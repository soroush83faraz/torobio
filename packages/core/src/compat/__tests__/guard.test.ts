/**
 * G1a regressions: the assumed 12 V camera-adapter rule is structural (a listing stating another voltage is never
 * auto-picked; one without a voltage neither), and the plan guard helpers (repairs, culprits) never let a conflict
 * stand next to an automatic pick. Property tests run on seeded random lists.
 */
import { describe, expect, it } from 'vitest';
import { compatCopy } from '../../copy/fa';
import { buildPlanItems, chosenItemsForCompat } from '../../plan/offers';
import { planRun } from '../../plan/optimize';
import { cand, int, pick, req, rng, shop, user } from '../../requirement/__tests__/fixtures';
import { resolveItems } from '../../requirement/resolve';
import type { Candidate, CompatFinding, Constraint, ItemResolution, ProductAttrs, Requirement } from '../../types/index';
import {
  applyDerivedConstraints,
  autoConflicts,
  compatRepairs,
  conflictCulprit,
  criticalUnknowns,
  evaluateCompat,
  isAutoPick,
} from '../index';

const ch = (item: Requirement, attrs: ProductAttrs | null) => ({ item, attrs });
const by = (fs: CompatFinding[], id: string) => fs.filter((f) => f.ruleId === id);
const cam = () => req('cam', '۴ دوربین', [], { kind: 'camera', qty: 4, qtyStated: true });
const rec = () => req('rec', 'ضبط‌کننده', [], { kind: 'recorder' });
const ad = (constraints: Constraint[] = [], extra: Partial<Requirement> = {}) => req('ad', 'آداپتور', constraints, { kind: 'adapter', ...extra });

describe('camera_adapter_12v: an assumed rule that is still structural', () => {
  it('derives voltage = 12 for an adapter next to cameras (from the cameras); nothing without cameras', () => {
    const items = applyDerivedConstraints([cam(), ad()]);
    expect(items[1]!.constraints).toEqual([{ attr: 'voltage_v', op: 'eq', value: 12, source: 'compat', ruleId: 'camera_adapter_12v', fromItemId: 'cam' }]);
    expect(applyDerivedConstraints([ad()])[0]!.constraints).toEqual([]);
  });

  it('a stated voltage wins (nothing derived, nothing asked); «فرقی نمی‌کند» keeps only «voltage known»', () => {
    const stated = applyDerivedConstraints([cam(), ad([user({ attr: 'voltage_v', op: 'eq', value: 5 })])]);
    expect(stated[1]!.constraints.filter((c) => c.source === 'compat')).toEqual([]);
    expect(criticalUnknowns(stated).filter((c) => c.ruleId === 'camera_adapter_12v')).toEqual([]);
    const relaxed = applyDerivedConstraints([cam(), ad([], { skippedQuestions: ['voltage_v'] })]);
    expect(relaxed[1]!.constraints).toEqual([{ attr: 'voltage_v', op: 'known', source: 'compat', ruleId: 'camera_adapter_12v', fromItemId: 'cam' }]);
  });

  it('the voltage is a compat-critical question; 12 V is offered first as the usual camera voltage', () => {
    const cands = {
      cam: [cand(1, { camera_signal: 'ahd' }, [['s', 1_000_000]])],
      ad: [
        cand(10, { voltage_v: 4.2, current_a: 0.5 }, [['s', 100_000]]),
        cand(11, { voltage_v: 12, current_a: 0.5 }, [['s', 210_000]]),
        cand(12, { current_a: 2 }, [['s', 62_000]]), // voltage not in the listing
        cand(13, { voltage_v: 48 }, [['s', 90_000]]), // PoE
      ],
    };
    const { results } = resolveItems([cam(), ad()], cands);
    const res = results[1]!.resolution;
    expect(res).toMatchObject({ state: 'needs_info', needsInfoReason: 'compat_critical', eligibleIds: [11], incompleteIds: [12] });
    expect(res.differsIds.sort()).toEqual([10, 13]);
    const q = results[1]!.question.question!;
    expect(q).toMatchObject({ key: 'voltage_v', priority: 1, source: 'compat', ruleId: 'camera_adapter_12v' });
    expect(q.options.map((o) => [o.id, o.label, o.count])).toEqual([
      ['voltage_v:12', '۱۲ ولت (معمول برای دوربین)', 1],
      ['voltage_v:4.2', '۴٫۲ ولت', 1],
      ['voltage_v:48', '۴۸ ولت', 1],
    ]);
    expect(q.text).toContain('فرض عمومی');
    // the 4.2 V listing says why it is not picked, and that 12 V is only an assumption
    const e10 = res.evaluations.find((e) => e.productId === 10)!;
    expect(e10.differences.join(' ')).toContain('فرض عمومی');
    // «کافیه، پیشنهاد بده» keeps the assumption: the 12 V adapter, never the cheaper 4.2 V / unknown / 48 V ones
    const settled = resolveItems([cam(), ad([], { preference: { acceptSuggestion: true } })], cands).results[1]!.resolution;
    expect(settled).toMatchObject({ state: 'suggested', chosenProductId: 11 });
    // «فرقی نمی‌کند» lifts it: any listing-stated voltage (never the unknown one)
    const relaxed = resolveItems([cam(), ad([], { skippedQuestions: ['voltage_v'] })], cands).results[1]!.resolution;
    expect(relaxed).toMatchObject({ state: 'suggested', chosenProductId: 13 });
    expect(relaxed.chosenProductId).not.toBe(12);
  });

  it('evaluation: 12 V assumed; missing unknown; a voltage the user chose or allowed is never a conflict', () => {
    const v = (a: Requirement, volts?: number) => by(evaluateCompat([ch(cam(), {}), ch(a, volts === undefined ? {} : { voltage_v: volts })]), 'camera_adapter_12v')[0]!;
    expect(v(ad(), 12).status).toBe('assumed');
    expect(v(ad()).status).toBe('unknown');
    expect(v(ad([user({ attr: 'voltage_v', op: 'eq', value: 5 })]), 5)).toMatchObject({ status: 'unknown', sentence: compatCopy.adapterUserVoltage(5) });
    expect(v(ad([], { skippedQuestions: ['voltage_v'] }), 9)).toMatchObject({ status: 'unknown', sentence: compatCopy.adapterRelaxed(9) });
    // only a product nobody asked for (e.g. a pinned one) is a conflict with the general rule
    expect(v(ad(), 5).status).toBe('conflict');
  });
});

