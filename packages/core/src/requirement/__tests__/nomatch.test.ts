/**
 * G1a: «no eligible product» is never a dead end. The summary says why (numbers from the data), what the user can
 * lift (strongest first), and the nearest products; it never picks anything.
 */
import { describe, expect, it } from 'vitest';
import { noMatchCopy } from '../../copy/fa';
import type { Requirement } from '../../types/index';
import { noMatchSummary } from '../nomatch';
import { resolveItem } from '../resolve';
import { cand, req, user } from './fixtures';

const a56 = user({ attr: 'phone_model', op: 'eq', value: 'galaxy a56' });
const phones = () => [
  cand(1, { brand: 'samsung', phone_model: 'galaxy a56' }, [['s1', 100_600_000], ['s2', 105_000_000]]),
  cand(2, { brand: 'samsung', phone_model: 'galaxy a56' }, [['s1', 116_800_000]]),
  cand(3, { brand: 'samsung', phone_model: 'galaxy a06' }, [['s1', 9_000_000]]), // under budget, another model
  cand(4, { brand: 'samsung', phone_model: 'galaxy a56' }, [['s1', 40_000_000]]),
];

function summary(item: Requirement, cands = phones()) {
  const { resolution } = resolveItem(item, cands);
  return { resolution, nm: noMatchSummary(item, resolution) };
}

describe('noMatchSummary', () => {
  it('budget: «A56 under 50 M» says the cheapest A56, offers to lift the budget first, nearest are the A56s', () => {
    const item = req('p', 'گوشی سامسونگ A56', [a56], { kind: 'phone', budget: { max: 50_000_000 } });
    const cands = phones();
    cands[3]!.listing = { condition: 'used' }; // the 40 M one is a used listing: differs on two counts
    const { resolution, nm } = summary(item, cands);
    expect(resolution.state).toBe('alternative');
    expect(resolution.chosenProductId).toBeUndefined();
    expect(nm!.reasonFa).toBe('هیچ مدلی با بودجهٔ ۵۰ میلیون پیدا نشد؛ ارزان‌ترین مدل ۱۰۰٫۶ میلیون تومان است');
    expect(nm!.reasonFa).toBe(noMatchCopy.budget(undefined, 50_000_000, 100_600_000));
    expect(nm!.relax[0]).toEqual({ attr: 'budget', label: 'بودجه را بردار' });
    expect(nm!.relax.map((r) => r.attr)).toContain('phone_model');
    expect(nm!.closestIds.slice(0, 2)).toEqual([1, 2]);
    expect(nm!.closestIds).not.toContain(undefined);
  });

  it('condition: a used request with only new listings says so and offers to lift «کارکرده»', () => {
    const item = req('p', 'گوشی A56 استوک', [a56], { kind: 'phone', condition: 'used' });
    const { nm } = summary(item);
    expect(nm!.reasonFa).toBe(noMatchCopy.conditionUsed(3));
    expect(nm!.relax[0]).toEqual({ attr: 'condition', label: 'شرط «کارکرده (استوک)» را بردار' });
  });

  it('a stated spec nobody has: the spec is the reason and the thing to lift', () => {
    const item = req('p', 'گوشی ۵۱۲ گیگ', [user({ attr: 'storage_gb', op: 'eq', value: 512 })], { kind: 'phone' });
    const cands = [cand(1, { storage_gb: 128 }, [['s1', 10_000_000]]), cand(2, { storage_gb: 256 }, [['s1', 12_000_000]])];
    const { nm } = summary(item, cands);
    expect(nm!.reasonFa).toBe(noMatchCopy.attr('۵۱۲ گیگابایت', 2));
    expect(nm!.relax).toEqual([{ attr: 'storage_gb', label: 'شرط «۵۱۲ گیگابایت» را بردار' }]);
  });

  it('only listings without the needed detail: says it, offers nothing it cannot lift', () => {
    const item = req('p', 'گوشی ۵۱۲ گیگ', [user({ attr: 'storage_gb', op: 'eq', value: 512 })], { kind: 'phone' });
    const { resolution, nm } = summary(item, [cand(1, {}, [['s1', 10_000_000]])]);
    expect(resolution.state).toBe('alternative');
    expect(nm!.reasonFa).toBe(noMatchCopy.unknown('حافظهٔ داخلی', 1));
  });

  it('nothing when something is eligible, when the user pinned the product, or when there are no candidates', () => {
    expect(summary(req('p', 'گوشی A56', [a56], { kind: 'phone' })).nm).toBeNull();
    const pinned = req('p', 'گوشی A56', [a56], { kind: 'phone', pinnedProductId: 3 });
    expect(summary(pinned).nm).toBeNull();
    expect(summary(req('p', 'x', [a56]), []).nm).toBeNull();
  });
});
