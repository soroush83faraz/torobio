import { describe, expect, it } from 'vitest';
import type { PlanResponse, Stop, StopLine } from '../api/types';
import { diffPlans } from './planDiff';

const line = (itemId: string, shopId: string, productId: string, unitPrice: number): StopLine => ({
  itemId,
  qty: 1,
  state: 'suggested',
  productName: `کالا ${itemId}`,
  listingTitle: 't',
  unitPrice,
  lineTotal: unitPrice,
  warranty: '',
  priceChangedAt: '2026-10-01',
  shopId,
  askSeller: [],
  productId,
});

const stop = (shopId: string, lines: StopLine[]): Stop => ({
  id: `stop-${shopId}`,
  index: 1,
  mall: 'م',
  shopId,
  shopName: `مغازه ${shopId}`,
  address: '',
  hoursText: '',
  open: 'unknown',
  lines,
});

const plan = (stops: Stop[]): PlanResponse =>
  ({ stops, coverage: { covered: 0, total: 0, missing: [] }, unpriced: [], compat: [], alternatives: [], closedNotes: [] }) as unknown as PlanResponse;

describe('diffPlans', () => {
  it('reports nothing when the plans are the same', () => {
    const p = plan([stop('a', [line('i1', 'a', '1', 100)])]);
    expect(diffPlans(p, p)).toEqual([]);
  });

  it('flags a replaced shop, a re-priced row and a dropped row', () => {
    const before = plan([stop('a', [line('i1', 'a', '1', 100), line('i2', 'a', '2', 50)]), stop('b', [line('i3', 'b', '3', 10)])]);
    const after = plan([stop('c', [line('i1', 'c', '1', 120)]), stop('b', [line('i3', 'b', '3', 12)])]);
    const d = diffPlans(before, after);
    expect(d.map((x) => [x.itemId, x.kind])).toEqual([
      ['i1', 'replaced'],
      ['i2', 'dropped'],
      ['i3', 'repriced'],
    ]);
    expect(d[0]).toMatchObject({ fromShop: 'مغازه a', toShop: 'مغازه c', fromPrice: 100, toPrice: 120 });
  });

  it('flags a newly covered row', () => {
    const d = diffPlans(plan([]), plan([stop('a', [line('i1', 'a', '1', 100)])]));
    expect(d).toEqual([expect.objectContaining({ itemId: 'i1', kind: 'added', toShop: 'مغازه a' })]);
  });

  it('reads the shop of each line inside a multi-shop stop', () => {
    const multi = (l1: StopLine, l2: StopLine): Stop => ({
      ...stop('a', [l1, l2]),
      shops: [
        { shopId: 'a', shopName: 'مغازه a', mall: 'م', address: '', hoursText: '', open: 'unknown', lines: [l1] },
        { shopId: 'b', shopName: 'مغازه b', mall: 'م', address: '', hoursText: '', open: 'unknown', lines: [l2] },
      ],
    });
    const before = plan([multi(line('i1', 'a', '1', 100), line('i2', 'b', '2', 50))]);
    const after = plan([multi(line('i1', 'a', '1', 100), line('i2', 'b', '2', 60))]);
    expect(diffPlans(before, after)).toEqual([expect.objectContaining({ itemId: 'i2', kind: 'repriced', toShop: 'مغازه b' })]);
  });
});
