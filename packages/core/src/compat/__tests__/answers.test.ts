/**
 * G3a: questions never offer an answer that contradicts what the user fixed on another item, and a contradiction
 * between two things the user fixed is reported (never hidden, never deepened).
 */
import { describe, expect, it } from 'vitest';
import { cand, req, user } from '../../requirement/__tests__/fixtures';
import { compatScope, resolveItems } from '../../requirement/resolve';
import type { Candidate, Constraint, Requirement } from '../../types/index';
import { answerConflict, evaluateCompat, fixedAttrSets, statedConflicts } from '../index';

const answer = <C extends Omit<Constraint, 'source'>>(c: C) => ({ ...c, source: 'answer' }) as Constraint;
const cam = (constraints: Constraint[] = [], extra: Partial<Requirement> = {}) =>
  req('cam', '۴ دوربین', constraints, { kind: 'camera', qty: 4, qtyStated: true, ...extra });
const rec = (constraints: Constraint[] = [], extra: Partial<Requirement> = {}) => req('rec', 'ضبط‌کننده', constraints, { kind: 'recorder', ...extra });
const ad = (constraints: Constraint[] = []) => req('ad', 'آداپتور', constraints, { kind: 'adapter' });
const scope = (items: Requirement[], cands: Record<string, Candidate[]> = {}) => compatScope(items, cands);
const sig = (v: string): Constraint => answer({ attr: 'camera_signal', op: 'eq', value: v });

/** Eight cameras over three signals (so camera_signal is a discriminating question) and many brands. */
function cameras(): Candidate[] {
  const out: Candidate[] = [];
  const sigs = ['ahd', 'hdcvi', 'ip'] as const;
  for (let i = 0; i < 12; i++) out.push(cand(100 + i, { brand: `b${i % 4}`, camera_signal: sigs[i % 3]! }, [['s', 1_000_000 + i * 1000]]));
  return out;
}

describe('answerConflict: an answer that contradicts a sibling the user fixed', () => {
  it('a stated DVR rules out IP cameras; a stated NVR rules out every analog signal', () => {
    const dvr = scope([cam(), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'dvr' })])]);
    expect(answerConflict(dvr, 'cam', sig('ip'))?.status).toBe('conflict');
    expect(answerConflict(dvr, 'cam', sig('ahd'))).toBeNull();
    const nvr = scope([cam(), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'nvr' })])]);
    for (const s of ['ahd', 'hdcvi', 'tvi', 'analog']) expect(answerConflict(nvr, 'cam', sig(s))).not.toBeNull();
    expect(answerConflict(nvr, 'cam', sig('ip'))).toBeNull();
  });

  it('a recorder answered «آنالوگ» (XVR or DVR) rules out IP cameras (a DVR takes none); the reverse for the recorder', () => {
    const s = scope([cam(), rec([answer({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'] })])]);
    expect(answerConflict(s, 'cam', sig('ip'))).not.toBeNull();
    const ipCam = scope([cam([user({ attr: 'camera_signal', op: 'eq', value: 'ip' })]), rec()]);
    expect(answerConflict(ipCam, 'rec', answer({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'] }))).not.toBeNull();
    expect(answerConflict(ipCam, 'rec', answer({ attr: 'recorder_kind', op: 'in', values: ['nvr'] }))).toBeNull();
  });

  it('a pinned product counts like a statement (its listing attributes)', () => {
    const items = [cam([], { pinnedProductId: 7 }), rec()];
    const s = scope(items, { cam: [cand(7, { camera_signal: 'ip' }, [['s', 1]])] });
    expect(fixedAttrSets(items[0]!, s.pinned.get('cam'))).toEqual([{ camera_signal: 'ip' }]);
    expect(answerConflict(s, 'rec', answer({ attr: 'recorder_kind', op: 'eq', value: 'dvr' }))).not.toBeNull();
  });

  it('channels below the stated camera count are never offered; a voltage the user picks is never a conflict', () => {
    const s = scope([cam(), rec(), ad()]);
    expect(answerConflict(s, 'rec', answer({ attr: 'channels', op: 'eq', value: 2 }))?.ruleId).toBe('recorder_channels');
    expect(answerConflict(s, 'rec', answer({ attr: 'channels', op: 'eq', value: 4 }))).toBeNull();
    expect(answerConflict(s, 'ad', answer({ attr: 'voltage_v', op: 'eq', value: 5 }))).toBeNull();
    // attributes no rule links are never judged
    expect(answerConflict(s, 'cam', answer({ attr: 'brand', op: 'eq', value: 'x' }))).toBeNull();
  });
});

describe('questions filter their options by compat consequences', () => {
  it('next to a stated DVR the camera-signal question has no IP option; next to an NVR it is not asked at all', () => {
    const dvr = resolveItems([cam(), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'dvr' })])], { cam: cameras(), rec: [] });
    const q = dvr.results[0]!.question.question!;
    // whatever the most discriminating question is, no option of it may contradict the DVR
    for (const o of q.options) if (o.apply.constraint?.attr === 'camera_signal') expect(o.apply.constraint).not.toMatchObject({ value: 'ip' });
    // ask the signal explicitly: brand skipped -> camera_signal comes next
    const dvr2 = resolveItems(
      [cam([], { skippedQuestions: ['brand'] }), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'dvr' })])],
      { cam: cameras(), rec: [] },
    );
    const q2 = dvr2.results[0]!.question.question!;
    expect(q2.key).toBe('camera_signal');
    expect(q2.options.map((o) => o.apply.constraint && 'value' in o.apply.constraint ? o.apply.constraint.value : null).sort()).toEqual(['ahd', 'hdcvi']);
    const nvr = resolveItems(
      [cam([], { skippedQuestions: ['brand'] }), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'nvr' })])],
      { cam: cameras(), rec: [] },
    );
    expect(nvr.results[0]!.question.question?.key).not.toBe('camera_signal');
    // without a recorder all three signals are offered
    const free = resolveItems([cam([], { skippedQuestions: ['brand'] })], { cam: cameras() });
    expect(free.results[0]!.question.question?.options.length).toBe(3);
  });

  it('the recorder compat question drops the option that contradicts a pinned IP camera', () => {
    const items = [cam([], { pinnedProductId: 7 }), rec()];
    const cands = {
      cam: [cand(7, { camera_signal: 'ip' }, [['s', 1_000_000]])],
      rec: [cand(20, { recorder_kind: 'nvr', channels: 4 }, [['s', 5_000_000]]), cand(21, { recorder_kind: 'dvr', channels: 4 }, [['s', 4_000_000]])],
    };
    const q = resolveItems(items, cands).results[1]!.question.question!;
    expect(q.key).toBe('recorder_kind');
    expect(q.options.map((o) => o.id)).toEqual(['recorder_kind:ip']);
  });
});

