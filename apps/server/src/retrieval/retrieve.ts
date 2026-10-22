/**
 * Candidate retrieval for one requirement item.
 *
 * 1. Categories: the item's categoryIds (from /api/parse, or a category the user picked) when valid. A parser item
 *    without categories is one the parser judged absent («not_in_catalog»): it is NEVER searched by raw text.
 *    A chip-form item without categories gets a vote: hand-written synonyms, else full-text hits whose category
 *    shares real words with the request (never a loose title match: «مرغ» once became cat food). No category = no candidate
 *    pool: only a pinned product and listings carrying the exact model code the user typed can be found
 *    (the item is otherwise «پیدا نشد», never auto-picked).
 * 2. Pool: every product with offers in those categories (bounded by MAX_POOL), so eligible counts and
 *    price ranges are the real ones; constraints then filter pass / fail / unknown in the engine.
 * 3. Narrowing: words of the item text that nothing else accounts for (not the quantity, not a stated chip,
 *    not the category's own words) are searched with FTS (AND, bm25) inside the categories; when that finds
 *    listings, the pool is narrowed to them («قاب سیلیکونی»). When it finds nothing the words are ignored.
 * 4. A typed model code and a pinned product are always added (they may sit outside the bounded pool).
 */
import { buildFtsQuery, modelCodeMatches, normalizeModelCode, tokenizeForSearch } from '@app/core';
import type { MarketCandidate } from '../adapter/rows.js';
import type { Catalog } from './catalog.js';
import { notFoundSuggestions } from './notfound.js';

export interface RetrieveInput {
  text: string;
  categoryIds: readonly number[];
  modelCode?: string | undefined;
  pinnedProductId?: number | undefined;
  /** Texts that are already turned into constraints (chip labels) or units: their words never narrow. */
  coveredTexts: readonly string[];
  qty: number;
  /**
   * Words that may narrow the pool, decided by the caller (parser items: their unparsed fragments). When given,
   * `coveredTexts` is not used to compute them.
   */
  narrowTerms?: readonly string[];
  /** The parser judged the item absent from the catalog: no category vote at all (terminal «پیدا نشد»). */
  noVote?: boolean;
}

export interface RetrieveResult {
  categoryIds: number[];
  /** true when the categories came from the vote (the item had none). */
  voted: boolean;
  /**
   * The pool is category-coherent: it comes from real categories (given or synonym-voted). false = no category;
   * the only candidates are the pinned product and exact model-code matches (never auto-picked otherwise).
   */
  coherent: boolean;
  candidates: MarketCandidate[];
  /** Words that narrowed the pool (empty = whole categories). */
  narrowedBy: string[];
  truncated: boolean;
}

/** FTS hits inspected for the category vote and for narrowing. */
const VOTE_HITS = 200;
const NARROW_HITS = 5000;
const MODEL_CODE_HITS = 200;

