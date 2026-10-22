/**
 * D1: the listing condition stated by a SELLER's own listing title («… های کپی», «استوک») applies to that offer.
 * A flagged offer is never the cheapest price, never counted, never in a range / quantile / plan unless the user
 * pinned the product; when every offer is flagged the product reads as flagged (never auto-picked).
 * Plus the generic-path detector vocabulary measured on the 2026-10 snapshot (copiers / copy paper never flag).
 */
import { describe, expect, it } from 'vitest';
import { detectListingFlags, extractListingFlags, extractReplica, prepTitle } from '../../extract/index';
import { buildPlanItems } from '../../plan/offers';
import type { Candidate, ListingFlags, Offer, Requirement } from '../../types/index';
import { offerOwnFlags, withOfferConditions, withOfferConditionsAll } from '../offers';
import { resolveItem } from '../resolve';

const offer = (id: string, productId: number, shopId: string, price: number, listing?: ListingFlags): Offer => ({
  id,
  productId,
  shopId,
  price,
  ...(listing ? { listing } : {}),
});
const COPY: ListingFlags = { replica: true, evidence: ['های کپی'] };
const USED: ListingFlags = { condition: 'used', evidence: ['استوک'] };
const cand = (id: number, offers: Offer[], listing?: ListingFlags): Candidate => ({
  product: { id, title: `p${id}`, categoryId: 1, modelCodes: [] },
  attrs: { brand: 'apple' },
  offers,
  ...(listing ? { listing } : {}),
});
const req = (o: Partial<Requirement> = {}): Requirement => ({
  id: 'i',
  text: 'شارژر ۲۰ وات اپل',
  qty: 1,
  categoryIds: [1],
  constraints: [{ attr: 'brand', op: 'eq', value: 'apple', source: 'user' }],
  ...o,
});

// product 1: one copy seller (cheapest, 480k) + one plain seller (900k); product 2: plain 700k;
// product 3: its ONLY seller says «های کپی» (the WH-1000XM6 case)
const pool = (): Candidate[] => [
  cand(1, [offer('a', 1, 's1', 480_000, COPY), offer('b', 1, 's2', 900_000)]),
  cand(2, [offer('c', 2, 's3', 700_000)]),
  cand(3, [offer('d', 3, 's4', 300_000, COPY)]),
];

describe('offer-level condition (withOfferConditions)', () => {
  it('a copy seller is set aside: never the cheapest price, never counted, never planned', () => {
    const item = req();
    const view = withOfferConditionsAll(item, pool());
    expect(view[0]!.offers.map((o) => o.id)).toEqual(['b']);
    expect(view[0]!.conditionExcludedOffers!.map((o) => o.id)).toEqual(['a']);
    const { resolution: r } = resolveItem(item, view);
    // product 3 (every seller a copy) differs with the seller-sourced reason; product 1 is priced at 900k, not 480k
    expect(r.state).toBe('suggested');
    expect(r.chosenProductId).toBe(2);
    expect(r.eligibleIds.sort()).toEqual([1, 2]);
    const e1 = r.evaluations.find((e) => e.productId === 1)!;
    expect(e1.minPrice).toBe(900_000);
    expect(e1.pricedOfferCount).toBe(1);
    expect(r.priceRange).toEqual({ min: 700_000, max: 900_000 });
    const e3 = r.evaluations.find((e) => e.productId === 3)!;
    expect(e3.fit).toBe('differs');
    expect(e3.conditionIssue).toBe('replica');
    expect(e3.differences[0]).toBe('کپی یا طرح طبق عنوان آگهی فروشنده («های کپی»)؛ خودکار انتخاب نمی‌شود');
    expect(r.conditionExcludedCount).toBe(1);
    const plan = buildPlanItems([item], [r], { i: view });
    expect(plan[0]!.offers.map((o) => o.offerId).sort()).toEqual(['b', 'c']);
  });

  it('the input candidates are never mutated (they are shared, cached pool objects)', () => {
    const p = pool();
    const before = JSON.stringify(p);
    withOfferConditionsAll(req(), p);
    expect(JSON.stringify(p)).toBe(before);
    const plain = p[1]!;
    expect(withOfferConditions(req(), plain)).toBe(plain);
  });

  it("'replica' mode: only the sellers that state a copy are used, and the product counts as a copy", () => {
    const item = req({ condition: 'replica' });
    const view = withOfferConditionsAll(item, pool());
    expect(view[0]!.offers.map((o) => o.id)).toEqual(['a']);
    expect(view[0]!.listing).toMatchObject({ replica: true, fromOffers: true });
    const { resolution: r } = resolveItem(item, view);
    expect(r.eligibleIds.sort()).toEqual([1, 3]);
    expect(r.chosenProductId).toBe(3);
    expect(r.evaluations.find((e) => e.productId === 2)!.conditionIssue).toBe('not_replica');
  });

  it("'used' mode takes the «استوک» seller; 'any' takes used sellers but never copies", () => {
    const p = [cand(5, [offer('u', 5, 's1', 100, USED), offer('n', 5, 's2', 200), offer('k', 5, 's3', 50, COPY)])];
    expect(withOfferConditions(req({ condition: 'used' }), p[0]!).offers.map((o) => o.id)).toEqual(['u']);
    expect(withOfferConditions(req({ condition: 'any' }), p[0]!).offers.map((o) => o.id)).toEqual(['u', 'n']);
    expect(withOfferConditions(req(), p[0]!).offers.map((o) => o.id)).toEqual(['n']);
  });

  it('a pinned product is taken as is: its accepted sellers, else every seller (flags shown)', () => {
    const p = pool();
    const pinned1 = withOfferConditions(req({ pinnedProductId: 1 }), p[0]!);
    expect(pinned1.offers.map((o) => o.id)).toEqual(['b']);
    const pinned3 = withOfferConditions(req({ pinnedProductId: 3 }), p[2]!);
    expect(pinned3.offers.map((o) => o.id)).toEqual(['d']);
    expect(pinned3.listing?.replica).toBe(true);
    const { resolution: r } = resolveItem(req({ pinnedProductId: 3 }), [pinned3]);
    expect(r.state).toBe('exact_model');
    expect(r.chosenProductId).toBe(3);
  });

  it('a product whose TITLE is flagged keeps its own reason; seller flags beyond the title are reported', () => {
    const c = cand(6, [offer('x', 6, 's1', 10, COPY)], { condition: 'used' });
    const v = withOfferConditions(req(), c);
    expect(v.listing).toEqual({ condition: 'used', replica: true, evidence: ['های کپی'] });
    expect(v.listing?.fromOffers).toBeUndefined();
    expect(offerOwnFlags(c.listing, c.offers[0]!)).toEqual({ replica: true, evidence: ['های کپی'] });
    expect(offerOwnFlags({ replica: true }, c.offers[0]!)).toBeUndefined();
  });
});