describe('statedConflicts: two things the user fixed contradict each other', () => {
  it('IP cameras typed next to a DVR: reported once, for both items; nothing reported when they agree', () => {
    const items = [cam([user({ attr: 'camera_signal', op: 'eq', value: 'ip' })]), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'dvr' })])];
    const found = statedConflicts(scope(items));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ruleId: 'camera_recorder_signal', status: 'conflict' });
    expect(found[0]!.itemIds.sort()).toEqual(['cam', 'rec']);
    expect(resolveItems(items, {}).statedConflicts).toHaveLength(1);
    const ok = [cam([user({ attr: 'camera_signal', op: 'eq', value: 'ahd' })]), rec([user({ attr: 'recorder_kind', op: 'eq', value: 'dvr' })])];
    expect(statedConflicts(scope(ok))).toEqual([]);
    // «XVR or DVR» next to IP is not certain (an XVR may take IP): not a stated conflict
    const maybe = [cam([user({ attr: 'camera_signal', op: 'eq', value: 'ip' })]), rec([answer({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'] })])];
    expect(statedConflicts(scope(maybe))).toEqual([]);
  });

  it('the 12 V rule lifted by the user is marked lifted (never a conflict, never verified)', () => {
    const items = [cam(), ad([user({ attr: 'voltage_v', op: 'eq', value: 5 })])];
    const f = evaluateCompat([
      { item: items[0]!, attrs: { camera_signal: 'ahd' } },
      { item: items[1]!, attrs: { voltage_v: 5 } },
    ]).find((x) => x.ruleId === 'camera_adapter_12v')!;
    expect(f).toMatchObject({ status: 'unknown', lifted: true });
    const twelve = evaluateCompat([
      { item: items[0]!, attrs: {} },
      { item: items[1]!, attrs: { voltage_v: 12 } },
    ]).find((x) => x.ruleId === 'camera_adapter_12v')!;
    expect(twelve.lifted).toBeUndefined();
  });
});
