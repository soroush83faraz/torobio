import { describe, expect, it } from 'vitest';
import { cand, req, user } from '../../requirement/__tests__/fixtures';
import { resolveItems } from '../../requirement/resolve';
import type { CompatFinding, ProductAttrs, Requirement } from '../../types/index';
import { applyDerivedConstraints, COMPAT_RULES, criticalUnknowns, deriveConstraints, evaluateCompat } from '../index';

const ch = (item: Requirement, attrs: ProductAttrs | null) => ({ item, attrs });
const by = (fs: CompatFinding[], id: string) => fs.filter((f) => f.ruleId === id);

describe('rules table', () => {
  it('only CCTV and phone accessories have compatibility rules (wire carries only the sale-unit guard)', () => {
    const compat = COMPAT_RULES.filter((r) => r.id !== 'wire_sale_unit');
    expect(new Set(compat.map((r) => r.domain))).toEqual(new Set(['cctv', 'phone']));
    const wire = req('w', 'سیم', [], { kind: 'wire' });
    expect(evaluateCompat([ch(wire, { sale_unit: 'roll' })])).toEqual([]);
  });
  it('nothing is derived or evaluated for other domains', () => {
    const items = [req('w', 'سیم افشان ۲٫۵', [user({ attr: 'wire_section_mm2', op: 'eq', value: 2.5 })], { kind: 'other' })];
    expect(deriveConstraints(items)).toEqual([]);
    expect(criticalUnknowns(items)).toEqual([]);
    expect(evaluateCompat([ch(items[0]!, { wire_section_mm2: 2.5 })])).toEqual([]);
  });
});