function containsSeq(tokens: readonly string[], seq: readonly string[]): boolean {
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let j = 0; j < seq.length; j++) if (tokens[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

const isDigits = (t: string) => /^\d+$/.test(t);

/**
 * Vote a category for free text. Returns [] when nothing in the data supports one. Hand-written synonyms first;
 * else the category of the top full-text hits, accepted ONLY when the request shares real words with that
 * category's name (the evidence rule of notfound.ts: «لپ تاپ ایسوس» -> «لپ تاپ و نوت بوک»). A loose title match
 * is never a category («مرغ» matches cat-food titles; «برنج» brass fittings).
 */
export function voteCategories(catalog: Catalog, text: string): number[] {
  const tokens = tokenizeForSearch(text, { dropStopwords: true });
  if (tokens.length === 0) return [];
  const cats = catalog.categories();
  const score = new Map<number, number>();
  for (const s of catalog.synonyms()) {
    if (!cats.has(s.categoryId) || !containsSeq(tokens, s.tokens)) continue;
    score.set(s.categoryId, (score.get(s.categoryId) ?? 0) + s.weight * s.tokens.length);
  }
  let fromFts = false;
  if (score.size === 0) {
    const words = tokens.filter((t) => !isDigits(t));
    const hits = words.length ? catalog.fts(buildFtsQuery(words.join(' ')), VOTE_HITS) : [];
    hits.forEach((h, rank) => {
      if (h.categoryId === null || !cats.has(h.categoryId)) return;
      // every hit counts 1; the rank only breaks ties (earlier hits slightly ahead)
      score.set(h.categoryId, (score.get(h.categoryId) ?? 0) + 1 + 1e-6 * (VOTE_HITS - rank));
    });
    fromFts = true;
  }
  if (score.size === 0) return [];
  const best = [...score.entries()].sort(
    (a, b) => b[1] - a[1] || (cats.get(b[0])!.productCount - cats.get(a[0])!.productCount) || a[0] - b[0],
  )[0]!;
  if (fromFts) {
    const evidence = notFoundSuggestions(catalog, text);
    if (evidence.kind !== 'related' || !evidence.categoryIds.includes(best[0])) return [];
  }
  return [best[0]];
}

/** Words of the item text not accounted for by the quantity, chips or the categories' own vocabulary. */
export function residualTokens(catalog: Catalog, input: RetrieveInput, categoryIds: readonly number[]): string[] {
  const covered = new Set<string>();
  for (const t of input.coveredTexts) for (const tok of tokenizeForSearch(t)) covered.add(tok);
  const cats = catalog.categories();
  for (const id of categoryIds) for (const tok of tokenizeForSearch(cats.get(id)?.name ?? '')) covered.add(tok);
  for (const s of catalog.synonyms()) if (categoryIds.includes(s.categoryId)) for (const tok of s.tokens) covered.add(tok);
  if (input.modelCode) for (const tok of tokenizeForSearch(input.modelCode)) covered.add(tok);
  const out: string[] = [];
  let qtyDropped = false;
  for (const tok of tokenizeForSearch(input.text, { dropStopwords: true })) {
    if (!qtyDropped && tok === String(input.qty)) {
      qtyDropped = true;
      continue;
    }
    if (covered.has(tok) || out.includes(tok)) continue;
    out.push(tok);
  }
  return out;
}

export function retrieve(catalog: Catalog, input: RetrieveInput): RetrieveResult {
  const cats = catalog.categories();
  let categoryIds = [...new Set(input.categoryIds)].filter((id) => cats.has(id));
  let voted = false;
  if (categoryIds.length === 0 && !input.noVote) {
    categoryIds = voteCategories(catalog, input.text);
    voted = categoryIds.length > 0;
  }
  const coherent = categoryIds.length > 0;

  const byId = new Map<number, MarketCandidate>();
  let truncated = false;
  for (const id of categoryIds) {
    const pool = catalog.categoryPool(id);
    truncated ||= pool.truncated;
    for (const c of pool.cands) if (!byId.has(c.product.id)) byId.set(c.product.id, c);
  }

  let narrowedBy: string[] = [];
  if (categoryIds.length && byId.size) {
    const residual = input.narrowTerms ? [...input.narrowTerms] : residualTokens(catalog, input, categoryIds);
    if (residual.length) {
      const hits = catalog.fts(buildFtsQuery(residual.join(' '), { prefixLast: false }), NARROW_HITS, categoryIds);
      const keep = new Set(hits.map((h) => h.id).filter((id) => byId.has(id)));
      if (keep.size > 0) {
        for (const id of [...byId.keys()]) if (!keep.has(id)) byId.delete(id);
        narrowedBy = residual;
      }
    }
  }

  const extra: number[] = [];
  if (input.modelCode) {
    const code = normalizeModelCode(input.modelCode).toLowerCase();
    if (code.length >= 3) {
      const hits = catalog.fts(buildFtsQuery(code), MODEL_CODE_HITS, categoryIds.length ? categoryIds : undefined);
      for (const h of hits) if (!byId.has(h.id)) extra.push(h.id);
    }
  }
  if (input.pinnedProductId !== undefined && !byId.has(input.pinnedProductId)) extra.push(input.pinnedProductId);
  for (const c of catalog.productsByIds(extra)) {
    if (byId.has(c.product.id)) continue;
    // without a category the pool is not coherent: only the user's own pin and exact model-code matches enter it
    if (!coherent && c.product.id !== input.pinnedProductId && !(input.modelCode && modelCodeMatches(c.product.modelCodes, input.modelCode))) continue;
    byId.set(c.product.id, c);
  }

  return { categoryIds, voted, coherent, candidates: [...byId.values()], narrowedBy, truncated };
}

/**
 * Real categories to offer when an item is not found: only categories with lexical / curated evidence, else the
 * catalog's biggest ones (see notfound.ts, which also says which of the two it is).
 */
export function nearbyCategories(catalog: Catalog, text: string, limit?: number): string[] {
  const r = notFoundSuggestions(catalog, text);
  return limit === undefined ? r.categories : r.categories.slice(0, limit);
}
