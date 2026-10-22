/**
 * Listing condition honesty: used / refurbished / replica listings are never auto-picked, never an exact
 * model-code match and never a closest alternative, unless the requirement accepts that condition (or pins it).
 * Plus the title detector (extractListingFlags) on real-world phrasings, including what must stay unknown.
 */
import { describe, expect, it } from 'vitest';
import { extractListingFlags, prepTitle } from '../../extract/index';
import type { Candidate, ListingFlags, Requirement } from '../../types/index';
import { conditionIssue } from '../evaluate';
import { resolveItem } from '../resolve';

const cand = (id: number, price: number, listing?: ListingFlags, codes: string[] = []): Candidate => ({
  product: { id, title: `p${id}`, categoryId: 1, modelCodes: codes },
  attrs: { brand: 'asus' },
  offers: [{ id: `o${id}`, productId: id, shopId: 's1', price }],
  ...(listing ? { listing } : {}),
});
const req = (o: Partial<Requirement> = {}): Requirement => ({
  id: 'i', text: 'لپ تاپ ایسوس', qty: 1, categoryIds: [1],
  constraints: [{ attr: 'brand', op: 'eq', value: 'asus', source: 'user' }], ...o,
});
const pool = [cand(1, 38, { condition: 'used' }), cand(2, 45, { replica: true }), cand(3, 50, { condition: 'refurbished' }), cand(4, 74)];

describe('condition policy (engine)', () => {
  it("default ('new'): the cheapest unflagged listing is the suggestion; flagged ones differ, visibly", () => {
    const { resolution: r } = resolveItem(req(), pool);
    expect(r.state).toBe('suggested');
    expect(r.chosenProductId).toBe(4);
    expect(r.eligibleIds).toEqual([4]);
    expect(r.differsIds.sort()).toEqual([1, 2, 3]);
    expect(r.conditionExcludedCount).toBe(3);
    const used = r.evaluations.find((e) => e.productId === 1)!;
    expect(used.conditionIssue).toBe('used');
    expect(used.differences[0]).toMatch(/کارکرده \(استوک\) طبق عنوان آگهی/);
    expect(r.priceRange).toEqual({ min: 74, max: 74 });
  });

  it("'any' accepts used and refurbished, still not copies; 'used' only stated-used; 'replica' only copies", () => {
    expect(resolveItem(req({ condition: 'any' }), pool).resolution.chosenProductId).toBe(1);
    const any = resolveItem(req({ condition: 'any' }), pool).resolution;
    expect(any.eligibleIds.sort()).toEqual([1, 3, 4]);
    const used = resolveItem(req({ condition: 'used' }), pool).resolution;
    expect(used.eligibleIds.sort()).toEqual([1, 3]);
    expect(used.evaluations.find((e) => e.productId === 4)!.conditionIssue).toBe('not_used');
    const rep = resolveItem(req({ condition: 'replica' }), pool).resolution;
    expect(rep.eligibleIds).toEqual([2]);
  });

  it('only flagged listings match: «جایگزین» without an automatic pick, even when the user relaxed', () => {
    const flagged = pool.slice(0, 3);
    const r = resolveItem(req({ preference: { allowAlternatives: true } }), flagged).resolution;
    expect(r.state).toBe('alternative');
    expect(r.chosenProductId).toBeUndefined();
  });

  it('a typed model code carried only by a used listing is not exact_model', () => {
    const r = resolveItem(req({ modelCode: 'X455' }), [cand(1, 38, { condition: 'used' }, ['X455']), cand(4, 74)]).resolution;
    expect(r.state).not.toBe('exact_model');
    expect(r.chosenProductId).toBeUndefined();
    const ok = resolveItem(req({ modelCode: 'X455', condition: 'used' }), [cand(1, 38, { condition: 'used' }, ['X455'])]).resolution;
    expect(ok.state).toBe('exact_model');
  });

  it('a pinned flagged product is taken as is (the user picked it)', () => {
    const r = resolveItem(req({ pinnedProductId: 1 }), pool).resolution;
    expect(r.state).toBe('exact_model');
    expect(r.chosenProductId).toBe(1);
  });

  it('no flag = not stated as used: passes the default policy', () => {
    expect(conditionIssue(req(), cand(4, 74))).toBeUndefined();
  });
});

describe('title detector (extractListingFlags)', () => {
  const f = (title: string, domain: string | null = null) => extractListingFlags(prepTitle(title), domain);
  it('used phrasings, including the ones added after measuring the snapshot', () => {
    expect(f('لپ تاپ ایسوس کارکرده AUSUS X455 LD 256GB SSD')).toEqual({ condition: 'used' });
    expect(f('گوشی سامسونگ (استوک) A56 5G', 'phone')).toEqual({ condition: 'used' });
    expect(f('اکسیژن ساز ۱۰ لیتری مدل KSOC-10 (کار کرده 380 ساعت کارکرد)')).toEqual({ condition: 'used' });
    expect(f('میکروفون نویمن تی ال ام ۴۹ (در حد نو)')).toEqual({ condition: 'used' });
    expect(f('لنز نیکون Fisheye-Nikkor (استوک، مشابه آکبند)')).toEqual({ condition: 'used' });
    expect(f('لنز توکینا 11-16 ( دست دوم، در حد آکبند )')).toEqual({ condition: 'used' });
    expect(f('آداپتور اپل - گارانتی: پک باز شده (فقط برای تست)', 'charger')).toEqual({ condition: 'used' });
  });
  it('refurbished, incl. the bazaar short form «ریفر»', () => {
    expect(f('هارددیسک اینترنال سیگیت Exos ظرفیت 2 ترابایت(ریفر)', 'hdd')).toEqual({ condition: 'refurbished' });
    expect(f('سوئیچ سیسکو WS-C2960S-24PS-L ریفر')).toEqual({ condition: 'refurbished' });
  });
  it('copies in every extraction domain; never on the generic path («دستگاه کپی»)', () => {
    expect(f('تاچ ال سی دی آیفون ۱۳ پرو - کپی Gx', 'phone_accessory')).toEqual({ replica: true });
    expect(f('تاچ ال سی دی آیفون مدل LCD IPHONE 6G BLACK COPY', 'phone_accessory')).toEqual({ replica: true });
    expect(f('سیم 1.5 * 2 افشان حلقه 100 متری-کپی', 'wire')).toEqual({ replica: true });
    expect(f('گوشی طرح نوکیا 110 2019', 'phone')).toEqual({ replica: true });
    expect(f('دستگاه کپی شارپ رنگی')).toEqual({});
  });
  it('stays unknown where the words mean something else or both conditions are offered', () => {
    expect(f('شیر برقی اوپن 1 اینچ')).toEqual({});
    expect(f('میکروفون منلی ریفرنس کاردیوید')).toEqual({});
    expect(f('قاب سیلیکونی Copybara iPhone 15', 'phone_accessory')).toEqual({});
    expect(f('دوربین وای فای ۲ مگاپیکسل - لنز فیکس', 'cctv_camera')).toEqual({});
    expect(f('دیسک PS4 و PS5 کارکرده و آکبند')).toEqual({});
    expect(f('لپ تاپ ایسوس E410KA')).toEqual({});
  });
});
