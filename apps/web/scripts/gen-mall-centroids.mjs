#!/usr/bin/env node
/**
 * Writes src/assets/mallCentroids.json for the Home "living map" hero (HomeMapHero).
 *
 *   node apps/web/scripts/gen-mall-centroids.mjs [path/to/market.sqlite]
 *
 * Reads the market database read-only (node:sqlite) and writes one compact row per mall:
 * [lat, lon, shopCount] with 4 decimals (about 11 m), largest malls first, plus the short names of the
 * biggest few for the hero's labels. The file is committed: the build never needs the database.
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.argv[2] ?? path.resolve(here, '../../../data/market.sqlite');
const out = path.resolve(here, '../src/assets/mallCentroids.json');

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare(
    `SELECT mall_key AS k, mall_name AS name, COUNT(*) AS n, AVG(lat) AS lat, AVG(lon) AS lon
       FROM shops
      WHERE mall_key IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
      GROUP BY mall_key
      ORDER BY n DESC, k`,
  )
  .all();
const totals = db.prepare('SELECT COUNT(*) AS shops FROM shops').get();
db.close();

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const shortName = (s) =>
  String(s ?? '')
    .replace(/^(پاساژ|ساختمان|مجتمع|بازار)\s+/, '')
    .trim();

const data = {
  /** Rows: [lat, lon, shopCount], biggest first. */
  malls: rows.map((r) => [r4(r.lat), r4(r.lon), r.n]),
  /** Short names of the biggest malls, same order as the first rows of `malls`. */
  names: rows.slice(0, 12).map((r) => shortName(r.name)),
  shops: totals.shops,
};
const json = JSON.stringify(data);
writeFileSync(out, json + '\n');
console.log(`wrote ${out}: ${data.malls.length} malls, ${json.length} bytes`);
