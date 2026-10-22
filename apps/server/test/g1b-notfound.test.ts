/**
 * Not-found suggestions: a category is offered as "close" only with lexical / curated evidence; otherwise the calm
 * generic list of the catalog's biggest real categories, labelled as what the list holds.
 * Runs on a stub catalog (always) and on the real market.sqlite when it is present.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import type { Catalog, CategoryInfo, SynonymEntry } from '../src/retrieval/catalog.js';
import { catalogFor } from '../src/retrieval/catalog.js';
import { LABEL_POPULAR, LABEL_RELATED, notFoundSuggestions } from '../src/retrieval/notfound.js';
import { nearbyCategories } from '../src/retrieval/retrieve.js';

const CATS: [number, string, number][] = [
  [1, 'سیم و کابل برق ساختمان', 5000],
  [2, 'دوربین مدار بسته', 3400],
  [3, 'ساعت مچی عقربه‌ ای و دیجیتالی', 2500],
  [4, 'چراغ پنلی و سقفی', 2300],
  [5, 'کیف و کاور گوشی', 2100],
  [6, 'سوکت و کانکتور', 2000],
  [7, 'ژنراتور و موتور برق', 1700],
  [8, 'پمپ خانگی و صنعتی', 1600],
  [9, 'رله و بیمتال', 1500],
  [10, 'سایر تجهیزات پنوماتیک', 1400],
  // the absurd matches of the old loose full-text search
  [20, 'غذا و تشویقی سگ و گربه', 300],
  [21, 'گیج فشار و مانومتر', 200],
  [22, 'قفل سوییچی', 100],
  [23, 'درایو و اینورتر', 1500],
  // homonyms: milk / tap, chicken / bird food
  [30, 'شیر برقی', 1300],
  [31, 'شیر روشویی', 125],
  [32, 'شیر توالت', 83],
  [33, 'غذای مرغ مینا', 3],
  [34, 'ادویه مرغ و ماهی', 1],
  [35, 'اتصالات برنجی', 176],
  // genuinely lexical neighbours
  [40, 'قالب پیتزا', 1],
  [41, 'پیتزا بر', 1],
  [42, 'کیک و نان و پیتزا پز برقی', 3],
  [43, 'ماست', 0],
  [44, 'لباس کار و یونیفرم', 40],
  [45, 'کفش ایمنی و کار', 40],
  [46, 'کابل برق کامپیوتر', 90],
];
const SYNS: SynonymEntry[] = [
  { tokens: ['سیم', 'برق'], categoryId: 1, weight: 1 },
  { tokens: ['دوربین'], categoryId: 2, weight: 0.5 },
];

function stubCatalog(): Catalog {
  const cats = new Map<number, CategoryInfo>(CATS.map(([id, name, productCount]) => [id, { id, name, domain: null, productCount }]));
  return { categories: () => cats, synonyms: () => SYNS } as unknown as Catalog;
}

const POPULAR_TOP = ['سیم و کابل برق ساختمان', 'دوربین مدار بسته', 'ساعت مچی عقربه‌ ای و دیجیتالی', 'چراغ پنلی و سقفی'];
const ABSURD = ['غذا و تشویقی سگ و گربه', 'گیج فشار و مانومتر', 'قفل سوییچی', 'درایو و اینورتر', 'شیر برقی', 'اتصالات برنجی'];

describe('not-found suggestions (stub catalog)', () => {
  const c = stubCatalog();

  it.each(['برنج هاشمی', 'ماست پرچرب', 'مرغ', 'شیر'])('«%s» has no evidence: the calm generic list, labelled as what the list holds', (text) => {
    const r = notFoundSuggestions(c, text);
    expect(r.kind).toBe('popular');
    expect(r.labelFa).toBe(LABEL_POPULAR);
    expect(r.labelFa).toBe('چیزهایی که در این فهرست دارم');
    expect(r.categories.slice(0, 4)).toEqual(POPULAR_TOP);
    expect(r.categories.length).toBeLessThanOrEqual(8);
    expect(r.categories).not.toContain('سایر تجهیزات پنوماتیک'); // «سایر» is filler, not a family
    for (const bad of ABSURD) expect(r.categories).not.toContain(bad);
  });

  it('«پیتزا» shares a real distinctive word with three kitchen categories and only those', () => {
    const r = notFoundSuggestions(c, 'پیتزا');
    expect(r.kind).toBe('related');
    expect(r.labelFa).toBe(LABEL_RELATED);
    expect([...r.categories].sort()).toEqual(['پیتزا بر', 'قالب پیتزا', 'کیک و نان و پیتزا پز برقی'].sort());
  });

  it('a category with no products is never offered («ماست» exists but is empty)', () => {
    expect(notFoundSuggestions(c, 'ماست').categories).not.toContain('ماست');
  });

  it('two shared words are evidence, and beat single-word matches', () => {
    const r = notFoundSuggestions(c, 'لباس کار');
    expect(r.kind).toBe('related');
    expect(r.categories).toEqual(['لباس کار و یونیفرم']);
  });

  it('a synonym entry is curated evidence', () => {
    const r = notFoundSuggestions(c, 'سیم برق نایلونی');
    expect(r.kind).toBe('related');
    expect(r.categories[0]).toBe('سیم و کابل برق ساختمان');
  });

  it('a homonym with a second word still needs a real shared word: «برنج قرمز» has none', () => {
    expect(notFoundSuggestions(c, 'برنج قرمز').kind).toBe('popular');
    expect(notFoundSuggestions(c, 'شیر پرچرب').kind).toBe('popular');
  });

  it('one weak shared word (very common, short, or not the head noun) is not evidence', () => {
    expect(notFoundSuggestions(c, 'کفش ورزشی').kind).toBe('popular');
    expect(notFoundSuggestions(c, 'برق').kind).toBe('popular'); // 3 letters: too weak alone
    expect(notFoundSuggestions(c, '۱۲۳ ۴۵').kind).toBe('popular');
    expect(notFoundSuggestions(c, '').kind).toBe('popular');
  });

  it('nearbyCategories (used by /api/resolve) is the same list', () => {
    expect(nearbyCategories(c, 'پیتزا')).toEqual(notFoundSuggestions(c, 'پیتزا').categories);
    expect(nearbyCategories(c, 'مرغ', 3)).toHaveLength(3);
  });
});

const realPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(loadConfig({ NODE_ENV: 'test' }).databasePath);
describe.skipIf(!existsSync(realPath))('not-found suggestions (real market.sqlite)', () => {
  it('the five reference words never suggest pet food, gauges, locks, drives or taps', () => {
    const db = openDb(realPath);
    try {
      const cat = catalogFor(db);
      const absurd = new Set(['غذا و تشویقی سگ و گربه', 'گیج فشار و مانومتر', 'قفل سوییچی', 'سایر غذا و مکمل حیوانات خانگی', 'قفل آویز', 'درایو و اینورتر', 'سایر باتری', 'تجهیزات برق خورشیدی', 'بستنی ساز', 'شیر برقی', 'شیر پنوماتیک', 'سایر شیرآلات', 'تشک مواج طبی', 'پرزگیر لباس']);
      for (const text of ['برنج هاشمی', 'ماست پرچرب', 'مرغ', 'شیر']) {
        const r = notFoundSuggestions(cat, text);
        expect(r.kind, text).toBe('popular');
        expect(r.labelFa).toBe(LABEL_POPULAR);
        expect(r.categories.length).toBe(8);
        for (const name of r.categories) expect(absurd.has(name), `${text}: ${name}`).toBe(false);
        for (const name of r.categories) expect([...cat.categories().values()].some((c) => c.name === name && c.productCount > 0)).toBe(true);
      }
      const pizza = notFoundSuggestions(cat, 'پیتزا');
      expect(pizza.kind).toBe('related');
      for (const name of pizza.categories) expect(name).toContain('پیتزا');
    } finally {
      db.close();
    }
  });
});
