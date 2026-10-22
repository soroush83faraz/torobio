/**
 * What to show when an item is not in the catalog.
 *
 * A category is offered as "close to what you wrote" ONLY with lexical or curated evidence:
 *  - a synonym entry (the hand-written `synonyms` table) whose words are all in the text, or
 *  - the category NAME shares words with the text: two or more meaningful words, or one distinctive word.
 * A single weak shared word is not evidence. Weak means: very common across category names («برقی», «لوازم»),
 * generic filler («سایر», «جانبی»), or a food word that is also a hardware word here («شیر» milk / tap,
 * «برنج» rice / brass, «مرغ» chicken / bird food). Loose full-text hits are never used: they are how «برنج هاشمی»
 * once "suggested" pet food and pressure gauges.
 *
 * No evidence -> a calm generic list instead: the catalog's biggest real categories, labelled as what the list
 * holds («چیزهایی که در این فهرست دارم»), never as a guess about the request.
 */
import { tokenizeForSearch, type Api } from '@app/core';
import { FOOD_HOMONYMS } from '../parse/category.js';
import type { Catalog, CategoryInfo } from './catalog.js';

export type NotFoundKind = 'related' | 'popular';

export interface NotFoundSuggestions {
  kind: NotFoundKind;
  /** Persian heading for the list. */
  labelFa: string;
  /** Real category names, best first. */
  categories: string[];
  /** Their dataset ids, same order: a client sets one as the item's `categoryIds` when the user picks it. */
  categoryIds: number[];
}

export const LABEL_RELATED = 'دسته‌های نزدیک در این فهرست';
export const LABEL_POPULAR = 'چیزهایی که در این فهرست دارم';

const RELATED_LIMIT = 5;
const POPULAR_LIMIT = 8;
/** A name word used by more categories than this is too common to be evidence on its own. */
const MAX_DF_SINGLE = 25;
/** Filler words in category names / requests: never evidence. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'سایر', 'لوازم', 'جانبی', 'تجهیزات', 'انواع', 'دستگاه', 'ست', 'کیت', 'مدل', 'نوع', 'عمومی', 'صنعتی', 'خانگی', 'برقی', 'خرید',
  'قیمت', 'ابزار', 'ای', 'های', 'ها', 'ورزشی', 'مردانه', 'زنانه', 'بچگانه', 'دیجیتال', 'هوشمند', 'محصولات', 'کالا', 'اصل', 'اصلی', 'نو', 'جدید', 'ارزان', 'خوب', 'بهترین', 'مخصوص', 'یدکی',
]);

interface Index {
  /** categories with products */
  cats: CategoryInfo[];
  nameTokens: Map<number, Set<string>>;
  /** token -> number of categories (with products) whose name contains it */
  df: Map<string, number>;
  popular: CategoryInfo[];
}

const indexes = new WeakMap<Catalog, Index>();

