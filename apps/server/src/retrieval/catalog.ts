/**
 * Read-only market catalog over market.sqlite.
 *
 * The database is opened read-only and never changes while the process runs, so per-category candidate
 * pools, shops, categories and synonyms are cached in memory (bounded LRU for pools). All SQL is constant;
 * user input reaches SQLite only as bound parameters (FTS MATCH strings are built by core buildFtsQuery,
 * which quotes every token; id lists are bound as one JSON array and expanded with json_each).
 */
import type { HeadStats, Shop } from '@app/core';
import { headStatsBuilder, tokenizeForSearch, withWireUnitCheck } from '@app/core';
import type { Db } from '../db.js';
import { toCandidate, toOffer, toShop, type MarketCandidate, type OfferRow, type ProductRow, type ShopRow } from '../adapter/rows.js';

export interface CategoryInfo {
  id: number;
  name: string;
  domain: string | null;
  productCount: number;
}

export interface SynonymEntry {
  tokens: string[];
  categoryId: number;
  weight: number;
}

interface HeadRow {
  id: number;
  title: string;
  categoryId: number;
}

export interface FtsHit {
  id: number;
  categoryId: number | null;
}

/** Products per category pool; the largest demo category (wire) has ~5.3k products with offers. */
export const MAX_POOL = 6000;
/** Max products kept in the pool cache across categories. */
const POOL_CACHE_PRODUCTS = 80_000;

const P_COLS = 'p.id, p.title, p.category_id, p.brand, p.image_url, p.attrs, p.model_codes, p.min_price, p.offer_count, p.seller_count, p.domain';
const O_COLS = 'o.id, o.product_id, o.shop_id, o.price, o.price_flag, o.seller_title, o.warranty_code, o.warranty_months, o.changed_at';

const SQL = {
  categories: 'SELECT id, name, domain, product_count AS productCount FROM categories',
  synonyms: 'SELECT term_norm AS term, category_id AS categoryId, weight FROM synonyms',
  shops: 'SELECT id, name, lat, lon, area_label, address, mall_key, mall_name, floor, unit, building_key, hours FROM shops',
  poolProducts: `SELECT ${P_COLS} FROM products p WHERE p.category_id = ? AND p.offer_count > 0
                 ORDER BY (p.min_price IS NULL), p.offer_count DESC, p.id LIMIT ?`,
  poolOffers: `SELECT ${O_COLS} FROM offers o JOIN products p ON p.id = o.product_id
               WHERE p.category_id = ? AND p.offer_count > 0 ORDER BY o.id`,
  productsByIds: `SELECT ${P_COLS} FROM products p WHERE p.id IN (SELECT value FROM json_each(?))`,
  offersByProducts: `SELECT ${O_COLS} FROM offers o WHERE o.product_id IN (SELECT value FROM json_each(?)) ORDER BY o.id`,
  fts: `SELECT rowid AS id, category_id AS categoryId FROM products_fts WHERE products_fts MATCH ?
        ORDER BY bm25(products_fts) LIMIT ?`,
  headRows: 'SELECT id, title, category_id AS categoryId FROM products WHERE offer_count > 0 AND category_id IS NOT NULL',
  ftsInCats: `SELECT rowid AS id, category_id AS categoryId FROM products_fts WHERE products_fts MATCH ?
              AND category_id IN (SELECT value FROM json_each(?)) ORDER BY bm25(products_fts) LIMIT ?`,
} as const;

export interface PoolStats {
  hits: number;
  misses: number;
}

export class Catalog {
  private categoriesById: Map<number, CategoryInfo> | null = null;
  private synonymList: SynonymEntry[] | null = null;
  private shopMap: Map<string, Shop> | null = null;
  private pools = new Map<number, { cands: MarketCandidate[]; truncated: boolean }>();
  private pooledProducts = 0;
  private heads: HeadStats | null = null;
  private headWork: { rows: HeadRow[]; next: number; builder: ReturnType<typeof headStatsBuilder> } | null = null;
  readonly stats: PoolStats = { hits: 0, misses: 0 };

  constructor(private readonly db: Db) {}

  categories(): Map<number, CategoryInfo> {
    if (!this.categoriesById) {
      const rows = this.db.prepare(SQL.categories).all() as CategoryInfo[];
      this.categoriesById = new Map(rows.map((r) => [r.id, r]));
    }
    return this.categoriesById;
  }

  synonyms(): SynonymEntry[] {
    if (!this.synonymList) {
      const rows = this.db.prepare(SQL.synonyms).all() as { term: string; categoryId: number; weight: number | null }[];
      this.synonymList = rows
        .map((r) => ({ tokens: tokenizeForSearch(r.term), categoryId: r.categoryId, weight: r.weight ?? 1 }))
        .filter((s) => s.tokens.length > 0);
    }
    return this.synonymList;
  }

