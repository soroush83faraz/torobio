/**
 * Category lexicon loaded once per database handle: category names (and their tokens, for the coherence check of
 * the vote), the hand-written `synonyms` table, the catalog scope (EVERY category that has products, plus synonym
 * targets; extraction domains only decide which attribute extractors run) and protected «x و y» pairs that must not be split into two items (e.g. «کلید و پریز»).
 */
import { domainForCategory, tokenizeForSearch, type Domain } from '@app/core';
import type { Db } from '../db.js';

export interface CategoryInfo {
  id: number;
  name: string;
  domain: Domain | null;
}

export interface SynTerm {
  tokens: string[];
  cats: { id: number; weight: number }[];
}

export interface Lexicon {
  /** false when the database is missing: parsing still works but no category can be assigned. */
  available: boolean;
  categories: Map<number, CategoryInfo>;
  /** Categories that exist in the catalog: product_count > 0 or a synonym target. */
  scope: Set<number>;
  /** Tokens of each category name (tokenizeForSearch), for the name-overlap coherence check. */
  nameTokens: Map<number, Set<string>>;
  /** First token of each category name: Persian puts the head noun first («لپ تاپ و نوت بوک» vs «شارژر لپ تاپ»). */
  nameHead: Map<number, string>;
  /** The phone category (device-model words without a noun, e.g. «آیفون ۱۵ پرو», point here). */
  phoneCategoryId: number | null;
  byFirst: Map<string, SynTerm[]>;
  protectedPairs: Set<string>;
}

/**
 * Code-level synonym supplement: common words the hand-written `synonyms` table (scripts/data) does not know. Each entry
 * names its target category by NAME (ids differ between builds); a category the database does not have is skipped, and
 * a term the table already has for that category is left alone. Weights follow the table: 1 = the word names the
 * thing, below 1 = a hint.
 */
export const SYNONYM_SUPPLEMENT: readonly { category: string; terms: readonly (readonly [string, number])[] }[] = [
  {
    category: 'ساعت و مچ بند هوشمند',
    terms: [
      ['اپل واچ', 1],
      ['اپل‌واچ', 1],
      ['apple watch', 1],
      ['ساعت اپل', 1],
      ['ساعت هوشمند', 1],
      ['مچ بند هوشمند', 1],
      ['اسمارت واچ', 1],
      ['سمارت واچ', 1],
      ['smart watch', 1],
      ['smartwatch', 1],
      ['گلکسی واچ', 1],
      ['گارمین', 0.8],
      ['garmin', 0.8],
      ['واچ', 0.9],
      ['watch', 0.9],
    ],
  },
];

const cache = new WeakMap<Db, Lexicon>();

function emptyLexicon(): Lexicon {
  return { available: false, categories: new Map(), scope: new Set(), nameTokens: new Map(), nameHead: new Map(), phoneCategoryId: null, byFirst: new Map(), protectedPairs: new Set() };
}

function addPairs(set: Set<string>, tokens: string[]): void {
  for (let i = 1; i < tokens.length - 1; i++) {
    if (tokens[i] === 'و') set.add(`${tokens[i - 1]} و ${tokens[i + 1]}`);
  }
}

export function getLexicon(db: Db): Lexicon {
  const hit = cache.get(db);
  if (hit) return hit;
  const lex = db.present ? loadLexicon(db) : emptyLexicon();
  cache.set(db, lex);
  return lex;
}

