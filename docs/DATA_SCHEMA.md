# market.sqlite schema (contract between U2 data build and U3/U4 engine/server)

All text columns hold ORIGINAL display text unless suffixed `_norm`. Normalisation = packages/core/src/normalize.

```sql
meta(key TEXT PRIMARY KEY, value TEXT)       -- snapshot_date='2026-10-13', data_version, counts, build_time
categories(id INTEGER PRIMARY KEY, name TEXT, name_norm TEXT, product_count INTEGER)
synonyms(term_norm TEXT, category_id INTEGER, weight REAL DEFAULT 1)   -- hand-written Persian synonyms for demo domains
shops(
  id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, area_label TEXT, address TEXT,
  mall_key TEXT, mall_name TEXT, floor TEXT, unit TEXT,          -- parsed from address, NULL if not parseable
  building_key TEXT NOT NULL,                                    -- mall_key if present else 'c:'||round(lat,4)||','||round(lon,4)
  category_ids TEXT,                                             -- JSON int[] (declared categories)
  hours TEXT,                                                    -- NULL = no hours known; else JSON {"sat":[[540,1140]],"fri":[],...} minutes from 00:00, [] = closed, key absent = unknown
  fast_delivery INTEGER, offer_count INTEGER)
products(
  id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE, title TEXT, category_id INTEGER, brand TEXT, image_url TEXT,
  attrs TEXT,           -- JSON of extracted attributes (keys documented in packages/core/src/extract); absent key = unknown
  model_codes TEXT,     -- JSON string[] normalised (upper-case latin codes)
  min_price INTEGER, offer_count INTEGER, seller_count INTEGER)
offers(
  id INTEGER PRIMARY KEY, ext_id TEXT, product_id INTEGER, shop_id TEXT,
  price INTEGER,        -- price_clean (toman) or NULL
  price_flag TEXT,      -- NULL | 'missing' | 'placeholder' | 'outlier'
  seller_title TEXT,    -- only when it differs from product title
  warranty_code TEXT,   -- 'on_site_test' | 'company' | 'authenticity' | 'none' | 'other' | NULL
  warranty_text TEXT, warranty_months INTEGER, changed_at TEXT)    -- ISO date of last price change
CREATE VIRTUAL TABLE products_fts USING fts5(text, category_id UNINDEXED, tokenize='unicode61 remove_diacritics 2');  -- rowid = products.id; text = title_norm + seller titles_norm + brand_norm + model codes
-- indexes: offers(product_id), offers(shop_id), products(category_id), shops(building_key)
```
Target size <= ~120 MB; measure and report.

## U2 additions and value formats (implemented by scripts/data; nothing above renamed or removed)

Build: `npm run data:build -- [--csv-dir DIR] [--out data/market.sqlite] [--limit-products N]`;
gates: `npm run data:check` (writes `data/quality-report.json`, exits non-zero on failure).
Full build: 225,903 products, 331,506 offers, 6,476 shops (3,792 with offers), ~130 MB, ~35 s.

Added columns / objects:
- `categories.domain TEXT` and `products.domain TEXT`: extraction domain (`cctv_camera`, `recorder`,
  `hdd`, `adapter`, `wire`, `phone`, `phone_accessory`, `charger`, `power_bank`, `headphones`,
  `lighting`, `switch_socket`) or NULL. Attribute keys per domain: packages/core/src/extract/ATTRIBUTES.md.
- `CREATE VIEW products_fts_src AS SELECT id, title AS text, category_id FROM products` and
  `products_fts` is declared with `content='products_fts_src', content_rowid='id'` (external content,
  saves ~22 MB). MATCH / rowid / bm25() / `category_id` work as specified; the INDEX holds the
  normalised tokens (title + seller titles + brand + model codes, built with `toFtsText` semantics);
  `SELECT text FROM products_fts` returns the product title. Read-only: never run 'rebuild'/'delete'.
  Query with `buildFtsQuery(userText)` from packages/core (quotes every token, prefix on the last).
