/**
 * D4: camera_adapter_current. Four cameras on ONE «آداپتور 12 ولت 500 میلی آمپر»: the total current is never
 * verified (no listing gives a camera's current), so the finding is 'unknown' with a seller question; it never
 * blocks a pick, never asks a question, never invents amps. The adapter item says what quantity was assumed when the
 * user did not write one.
 */
import { describe, expect, it } from 'vitest';
import { req } from '../../requirement/__tests__/fixtures';
import { resolveItems } from '../../requirement/resolve';
import type { ProductAttrs, Requirement } from '../../types/index';
import { applyDerivedConstraints, compatItemNotes, criticalUnknowns, evaluateCompat } from '../index';

const ch = (item: Requirement, attrs: ProductAttrs | null) => ({ item, attrs });
const cams4 = req('c', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true });
const adapter = req('a', 'آداپتور', [], { kind: 'adapter' });

describe('camera_adapter_current', () => {
  it('4 cameras + one 0.5 A adapter: unknown, the exact sentence and seller question, the stated amps quoted', () => {
    const fs = evaluateCompat([ch(cams4, { camera_signal: 'ahd' }), ch(adapter, { voltage_v: 12, current_a: 0.5 })]).filter(
      (f) => f.ruleId === 'camera_adapter_current',
    );
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ status: 'unknown', basis: 'missing', itemIds: ['a', 'c'] });
    expect(fs[0]!.sentence).toBe('برای ۴ دوربین، جریان کل آداپتور (یا تعداد آداپتورها) باید کافی باشد؛ آگهی این آداپتور ۰٫۵ آمپر نوشته (۱ عدد)؛ تأیید نشده');
    expect(fs[0]!.askSeller).toBe('جمع جریان مورد نیاز ۴ دوربین چقدر است و این آداپتور کافی است؟');
  });

  it('no current in the adapter listing: the sentence states nothing about amps (never invented)', () => {
    const f = evaluateCompat([ch(cams4, {}), ch(adapter, { voltage_v: 12 })]).find((x) => x.ruleId === 'camera_adapter_current')!;
    expect(f.sentence).toBe('برای ۴ دوربین، جریان کل آداپتور (یا تعداد آداپتورها) باید کافی باشد؛ تأیید نشده');
    expect(f.sentence).not.toMatch(/آمپر/);
    expect(f.status).not.toBe('listing_stated');
  });

  it('one adapter per camera: says so; still unverified', () => {
    const four = req('a', '۴ آداپتور', [], { kind: 'adapter', qty: 4, qtyStated: true });
    const f = evaluateCompat([ch(cams4, {}), ch(four, {})]).find((x) => x.ruleId === 'camera_adapter_current')!;
    expect(f.sentence).toBe('برای ۴ دوربین ۴ آداپتور در فهرست است؛ جریان هر آداپتور باید برای دوربینش کافی باشد؛ تأیید نشده');
    expect(f.status).toBe('unknown');
  });

  it('a single camera, or no adapter picked: no finding', () => {
    const one = req('c', 'دوربین', [], { kind: 'camera' });
    expect(evaluateCompat([ch(one, {}), ch(adapter, { voltage_v: 12 })]).some((f) => f.ruleId === 'camera_adapter_current')).toBe(false);
    expect(evaluateCompat([ch(cams4, {}), ch(adapter, null)]).some((f) => f.ruleId === 'camera_adapter_current')).toBe(false);
  });

  it('never derives a constraint or a critical question (never blocks selection)', () => {
    const items = [cams4, adapter];
    const derived = applyDerivedConstraints(items).flatMap((i) => i.constraints);
    expect(derived.some((c) => c.ruleId === 'camera_adapter_current')).toBe(false);
    expect(criticalUnknowns(items).some((c) => c.ruleId === 'camera_adapter_current')).toBe(false);
    const list = resolveItems(items, { c: [], a: [] });
    expect(list.results.every((r) => r.question.question?.ruleId !== 'camera_adapter_current')).toBe(true);
  });

  it('item note on the adapter when its quantity was not written next to several cameras; none otherwise', () => {
    expect(compatItemNotes([cams4, adapter]).get('a')).toBe(
      'تعداد آداپتور را ننوشتی؛ ۱ عدد برای ۴ دوربین در نظر گرفته شد. یک آداپتور پرقدرت یا یک آداپتور برای هر دوربین؟ جریان کافی را از فروشنده بپرس.',
    );
    expect(compatItemNotes([cams4, req('a', '۲ آداپتور', [], { kind: 'adapter', qty: 2, qtyStated: true })]).size).toBe(0);
    expect(compatItemNotes([req('c', 'دوربین', [], { kind: 'camera' }), adapter]).size).toBe(0);
  });
});
