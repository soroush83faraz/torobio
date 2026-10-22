import { describe, expect, it } from 'vitest';
import { int, rng, shop, shuffle } from '../../requirement/__tests__/fixtures';
import type { Plan, PlanInput, PlanItemInput, PlanResult, Shop } from '../../types/index';
import { haversineM } from '../geo';
import { planRun } from '../optimize';

const item = (itemId: string, offers: [string, number | null, number?][], extra: Partial<PlanItemInput> = {}): PlanItemInput => ({
  itemId,
  label: `مورد ${itemId}`,
  qty: 1,
  state: 'exact_model',
  offers: offers.map(([shopId, price, productId], i) => ({ offerId: `${itemId}-${shopId}-${i}`, productId: productId ?? 1, shopId, price })),
  ...extra,
});

// three buildings ~100 m apart, one far away
const SHOPS: Shop[] = [
  shop('a1', 'A', 35.6900, 51.4190),
  shop('a2', 'A', 35.6900, 51.4191),
  shop('b1', 'B', 35.6909, 51.4190),
  shop('c1', 'C', 35.6900, 51.4201),
  shop('z1', 'Z', 35.7300, 51.4600),
];

const allText = (p: Plan) => [p.totals.line, p.totals.missingLine ?? '', ...p.reasons.map((r) => r.text), p.delta?.text ?? ''].join(' | ');

describe('planner basics', () => {
  it('one stop when one building has everything at the best prices', () => {
    const res = planRun({ items: [item('x', [['a1', 100_000], ['b1', 120_000]]), item('y', [['a2', 50_000], ['c1', 60_000]])], shops: SHOPS });
    expect(res.plans).toHaveLength(1);
    const p = res.plans[0]!;
    expect(p.stopCount).toBe(1);
    expect(p.totals.total).toBe(150_000);
    expect(p.stops[0]!.shops.map((s) => s.shop.id)).toEqual(['a1', 'a2']);
    expect(p.totals.line).toBe('جمع ۲ مورد: ۱۵۰ هزار تومان');
    expect(p.tags).toEqual(['cheapest', 'fewest_stops', 'most_compact']);
    expect(res.notes.some((n) => n.code === 'only_one')).toBe(true);
  });

  it('price × qty, one item at one stop', () => {
    const res = planRun({ items: [item('x', [['a1', 100_000], ['b1', 90_000]], { qty: 4 })], shops: SHOPS });
    expect(res.plans[0]!.assignments[0]).toMatchObject({ shopId: 'b1', unitPrice: 90_000, qty: 4, lineTotal: 360_000 });
  });

  it('Pareto set over (cost, stops) with deltas vs the default', () => {
    const items = [item('x', [['a1', 100_000], ['b1', 70_000]]), item('y', [['a1', 100_000], ['c1', 80_000]])];
    const res = planRun({ items, shops: SHOPS });
    expect(res.plans.map((p) => [p.stopCount, p.totals.total])).toEqual([[3 - 1, 150_000], [1, 200_000]]);
    const def = res.plans[0]!;
    expect(def.isDefault).toBe(true);
    expect(def.reasons[0]!.code).toBe('default_cheapest');
    expect(def.reasons[0]!.text).toContain('ارزان‌ترین');
    const alt = res.plans[1]!;
    expect(alt.delta).toMatchObject({ cost: 50_000, stops: -1 });
    expect(alt.delta!.text).toBe('۵۰ هزار تومان بیشتر، یک توقف کمتر');
    // preference picks the default
    const few = planRun({ items, shops: SHOPS, preference: 'fewest_stops' });
    expect(few.plans[0]!.stopCount).toBe(1);
    expect(few.plans[0]!.reasons[0]!.code).toBe('default_fewest_stops');
    expect(few.plans[1]!.delta!.text).toBe('۵۰ هزار تومان ارزان‌تر، یک توقف بیشتر');
  });

  it('ties at equal (cost, stops) are broken by compactness', () => {
    // y costs the same at B (≈100 m from A) and at Z (far): the compact pair wins
    const items = [item('x', [['a1', 100_000]]), item('y', [['z1', 50_000], ['b1', 50_000]])];
    const res = planRun({ items, shops: SHOPS });
    expect(res.plans[0]!.stops.map((s) => s.buildingKey).sort()).toEqual(['A', 'B']);
    expect(res.plans[0]!.spreadM).toBeLessThan(200);
  });

  it('suggested order starts from the densest stop (nearest neighbour)', () => {
    const items = [item('x', [['a1', 1]].map(([s]) => [s as string, 10_000] as [string, number])), item('y', [['b1', 10_000]]), item('z', [['z1', 10_000]])];
    const res = planRun({ items, shops: SHOPS });
    const order = res.plans[0]!.stops.map((s) => s.buildingKey);
    expect(order[2]).toBe('Z');
    const s0 = res.plans[0]!.stops[0]!;
    expect(s0.distanceToNextM).toBeCloseTo(haversineM(s0 as { lat: number; lon: number }, res.plans[0]!.stops[1] as { lat: number; lon: number }), 6);
    expect(res.plans[0]!.stops.at(-1)!.distanceToNextM).toBeNull();
    expect(res.orderNote).toContain('نه مسیر');
  });
});

