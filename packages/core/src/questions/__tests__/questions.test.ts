import { describe, expect, it } from 'vitest';
import { applyDerivedConstraints, criticalUnknowns } from '../../compat/index';
import { cand, int, pick, req, rng, user } from '../../requirement/__tests__/fixtures';
import type { Candidate, ProductAttrs } from '../../types/index';
import { budgetBands, niceRound } from '../budget';
import { DEFAULT_MAX_LIST_SIZE, nextQuestion } from '../next';

const pool = (n: number, attrsOf: (i: number) => ProductAttrs, priceOf: (i: number) => number | null = (i) => 1_000_000 + i * 100_000): Candidate[] =>
  Array.from({ length: n }, (_, i) => cand(i + 1, attrsOf(i), [['s1', priceOf(i)]]));

describe('stopping rule (B1.4)', () => {
  it('stops when the eligible list fits one screen (default 8)', () => {
    const p = pool(DEFAULT_MAX_LIST_SIZE, (i) => ({ brand: i % 2 ? 'A' : 'B' }));
    const out = nextQuestion(req('x', 'x'), p);
    expect(out.question).toBeNull();
    expect(out.stopReason).toBe('fits_one_screen');
  });
  it('asks while the list is longer than maxListSize, and maxListSize is a parameter', () => {
    const p = pool(9, (i) => ({ brand: i % 2 ? 'A' : 'B' }));
    expect(nextQuestion(req('x', 'x'), p).question?.key).toBe('brand');
    expect(nextQuestion(req('x', 'x'), p, { maxListSize: 20 }).question).toBeNull();
  });
  it('stops on «کافیه، پیشنهاد بده»', () => {
    const p = pool(30, (i) => ({ brand: i % 2 ? 'A' : 'B' }));
    const out = nextQuestion(req('x', 'x', [], { preference: { acceptSuggestion: true } }), p);
    expect(out.stopReason).toBe('accepted_default');
  });
  it('reports when no question can discriminate', () => {
    const p = pool(12, () => ({ brand: 'A' }), () => 500_000);
    expect(nextQuestion(req('x', 'x'), p).stopReason).toBe('no_discriminating_question');
  });
  it('property: the outcome always follows the rule (300 random pools)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const n = int(r, 0, 30);
      const p = pool(n, () => {
        const a: ProductAttrs = {};
        if (r() < 0.7) a.brand = pick(r, ['A', 'B', 'C']);
        if (r() < 0.5) a.resolution_mp = pick(r, [2, 4, 5, 8]);
        return a;
      }, () => (r() < 0.1 ? null : int(r, 10, 900) * 10_000));
      const max = int(r, 1, 12);
      const out = nextQuestion(req('x', 'x'), p, { maxListSize: max });
      if (out.question === null) {
        expect(['fits_one_screen', 'no_discriminating_question', 'no_candidates']).toContain(out.stopReason);
        if (out.stopReason === 'no_discriminating_question') expect(out.eligibleCount).toBeGreaterThan(max);
      } else {
        expect(out.eligibleCount).toBeGreaterThan(max);
        expect(out.question.options.length).toBeGreaterThanOrEqual(2);
        for (const o of out.question.options) expect(o.count).toBeGreaterThan(0);
      }
    }
  });
});