describe('derived constraints (stated requirements only)', () => {
  it('recorder channels >= total stated camera quantity', () => {
    const items = applyDerivedConstraints([
      req('c1', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true }),
      req('c2', '۲ دوربین', [], { kind: 'camera', qty: 2, qtyStated: true }),
      req('r', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    expect(items[2]!.constraints).toContainEqual({ attr: 'channels', op: 'gte', value: 6, source: 'compat', ruleId: 'recorder_channels', fromItemId: 'c1' });
  });
  it('does not derive from a default (unstated) quantity', () => {
    const items = applyDerivedConstraints([req('c', 'دوربین', [], { kind: 'camera' }), req('r', 'ضبط‌کننده', [], { kind: 'recorder' })]);
    expect(items[1]!.constraints.filter((c) => c.attr === 'channels')).toEqual([]);
  });
  it('is idempotent', () => {
    const once = applyDerivedConstraints([req('c', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true }), req('r', 'ضبط', [], { kind: 'recorder' })]);
    expect(applyDerivedConstraints(once)).toEqual(once);
  });
  it('IP cameras → recorder kind NVR', () => {
    const items = applyDerivedConstraints([
      req('c', 'دوربین IP', [user({ attr: 'camera_signal', op: 'eq', value: 'ip' })], { kind: 'camera' }),
      req('r', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    expect(items[1]!.constraints[0]).toMatchObject({ attr: 'recorder_kind', op: 'in', values: ['nvr'], source: 'compat' });
  });
  it('accessories inherit the stated phone model', () => {
    const items = applyDerivedConstraints([
      req('p', 'گوشی A56', [user({ attr: 'phone_model', op: 'eq', value: 'A56' })], { kind: 'phone' }),
      req('k', 'کاور', [], { kind: 'phone_case' }),
      req('g', 'گلس', [], { kind: 'screen_protector' }),
    ]);
    expect(items[1]!.constraints).toEqual([{ attr: 'fits_models', op: 'contains', value: 'A56', source: 'compat', ruleId: 'phone_accessory_fit', fromItemId: 'p' }]);
    expect(items[2]!.constraints[0]).toMatchObject({ attr: 'fits_models', value: 'A56' });
    expect(criticalUnknowns(items)).toEqual([]);
  });
});

describe('evaluation over chosen products', () => {
  const cam = req('cam', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true });
  const rec = req('rec', 'ضبط‌کننده', [], { kind: 'recorder' });
  const hdd = req('hdd', 'هارد', [], { kind: 'hdd' });
  const ad = req('ad', 'آداپتور', [], { kind: 'adapter' });

  it('channels: listing_stated / conflict / unknown', () => {
    expect(by(evaluateCompat([ch(cam, {}), ch(rec, { channels: 8 })]), 'recorder_channels')[0]).toMatchObject({ status: 'listing_stated', basis: 'listing' });
    const few = by(evaluateCompat([ch(cam, {}), ch(rec, { channels: 2 })]), 'recorder_channels')[0]!;
    expect(few.status).toBe('conflict');
    expect(few.askSeller).toBeDefined();
    const unk = by(evaluateCompat([ch(cam, {}), ch(rec, {})]), 'recorder_channels')[0]!;
    expect(unk.status).toBe('unknown');
    expect(unk.askSeller).toContain('کانال');
  });
  it('camera signal vs recorder kind is only ever an assumption (or unknown / rule conflict)', () => {
    const f = by(evaluateCompat([ch(cam, { camera_signal: 'ahd' }), ch(rec, { recorder_kind: 'xvr' })]), 'camera_recorder_signal')[0]!;
    expect(f.status).toBe('assumed');
    expect(f.basis).toBe('general_rule');
    expect(f.sentence).toContain('وصل می‌شوند');
    expect(f.askSeller).toContain('سازگار');
    expect(by(evaluateCompat([ch(cam, { camera_signal: 'ip' }), ch(rec, { recorder_kind: 'nvr' })]), 'camera_recorder_signal')[0]!.status).toBe('assumed');
    expect(by(evaluateCompat([ch(cam, { camera_signal: 'ahd' }), ch(rec, { recorder_kind: 'nvr' })]), 'camera_recorder_signal')[0]).toMatchObject({ status: 'conflict', basis: 'general_rule' });
    expect(by(evaluateCompat([ch(cam, {}), ch(rec, { recorder_kind: 'xvr' })]), 'camera_recorder_signal')[0]!.status).toBe('unknown');
    // never listing_stated: the data cannot verify this relationship
    for (const s of ['ahd', 'ip', undefined] as const)
      for (const k of ['xvr', 'nvr', 'dvr', undefined] as const) {
        const a: ProductAttrs = s ? { camera_signal: s } : {};
        const b: ProductAttrs = k ? { recorder_kind: k } : {};
        for (const x of by(evaluateCompat([ch(cam, a), ch(rec, b)]), 'camera_recorder_signal')) expect(x.status).not.toBe('listing_stated');
      }
  });
  it('recorder needs an internal SATA drive (assumed) and says when no drive is in the list', () => {
    const f = by(evaluateCompat([ch(rec, { recorder_kind: 'xvr' })]), 'recorder_hdd_internal')[0]!;
    expect(f.status).toBe('assumed');
    expect(f.sentence).toContain('هارد در فهرستت نیست');
    expect(by(evaluateCompat([ch(rec, {}), ch(hdd, {})]), 'recorder_hdd_internal')[0]!.sentence).not.toContain('فهرستت نیست');
  });
  it('HDD surveillance flag: listing_stated when present, else unknown', () => {
    expect(by(evaluateCompat([ch(rec, {}), ch(hdd, { hdd_surveillance: true })]), 'hdd_surveillance')[0]!.status).toBe('listing_stated');
    const u = by(evaluateCompat([ch(rec, {}), ch(hdd, { capacity_tb: 2 })]), 'hdd_surveillance')[0]!;
    expect(u.status).toBe('unknown');
    expect(u.askSeller).toContain('سورویلنس');
  });
  it('12 V adapter: assumed / unknown / conflict with the general rule', () => {
    expect(by(evaluateCompat([ch(cam, {}), ch(ad, { voltage_v: 12 })]), 'camera_adapter_12v')[0]!.status).toBe('assumed');
    expect(by(evaluateCompat([ch(cam, {}), ch(ad, {})]), 'camera_adapter_12v')[0]!.status).toBe('unknown');
    expect(by(evaluateCompat([ch(cam, {}), ch(ad, { voltage_v: 5 })]), 'camera_adapter_12v')[0]).toMatchObject({ status: 'conflict', basis: 'general_rule' });
  });
  it('items without a chosen product produce no finding', () => {
    expect(evaluateCompat([ch(cam, null), ch(rec, null), ch(hdd, null), ch(ad, null)])).toEqual([]);
  });
  it('every assumed / unknown / conflict finding carries an «ask the seller» line', () => {
    const fs = evaluateCompat([ch(cam, {}), ch(rec, {}), ch(hdd, {}), ch(ad, {})]);
    expect(fs.length).toBeGreaterThan(0);
    for (const f of fs) if (f.status !== 'listing_stated') expect(f.askSeller).toBeTruthy();
  });
});

describe('phone accessories, including a listing-stated conflict', () => {
  const phone = req('p', 'گوشی سامسونگ A56', [user({ attr: 'phone_model', op: 'eq', value: 'A56' })], { kind: 'phone' });
  const kase = req('k', 'کاور', [], { kind: 'phone_case' });
  const cases = [
    cand(1, { fits_models: ['A56'] }, [['s', 300_000]]),
    cand(2, { fits_models: ['A57'] }, [['s', 200_000]]), // conflict: cheaper but for another phone
    cand(3, {}, [['s', 150_000]]), // unknown: no model in the listing
  ];

  it('a different explicit model is excluded by default and explained', () => {
    const { results } = resolveItems([phone, kase], { p: [cand(9, { phone_model: 'A56' }, [['s', 20_000_000]])], k: cases });
    const r = results[1]!.resolution;
    expect(r.state).toBe('suggested');
    expect(r.chosenProductId).toBe(1);
    expect(r.differsIds).toEqual([2]);
    expect(r.incompleteIds).toEqual([3]);
    const why = r.evaluations.find((e) => e.productId === 2)!.differences.join(' ');
    expect(why).toContain('A57');
    expect(why).toContain('A56');
  });

  it('statuses: listing_stated / conflict / unknown', () => {
    const items = applyDerivedConstraints([phone, kase]);
    const k = items[1]!;
    const f = (attrs: ProductAttrs) => by(evaluateCompat([ch(items[0]!, { phone_model: 'A56' }), ch(k, attrs)]), 'phone_accessory_fit')[0]!;
    expect(f({ fits_models: ['A56'] }).status).toBe('listing_stated');
    const c = f({ fits_models: ['A57'] });
    expect(c.status).toBe('conflict');
    expect(c.basis).toBe('listing');
    expect(c.sentence).toContain('A57');
    expect(f({}).status).toBe('unknown');
  });

  it('accessory with no phone anywhere: compat-critical question, then unknown status', () => {
    const items = applyDerivedConstraints([kase]);
    expect(criticalUnknowns(items)).toEqual([{ itemId: 'k', ruleId: 'phone_accessory_fit', attr: 'fits_models', relatedItemIds: [] }]);
    const { results } = resolveItems([kase], { k: cases });
    expect(results[0]!.resolution.state).toBe('needs_info');
    expect(results[0]!.resolution.needsInfoReason).toBe('compat_critical');
    expect(by(evaluateCompat([ch(kase, { fits_models: ['A56'] })]), 'phone_accessory_fit')[0]!.status).toBe('unknown');
  });
});