describe('plan guard helpers', () => {
  const auto = (ids: string[]) => (id: string) => ids.includes(id);
  const camR = cam();
  const recR = rec();
  const signal = (s: string, k: string) => evaluateCompat([ch(camR, { camera_signal: s as never }), ch(recR, { recorder_kind: k as never })]);
  const chosen = (s: string, k: string) => [ch(camR, { camera_signal: s as never }), ch(recR, { recorder_kind: k as never })];

  it('HDCVI camera + NVR, both automatic: the recorder follows the camera, the camera keeps its family', () => {
    const fs = signal('hdcvi', 'nvr');
    expect(autoConflicts(fs, chosen('hdcvi', 'nvr'), auto(['cam', 'rec']))).toHaveLength(1);
    const repairs = compatRepairs(fs, chosen('hdcvi', 'nvr'), auto(['cam', 'rec']));
    expect(repairs).toEqual([
      { itemId: 'rec', constraint: { attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: 'cam' } },
      { itemId: 'cam', constraint: { attr: 'camera_signal', op: 'in', values: ['ahd', 'hdcvi', 'tvi', 'analog'], source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: 'rec' } },
    ]);
    // already applied → nothing new
    expect(compatRepairs(fs, chosen('hdcvi', 'nvr'), auto(['cam', 'rec']), repairs)).toEqual([]);
    expect(conflictCulprit(by(fs, 'camera_recorder_signal')[0]!, chosen('hdcvi', 'nvr'), auto(['cam', 'rec']))).toBe('rec');
  });

  it('a recorder the user pinned: the automatic camera follows it; two pins are the user\'s call', () => {
    const fs = signal('hdcvi', 'nvr');
    expect(compatRepairs(fs, chosen('hdcvi', 'nvr'), auto(['cam']))).toEqual([
      { itemId: 'cam', constraint: { attr: 'camera_signal', op: 'in', values: ['ip'], source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: 'rec' } },
    ]);
    expect(conflictCulprit(by(fs, 'camera_recorder_signal')[0]!, chosen('hdcvi', 'nvr'), auto(['cam']))).toBe('cam');
    expect(autoConflicts(fs, chosen('hdcvi', 'nvr'), auto([]))).toEqual([]);
  });

  it('an automatic pick that only does what the user stated is not changed (stated camera signal + pinned NVR)', () => {
    const statedCam = req('cam', 'دوربین HDCVI', [user({ attr: 'camera_signal', op: 'eq', value: 'hdcvi' })], { kind: 'camera' });
    const c = [ch(statedCam, { camera_signal: 'hdcvi' }), ch(recR, { recorder_kind: 'nvr' })];
    const fs = evaluateCompat(c);
    expect(by(fs, 'camera_recorder_signal')[0]!.status).toBe('conflict');
    expect(autoConflicts(fs, c, auto(['cam']))).toEqual([]);
  });

  it('phone accessory: an automatic case follows the picked phone; a pinned case next to a stated phone stays', () => {
    const phone = req('ph', 'گوشی', [], { kind: 'phone' });
    const kase = req('cs', 'قاب', [], { kind: 'phone_case' });
    const c = [ch(phone, { phone_model: 'galaxy a56' }), ch(kase, { fits_models: ['galaxy a57'] })];
    const fs = evaluateCompat(c);
    expect(compatRepairs(fs, c, auto(['ph', 'cs']))).toEqual([
      { itemId: 'cs', constraint: { attr: 'fits_models', op: 'contains', value: 'galaxy a56', source: 'compat', ruleId: 'phone_accessory_fit', fromItemId: 'ph' } },
    ]);
    const statedPhone = req('ph', 'گوشی A56', [user({ attr: 'phone_model', op: 'eq', value: 'galaxy a56' })], { kind: 'phone' });
    const c2 = [ch(statedPhone, { phone_model: 'galaxy a56' }), ch(kase, { fits_models: ['galaxy a57'] })];
    expect(autoConflicts(evaluateCompat(c2), c2, auto(['ph']))).toEqual([]);
  });

  it('isAutoPick: a visible-rule pick is automatic; a pin or a typed model code is not; no pick is not', () => {
    const base: ItemResolution = {
      itemId: 'x',
      state: 'suggested',
      counts: { candidates: 1, eligible: 1, eligiblePriced: 1, incomplete: 0, differs: 0 },
      eligibleIds: [],
      incompleteIds: [],
      differsIds: [],
      evaluations: [],
      label: '',
      detail: '',
    };
    expect(isAutoPick({ ...base, chosenProductId: 1, rule: 'cheapest_eligible' })).toBe(true);
    expect(isAutoPick({ ...base, chosenProductId: 1, rule: 'closest_alternative', state: 'alternative' })).toBe(true);
    expect(isAutoPick({ ...base, chosenProductId: 1, rule: 'user_pinned', state: 'exact_model' })).toBe(false);
    expect(isAutoPick({ ...base, chosenProductId: 1, rule: 'model_code', state: 'exact_model' })).toBe(false);
    expect(isAutoPick({ ...base })).toBe(false);
  });
});