function indexOf(catalog: Catalog): Index {
  const hit = indexes.get(catalog);
  if (hit) return hit;
  const cats = [...catalog.categories().values()].filter((c) => c.productCount > 0);
  const nameTokens = new Map<number, Set<string>>();
  const df = new Map<string, number>();
  for (const c of cats) {
    const toks = new Set(tokenizeForSearch(c.name));
    nameTokens.set(c.id, toks);
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const popular = cats
    .filter((c) => !c.name.startsWith('سایر'))
    .sort((a, b) => b.productCount - a.productCount || a.id - b.id)
    .slice(0, POPULAR_LIMIT);
  const idx = { cats, nameTokens, df, popular };
  indexes.set(catalog, idx);
  return idx;
}

const isMeaningful = (t: string): boolean => t.length >= 2 && !/^\d+$/.test(t) && !GENERIC_WORDS.has(t);

/** Calm generic answer: the biggest real categories. */
export function popularCategories(catalog: Catalog): NotFoundSuggestions {
  const popular = indexOf(catalog).popular;
  return { kind: 'popular', labelFa: LABEL_POPULAR, categories: popular.map((c) => c.name), categoryIds: popular.map((c) => c.id) };
}

/** Suggestions for an item that matched nothing; `related` only with evidence (see the module comment). */
export function notFoundSuggestions(catalog: Catalog, text: string, limit = RELATED_LIMIT): NotFoundSuggestions {
  const idx = indexOf(catalog);
  const words = [...new Set(tokenizeForSearch(text, { dropStopwords: true }).filter(isMeaningful))];
  if (words.length === 0) return popularCategories(catalog);
  const wordSet = new Set(words);
  const onlyHomonyms = words.every((w) => FOOD_HOMONYMS.has(w));

  const scores = new Map<number, number>();
  const bump = (id: number, s: number) => scores.set(id, Math.max(scores.get(id) ?? 0, s));
  const byId = new Map(idx.cats.map((c) => [c.id, c]));

  // Curated evidence: a synonym term fully present in the text.
  for (const s of catalog.synonyms()) {
    if (s.weight < 0.6 || !byId.has(s.categoryId)) continue;
    if (!s.tokens.every((t) => wordSet.has(t))) continue;
    if (s.tokens.every((t) => FOOD_HOMONYMS.has(t) || !isMeaningful(t))) continue;
    bump(s.categoryId, 10 + s.tokens.length + s.weight);
  }
  // Lexical evidence: words shared with the category name.
  if (!onlyHomonyms || words.length > 1) {
    for (const c of idx.cats) {
      const names = idx.nameTokens.get(c.id);
      if (!names) continue;
      const shared = words.filter((w) => names.has(w));
      if (shared.length === 0) continue;
      const strong = shared.filter((w) => !FOOD_HOMONYMS.has(w));
      if (strong.length === 0) continue; // a homonym alone is never evidence
      const rare = strong.filter((w) => w.length >= 4 && (idx.df.get(w) ?? 0) <= MAX_DF_SINGLE);
      // One shared word must be the head noun of the request (Persian puts it first: «کفش ورزشی» is about «کفش»,
      // not about everything «ورزشی») and a rare one; otherwise it is a weak token.
      if (shared.length < 2 && !(rare.length > 0 && rare[0] === words[0])) continue;
      const rarity = rare.length ? 1 - Math.min(...rare.map((w) => idx.df.get(w) ?? 0)) / (MAX_DF_SINGLE + 1) : 0;
      bump(c.id, shared.length * 2 + rarity);
    }
  }

  // Two or more shared words beat any single shared word: the single-word matches are dropped when they exist.
  const best = Math.max(0, ...scores.values());
  if (best >= 4) for (const [id, sc] of scores) if (sc < 4) scores.delete(id);

  const ranked = [...scores.entries()]
    .map(([id, score]) => ({ c: byId.get(id)!, score }))
    .sort((a, b) => b.score - a.score || b.c.productCount - a.c.productCount || a.c.id - b.c.id)
    .slice(0, limit);
  if (ranked.length === 0) return popularCategories(catalog);
  return { kind: 'related', labelFa: LABEL_RELATED, categories: ranked.map((r) => r.c.name), categoryIds: ranked.map((r) => r.c.id) };
}

/**
 * Adds `nearbyKind` / `nearbyLabelFa` to every resolution that carries `nearbyCategories`, so the UI can say
 * whether the list is "close to your request" or "what this list holds". `textOf(itemId)` gives the item's text.
 * Idempotent; the category list itself is whatever the engine produced (it comes from `notFoundSuggestions`).
 */
export function labelNearby(catalog: Catalog, items: Api.ItemResolution[], textOf: (itemId: string) => string | undefined): void {
  for (const it of items) {
    if (!it.nearbyCategories) continue;
    const r = notFoundSuggestions(catalog, textOf(it.itemId) ?? '');
    it.nearbyKind = r.kind;
    it.nearbyLabelFa = r.labelFa;
    if (!it.nearbyCategoryIds && r.categories.join('\u0000') === it.nearbyCategories.join('\u0000')) it.nearbyCategoryIds = r.categoryIds;
  }
}