describe('listing detector on seller and product titles (snapshot vocabulary)', () => {
  const f = (t: string, d: string | null = null) => extractListingFlags(prepTitle(t), d);
  const ev = (t: string, d: string | null = null) => detectListingFlags(prepTitle(t), d).evidence;
  it('the D1 repro seller titles flag, with the words as evidence', () => {
    expect(ev('آداپتور فست شارژ آیفون 20 وات سه پین مدل MU7W2ZP های کپی', 'charger')).toEqual(['های کپی']);
    expect(ev('هدست بلوتوثی WH-1000XM6 های کپی SH-1236', 'headphones')).toEqual(['های کپی']);
    expect(ev('شارژر اپل 20 وات سه پین غیر اصل', 'charger')).toEqual(['غیر اصل']);
    expect(ev('هدفون بلوتوثی طرح اپل | مدل AirPods Pro 2nd Generation', 'headphones')).toEqual(['طرح اپل']);
    expect(ev('دوربین عکاسی کانن Canon EOS 700D Kit 18-55mm دست دوم')).toEqual(['دست دوم']);
  });
  it('generic path (no extraction domain): only unambiguous copy phrases', () => {
    expect(f('ساعت هوشمند سامسونگ Galaxy Watch 8 فول کپی')).toEqual({ replica: true });
    expect(f('ساعت زنانه امگا کانسلیشن Constellation های کپی درجه یک')).toEqual({ replica: true });
    expect(f('میکروفون SHURE Beta58A هایکپی')).toEqual({ replica: true });
    expect(f('میکروفن بی سیم SHURE AD4G/Beta 58A (های‌کپی)')).toEqual({ replica: true });
    expect(f('ترایاک BTA12-600B (کپی)')).toEqual({ replica: true });
    expect(f('گیتار اکتریک ایبانز GRX طرح High Copy')).toEqual({ replica: true });
  });
  it('copiers, copy paper, «کپی خور» consoles, anti-copy remotes and toner never flag as copies', () => {
    for (const t of [
      'دستگاه کپی شارپ رنگی',
      'کپی شارپ سیاه و سفید MX465',
      'دستگاه فتوکپی ریسوگراف RZ230',
      'کاغذ A4 کپی مکس 80 گرم بسته 500 عددی',
      'کاغذ a4 کپی مکس شیراز 80 گرم a4 paper copimax',
      'کنسول Ps5 Drive (کپی خور)',
      'نصب بازی ps4 (کپی خور)',
      'ریموت کلاسیک گیگاکد ضد کپی REMOTE Z4 ULTRA GIGACODET',
      'تونر شارژ کپی کیوسرا جگوار',
      'دولوپر دستگاه کپی شارپ مدل AR-202SD/5316',
      'کارتخوان دستی RFID (کپی کننده کارت های ۱۲۵)',
      'دستگاه کپی‌کار رومیزی',
      'ماشین کپی کانن',
    ]) {
      expect(f(t).replica, t).toBeUndefined();
    }
    // a stock copier is a used listing, not a copy
    expect(f('دستگاه کپی استوک سیاه و سفید شارپ MX-M266N SHARP')).toEqual({ condition: 'used' });
  });
  it('the parser rule (extractReplica) stays domain-gated: no generic-path copy reading of user text', () => {
    expect(extractReplica(prepTitle('ساعت فول کپی'), null)).toBe(false);
  });
});
