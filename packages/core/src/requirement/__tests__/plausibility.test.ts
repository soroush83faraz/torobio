/**
 * Listing plausibility (audit F3): title-head kind rules, sub-kinds of mixed categories, roll-vs-metre price check,
 * and how the engine treats a listing issue (never auto-picked, visible with its Persian reason).
 */
import { describe, expect, it } from 'vitest';
import { screenInchOf } from '../../extract/screen';
import { prep } from '../../extract/numbers';
import { tokenizeForSearch } from '../../normalize/index';
import type { Candidate, ListingIssue } from '../../types/index';
import { resolveItems } from '../resolve';
import { evaluateCandidate } from '../evaluate';
import {
  BLANKED_HEAD,
  buildHeadStats,
  foldHead,
  kindIssue,
  titleHead,
  withKindIssues,
  withWireUnitCheck,
  type KindContext,
} from '../plausibility';
import { cand, req, user } from './fixtures';

const ADAPTER = 1;
const CABLES = 2;
const CHARGER = 3;
const SOCKETS = 4;
const NAMES: Record<number, string> = { [ADAPTER]: 'آداپتور برق', [CABLES]: 'سایر کابل و تبدیل', [CHARGER]: 'شارژر گوشی', [SOCKETS]: 'کلید و پریز' };

function rows(cat: number, title: string, n: number) {
  return Array.from({ length: n }, () => ({ title, categoryId: cat }));
}
const STATS = buildHeadStats([
  ...rows(ADAPTER, 'آداپتور ۱۲ ولت ۲ آمپر', 60),
  ...rows(ADAPTER, 'فیش آداپتور نری سر زرد', 1),
  ...rows(CABLES, 'فیش تبدیل', 30),
  ...rows(CHARGER, 'شارژر سامسونگ ۲۵ وات', 90),
  ...rows(CHARGER, 'آداپتور شارژر سامسونگ', 10), // 10 % of the category: an established name there
  ...rows(SOCKETS, 'پریز برق ارت دار', 50),
  ...rows(SOCKETS, 'کلید بین راهی', 40),
]);

function ctx(text: string, categoryIds: number[]): KindContext {
  const vocabulary = new Set<string>();
  for (const id of categoryIds) for (const t of tokenizeForSearch(NAMES[id])) vocabulary.add(foldHead(t));
  return {
    requestTokens: new Set(tokenizeForSearch(text).map(foldHead)),
    requested: tokenizeForSearch(text)[0] ?? null,
    categoryIds: new Set(categoryIds),
    vocabulary,
    categoryName: (id) => NAMES[id],
    stats: STATS,
  };
}

describe('titleHead: the first word that names goods', () => {
  it('reads the Persian head noun and skips noise, numbers, units, sizes, brands and codes', () => {
    expect(titleHead('فیش آداپتور نری سر زرد دیسمکن 1.7 میلی متری')).toBe('فیش');
    expect(titleHead('خرید آداپتور 12 ولت')).toBe(foldHead('آداپتور'));
    expect(titleHead('یک متر کابل مفتولی (زمینی) مسی')).toBe('کابل');
    expect(titleHead('مینی دوربین مداربسته')).toBe('دوربین');
    expect(titleHead('چهار کانال دستگاه XVR')).toBe('دستگاه');
    expect(titleHead('هایک ویژن دستگاه 8 کانال')).toBe('دستگاه');
    expect(titleHead('DS-7608NI-K1 دستگاه')).toBe('دستگاه');
    expect(titleHead('آیفون 16 پرو 256 گیگ')).toBeNull();
    expect(titleHead('عنوان حذف‌شده برای انتشار')).toBe(BLANKED_HEAD);
  });
});

