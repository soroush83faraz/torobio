/**
 * Quality report + gates for data/market.sqlite.
 *   npm run data:check -- [--db data/market.sqlite] [--out data/quality-report.json]
 * Writes the report and exits non-zero when a gate fails.
 */
import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { buildFtsQuery, DOMAIN_CATEGORIES } from '@app/core';
import { REPO_ROOT, argValue, userPath } from './io';

/** Full-build invariants (PLAN B5). */
export const EXPECTED_FULL = { products: 225_903, offers: 331_506, shops_with_offers: 3_792, shops: 6_476 };
export const SIZE_TARGET_MB = 120;
export const SIZE_FAIL_MB = 200;
export const FTS_P95_GATE_MS = 50;

/** Iranian mobile / landline numbers (digits already Latin or Persian). */
const PHONE_RE = /(?<![0-9A-Za-z۰-۹])(?:(?:\+|00)98[\s-]?9\d{2}|0?9\d{2})[\s-]?\d{3}[\s-]?\d{4}(?![0-9۰-۹])|(?<![0-9A-Za-z۰-۹])0[1-8]\d{1,2}[\s-]?\d{7,8}(?![0-9۰-۹])/;
const CONTACT_RE = /instagram\.com|t\.me\/|wa\.me\/|https?:\/\/(?!image\.torob\.com)|www\./i;

interface Gate {
  name: string;
  ok: boolean;
  detail: string;
}