describe('coverage, partial plans and unknown prices (B1.3)', () => {
  it('unpriced items are listed separately with sellers and add nothing to the total', () => {
    const res = planRun({
      items: [item('x', [['a1', 100_000]]), item('y', [['b1', null], ['c1', null]], { state: 'price_unknown' }), item('n', [], { state: 'needs_info' })],
      shops: SHOPS,
    });
    const p = res.plans[0]!;
    expect(p.totals.total).toBe(100_000);
    expect(p.totals.coverage).toMatchObject({ coveredCount: 1, totalCount: 3, complete: false });
    expect(p.totals.coverage.unpricedItems.map((u) => [u.itemId, u.sellers.map((s) => s.shopId)])).toEqual([['y', ['b1', 'c1']]]);
    expect(p.totals.coverage.missingItems.map((m) => [m.itemId, m.reason])).toEqual([['y', 'price_unknown'], ['n', 'needs_info']]);
    expect(p.totals.line).toBe('فقط ۱ از ۳ مورد: ۱۰۰ هزار تومان');
    expect(p.totals.missingLine).toBe('منتظر انتخاب: مورد n · قیمت ثبت نشده: مورد y');
  });

  it('partial plans never carry superlatives or superlative tags', () => {
    const items = [item('x', [['a1', 100_000], ['b1', 70_000]]), item('y', [['a1', 100_000], ['c1', 80_000]]), item('q', [], { state: 'needs_info' })];
    for (const preference of ['cheapest', 'fewest_stops', 'compact'] as const) {
      const res = planRun({ items, shops: SHOPS, preference });
      expect(res.plans.length).toBe(2);
      for (const p of res.plans) {
        expect(p.totals.coverage.complete).toBe(false);
        expect(p.tags).toEqual([]);
        expect(allText(p)).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین|نزدیک‌ترین/);
      }
      expect(res.plans[0]!.reasons[0]!.code).toBe('partial');
      expect(res.plans[0]!.reasons[0]!.text).toContain('ناقص');
    }
  });

  it('complete plans use the complete wording and «با مدل‌های پیشنهادی» when suggestions are used', () => {
    const res = planRun({ items: [item('x', [['a1', 2_500_000]], { state: 'suggested', chosenProductId: 1, rule: 'cheapest_eligible' })], shops: SHOPS });
    const t = res.plans[0]!.totals;
    expect(t.coverage.complete).toBe(true);
    expect(t.line).toBe('جمع ۱ مورد: ۲٫۵ میلیون تومان');
    expect(t.suggestionNote).toBe('با مدل‌های پیشنهادی');
    expect(t.coverage.usesSuggestions).toBe(true);
    expect(res.plans[0]!.assignments[0]!.rule).toBe('cheapest_eligible');
  });

  it('a suggested item bought as a different eligible model is labelled cheapest-at-stop', () => {
    const res = planRun({
      items: [
        item('x', [['a1', 2_000_000, 7], ['b1', 2_100_000, 8]], { state: 'suggested', chosenProductId: 7, rule: 'cheapest_eligible' }),
        item('y', [['b1', 100_000]]),
      ],
      shops: SHOPS,
      preference: 'fewest_stops',
    });
    expect(res.plans[0]!.assignments.find((a) => a.itemId === 'x')).toMatchObject({ productId: 8, rule: 'cheapest_eligible_at_stop' });
  });

  it('nothing plannable', () => {
    const res = planRun({ items: [item('n', [], { state: 'needs_info' })], shops: SHOPS });
    expect(res.plans).toEqual([]);
    expect(res.defaultPlanId).toBeNull();
    expect(res.notes[0]!.code).toBe('nothing_plannable');
  });
});

