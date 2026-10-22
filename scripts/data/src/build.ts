/**
 * Raw Torob CSVs -> data/market.sqlite (read-only, slim) — see docs/DATA_SCHEMA.md.
 *
 *   npm run data:build -- [--csv-dir DIR] [--out data/market.sqlite] [--limit-products N]
 *
 * --limit-products N builds a self-consistent slice: the first N products (file
 * order), all their offers, and only the shops those offers reference.
 * Never written: shop contacts / phone numbers, instagram, website, offer descriptions.
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { extractProduct, normalizeFa, tokenizeForSearch } from '@app/core';
import { parseAddress } from './clean/address';
import { parseHours, type HoursStats } from './clean/hours';
import { canonicalMallFold, resolveMalls, type MallMember } from './clean/malls';
import { cleanPrice, normalizeWarranty } from './clean/offer';
import { REPO_ROOT, argValue, defaultCsvDir, parseJson, readCsv, userPath } from './io';
import { SYNONYMS } from './synonyms';

export const SNAPSHOT_DATE = '2026-10-13';
export const SCHEMA_VERSION = '1';

interface OfferLite {
  idx: number;
  ext: string;
  shop: string;
  priceRaw: string | null;
  seller: string | null;
  warranty: string | null;
  changed: string | null;
}

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT NOT NULL, product_count INTEGER NOT NULL DEFAULT 0, domain TEXT);
CREATE TABLE synonyms(term_norm TEXT NOT NULL, category_id INTEGER NOT NULL, weight REAL DEFAULT 1);
CREATE TABLE shops(
  id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, area_label TEXT, address TEXT,
  mall_key TEXT, mall_name TEXT, floor TEXT, unit TEXT,
  building_key TEXT NOT NULL,
  category_ids TEXT,
  hours TEXT,
  fast_delivery INTEGER, offer_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE products(
  id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category_id INTEGER, brand TEXT, image_url TEXT,
  attrs TEXT, model_codes TEXT,
  min_price INTEGER, offer_count INTEGER NOT NULL DEFAULT 0, seller_count INTEGER NOT NULL DEFAULT 0,
  domain TEXT);
CREATE TABLE offers(
  id INTEGER PRIMARY KEY, ext_id TEXT NOT NULL, product_id INTEGER NOT NULL, shop_id TEXT NOT NULL,
  price INTEGER, price_flag TEXT, seller_title TEXT,
  warranty_code TEXT, warranty_text TEXT, warranty_months INTEGER, changed_at TEXT);
-- External-content FTS: the index holds the normalised tokens written at build time
-- (title + seller titles + brand + model codes); reading products_fts.text returns the
-- product title through the view. Read-only DB: never run 'rebuild' / 'delete' on it.
CREATE VIEW products_fts_src AS SELECT id, title AS text, category_id FROM products;
CREATE VIRTUAL TABLE products_fts USING fts5(text, category_id UNINDEXED, content='products_fts_src', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
`;

const INDEXES = `
CREATE INDEX idx_offers_product ON offers(product_id);
CREATE INDEX idx_offers_shop ON offers(shop_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_shops_building ON shops(building_key);
CREATE INDEX idx_shops_mall ON shops(mall_key);
CREATE INDEX idx_synonyms_term ON synonyms(term_norm);
`;

function log(msg: string): void {
  process.stderr.write(`[data:build ${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

function round4(v: number): number {
  return Number(v.toFixed(4));
}

function firstImage(raw: string | null): string | null {
  const arr = parseJson<unknown>(raw);
  if (Array.isArray(arr) && typeof arr[0] === 'string') return arr[0];
  return null;
}

function changedDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? (m[1] as string) : null;
}

export interface BuildOptions {
  csvDir: string;
  out: string;
  limitProducts?: number;
}

export async function build(opts: BuildOptions): Promise<void> {
  const t0 = Date.now();
  const { csvDir, out } = opts;
  const limit = opts.limitProducts && opts.limitProducts > 0 ? opts.limitProducts : null;
  for (const f of ['shops.csv', 'products.csv', 'offers.csv']) {
    if (!existsSync(resolve(csvDir, f))) throw new Error(`missing ${resolve(csvDir, f)} (use --csv-dir)`);
  }
  log(`csv dir ${csvDir}; out ${out}${limit ? `; slice of ${limit} products` : ''}`);

  // ---------------------------------------------------------------- shops (small: in memory)
  const shopRows: Array<Record<string, string | null>> = [];
  for await (const r of readCsv(resolve(csvDir, 'shops.csv'))) shopRows.push(r);
  log(`shops: ${shopRows.length}`);

  // ---------------------------------------------------------------- offers grouped by product
  const offersByProduct = new Map<string, OfferLite[]>();
  let rawOffers = 0;
  const rawShopsWithOffers = new Set<string>();
  for await (const r of readCsv(resolve(csvDir, 'offers.csv'))) {
    rawOffers++;
    const o: OfferLite = {
      idx: rawOffers,
      ext: r.offer_id as string,
      shop: r.shop_id as string,
      priceRaw: r.price_toman ?? null,
      seller: r.seller_title ?? null,
      warranty: r.warranty ?? null,
      changed: r.last_price_changed_at ?? null,
    };
    rawShopsWithOffers.add(o.shop);
    const pid = r.product_id as string;
    const list = offersByProduct.get(pid);
    if (list) list.push(o);
    else offersByProduct.set(pid, [o]);
  }
  log(`offers: ${rawOffers} for ${offersByProduct.size} products`);

  // ---------------------------------------------------------------- pass 1 over products: categories
  const catCountsRaw = new Map<string, number>();
  let rawProducts = 0;
  for await (const r of readCsv(resolve(csvDir, 'products.csv'))) {
    rawProducts++;
    const c = r.category_name;
    if (c) catCountsRaw.set(c, (catCountsRaw.get(c) ?? 0) + 1);
  }
  const catNames = new Set<string>(catCountsRaw.keys());
  for (const s of shopRows) for (const c of parseJson<string[]>(s.category_names) ?? []) if (typeof c === 'string') catNames.add(c);
  // stable ids: code-point order of the names (identical for slice and full builds)
  const sortedCats = [...catNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const catId = new Map<string, number>();
  sortedCats.forEach((n, i) => catId.set(n, i + 1));
  log(`products: ${rawProducts}; categories: ${sortedCats.length}`);

  // ---------------------------------------------------------------- DB
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  rmSync(tmp, { force: true });
  const db = new Database(tmp);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('page_size = 4096');
  db.exec(SCHEMA);

  const insProduct = db.prepare(
    'INSERT INTO products(id, ext_id, title, category_id, brand, image_url, attrs, model_codes, min_price, offer_count, seller_count, domain) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  const insOffer = db.prepare(
    'INSERT INTO offers(id, ext_id, product_id, shop_id, price, price_flag, seller_title, warranty_code, warranty_text, warranty_months, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  const insFts = db.prepare('INSERT INTO products_fts(rowid, text, category_id) VALUES (?,?,?)');

  const usedShops = new Map<string, number>(); // shop -> offers in DB
  const catCountDb = new Map<number, number>();
  const priceFlags: Record<string, number> = { missing: 0, placeholder: 0, outlier: 0 };
  const warrantyCodes: Record<string, number> = {};
  let nProducts = 0;
  let nOffers = 0;
  let sellerTitlesKept = 0;
  let ftsChars = 0;

  const batchSize = 5000;
  let batch: Array<() => void> = [];
  const flush = db.transaction((fns: Array<() => void>) => { for (const f of fns) f(); });

  let pid = 0;
  for await (const r of readCsv(resolve(csvDir, 'products.csv'))) {
    pid++;
    if (limit && pid > limit) break;
    const ext = r.product_id as string;
    const title = r.persian_title ?? '';
    const cat = r.category_name;
    const cid = cat ? (catId.get(cat) ?? null) : null;
    const specs = parseJson<Array<{ key: string; value: string }>>(r.specs);
    const ex = extractProduct({ title, categoryName: cat, brandField: r.brand_name, modelField: r.model, specs });
    const offers = offersByProduct.get(ext) ?? [];
    const titleKey = tokenizeForSearch(title).join(' ');
    let minPrice: number | null = null;
    const shops = new Set<string>();
    const extraTokens = new Set<string>();
    const rows: unknown[][] = [];
    for (const o of offers) {
      const { price, flag } = cleanPrice(o.priceRaw);
      if (flag) priceFlags[flag] = (priceFlags[flag] ?? 0) + 1;
      if (price != null && (minPrice == null || price < minPrice)) minPrice = price;
      shops.add(o.shop);
      const w = normalizeWarranty(parseJson(o.warranty));
      if (w.code) warrantyCodes[w.code] = (warrantyCodes[w.code] ?? 0) + 1;
      let seller: string | null = null;
      // kept only when it differs from the product title beyond spacing/punctuation/letter forms
      if (o.seller && tokenizeForSearch(o.seller).join(' ') !== titleKey) {
        seller = o.seller;
        sellerTitlesKept++;
        for (const t of tokenizeForSearch(o.seller)) extraTokens.add(t);
      }
      rows.push([o.idx, o.ext, pid, o.shop, price, flag, seller, w.code, w.text, w.months, changedDate(o.changed)]);
      usedShops.set(o.shop, (usedShops.get(o.shop) ?? 0) + 1);
    }
    // FTS text: title tokens in order, then the extra tokens of seller titles, brand and model codes
    const titleTokens = tokenizeForSearch(title);
    const have = new Set(titleTokens);
    if (ex.brand) for (const t of tokenizeForSearch(ex.brand)) extraTokens.add(t);
    if (ex.brandKey && !ex.brandKey.startsWith('fa:')) extraTokens.add(ex.brandKey.replace(/[^a-z0-9]/g, ''));
    for (const c of ex.modelCodes) extraTokens.add(c.toLowerCase());
    const extra = [...extraTokens].filter((t) => !have.has(t) && t.length > 0);
    const ftsText = [...titleTokens, ...extra].join(' ');
    ftsChars += ftsText.length;
    const attrs = Object.keys(ex.attrs).length ? JSON.stringify(ex.attrs) : null;
    const codes = ex.modelCodes.length ? JSON.stringify(ex.modelCodes) : null;
    const id = pid;
    const productRow = [id, ext, title, cid, ex.brand, firstImage(r.image_urls ?? null), attrs, codes, minPrice, offers.length, shops.size, ex.domain];
    batch.push(() => {
      insProduct.run(productRow);
      for (const row of rows) insOffer.run(row);
      insFts.run(id, ftsText, cid);
    });
    nProducts++;
    nOffers += offers.length;
    if (cid != null) catCountDb.set(cid, (catCountDb.get(cid) ?? 0) + 1);
    if (batch.length >= batchSize) {
      flush(batch);
      batch = [];
    }
    if (pid % 50000 === 0) log(`products ${pid}…`);
  }
  if (batch.length) flush(batch);
  log(`inserted ${nProducts} products, ${nOffers} offers`);

  // ---------------------------------------------------------------- shops
  const hoursStats: HoursStats = { sentinelsDropped: 0, midnightFixed: 0, overnight: 0, declaredEmpty: 0, placeholderFriday: 0 };
  const parsed = shopRows.map((s) => ({ s, a: parseAddress(s.address) }));
  const members: MallMember[] = [];
  for (const { s, a } of parsed) {
    const fold = canonicalMallFold(a.mallFold);
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    if (fold && a.mallRaw && Number.isFinite(lat) && Number.isFinite(lon)) members.push({ id: s.shop_id as string, fold, raw: a.mallRaw, lat, lon });
  }
  const malls = resolveMalls(members);
  log(`malls: ${malls.clusters} buildings from ${members.length} shops with a mall name (${malls.dropped} without a key, ${malls.attached} attached to their mall, ${malls.merged} clusters merged)`);
  const insShop = db.prepare(
    'INSERT INTO shops(id, name, lat, lon, area_label, address, mall_key, mall_name, floor, unit, building_key, category_ids, hours, fast_delivery, offer_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  let nShops = 0;
  const shopTx = db.transaction(() => {
    for (const { s, a } of parsed) {
      const id = s.shop_id as string;
      if (limit && !usedShops.has(id)) continue;
      const lat = s.lat != null ? Number(s.lat) : null;
      const lon = s.lon != null ? Number(s.lon) : null;
      const m = malls.assign.get(id);
      // a readable mall name that could not be tied to one building keeps its display name, but no key
      const looseName = !m && canonicalMallFold(a.mallFold) ? a.mallRaw : null;
      const building = m ? m.mallKey : lat != null && lon != null ? `c:${round4(lat)},${round4(lon)}` : `s:${id}`;
      const cats = (parseJson<string[]>(s.category_names) ?? []).map((c) => catId.get(c)).filter((x): x is number => x != null);
      const hours = parseHours(parseJson(s.weekly_hours), hoursStats);
      const fd = s.supports_fast_delivery === 'true' ? 1 : s.supports_fast_delivery === 'false' ? 0 : null;
      insShop.run(
        id,
        s.name,
        lat,
        lon,
        s.location_label,
        s.address,
        m?.mallKey ?? null,
        m?.mallName ?? looseName,
        a.floor,
        a.unit,
        building,
        JSON.stringify(cats),
        hours ? JSON.stringify(hours) : null,
        fd,
        usedShops.get(id) ?? 0,
      );
      nShops++;
    }
  });
  shopTx();
  log(`shops inserted: ${nShops}`);

  // ---------------------------------------------------------------- categories + synonyms
  const { domainForCategory } = await import('@app/core');
  const insCat = db.prepare('INSERT INTO categories(id, name, name_norm, product_count, domain) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    for (const [name, id] of catId) insCat.run(id, name, normalizeFa(name), catCountDb.get(id) ?? 0, domainForCategory(name));
  })();
  const insSyn = db.prepare('INSERT INTO synonyms(term_norm, category_id, weight) VALUES (?,?,?)');
  const missingSyn: string[] = [];
  db.transaction(() => {
    const seen = new Set<string>();
    for (const [term, cat, w] of SYNONYMS) {
      const id = catId.get(cat);
      if (id == null) { missingSyn.push(cat); continue; }
      const tn = normalizeFa(term);
      const k = `${tn}|${id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      insSyn.run(tn, id, w ?? 1);
    }
  })();
  if (missingSyn.length) throw new Error(`synonym categories not found: ${[...new Set(missingSyn)].join(' | ')}`);

  // ---------------------------------------------------------------- meta
  const buildSeconds = Math.round((Date.now() - t0) / 1000);
  const meta: Record<string, string> = {
    schema_version: SCHEMA_VERSION,
    snapshot_date: SNAPSHOT_DATE,
    data_version: `${SNAPSHOT_DATE}.s${SCHEMA_VERSION}${limit ? `.slice${limit}` : ''}`,
    build_time: new Date().toISOString(),
    build_seconds: String(buildSeconds),
    slice_limit_products: limit ? String(limit) : '',
    counts: JSON.stringify({ products: nProducts, offers: nOffers, shops: nShops, shops_with_offers: usedShops.size, categories: catId.size }),
    raw_counts: JSON.stringify({ products: rawProducts, offers: rawOffers, shops: shopRows.length, shops_with_offers: rawShopsWithOffers.size }),
    price_rules: JSON.stringify({ min: 10000, max: 1e12, flags: priceFlags }),
    warranty_codes: JSON.stringify(warrantyCodes),
    hours_stats: JSON.stringify(hoursStats),
    mall_stats: JSON.stringify({ buildings: malls.clusters, shops_with_mall_name: members.length, without_key: malls.dropped, attached_by_name: malls.attached, merged_clusters: malls.merged }),
    seller_titles_kept: String(sellerTitlesKept),
    fts_chars: String(ftsChars),
    shop_names_note: 'Shop names are as provided by the dataset (the organisers may have fictionalised them). Contacts, phone numbers, instagram and websites are not included.',
  };
  const insMeta = db.prepare('INSERT INTO meta(key, value) VALUES (?,?)');
  db.transaction(() => { for (const [k, v] of Object.entries(meta)) insMeta.run(k, v); })();

  log('indexes, FTS optimize, ANALYZE, VACUUM…');
  db.exec(INDEXES);
  db.exec("INSERT INTO products_fts(products_fts) VALUES('optimize')");
  db.exec('ANALYZE');
  db.close();
  const db2 = new Database(tmp);
  db2.exec('VACUUM');
  db2.close();
  rmSync(out, { force: true });
  renameSync(tmp, out);
  const mb = statSync(out).size / 1024 / 1024;
  log(`done in ${Math.round((Date.now() - t0) / 1000)}s: ${out} (${mb.toFixed(1)} MB); peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith('build.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const csvDir = userPath(argValue(args, '--csv-dir') ?? defaultCsvDir());
  const outArg = argValue(args, '--out');
  const out = outArg ? userPath(outArg) : resolve(REPO_ROOT, 'data/market.sqlite');
  const lim = argValue(args, '--limit-products');
  build({ csvDir, out, limitProducts: lim ? Number(lim) : undefined }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