- Extra indexes: `shops(mall_key)`, `synonyms(term_norm)`; `products.ext_id` is UNIQUE.

Value formats:
- ids: `products.id` = 1-based row order of products.csv, `offers.id` = 1-based row order of offers.csv;
  `categories.id` = rank of the category name in code-point order over all product and shop
  categories (same ids in slice and full builds). `synonyms.category_id` resolves to real categories.
- `shops.floor`: canonical floor as text: `"0"` همکف, `"-1"` زیرهمکف/زیرزمین/منفی ۱, `"-2"`…, `"1"`…`"40"`,
  `"M"` نیم‌طبقه/بالای همکف; NULL when not stated or ambiguous. `shops.unit`: as written, Latin digits and
  upper-case letters (`"62"`, `"A41"`, `"63/1"`, `"39 و 40"`); «پلاک» is used as the unit only inside a parsed mall.
- `shops.mall_key`: `"m:<folded name>"` (spelling variants folded: علاالدین/علاءالدین/علائدین → `m:علاالدین`);
  a second building with the same name elsewhere gets `"m:<name>#2"`. «علاالدین ۲/۳» and «علاالدین آرایشی»
  are separate buildings (their shops' median coordinates are 140–520 m from the main one) and keep separate keys.
  `mall_name` = the most common spelling in that building. A mall name whose pin is > 600 m from every
  cluster of that name keeps `mall_name` but gets `mall_key` NULL (building_key then uses coordinates).
- `shops.building_key`: `mall_key`, else `"c:<lat rounded 4>,<lon rounded 4>"` (JS `Number(x.toFixed(4))`).
- `shops.hours`: as above; shifts can end at 1440 (midnight) and, for overnight shifts, after 1440.
  The 00:00–00:00 second-shift sentinel is dropped; status `unsupported` => day absent; a shop with no
  known day => NULL. `fast_delivery`: 1/0/NULL.
  **Placeholder Friday:** a Friday of exactly 00:00-23:59 (stored `[[0,1440]]`) on a shop whose every other
  open day is a normal schedule (none round-the-clock) is treated as unknown (key `fri` absent), not as
  «۰ تا ۲۴». Evidence (2026-10 snapshot): 97 shops declare 00:00-23:59 on some day; 85 of them on Friday, and
  64 of those (34 with offers) have only normal hours on every other open day, i.e. 7 % of the 916 shops open on
  Friday with normal weekdays, versus 0.6 % (19-27 of 4,472 shops with hours) for any other single weekday. The
  other 33 are left as declared: 12 shops declare round-the-clock on all seven days, 9 on Friday plus some
  other days, 12 on some weekdays but not Friday. The rule is applied in the
  data build (`scripts/data/src/clean/hours.ts`, counted as `hours_stats.placeholderFriday`) and again when the
  server reads `shops.hours` (`apps/server/src/adapter/rows.ts`), so a snapshot built before the rule reads
  the same way.
- `products.brand`: Persian display brand (dataset `brand_name`, else a single unambiguous lexicon match
  in the title outside accessory/part categories). `attrs.brand_key` holds the stable slug.
- `products.attrs`: JSON; absent key = unknown; `_src` marks values not read from the title text.
- `products.model_codes`: JSON string[] of `normalizeModelCode` forms (A-Z0-9 only), primary codes first,
  then variants (without Dahua `DH-` prefix, main segment).
- `products.image_url`: first image URL; `min_price`: min clean offer price (NULL if none).
- `offers.changed_at`: `YYYY-MM-DD`. `offers.seller_title`: only when its search tokens differ from the
  product title's. `warranty_months`: dataset period, else a single unambiguous period in the text.
- `meta` keys: `schema_version`, `snapshot_date`, `data_version`, `build_time`, `build_seconds`,
  `slice_limit_products` ('' for full builds), `counts`, `raw_counts`, `price_rules`, `warranty_codes`,
  `hours_stats`, `mall_stats`, `seller_titles_kept`, `fts_chars`, `shop_names_note` (JSON where structured).
- Never present: shop contacts/phone numbers, instagram, website, offer descriptions.