describe('rule 1: a foreign title head (accessory / part filed in the category)', () => {
  it('«فیش آداپتور» is not an adapter: differs, with its reason', () => {
    const issue = kindIssue('فیش آداپتور نری سر زرد', ADAPTER, ctx('آداپتور', [ADAPTER]));
    expect(issue).toMatchObject({ code: 'other_kind', fit: 'differs' });
    expect(issue!.text).toContain('«فیش»');
    expect(issue!.text).toContain('«سایر کابل و تبدیل»');
    expect(issue!.text).toContain('نه «آداپتور»');
  });
  it('the requested thing, an asked-for head and an established name are never flagged', () => {
    expect(kindIssue('آداپتور ۱۲ ولت ۲ آمپر', ADAPTER, ctx('آداپتور', [ADAPTER]))).toBeNull();
    expect(kindIssue('فیش آداپتور نری سر زرد', ADAPTER, ctx('فیش آداپتور', [ADAPTER]))).toBeNull();
    // «آداپتور» heads 10 % of phone chargers (>= 5 %): a charger listing, although its home is the adapter category
    expect(kindIssue('آداپتور شارژر سامسونگ', CHARGER, ctx('شارژر ۲۵ وات', [CHARGER]))).toBeNull();
    // an item searched in both categories: the head's home is one of them
    expect(kindIssue('فیش تبدیل', CABLES, ctx('آداپتور', [ADAPTER, CABLES]))).toBeNull();
  });
  it('a blanked title cannot be identified: incomplete', () => {
    expect(kindIssue('عنوان حذف‌شده برای انتشار', ADAPTER, ctx('آداپتور', [ADAPTER]))).toMatchObject({ fit: 'incomplete' });
  });
});

describe('rule 2: sub-kinds of a mixed category', () => {
  it('«پریز برق» does not accept a «کلید» listing; «کلید و پریز» accepts both', () => {
    const issue = kindIssue('کلید بین راهی', SOCKETS, ctx('پریز برق', [SOCKETS]));
    expect(issue).toMatchObject({ code: 'other_kind', fit: 'differs', text: 'این آگهی «کلید» است، نه «پریز»' });
    expect(kindIssue('پریز برق ارت دار', SOCKETS, ctx('پریز برق', [SOCKETS]))).toBeNull();
    expect(kindIssue('کلید بین راهی', SOCKETS, ctx('کلید و پریز', [SOCKETS]))).toBeNull();
    expect(kindIssue('پریز برق ارت دار', SOCKETS, ctx('کلید و پریز', [SOCKETS]))).toBeNull();
  });
});

describe('engine: a listing issue never becomes the suggestion and stays visible', () => {
  const plug = cand(1, {}, [['S1', 30_000]], { title: 'فیش آداپتور نری سر زرد', categoryId: ADAPTER });
  const adapter = cand(2, { voltage_v: 12 }, [['S2', 290_000]], { title: 'آداپتور ۱۲ ولت ۲ آمپر', categoryId: ADAPTER });
  const annotated = withKindIssues([plug, adapter], ctx('آداپتور', [ADAPTER]));

  it('the cheaper plug is set aside, the adapter is suggested', () => {
    const item = req('ad', 'آداپتور', [], { kind: 'adapter', categoryIds: [ADAPTER], preference: { acceptSuggestion: true } });
    const r = resolveItems([item], { ad: annotated }).results[0]!.resolution;
    expect(r.state).toBe('suggested');
    expect(r.chosenProductId).toBe(2);
    const ev = r.evaluations.find((e) => e.productId === 1)!;
    expect(ev.fit).toBe('differs');
    expect(ev.issues).toEqual(['other_kind']);
    expect(ev.differences.join(' ')).toContain('«فیش»');
  });
  it('never picked as the closest alternative either; a pinned listing is taken as is', () => {
    const item = req('ad', 'آداپتور', [user({ attr: 'voltage_v', op: 'eq', value: 24 })], { kind: 'adapter', preference: { allowAlternatives: true } });
    const r = resolveItems([item], { ad: [annotated[0]!] }).results[0]!.resolution;
    expect(r.state).toBe('alternative');
    expect(r.chosenProductId).toBeUndefined();
    const pinned = req('ad', 'آداپتور', [], { kind: 'adapter', pinnedProductId: 1 });
    expect(evaluateCandidate(pinned, annotated[0]!).fit).toBe('eligible');
  });
  it('an incomplete issue keeps an otherwise eligible listing out of the pick', () => {
    const issue: ListingIssue = { code: 'unit_unclear', fit: 'incomplete', text: 'واحد فروش روشن نیست' };
    const c: Candidate = { ...adapter, issues: [issue] };
    const ev = evaluateCandidate(req('ad', 'آداپتور'), c);
    expect(ev.fit).toBe('incomplete');
    expect(ev.differences).toContain('واحد فروش روشن نیست');
  });
});