describe('hours, exclusions and stop limits', () => {
  const hoursShops: Shop[] = [
    shop('open', 'A', 35.69, 51.419, { fri: [[600, 840]] }),
    shop('closed', 'B', 35.6909, 51.419, { fri: [] }),
    shop('nohours', 'C', 35.69, 51.4201, null),
    shop('nofri', 'D', 35.6905, 51.4195, { sat: [[600, 1200]] }),
  ];
  it('closed-at-visit shops are excluded; shops with no hours are never treated as closed', () => {
    const items = [item('x', [['closed', 10_000], ['nohours', 20_000]]), item('y', [['closed', 10_000], ['nofri', 30_000]])];
    const res = planRun({ items, shops: hoursShops, visit: { day: 'fri', minute: 1300 } });
    const shopsUsed = res.plans[0]!.assignments.map((a) => a.shopId).sort();
    expect(shopsUsed).toEqual(['nofri', 'nohours']);
    expect(res.closedShopIds).toEqual(['closed']);
    expect(res.plans[0]!.stops.flatMap((s) => s.shops.map((x) => x.openStatus))).toEqual(['unknown', 'unknown']);
    expect(res.notes.some((n) => n.code === 'closed_excluded')).toBe(true);
    // without a visit time nothing is excluded
    const anyTime = planRun({ items, shops: hoursShops });
    expect(anyTime.plans[0]!.assignments.every((a) => a.shopId === 'closed')).toBe(true);
    expect(anyTime.plans[0]!.stops[0]!.shops[0]!.openStatus).toBeNull();
  });
  it('an item only sold at closed shops is missing with reason "closed"', () => {
    const res = planRun({ items: [item('x', [['closed', 10_000]]), item('y', [['open', 5_000]])], shops: hoursShops, visit: { day: 'fri', minute: 700 } });
    expect(res.coverage.missingItems).toEqual([{ itemId: 'x', label: 'مورد x', reason: 'closed' }]);
    expect(res.plans[0]!.stops[0]!.shops[0]!.openStatus).toBe('open');
  });
  it('excluded shops / malls / buildings', () => {
    const shops = [shop('m1', 'M', 35.69, 51.419, null, { mallKey: 'mall1' }), shop('s2', 'S', 35.691, 51.42)];
    const items = [item('x', [['m1', 10_000], ['s2', 20_000]])];
    expect(planRun({ items, shops, exclusions: { mallKeys: ['mall1'] } }).plans[0]!.assignments[0]!.shopId).toBe('s2');
    expect(planRun({ items, shops, exclusions: { shopIds: ['m1'] } }).plans[0]!.assignments[0]!.shopId).toBe('s2');
    const none = planRun({ items, shops, exclusions: { buildingKeys: ['M', 'S'] } });
    expect(none.coverage.missingItems[0]!.reason).toBe('excluded');
  });
  it('maxStops limits coverage honestly', () => {
    const res = planRun({ items: [item('x', [['a1', 10_000]]), item('y', [['b1', 10_000]])], shops: SHOPS, maxStops: 1 });
    expect(res.plans[0]!.totals.coverage.coveredCount).toBe(1);
    expect(res.coverage.missingItems[0]!.reason).toBe('stop_limit');
  });
});

// ---------------------------------------------------------------------------
// Property tests against a brute force on synthetic data
// ---------------------------------------------------------------------------

function synthetic(seed: number): PlanInput {
  const r = rng(seed);
  const nb = int(r, 1, 6);
  const shops: Shop[] = [];
  for (let b = 0; b < nb; b++) {
    const lat = 35.68 + r() * 0.02;
    const lon = 51.41 + r() * 0.02;
    const ns = int(r, 1, 2);
    for (let s = 0; s < ns; s++) shops.push(shop(`b${b}s${s}`, `B${b}`, lat + s * 1e-5, lon, r() < 0.3 ? null : { sat: [[600, 1200]], fri: r() < 0.5 ? [] : [[600, 840]] }));
  }
  const m = int(r, 1, 5);
  const items: PlanItemInput[] = [];
  for (let i = 0; i < m; i++) {
    const offers: [string, number | null, number][] = [];
    const k = int(r, 0, 4);
    for (let j = 0; j < k; j++) offers.push([shops[int(r, 0, shops.length - 1)]!.id, r() < 0.1 ? null : int(r, 1, 20) * 10_000, int(r, 1, 3)]);
    items.push(item(`i${i}`, offers, { qty: int(r, 1, 3), state: r() < 0.5 ? 'suggested' : 'exact_model' }));
  }
  const input: PlanInput = { items, shops };
  if (r() < 0.4) input.visit = { day: r() < 0.5 ? 'sat' : 'fri', minute: int(r, 500, 1300) };
  return input;
}

