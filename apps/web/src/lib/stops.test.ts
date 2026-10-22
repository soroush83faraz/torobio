import { describe, expect, it } from 'vitest';
import type { Stop, StopLine } from '../api/types';
import { allLines, flagLabelsOf, shopOfLine, shopsOf } from './stops';

const line = (itemId: string, shopId: string): StopLine => ({
  itemId,
  qty: 1,
  state: 'suggested',
  productName: 'p',
  listingTitle: 't',
  unitPrice: 1,
  lineTotal: 1,
  warranty: '',
  priceChangedAt: '',
  shopId,
  askSeller: [],
});
const base: Stop = { id: 's', index: 1, mall: 'م', shopId: 'a', shopName: 'الف', address: 'نشانی', hoursText: 'ساعت', open: 'open', lines: [line('i1', 'a')] };

describe('stops helpers', () => {
  it('synthesises one shop for a stop without shops[]', () => {
    expect(shopsOf(base)).toEqual([expect.objectContaining({ shopId: 'a', shopName: 'الف', lines: base.lines })]);
  });
  it('uses shops[] when present and finds the shop of a line', () => {
    const l1 = line('i1', 'a');
    const l2 = line('i2', 'b');
    const first = shopsOf(base)[0]!;
    const stop: Stop = { ...base, lines: [l1, l2], shops: [{ ...first, lines: [l1] }, { ...first, shopId: 'b', shopName: 'ب', lines: [l2] }] };
    expect(allLines([stop]).map((l) => l.itemId)).toEqual(['i1', 'i2']);
    expect(shopOfLine(stop, l2).shopName).toBe('ب');
  });
  it('labels flags from the server, else locally', () => {
    expect(flagLabelsOf({ flags: ['used'], flagLabels: ['کارکرده (استوک)'] })).toEqual(['کارکرده (استوک)']);
    expect(flagLabelsOf({ flags: ['replica'] })).toEqual(['کپی']);
    expect(flagLabelsOf({})).toEqual([]);
  });
});