describe('property: an automatically picked adapter never stands next to a 12 V conflict (seeded random lists)', () => {
  const SHOPS = [shop('s1', 'b1', 35.69, 51.42), shop('s2', 'b2', 35.70, 51.43), shop('s3', 'b3', 35.71, 51.44)];
  it('300 random CCTV lists, every user path (none / settle / skip / answer)', () => {
    const r = rng(20261022);
    const VOLTS = [undefined, 5, 4.2, 9, 12, 12, 24, 48];
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const adapters: Candidate[] = [];
      const count = int(r, 1, 8);
      for (let i = 0; i < count; i++) {
        const v = pick(r, VOLTS);
        const attrs: ProductAttrs = v === undefined ? { current_a: pick(r, [0.5, 1, 2]) } : { voltage_v: v, current_a: pick(r, [0.5, 1, 2]) };
        adapters.push(cand(100 + i, attrs, [[pick(r, ['s1', 's2', 's3']), int(r, 5, 60) * 10_000]]));
      }
      const path = pick(r, ['none', 'settle', 'skip', 'answer12', 'answerOther'] as const);
      const extra: Partial<Requirement> = {};
      const cons: Constraint[] = [];
      if (path === 'settle') extra.preference = { acceptSuggestion: true };
      if (path === 'skip') extra.skippedQuestions = ['voltage_v'];
      if (path === 'answer12') cons.push({ attr: 'voltage_v', op: 'eq', value: 12, source: 'answer' });
      if (path === 'answerOther') cons.push({ attr: 'voltage_v', op: 'eq', value: 9, source: 'answer' });
      const items = [cam(), ad(cons, extra)];
      const cands = { cam: [cand(1, { camera_signal: 'ahd' }, [['s1', 1_000_000]])], ad: adapters };
      const { items: derived, results } = resolveItems(items, cands);
      const resolutions = results.map((x) => x.resolution);
      const plan = planRun({ items: buildPlanItems(derived, resolutions, cands), shops: SHOPS }).plans[0] ?? null;
      const chosen = chosenItemsForCompat(derived, resolutions, cands, plan);
      const adRes = resolutions[1]!;
      const adPick = chosen[1]!.attrs;
      if (adPick) {
        checked++;
        // never a listing without a voltage; 12 V unless the user chose / allowed another one
        expect(typeof adPick.voltage_v).toBe('number');
        if (path === 'none' || path === 'settle' || path === 'answer12') expect(adPick.voltage_v).toBe(12);
        if (path === 'answerOther') expect(adPick.voltage_v).toBe(9);
      }
      if (isAutoPick(adRes)) {
        const fs = by(evaluateCompat(chosen), 'camera_adapter_12v');
        expect(fs.every((f) => f.status !== 'conflict')).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
