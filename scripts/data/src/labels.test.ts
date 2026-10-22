import { describe, expect, it } from 'vitest';
import { evaluate, formatReport } from './labels-eval';

/**
 * Design gate (PLAN B5 #1): a wrong attribute is worse than a missing one.
 * Every labelled set must have no wrong values and no unsupported claims;
 * coverage is reported, not gated.
 */
describe('labelled accuracy (worker-labelled sets in scripts/data/labels)', () => {
  const stats = evaluate();
  it('has labelled sets for the six demo domains', () => {
    const sets = new Set(stats.map((s) => s.set.replace(/-holdout$/, '')));
    for (const s of ['cctv-camera', 'recorder', 'hdd', 'adapter', 'wire', 'phone-accessory']) expect(sets.has(s)).toBe(true);
  });
  it('produces no wrong values and no unsupported claims', () => {
    const bad = stats.filter((s) => s.wrong > 0 || s.unsupported > 0);
    if (bad.length) console.log(formatReport(stats));
    expect(bad.map((s) => `${s.set}.${s.attr}: wrong=${s.wrong} unsupported=${s.unsupported}`)).toEqual([]);
  });
});
