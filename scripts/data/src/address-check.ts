/**
 * Address hand-check helper: prints a reproducible sample of shop addresses
 * from the biggest malls (and some non-mall addresses) with the parsed
 * mall / floor / unit, for a human to verify.
 *   npm run address-check -w @app/data -- [--db data/market.sqlite] [--per-mall 4] [--malls 10]
 */
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { REPO_ROOT, argValue, userPath } from './io';

const args = process.argv.slice(2);
const db = new Database(userPath(argValue(args, '--db') ?? resolve(REPO_ROOT, 'data/market.sqlite')), { readonly: true });
const perMall = Number(argValue(args, '--per-mall') ?? 4);
const nMalls = Number(argValue(args, '--malls') ?? 10);
const malls = db
  .prepare('SELECT mall_key, mall_name, count(*) n FROM shops WHERE mall_key IS NOT NULL GROUP BY mall_key ORDER BY n DESC LIMIT ?')
  .all(nMalls) as Array<{ mall_key: string; mall_name: string; n: number }>;
const pick = db.prepare(
  "SELECT id, address, mall_name, mall_key, floor, unit FROM shops WHERE mall_key = ? ORDER BY substr(id, 12) LIMIT ?",
);
let i = 0;
for (const m of malls) {
  for (const r of pick.all(m.mall_key, perMall) as Array<Record<string, string | null>>) {
    console.log(`${++i}\t${r.address}\n\t=> mall=${r.mall_name ?? '-'} [${r.mall_key ?? '-'}] floor=${r.floor ?? '-'} unit=${r.unit ?? '-'}`);
  }
}
// addresses that mention a mall word but got no mall key
const missed = db
  .prepare("SELECT id, address, mall_name, mall_key, floor, unit FROM shops WHERE mall_key IS NULL AND (address LIKE '%پاساژ%' OR address LIKE '%مجتمع%') ORDER BY substr(id, 12) LIMIT ?")
  .all(Number(argValue(args, '--no-mall') ?? 10)) as Array<Record<string, string | null>>;
for (const r of missed) console.log(`${++i}\t${r.address}\n\t=> mall=${r.mall_name ?? '-'} [${r.mall_key ?? '-'}] floor=${r.floor ?? '-'} unit=${r.unit ?? '-'}`);
