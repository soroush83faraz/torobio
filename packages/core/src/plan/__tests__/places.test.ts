import { describe, expect, it } from 'vitest';
import { shop } from '../../requirement/__tests__/fixtures';
import { placeNameFa, placesCopy } from '../../copy/fa';
import type { PlanItemInput, Shop, WeeklyHours } from '../../types/index';
import { rankPlaces } from '../places';

const item = (itemId: string, offers: [string, number | null, number?][], extra: Partial<PlanItemInput> = {}): PlanItemInput => ({
  itemId,
  label: `مورد ${itemId}`,
  qty: 1,
  state: 'suggested',
  offers: offers.map(([shopId, price, productId], i) => ({ offerId: `${itemId}-${shopId}-${i}`, productId: productId ?? 1, shopId, price })),
  ...extra,
});

const closedWed: WeeklyHours = { wed: [] };
const SHOPS: Shop[] = [
  shop('a1', 'm:A', 35.69, 51.419, null, { mallName: 'پاساژ A', mallKey: 'm:A' }),
  shop('a2', 'm:A', 35.6902, 51.4192, null, { mallName: 'پاساژ A', mallKey: 'm:A' }),
  shop('b1', 'm:B', 35.6909, 51.419, null, { mallName: 'پاساژ B', mallKey: 'm:B' }),
  shop('c1', 'c:35.7,51.43', 35.7, 51.43, closedWed),
];

describe('rankPlaces', () => {
  it('ranks by coverage first, then the covered total, and keeps the cheapest line per building', () => {
    const r = rankPlaces({
      items: [
        item('x', [['a1', 100], ['a2', 90, 2], ['b1', 50]]),
        item('y', [['a2', 200], ['c1', 10]], { qty: 3 }),
        item('z', [['b1', 30], ['c1', 20]]),
      ],
      shops: SHOPS,
    });
    expect(r.coverableIds).toEqual(['x', 'y', 'z']);
    expect(r.buildings.map((b) => [b.buildingKey, b.covered, b.total])).toEqual([
      ['c:35.7,51.43', 2, 50], // y 10×3 + z 20
      ['m:B', 2, 80], // x 50 + z 30
      ['m:A', 2, 690], // x 90 (a2) + y 200×3
    ]);
    const a = r.buildings.find((b) => b.buildingKey === 'm:A')!;
    expect(a.mallName).toBe('پاساژ A');
    expect(a.lines[0]).toMatchObject({ itemId: 'x', shopId: 'a2', productId: 2, unitPrice: 90, lineTotal: 90, shopIds: ['a2', 'a1'] });
    expect(a.shopIds).toEqual(['a2', 'a1']);
    expect(a.lat).toBeCloseTo(35.6901, 4);
    expect(a.lon).toBeCloseTo(51.4191, 4);
  });

  it('applies the planner gate: unpriced, excluded and closed-at-visit offers never cover', () => {
    const items = [item('x', [['a1', null], ['b1', 50], ['c1', 40]]), item('y', [['a1', 70], ['c1', 60]])];
    const open = rankPlaces({ items, shops: SHOPS });
    expect(open.buildings[0]!.buildingKey).toBe('c:35.7,51.43');
    // a Wednesday visit closes c1; excluding b1 leaves x nowhere
    const r = rankPlaces({ items, shops: SHOPS, visit: { day: 'wed', minute: 600 }, exclusions: { shopIds: ['b1'] } });
    expect(r.coverableIds).toEqual(['y']);
    expect(r.buildings.map((b) => [b.buildingKey, b.covered])).toEqual([['m:A', 1]]);
    expect(rankPlaces({ items, shops: SHOPS, exclusions: { mallKeys: ['m:A', 'm:B'] } }).buildings.map((b) => b.buildingKey)).toEqual(['c:35.7,51.43']);
  });

  it('never covers an item waiting on a question or not found (the caller passes default picks as suggested)', () => {
    const r = rankPlaces({ items: [item('x', [['a1', 10]], { state: 'needs_info' }), item('y', [['a1', 10]], { state: 'not_found' })], shops: SHOPS });
    expect(r.coverableIds).toEqual([]);
    expect(r.buildings).toEqual([]);
  });

  it('asks the compat guard about one building at a time: the culprit takes its next product there, or is left out', () => {
    const items = [item('cam', [['a1', 100, 1], ['b1', 100, 1]]), item('rec', [['a1', 50, 10], ['a2', 80, 11], ['b1', 40, 10], ['b1', 90, 12]])];
    // product 10 (say an NVR) cannot stand next to camera 1; 11 can; 12 cannot either
    const conflictOf = (picks: ReadonlyArray<{ itemId: string; productId: number }>) =>
      picks.some((p) => p.productId === 1) && picks.some((p) => p.productId === 10 || p.productId === 12) ? 'rec' : undefined;
    const r = rankPlaces({ items, shops: SHOPS }, { conflictOf });
    const a = r.buildings.find((b) => b.buildingKey === 'm:A')!;
    expect(a.lines.find((l) => l.itemId === 'rec')).toMatchObject({ productId: 11, shopId: 'a2', unitPrice: 80, shopIds: ['a2'] });
    const b = r.buildings.find((x) => x.buildingKey === 'm:B')!;
    expect(b.lines.map((l) => l.itemId)).toEqual(['cam']);
    expect(r.buildings[0]!.buildingKey).toBe('m:A');
    // without the guard: the plain cheapest offers
    expect(rankPlaces({ items, shops: SHOPS }).buildings[0]).toMatchObject({ buildingKey: 'm:B', total: 140 });
  });

  it('breaks an equal (coverage, total) tie by more relevant shops', () => {
    const r = rankPlaces({ items: [item('x', [['b1', 50], ['a1', 50], ['a2', 60]])], shops: SHOPS });
    expect(r.buildings.map((b) => [b.buildingKey, b.shopIds.length])).toEqual([
      ['m:A', 2],
      ['m:B', 1],
    ]);
  });
});

describe('places copy', () => {
  it('states the finding with Persian digits and the mall name as written', () => {
    expect(placeNameFa('پاساژ علاالدین 2')).toBe('پاساژ علاالدین ۲');
    expect(placesCopy.allIn(4, 'پاساژ علاالدین 2', 12_300_000)).toBe('همهٔ ۴ مورد در پاساژ علاالدین ۲ هست (جمع ۱۲٫۳ میلیون تومان).');
    expect(placesCopy.allIn(2, 'پاساژ چارسو', 800_000)).toBe('هر دو مورد در پاساژ چارسو هست (جمع ۸۰۰ هزار تومان).');
    expect(placesCopy.mostIn(3, 4, 'پاساژ بوشهری')).toBe('۳ از ۴ مورد در پاساژ بوشهری هست؛ بقیه را باید از جای دیگری بخری.');
    expect(placesCopy.single(5, 'پاساژ امجد')).toBe('این مورد در ۵ جا پیدا شد؛ ارزان‌ترین در پاساژ امجد.');
    expect(placeNameFa('Tehran Mall')).toBe('⁦Tehran Mall⁩');
  });
});