function toLatin(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function pct(n: number, d: number): number {
  return d ? Math.round((1000 * n) / d) / 10 : 0;
}

function main(): void {
  const args = process.argv.slice(2);
  const dbPath = userPath(argValue(args, '--db') ?? resolve(REPO_ROOT, 'data/market.sqlite'));
  const outPath = userPath(argValue(args, '--out') ?? resolve(REPO_ROOT, 'data/quality-report.json'));
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const one = <T = number>(sql: string, ...p: unknown[]): T => {
    const r = db.prepare(sql).get(...p) as Record<string, unknown>;
    return Object.values(r)[0] as T;
  };
  const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  const isSlice = !!meta.slice_limit_products;
  const rawCounts = JSON.parse(meta.raw_counts ?? '{}') as Record<string, number>;
  const gates: Gate[] = [];
  const gate = (name: string, ok: boolean, detail: string) => gates.push({ name, ok, detail });

  // ---------------------------------------------------------------- counts & joins
  const counts = {
    products: one('SELECT count(*) FROM products'),
    offers: one('SELECT count(*) FROM offers'),
    shops: one('SELECT count(*) FROM shops'),
    shops_with_offers: one('SELECT count(DISTINCT shop_id) FROM offers'),
    categories: one('SELECT count(*) FROM categories'),
    categories_with_products: one('SELECT count(*) FROM categories WHERE product_count > 0'),
    synonyms: one('SELECT count(*) FROM synonyms'),
    fts_rows: one('SELECT count(*) FROM products_fts'),
  };
  const joins = {
    offers_without_product: one('SELECT count(*) FROM offers o LEFT JOIN products p ON p.id = o.product_id WHERE p.id IS NULL'),
    offers_without_shop: one('SELECT count(*) FROM offers o LEFT JOIN shops s ON s.id = o.shop_id WHERE s.id IS NULL'),
    products_offer_count_mismatch: one('SELECT count(*) FROM products p WHERE p.offer_count != (SELECT count(*) FROM offers o WHERE o.product_id = p.id)'),
    shops_offer_count_mismatch: one('SELECT count(*) FROM shops s WHERE s.offer_count != (SELECT count(*) FROM offers o WHERE o.shop_id = s.id)'),
    products_min_price_mismatch: one('SELECT count(*) FROM products p WHERE p.min_price IS NOT (SELECT min(price) FROM offers o WHERE o.product_id = p.id)'),
    products_without_fts: one('SELECT count(*) FROM products p WHERE p.id NOT IN (SELECT rowid FROM products_fts)'),
    products_unknown_category: one('SELECT count(*) FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE c.id IS NULL'),
    synonyms_unknown_category: one('SELECT count(*) FROM synonyms s LEFT JOIN categories c ON c.id = s.category_id WHERE c.id IS NULL'),
    synonyms_category_without_products: one('SELECT count(DISTINCT s.category_id) FROM synonyms s JOIN categories c ON c.id = s.category_id WHERE c.product_count = 0'),
  };
  for (const [k, v] of Object.entries(joins)) {
    // in a slice many categories legitimately have no products
    if (isSlice && k === 'synonyms_category_without_products') continue;
    gate(`join:${k}`, v === 0, `${v}`);
  }
  gate('fts:one_row_per_product', counts.fts_rows === counts.products, `${counts.fts_rows} vs ${counts.products}`);
  if (isSlice) {
    gate('slice:shops_are_referenced', counts.shops === counts.shops_with_offers, `${counts.shops} shops, ${counts.shops_with_offers} referenced`);
  } else {
    for (const k of ['products', 'offers', 'shops_with_offers', 'shops'] as const) {
      gate(`full:${k}`, counts[k] === EXPECTED_FULL[k] && rawCounts[k] === EXPECTED_FULL[k], `db=${counts[k]} raw=${rawCounts[k]} expected=${EXPECTED_FULL[k]}`);
    }
  }

  // ---------------------------------------------------------------- privacy
  const cols = (db.prepare("SELECT m.name t, p.name c FROM sqlite_schema m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'").all() as Array<{ t: string; c: string }>);
  const badCols = cols.filter((r) => /phone|contact|instagram|website|tel|mobile|email/i.test(r.c)).map((r) => `${r.t}.${r.c}`);
  gate('privacy:no_contact_columns', badCols.length === 0, badCols.join(',') || 'none');
  const scan = (sql: string) => {
    let phones = 0, contacts = 0;
    const examples: string[] = [];
    for (const r of db.prepare(sql).iterate() as Iterable<{ v: string | null }>) {
      if (!r.v) continue;
      const t = toLatin(r.v);
      if (PHONE_RE.test(t)) { phones++; if (examples.length < 3) examples.push(r.v.slice(0, 80)); }
      if (CONTACT_RE.test(t)) contacts++;
    }
    return { phones, contacts, examples };
  };
  const privacy = {
    shop_name: scan('SELECT name v FROM shops'),
    shop_address: scan('SELECT address v FROM shops'),
    mall_name: scan('SELECT mall_name v FROM shops'),
    product_title: scan('SELECT title v FROM products'),
    seller_title: scan('SELECT seller_title v FROM offers WHERE seller_title IS NOT NULL'),
    warranty_text: scan('SELECT warranty_text v FROM offers WHERE warranty_text IS NOT NULL'),
  };
  const phoneHits = Object.values(privacy).reduce((a, b) => a + b.phones, 0);
  gate('privacy:no_phone_numbers_in_text', phoneHits === 0, `${phoneHits} ${JSON.stringify(Object.fromEntries(Object.entries(privacy).filter(([, v]) => v.phones).map(([k, v]) => [k, v.examples])))}`);
  const shopContacts = privacy.shop_name.contacts + privacy.shop_address.contacts;
  gate('privacy:no_links_in_shop_fields', shopContacts === 0, `${shopContacts}`);

  // ---------------------------------------------------------------- prices
  const prices = {
    bad_price: one('SELECT count(*) FROM offers WHERE price IS NOT NULL AND (price < 10000 OR price > 1e12)'),
    null_price_without_flag: one('SELECT count(*) FROM offers WHERE price IS NULL AND price_flag IS NULL'),
    flag_with_price: one('SELECT count(*) FROM offers WHERE price IS NOT NULL AND price_flag IS NOT NULL'),
    flags: Object.fromEntries((db.prepare('SELECT coalesce(price_flag, \'ok\') f, count(*) n FROM offers GROUP BY 1').all() as Array<{ f: string; n: number }>).map((r) => [r.f, r.n])),
    products_with_price: one('SELECT count(*) FROM products WHERE min_price IS NOT NULL'),
  };
  gate('price:clean_range', prices.bad_price === 0, `${prices.bad_price}`);
  gate('price:null_has_flag', prices.null_price_without_flag === 0 && prices.flag_with_price === 0, `${prices.null_price_without_flag}/${prices.flag_with_price}`);

  // ---------------------------------------------------------------- hours
  let sentinel = 0, badShift = 0, emptyObj = 0, withHours = 0, fridayClosed = 0, fridayOpen = 0, fridayUnknown = 0;
  const DAYS = new Set(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
  for (const r of db.prepare('SELECT hours FROM shops').iterate() as Iterable<{ hours: string | null }>) {
    if (r.hours == null) continue;
    withHours++;
    const h = JSON.parse(r.hours) as Record<string, Array<[number, number]>>;
    if (Object.keys(h).length === 0) emptyObj++;
    for (const [d, shifts] of Object.entries(h)) {
      if (!DAYS.has(d) || !Array.isArray(shifts)) badShift++;
      for (const s of shifts) {
        if (s[0] === 0 && s[1] === 0) sentinel++;
        if (!(s[0] >= 0 && s[1] > s[0] && s[1] <= 2880)) badShift++;
      }
    }
    if (!('fri' in h)) fridayUnknown++;
    else if (h.fri?.length === 0) fridayClosed++;
    else fridayOpen++;
  }
  gate('hours:no_sentinel_shifts', sentinel === 0, `${sentinel}`);
  gate('hours:valid_shifts', badShift === 0 && emptyObj === 0, `${badShift} bad, ${emptyObj} empty`);

  // ---------------------------------------------------------------- shops parsing
  const shopShare = (where: string) => {
    const tot = one(`SELECT count(*) FROM shops WHERE ${where}`);
    const f = (c: string) => pct(one(`SELECT count(*) FROM shops WHERE ${where} AND ${c} IS NOT NULL`), tot);
    return { shops: tot, mall_pct: f('mall_key'), floor_pct: f('floor'), unit_pct: f('unit'), hours_pct: f('hours') };
  };
  const shops = {
    all: shopShare('1'),
    with_offers: shopShare('offer_count > 0'),
    buildings: one('SELECT count(DISTINCT building_key) FROM shops'),
    mall_buildings: one("SELECT count(DISTINCT mall_key) FROM shops WHERE mall_key IS NOT NULL"),
    top_malls: db.prepare("SELECT mall_name, mall_key, count(*) shops, sum(offer_count) offers FROM shops WHERE mall_key IS NOT NULL GROUP BY mall_key ORDER BY shops DESC LIMIT 15").all(),
    floors: db.prepare('SELECT floor, count(*) n FROM shops WHERE floor IS NOT NULL GROUP BY floor ORDER BY n DESC LIMIT 12').all(),
    friday: { closed: fridayClosed, open: fridayOpen, unknown: fridayUnknown, with_hours: withHours },
  };
  gate('shops:hours_parsed', shops.all.hours_pct > 50, `${shops.all.hours_pct}%`);
  gate('shops:mall_parsed', shops.all.mall_pct > 40, `${shops.all.mall_pct}%`);

  // ---------------------------------------------------------------- attribute coverage per domain
  const coverage: Record<string, unknown> = {};
  for (const [domain] of DOMAIN_CATEGORIES) {
    const rows = db.prepare('SELECT attrs, brand FROM products WHERE domain = ?').all(domain) as Array<{ attrs: string | null; brand: string | null }>;
    const n = rows.length;
    const keys = new Map<string, { n: number; nonTitle: number }>();
    let brand = 0;
    for (const r of rows) {
      if (r.brand) brand++;
      if (!r.attrs) continue;
      const a = JSON.parse(r.attrs) as Record<string, unknown> & { _src?: Record<string, string> };
      for (const k of Object.keys(a)) {
        if (k === '_src' || k === 'brand_key') continue;
        const e = keys.get(k) ?? { n: 0, nonTitle: 0 };
        e.n++;
        if (a._src?.[k]) e.nonTitle++;
        keys.set(k, e);
      }
    }
    coverage[domain] = {
      products: n,
      brand_pct: pct(brand, n),
      attrs: Object.fromEntries([...keys].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => [k, { pct: pct(e.n, n), from_code_or_spec_pct: pct(e.nonTitle, n) }])),
    };
  }
  const brandAll = pct(one('SELECT count(*) FROM products WHERE brand IS NOT NULL'), counts.products);
  const withCodes = pct(one('SELECT count(*) FROM products WHERE model_codes IS NOT NULL'), counts.products);

  // ---------------------------------------------------------------- FTS timings
  const queries = ['دوربین داهوا ۲ مگاپیکسل', 'هارد ۲ ترابایت بنفش', 'XVR1B04-I', 'سیم افشان ۲.۵', 'قاب گوشی A56', 'آداپتور ۱۲ ولت ۲ آمپر', 'ضبط کننده ۸ کانال', 'کابل شبکه', 'گوشی سامسونگ', 'پروژکتور ۵۰ وات'];
  const stmt = db.prepare('SELECT p.id, p.min_price FROM products_fts f JOIN products p ON p.id = f.rowid WHERE products_fts MATCH ? ORDER BY bm25(products_fts) LIMIT 200');
  const timings: Array<{ q: string; fts: string; hits: number; p50_ms: number; p95_ms: number }> = [];
  for (const q of queries) {
    const fq = buildFtsQuery(q);
    const ts: number[] = [];
    let hits = 0;
    for (let i = 0; i < 21; i++) {
      const t = process.hrtime.bigint();
      hits = stmt.all(fq).length;
      ts.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    ts.shift(); // warm-up
    ts.sort((a, b) => a - b);
    timings.push({ q, fts: fq, hits, p50_ms: Math.round((ts[10] as number) * 100) / 100, p95_ms: Math.round((ts[18] as number) * 100) / 100 });
  }
  const worstP95 = Math.max(...timings.map((t) => t.p95_ms));
  gate('fts:p95_under_50ms', worstP95 < FTS_P95_GATE_MS, `worst p95 ${worstP95} ms`);
  if (!isSlice) gate('fts:demo_queries_hit', timings.every((t) => t.hits > 0), timings.filter((t) => t.hits === 0).map((t) => t.q).join(',') || 'all hit');

  // ---------------------------------------------------------------- size
  db.close();
  const sizeMb = Math.round((statSync(dbPath).size / 1024 / 1024) * 10) / 10;
  if (!isSlice) gate('size:under_fail_limit', sizeMb <= SIZE_FAIL_MB, `${sizeMb} MB (target ${SIZE_TARGET_MB} MB, fail above ${SIZE_FAIL_MB} MB)`);

  const report = {
    generated_at: new Date().toISOString(),
    db: dbPath,
    db_size_mb: sizeMb,
    size_target_mb: SIZE_TARGET_MB,
    size_within_target: sizeMb <= SIZE_TARGET_MB,
    slice: isSlice ? Number(meta.slice_limit_products) : null,
    meta: { data_version: meta.data_version, snapshot_date: meta.snapshot_date, build_time: meta.build_time, build_seconds: Number(meta.build_seconds) },
    counts,
    raw_counts: rawCounts,
    joins,
    privacy,
    prices,
    price_rules: JSON.parse(meta.price_rules ?? '{}'),
    warranty_codes: JSON.parse(meta.warranty_codes ?? '{}'),
    hours: { stats: JSON.parse(meta.hours_stats ?? '{}'), sentinel_shifts_in_db: sentinel, bad_shifts: badShift },
    shops,
    mall_stats: JSON.parse(meta.mall_stats ?? '{}'),
    products: { brand_pct: brandAll, with_model_codes_pct: withCodes, seller_titles_kept: Number(meta.seller_titles_kept) },
    attribute_coverage: coverage,
    fts_timings: timings,
    gates,
    passed: gates.every((g) => g.ok),
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const g of gates) console.log(`${g.ok ? 'PASS' : 'FAIL'}  ${g.name}  ${g.detail}`);
  console.log(`size ${sizeMb} MB${sizeMb > SIZE_TARGET_MB ? ` (above the ${SIZE_TARGET_MB} MB target)` : ''}; report: ${outPath}`);
  if (!report.passed) {
    console.error('data:check FAILED');
    process.exit(1);
  }
  console.log('data:check passed');
}

main();