describe('priority 1: compatibility-critical unknowns', () => {
  it('asks the camera-type question on the recorder even when the list is short', () => {
    const items = applyDerivedConstraints([
      req('cam', 'دوربین', [], { kind: 'camera', qty: 4, qtyStated: true }),
      req('rec', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    const crit = criticalUnknowns(items);
    expect(crit).toEqual([{ itemId: 'rec', ruleId: 'camera_recorder_signal', attr: 'recorder_kind', relatedItemIds: ['cam'] }]);
    const recs = [
      cand(1, { recorder_kind: 'xvr', channels: 4 }, [['s', 6_000_000]]),
      cand(2, { recorder_kind: 'dvr', channels: 8 }, [['s', 7_000_000]]),
      cand(3, { recorder_kind: 'nvr', channels: 4 }, [['s', 8_000_000]]),
      cand(4, { channels: 4 }, [['s', 5_000_000]]),
      cand(5, { recorder_kind: 'nvr', channels: 2 }, [['s', 1_000_000]]), // fails derived channels>=4
    ];
    const out = nextQuestion(items[1]!, recs, { criticalUnknowns: crit });
    const q = out.question!;
    expect(q.priority).toBe(1);
    expect(q.source).toBe('compat');
    expect(q.options.map((o) => [o.id, o.count])).toEqual([['recorder_kind:analog', 2], ['recorder_kind:ip', 1]]);
    expect(q.unknownCount).toBe(1);
    expect(q.text).toContain('آنالوگ');
    // skipping it ends the compat question
    const skipped = nextQuestion({ ...items[1]!, skippedQuestions: ['recorder_kind'] }, recs, { criticalUnknowns: crit });
    expect(skipped.question).toBeNull();
  });
  it('no critical question once the camera signal is stated (derived constraint instead)', () => {
    const items = applyDerivedConstraints([
      req('cam', 'دوربین', [user({ attr: 'camera_signal', op: 'eq', value: 'ahd' })], { kind: 'camera' }),
      req('rec', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    expect(criticalUnknowns(items)).toEqual([]);
    expect(items[1]!.constraints).toEqual([
      { attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: 'cam' },
    ]);
  });
  it('asks which phone an accessory is for, with real model tokens and counts', () => {
    const items = [req('case', 'کاور', [], { kind: 'phone_case' })];
    const crit = criticalUnknowns(items);
    const cases = [
      cand(1, { fits_models: ['A56'] }, [['s', 300_000]]),
      cand(2, { fits_models: ['A56', 'A55'] }, [['s', 250_000]]),
      cand(3, { fits_models: ['A57'] }, [['s', 200_000]]),
      cand(4, {}, [['s', 100_000]]),
    ];
    const q = nextQuestion(items[0]!, cases, { criticalUnknowns: crit }).question!;
    expect(q.key).toBe('fits_models');
    expect(q.options.map((o) => o.count)).toEqual([2, 1, 1]);
    expect(q.options[0]!.apply.constraint).toEqual({ attr: 'fits_models', op: 'contains', value: 'A56', source: 'answer' });
    expect(q.text).toBe('کاور را برای کدام گوشی می‌خواهی؟');
  });
});

describe('priority 2: information value (entropy × coverage)', () => {
  it('prefers the attribute that splits the most candidates, among those readable for most', () => {
    // brand readable for all, 2 values; resolution readable for all, 4 values → resolution wins
    const p = pool(16, (i) => ({ brand: i < 8 ? 'A' : 'B', resolution_mp: [2, 4, 5, 8][i % 4]! }));
    const q = nextQuestion(req('x', 'x'), p).question!;
    expect(q.key).toBe('resolution_mp');
    expect(q.priority).toBe(2);
    expect(q.options.map((o) => o.count)).toEqual([4, 4, 4, 4]);
    expect(q.score!.coverage).toBe(1);
    expect(q.text).toBe('دوربین چند مگاپیکسل باشد؟');
  });
  it('skips attributes readable for fewer than half of the candidates', () => {
    const p = pool(20, (i) => ({ brand: i % 2 ? 'A' : 'B', ...(i < 6 ? { resolution_mp: [2, 4, 5, 8, 12, 16][i]! } : {}) }));
    expect(nextQuestion(req('x', 'x'), p).question!.key).toBe('brand');
  });
  it('does not ask about an attribute the user already constrained or skipped', () => {
    const p = pool(16, (i) => ({ brand: i % 2 ? 'A' : 'B', resolution_mp: 2 + (i % 2) }));
    const q1 = nextQuestion(req('x', 'x', [], { skippedQuestions: ['brand', 'resolution_mp'] }), p).question!;
    expect(q1.key).toBe('budget');
  });
});

describe('priority 3: budget bands', () => {
  it('builds friendly quantile bands with real counts', () => {
    const prices = [1.9, 2.1, 2.4, 3.0, 3.3, 4.1, 5.0, 6.2, 7.5, 8.5, 9.9, 12].map((x) => x * 1e6);
    const bands = budgetBands(prices);
    expect(bands.length).toBe(3);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(prices.length);
    for (const b of bands) expect(b.count).toBeGreaterThan(0);
    for (const b of [bands[0]!.to!, bands[1]!.to!]) expect(niceRound(b)).toBe(b);
  });
  it('rounds to friendly toman numbers', () => {
    expect(niceRound(7_834_000)).toBe(8_000_000);
    expect(niceRound(14_300_000)).toBe(15_000_000);
    expect(niceRound(96_000)).toBe(100_000);
    expect(niceRound(2_380_000)).toBe(2_500_000);
  });
  it('the budget question carries Persian labels and applicable budgets', () => {
    const p = pool(12, () => ({ brand: 'A' }), (i) => (i + 1) * 1_000_000);
    const q = nextQuestion(req('x', 'x'), p).question!;
    expect(q.key).toBe('budget');
    expect(q.priority).toBe(3);
    expect(q.options[0]!.label.startsWith('تا ')).toBe(true);
    expect(q.options.at(-1)!.label.startsWith('بیشتر از ')).toBe(true);
    expect(q.options.reduce((s, o) => s + o.count, 0)).toBe(12);
    expect(q.skipLabel).toBe('فرقی نمی‌کند');
  });
  it('no bands for a single price', () => {
    expect(budgetBands([5_000_000, 5_000_000, 5_000_000])).toEqual([]);
  });
});