function loadLexicon(db: Db): Lexicon {
  const lex = emptyLexicon();
  try {
    const cats = db.prepare('SELECT id, name, product_count FROM categories').all() as { id: number; name: string; product_count: number | null }[];
    for (const c of cats) {
      const domain = domainForCategory(c.name);
      lex.categories.set(c.id, { id: c.id, name: c.name, domain });
      if (domain === 'phone' && (lex.phoneCategoryId === null || c.name === 'گوشی موبایل')) lex.phoneCategoryId = c.id;
      const nameToks = tokenizeForSearch(c.name);
      lex.nameTokens.set(c.id, new Set(nameToks));
      if (nameToks[0]) lex.nameHead.set(c.id, nameToks[0]);
      if ((c.product_count ?? 0) > 0 || domain) lex.scope.add(c.id);
      if (domain) addPairs(lex.protectedPairs, nameToks);
    }
    const syns = db.prepare('SELECT term_norm, category_id, weight FROM synonyms').all() as {
      term_norm: string;
      category_id: number;
      weight: number | null;
    }[];
    const idByName = new Map<string, number>();
    for (const c of lex.categories.values()) if (!idByName.has(c.name)) idByName.set(c.name, c.id);
    for (const sup of SYNONYM_SUPPLEMENT) {
      const id = idByName.get(sup.category);
      if (id === undefined) continue;
      for (const [term, weight] of sup.terms) {
        const key = tokenizeForSearch(term).join(' ');
        const has = syns.some((x) => x.category_id === id && tokenizeForSearch(x.term_norm).join(' ') === key);
        if (!has) syns.push({ term_norm: term, category_id: id, weight });
      }
    }
    const byKey = new Map<string, SynTerm>();
    for (const s of syns) {
      if (!lex.categories.has(s.category_id)) continue;
      const tokens = tokenizeForSearch(s.term_norm);
      if (tokens.length === 0) continue;
      lex.scope.add(s.category_id);
      addPairs(lex.protectedPairs, tokens);
      const key = tokens.join(' ');
      let term = byKey.get(key);
      if (!term) {
        term = { tokens, cats: [] };
        byKey.set(key, term);
      }
      term.cats.push({ id: s.category_id, weight: s.weight ?? 1 });
    }
    for (const term of byKey.values()) {
      const first = term.tokens[0] as string;
      const list = lex.byFirst.get(first) ?? [];
      list.push(term);
      lex.byFirst.set(first, list);
    }
    for (const list of lex.byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
    lex.available = true;
  } catch {
    // Unexpected schema (e.g. a bare fixture without these tables): behave as "no catalog".
    return emptyLexicon();
  }
  return lex;
}

export interface SynonymMatch {
  /** category id -> best weight among matched terms (longest-match-wins, matched tokens are consumed). */
  cats: Map<number, number>;
  /** consumed[i] = token i belongs to a matched synonym term. */
  consumed: boolean[];
}

/** Greedy longest-match of synonym terms over the token list. */
export function matchSynonyms(lex: Lexicon, tokens: string[]): SynonymMatch {
  const cats = new Map<number, number>();
  const consumed = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i < tokens.length; i++) {
    const cands = lex.byFirst.get(tokens[i] as string);
    if (!cands) continue;
    for (const term of cands) {
      const n = term.tokens.length;
      if (i + n > tokens.length) continue;
      let ok = true;
      for (let j = 1; j < n; j++) if (tokens[i + j] !== term.tokens[j]) { ok = false; break; }
      if (!ok) continue;
      for (const c of term.cats) cats.set(c.id, Math.max(cats.get(c.id) ?? 0, c.weight));
      for (let j = 0; j < n; j++) consumed[i + j] = true;
      i += n - 1;
      break;
    }
  }
  return { cats, consumed };
}

/** True when `tokens` starts (after the optional skip count) with a synonym term of decent weight. */
export function startsWithHeadNoun(lex: Lexicon, tokens: string[], skip = 0): boolean {
  const cands = lex.byFirst.get(tokens[skip] as string);
  if (!cands) return false;
  for (const term of cands) {
    const n = term.tokens.length;
    if (skip + n > tokens.length) continue;
    if (term.tokens.every((t, j) => tokens[skip + j] === t) && term.cats.some((c) => c.weight >= 0.7)) return true;
  }
  return false;
}

/** True when any token of the fragment is part of a synonym term (it names a thing). */
export function hasHeadNoun(lex: Lexicon, tokens: string[]): boolean {
  return matchSynonyms(lex, tokens).consumed.some(Boolean);
}