describe('rule 3: roll vs metre prices of one wire', () => {
  const wire = { wire_section_mm2: 2.5, wire_cores: 1 } as const;
  const rollOk = cand(10, { ...wire, sale_unit: 'roll' }, [['A', 5_000_000], ['B', 5_500_000]]);
  const rollMixed = cand(11, { ...wire, sale_unit: 'roll' }, [['A', 6_000_000], ['B', 45_000]]);
  const rollPerMetre = cand(12, { ...wire, sale_unit: 'roll' }, [['C', 48_500]]); // «کلاف ۱۰۰ متری» at a metre price
  const metreOk = cand(13, { ...wire, sale_unit: 'meter' }, [['A', 52_000], ['D', 58_000]]);
  const metreAsRoll = cand(14, { ...wire, sale_unit: 'meter' }, [['E', 4_300_000]]); // «طول ۱ متر» at a roll price
  const out = withWireUnitCheck([rollOk, rollMixed, rollPerMetre, metreOk, metreAsRoll]);
  const by = new Map(out.map((c) => [c.product.id, c]));

  it('consistent listings are untouched (same objects)', () => {
    expect(by.get(10)).toBe(rollOk);
    expect(by.get(13)).toBe(metreOk);
  });
  it('a contradicting offer loses its price; the listing keeps its consistent offers', () => {
    const offers = by.get(11)!.offers;
    expect(offers.find((o) => o.shopId === 'B')).toMatchObject({ price: null, priceFlag: 'unit_mismatch' });
    expect(offers.find((o) => o.shopId === 'A')!.price).toBe(6_000_000);
    expect(by.get(11)!.issues).toBeUndefined();
  });
  it('a listing with no consistent price is «unit unclear» (incomplete), in both directions', () => {
    expect(by.get(12)!.issues).toEqual([expect.objectContaining({ code: 'unit_unclear', fit: 'incomplete' })]);
    expect(by.get(12)!.issues![0]!.text).toContain('حلقهٔ ۱۰۰ متری');
    expect(by.get(14)!.issues![0]!.text).toContain('«متری»');
    expect(by.get(14)!.offers[0]!.price).toBeNull();
  });
  it('the 45,000 roll is never suggested for a roll request', () => {
    const item = req('w', 'سیم ۲.۵', [user({ attr: 'sale_unit', op: 'eq', value: 'roll' })], { kind: 'wire' });
    const r = resolveItems([item], { w: out }).results[0]!.resolution;
    expect(r.chosenProductId).toBe(10);
    expect(r.priceRange!.min).toBeGreaterThanOrEqual(5_000_000);
    expect(r.evaluations.find((e) => e.productId === 12)!.fit).toBe('incomplete');
  });
  it('fewer than three priced offers: no judgement', () => {
    const two = [cand(20, { ...wire, sale_unit: 'roll' }, [['A', 5_000_000]]), cand(21, { ...wire, sale_unit: 'roll' }, [['B', 45_000]])];
    expect(withWireUnitCheck(two)).toEqual(two);
  });
  it('cores unknown: judged against every core count of the same section', () => {
    const noCores = cand(30, { wire_section_mm2: 2.5, sale_unit: 'roll' }, [['F', 360_000]]);
    const r = withWireUnitCheck([rollOk, rollMixed, metreOk, noCores]);
    expect(r.find((c) => c.product.id === 30)!.issues?.[0]?.code).toBe('unit_unclear');
  });
});

describe('screenInchOf', () => {
  it('reads one stated size, any category', () => {
    expect(screenInchOf(prep('تلویزیون سامسونگ مدل U8000F سایز ۵۵ اینچ'))).toBe(55);
    expect(screenInchOf(prep('لپ تاپ ۱۵.۶ اینچی'))).toBe(15.6);
    expect(screenInchOf(prep('تلویزیون ۴۳ اینچ و ۵۵ اینچ'))).toBeNull();
    expect(screenInchOf(prep('8050 UR سایز 55ال جی'))).toBeNull();
  });
});
