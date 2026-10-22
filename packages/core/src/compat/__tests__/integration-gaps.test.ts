/**
 * Engine behaviour added while wiring the engine to market.sqlite (M2-A):
 * device-model keys (extractor convention), the 'analog' camera family, and the wire sale-unit guard.
 */
import { describe, expect, it } from 'vitest';
import { cand, req, user } from '../../requirement/__tests__/fixtures';
import { deviceModelsMatch, evaluateConstraint } from '../../requirement/evaluate';
import { resolveItems } from '../../requirement/resolve';
import { applyDerivedConstraints, criticalUnknowns, evaluateCompat } from '../index';

describe('device-model keys', () => {
  it('variants are distinct; a one-sided network suffix is ignored', () => {
    expect(deviceModelsMatch('galaxy a56', 'galaxy a56')).toBe(true);
    expect(deviceModelsMatch('Galaxy  A56', 'galaxy a56')).toBe(true);
    expect(deviceModelsMatch('galaxy a56', 'galaxy a56 5g')).toBe(true);
    expect(deviceModelsMatch('galaxy a56 4g', 'galaxy a56 5g')).toBe(false);
    expect(deviceModelsMatch('galaxy s24', 'galaxy s24 ultra')).toBe(false);
    expect(deviceModelsMatch('galaxy a56', 'galaxy a57')).toBe(false);
    expect(deviceModelsMatch('iphone 15 pro', 'iphone 15 pro max')).toBe(false);
  });
  it('fits_models contains and phone_model eq use the same convention', () => {
    const c = { attr: 'fits_models', op: 'contains', value: 'galaxy a56', source: 'compat' } as const;
    expect(evaluateConstraint(c, { fits_models: ['galaxy a56 5g'] }).result).toBe('pass');
    expect(evaluateConstraint(c, { fits_models: ['galaxy a56 ultra'] }).result).toBe('fail');
    const p = { attr: 'phone_model', op: 'eq', value: 'galaxy a56', source: 'user' } as const;
    expect(evaluateConstraint(p, { phone_model: 'galaxy a56 5g' }).result).toBe('pass');
    expect(evaluateConstraint(p, { phone_model: 'galaxy a57 5g' }).result).toBe('fail');
  });
  it('a case listed for the 4G-less key fits a phone listed with 5G (listing_stated)', () => {
    const [phone, kase] = applyDerivedConstraints([
      req('p', 'گوشی A56', [user({ attr: 'phone_model', op: 'eq', value: 'galaxy a56' })], { kind: 'phone' }),
      req('k', 'قاب', [], { kind: 'phone_case' }),
    ]);
    const f = evaluateCompat([
      { item: phone!, attrs: { phone_model: 'galaxy a56 5g' } },
      { item: kase!, attrs: { fits_models: ['galaxy a56'] } },
    ]);
    expect(f.map((x) => x.status)).toEqual(['listing_stated']);
  });
});

describe('analog camera family', () => {
  it("a stated 'analog' camera derives an XVR/DVR recorder", () => {
    const items = applyDerivedConstraints([
      req('c', 'دوربین آنالوگ', [user({ attr: 'camera_signal', op: 'eq', value: 'analog' })], { kind: 'camera' }),
      req('r', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    expect(items[1]!.constraints).toContainEqual(expect.objectContaining({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'] }));
    const f = evaluateCompat([
      { item: items[0]!, attrs: { camera_signal: 'analog' } },
      { item: items[1]!, attrs: { recorder_kind: 'xvr' } },
    ]).filter((x) => x.ruleId === 'camera_recorder_signal');
    expect(f[0]!.status).toBe('assumed');
  });
});

describe('wire sale-unit guard', () => {
  const wires = [
    cand(1, { wire_section_mm2: 2.5, sale_unit: 'roll' }, [['s', 2_000_000]]),
    cand(2, { wire_section_mm2: 2.5, sale_unit: 'meter' }, [['s', 25_000]]),
    cand(3, { wire_section_mm2: 2.5 }, [['s', 10_000]]),
  ];
  it('derives a known constraint and a mandatory question that settle/skip cannot bypass', () => {
    const w = req('w', 'سیم ۲٫۵', [user({ attr: 'wire_section_mm2', op: 'eq', value: 2.5 })], {
      kind: 'wire',
      preference: { acceptSuggestion: true },
      skippedQuestions: ['sale_unit'],
    });
    const { items, critical, results } = resolveItems([w], { w: wires });
    expect(items[0]!.constraints).toContainEqual(expect.objectContaining({ attr: 'sale_unit', op: 'known', ruleId: 'wire_sale_unit' }));
    expect(critical).toHaveLength(1);
    const r = results[0]!;
    expect(r.resolution.state).toBe('needs_info');
    expect(r.question.question?.key).toBe('sale_unit');
    expect(r.question.question?.options.map((o) => o.id)).toEqual(['sale_unit:meter', 'sale_unit:roll']);
    // the product with an unreadable unit is never eligible
    expect(r.resolution.eligibleIds).not.toContain(3);
  });
  it('a stated unit resolves the item to one comparable unit', () => {
    const w = req('w', 'سیم ۲٫۵', [user({ attr: 'wire_section_mm2', op: 'eq', value: 2.5 }), user({ attr: 'sale_unit', op: 'eq', value: 'meter' })], { kind: 'wire' });
    expect(criticalUnknowns(applyDerivedConstraints([w]))).toEqual([]);
    const { results } = resolveItems([w], { w: wires });
    expect(results[0]!.resolution.state).toBe('suggested');
    expect(results[0]!.resolution.eligibleIds).toEqual([2]);
  });
});