  shops(): Map<string, Shop> {
    if (!this.shopMap) {
      const rows = this.db.prepare(SQL.shops).all() as ShopRow[];
      this.shopMap = new Map(rows.map((r) => [r.id, toShop(r)]));
    }
    return this.shopMap;
  }

  /** Every product with offers in one category (bounded), with all its offers. Cached. */
  categoryPool(categoryId: number): { cands: MarketCandidate[]; truncated: boolean } {
    const hit = this.pools.get(categoryId);
    if (hit) {
      this.stats.hits++;
      this.pools.delete(categoryId);
      this.pools.set(categoryId, hit);
      return hit;
    }
    this.stats.misses++;
    const prods = this.db.prepare(SQL.poolProducts).all(categoryId, MAX_POOL + 1) as ProductRow[];
    const truncated = prods.length > MAX_POOL;
    if (truncated) prods.length = MAX_POOL;
    const keep = new Set(prods.map((p) => p.id));
    const offers = this.db.prepare(SQL.poolOffers).all(categoryId) as OfferRow[];
    const byProduct = new Map<number, OfferRow[]>();
    for (const o of offers) {
      if (!keep.has(o.product_id)) continue;
      const l = byProduct.get(o.product_id);
      if (l) l.push(o);
      else byProduct.set(o.product_id, [o]);
    }
    let cands = prods.map((p) => toCandidate(p, (byProduct.get(p.id) ?? []).map((o) => toOffer(o, p.domain))));
    // wire: an offer whose price contradicts its listing's sale unit (roll vs metre) loses its price (core plausibility)
    if (this.categories().get(categoryId)?.domain === 'wire') cands = withWireUnitCheck(cands);
    const entry = { cands, truncated };
    this.pools.set(categoryId, entry);
    this.pooledProducts += cands.length;
    for (const [k, v] of this.pools) {
      if (this.pooledProducts <= POOL_CACHE_PRODUCTS || k === categoryId) break;
      this.pools.delete(k);
      this.pooledProducts -= v.cands.length;
    }
    return entry;
  }

  /** Products by id (pins, model-code hits outside a pool). */
  productsByIds(ids: readonly number[]): MarketCandidate[] {
    const uniq = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))].slice(0, 500);
    if (uniq.length === 0) return [];
    const json = JSON.stringify(uniq);
    const prods = this.db.prepare(SQL.productsByIds).all(json) as ProductRow[];
    const offers = this.db.prepare(SQL.offersByProducts).all(json) as OfferRow[];
    const byProduct = new Map<number, OfferRow[]>();
    for (const o of offers) byProduct.set(o.product_id, [...(byProduct.get(o.product_id) ?? []), o]);
    const cats = this.categories();
    return prods.map((p) => {
      // wire listings are judged against their whole category (sale-unit check): take the pooled candidate
      if (p.category_id !== null && cats.get(p.category_id)?.domain === 'wire') {
        const pooled = this.categoryPool(p.category_id).cands.find((c) => c.product.id === p.id);
        if (pooled) return pooled;
      }
      return toCandidate(p, (byProduct.get(p.id) ?? []).map((o) => toOffer(o, p.domain)));
    });
  }

  /** Title-head counts over every listing with offers (core plausibility rule 1). Finishes any pending warm-up. */
  headStats(): HeadStats {
    if (!this.heads) {
      const w = this.headWorkStart();
      while (w.next < w.rows.length) w.builder.add(w.rows[w.next++]!);
      this.heads = w.builder.build();
      this.headWork = null;
    }
    return this.heads;
  }

  /**
   * Warm-up step for headStats (~2 s of work over the full snapshot): processes `chunk` listings and returns true
   * when the stats are ready. Called once per event-loop turn by the prewarm, so requests are never blocked long.
   */
  warmHeadStats(chunk = 10_000): boolean {
    if (this.heads) return true;
    const w = this.headWorkStart();
    const end = Math.min(w.rows.length, w.next + chunk);
    while (w.next < end) w.builder.add(w.rows[w.next++]!);
    if (w.next >= w.rows.length) this.headStats();
    return this.heads !== null;
  }

  private headWorkStart() {
    if (!this.headWork) this.headWork = { rows: this.db.prepare(SQL.headRows).all() as HeadRow[], next: 0, builder: headStatsBuilder() };
    return this.headWork;
  }

  /** FTS5 search; `match` must come from buildFtsQuery. */
  fts(match: string, limit: number, categoryIds?: readonly number[]): FtsHit[] {
    if (!match) return [];
    if (categoryIds && categoryIds.length) {
      return this.db.prepare(SQL.ftsInCats).all(match, JSON.stringify(categoryIds), limit) as FtsHit[];
    }
    return this.db.prepare(SQL.fts).all(match, limit) as FtsHit[];
  }
}

/** One catalog per Db handle. */
const catalogs = new WeakMap<Db, Catalog>();
export function catalogFor(db: Db): Catalog {
  let c = catalogs.get(db);
  if (!c) {
    c = new Catalog(db);
    catalogs.set(db, c);
  }
  return c;
}