/** Brute force over building subsets: g(k) = min cost covering the max coverable set with at most k buildings. */
function brute(res: PlanResult, input: PlanInput): { k: number; cost: number }[] {
  if (res.plans.length === 0) return [];
  const covered = new Set(res.plans[0]!.assignments.map((a) => a.itemId));
  const shopById = new Map(input.shops.map((s) => [s.id, s]));
  const closed = new Set(res.closedShopIds);
  const keys = [...new Set(input.shops.map((s) => s.buildingKey))].sort();
  const cost = (bset: string[]): number => {
    let total = 0;
    for (const it of input.items.filter((i) => covered.has(i.itemId))) {
      let best = Infinity;
      for (const o of it.offers) {
        const s = shopById.get(o.shopId);
        if (!s || o.price === null || closed.has(s.id) || !bset.includes(s.buildingKey)) continue;
        best = Math.min(best, o.price * it.qty);
      }
      if (best === Infinity) return Infinity;
      total += best;
    }
    return total;
  };
  const g: number[] = [];
  for (let k = 1; k <= covered.size; k++) {
    let best = Infinity;
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const set = keys.filter((_, i) => mask & (1 << i));
      if (set.length <= k) best = Math.min(best, cost(set));
    }
    g.push(best);
  }
  const front: { k: number; cost: number }[] = [];
  let last = Infinity;
  g.forEach((c, i) => {
    if (c < last) {
      front.push({ k: i + 1, cost: c });
      last = c;
    }
  });
  return front;
}

describe('property: exact optimiser (400 synthetic cases)', () => {
  it('matches the brute-force Pareto front; every plan is non-dominated; complete coverage when possible', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const input = synthetic(seed);
      const res = planRun(input);
      const got = [...res.plans].map((p) => ({ k: p.stopCount, cost: p.totals.total })).sort((a, b) => a.k - b.k);
      expect(got).toEqual(brute(res, input));
      for (const p of res.plans)
        for (const q of res.plans)
          if (p !== q) expect(q.totals.total <= p.totals.total && q.stopCount <= p.stopCount).toBe(false);
      for (const p of res.plans) {
        expect(p.assignments.reduce((s, a) => s + a.lineTotal, 0)).toBe(p.totals.total);
        expect(new Set(p.assignments.map((a) => a.itemId)).size).toBe(p.assignments.length); // one stop per item
        expect(p.stops.every((s) => s.itemIds.length > 0)).toBe(true);
        for (const a of p.assignments) expect(res.closedShopIds).not.toContain(a.shopId);
      }
      expect(res.plans.filter((p) => p.isDefault)).toHaveLength(res.plans.length ? 1 : 0);
      // coverage = every item with at least one usable offer
      const coverable = res.plans[0]?.totals.coverage.coveredCount ?? 0;
      expect(coverable + res.coverage.missingItems.length).toBe(input.items.length);
    }
  });

  it('determinism: same output for repeated calls and shuffled shops/offers', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const input = synthetic(seed);
      const a = planRun(input);
      expect(planRun(input)).toEqual(a);
      const r = rng(seed * 31);
      const shuffled: PlanInput = { ...input, shops: shuffle(r, input.shops), items: input.items.map((it) => ({ ...it, offers: shuffle(r, it.offers) })) };
      expect(planRun(shuffled)).toEqual(a);
    }
  });

  it('coverage never decreases and the best cost never increases when offers are added', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const input = synthetic(seed);
      const before = planRun(input);
      const r = rng(seed * 7 + 1);
      const extra = input.items.map((it) => ({
        ...it,
        offers: [...it.offers, ...(r() < 0.6 ? [{ offerId: `extra-${it.itemId}`, productId: 9, shopId: input.shops[int(r, 0, input.shops.length - 1)]!.id, price: int(r, 1, 20) * 10_000 }] : [])],
      }));
      const after = planRun({ ...input, items: extra });
      const cov = (x: PlanResult) => x.plans[0]?.totals.coverage.coveredCount ?? 0;
      expect(cov(after)).toBeGreaterThanOrEqual(cov(before));
      if (cov(after) === cov(before) && before.plans.length) {
        const minCost = (x: PlanResult) => Math.min(...x.plans.map((p) => p.totals.total));
        expect(minCost(after)).toBeLessThanOrEqual(minCost(before));
      }
    }
  });

  it('partial vs complete wording holds on every synthetic plan', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const res = planRun(synthetic(seed));
      for (const p of res.plans) {
        if (p.totals.coverage.complete) {
          expect(p.totals.line.startsWith('جمع ')).toBe(true);
          expect(p.totals.missingLine).toBeUndefined();
        } else {
          expect(p.totals.line.startsWith('فقط ')).toBe(true);
          expect(p.tags).toEqual([]);
          expect(allText(p)).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین/);
        }
      }
    }
  });
});
