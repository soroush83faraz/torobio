import { describe, expect, it } from 'vitest';
import { applyDerivedConstraints, criticalUnknowns } from '../../compat/index';
import { facetOptionLabel, questionWhy } from '../../copy/fa';
import { cand, int, pick, req, rng, user } from '../../requirement/__tests__/fixtures';
import type { Candidate, ProductAttrs } from '../../types/index';
import { budgetBands, niceRound } from '../budget';
import {
  askedQuestions,
  DEFAULT_MAX_LIST_SIZE,
  informationValue,
  MAX_QUESTIONS_PER_ITEM,
  MIN_POOL_NARROWING,
  MIN_SPREAD_NARROWING,
  nextQuestion,
} from '../next';

const pool = (n: number, attrsOf: (i: number) => ProductAttrs, priceOf: (i: number) => number | null = (i) => 1_000_000 + i * 100_000): Candidate[] =>
  Array.from({ length: n }, (_, i) => cand(i + 1, attrsOf(i), [['s1', priceOf(i)]]));
/** One price for every model: no budget question, so facets are judged alone. */
const flat = () => 1_000_000;

describe('stopping rule (B1.4)', () => {
  it('stops when the eligible list fits one screen (default 8)', () => {
    const p = pool(DEFAULT_MAX_LIST_SIZE, (i) => ({ brand: i % 2 ? 'A' : 'B' }));
    const out = nextQuestion(req('x', 'x'), p);
    expect(out.question).toBeNull();
    expect(out.stopReason).toBe('fits_one_screen');
  });
  it('asks while the list is longer than maxListSize, and maxListSize is a parameter', () => {
    const p = pool(9, (i) => ({ brand: i % 2 ? 'A' : 'B' }), flat);
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
  it('property: the outcome always follows the policy (300 random pools)', () => {
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
      const answered = r() < 0.3 ? (['brand', 'resolution_mp'] as const).slice(0, int(r, 1, 2)) : [];
      const item = req('x', 'x', [], answered.length ? { answeredQuestions: [...answered] } : {});
      const out = nextQuestion(item, p, { maxListSize: max });
      if (out.question === null) {
        expect(['fits_one_screen', 'no_discriminating_question', 'low_value', 'question_cap', 'no_candidates']).toContain(out.stopReason);
        if (out.stopReason !== 'fits_one_screen' && out.stopReason !== 'no_candidates') expect(out.eligibleCount).toBeGreaterThan(max);
      } else {
        expect(out.eligibleCount).toBeGreaterThan(max);
        // the cap: never a third question, never one already answered
        expect(answered.length).toBeLessThan(MAX_QUESTIONS_PER_ITEM);
        expect(answered as readonly string[]).not.toContain(out.question.key);
        expect(out.question.options.length).toBeGreaterThanOrEqual(2);
        for (const o of out.question.options) expect(o.count).toBeGreaterThan(0);
        // never a question that narrows neither the models nor their prices
        const s = out.question.score!;
        expect(s.narrowing! >= MIN_POOL_NARROWING || s.spread! >= MIN_SPREAD_NARROWING).toBe(true);
        expect(out.question.why).toBeTruthy();
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
    // consequence hint data: the cheapest eligible model each option keeps
    expect(q.options.map((o) => o.minPrice)).toEqual([6_000_000, 8_000_000]);
    expect(q.unknownCount).toBe(1);
    expect(q.text).toContain('آنالوگ');
    // skipping it ends the compat question
    const skipped = nextQuestion({ ...items[1]!, skippedQuestions: ['recorder_kind'] }, recs, { criticalUnknowns: crit });
    expect(skipped.question).toBeNull();
  });
  it('never offers a compat option that keeps nothing', () => {
    const items = applyDerivedConstraints([
      req('cam', 'دوربین', [], { kind: 'camera', qty: 2, qtyStated: true }),
      req('rec', 'ضبط‌کننده', [], { kind: 'recorder' }),
    ]);
    const recs = [cand(1, { recorder_kind: 'xvr', channels: 4 }, [['s', 6_000_000]]), cand(2, { recorder_kind: 'dvr', channels: 4 }, [['s', 7_000_000]])];
    const q = nextQuestion(items[1]!, recs, { criticalUnknowns: criticalUnknowns(items) }).question!;
    expect(q.options.map((o) => o.id)).toEqual(['recorder_kind:analog']);
  });
  it('a compatibility question is unavoidable: asked even after the item had its share of questions', () => {
    const items = applyDerivedConstraints([
      req('cam', 'دوربین', [], { kind: 'camera', qty: 4, qtyStated: true }),
      req('rec', 'ضبط‌کننده', [], { kind: 'recorder', answeredQuestions: ['brand', 'budget'] }),
    ]);
    const recs = pool(20, (i) => ({ recorder_kind: i % 2 ? 'xvr' : 'nvr', channels: 8 }));
    const out = nextQuestion(items[1]!, recs, { criticalUnknowns: criticalUnknowns(items) });
    expect(out.question).toMatchObject({ key: 'recorder_kind', priority: 1, source: 'compat' });
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
    expect(q.options[0]!.minPrice).toBe(250_000);
    expect(q.text).toBe('کاور را برای کدام گوشی می‌خواهی؟');
  });
});

describe('information value: what is asked, and in which order', () => {
  it('prefers the attribute that narrows the models most', () => {
    // brand: 2 values (narrowing 0.5); resolution: 4 values (0.75) → resolution wins
    const p = pool(16, (i) => ({ brand: i < 8 ? 'A' : 'B', resolution_mp: [2, 4, 5, 8][i % 4]! }), flat);
    const q = nextQuestion(req('x', 'x'), p).question!;
    expect(q.key).toBe('resolution_mp');
    expect(q.priority).toBe(2);
    expect(q.options.map((o) => o.count)).toEqual([4, 4, 4, 4]);
    expect(q.score!.coverage).toBe(1);
    expect(q.score!.narrowing).toBeCloseTo(0.75, 9);
    expect(q.text).toBe('دوربین چند مگاپیکسل باشد؟');
  });
  it('a split that separates the prices beats a balanced one that does not', () => {
    // camera_form: 17 cheap bullets vs 3 expensive domes (narrowing 0.26, price spread 0.9);
    // resolution: 4 balanced values spread over every price (narrowing 0.75, spread small)
    const price = (i: number) => (i < 17 ? 1_000_000 + i * 10_000 : 10_000_000 + (i - 17) * 1_000_000);
    const p = pool(20, (i) => ({ camera_form: i < 17 ? 'bullet' : 'dome', resolution_mp: [2, 4, 5, 8][i % 4]! }), price);
    // a stated budget (wide enough for all) keeps the budget question out of the comparison
    const q = nextQuestion(req('x', 'x', [], { budget: { max: 50_000_000 } }), p).question!;
    expect(q.key).toBe('camera_form');
    expect(q.score!.spread!).toBeGreaterThan(q.score!.narrowing!);
    expect(q.score!.value).toBeGreaterThan(0.75);
    // options say where they lead: 17 models from 1 M, 3 from 10 M
    expect(q.options.map((o) => [o.label, o.count, o.minPrice])).toEqual([
      [facetOptionLabel('camera_form', 'bullet'), 17, 1_000_000],
      [facetOptionLabel('camera_form', 'dome'), 3, 10_000_000],
    ]);
  });
  it('the budget question competes on the same value (it wins over a weak facet)', () => {
    // brand barely separates anything; the prices spread 1 M - 3.3 M
    const p = pool(24, (i) => ({ brand: i % 6 === 0 ? 'B' : 'A' }));
    const q = nextQuestion(req('x', 'x'), p).question!;
    expect(q.key).toBe('budget');
    expect(q.why).toBe(questionWhy('budget', { min: 1_000_000, max: 3_300_000 }));
  });
  it('questions come out in decreasing value as the user answers', () => {
    const price = (i: number) => 1_000_000 * (1 + (i % 7));
    const p = pool(60, (i) => ({ brand: ['A', 'B', 'C'][i % 3]!, resolution_mp: [2, 4][i % 2]! }), price);
    const first = nextQuestion(req('x', 'x'), p).question!;
    const rest = nextQuestion(req('x', 'x', [], { skippedQuestions: [first.key] }), p).question!;
    expect(first.score!.value).toBeGreaterThanOrEqual(rest.score!.value);
  });
  it('skips attributes whose options cover fewer than half of the models', () => {
    const p = pool(20, (i) => ({ brand: i % 2 ? 'A' : 'B', ...(i < 6 ? { resolution_mp: [2, 4, 8][i % 3]! } : {}) }), flat);
    expect(nextQuestion(req('x', 'x'), p).question!.key).toBe('brand');
  });
  it('never asks what the user stated or skipped', () => {
    const p = pool(16, (i) => ({ brand: i % 2 ? 'A' : 'B', resolution_mp: 2 + (i % 2) }));
    const q = nextQuestion(req('x', 'x', [user({ attr: 'brand', op: 'in', values: ['A', 'B'] })], { skippedQuestions: ['resolution_mp'] }), p).question!;
    expect(q.key).toBe('budget');
  });
  it('never asks a question that barely narrows the models or their prices', () => {
    // 37 vs 3 (narrowing 0.14 < 0.15), one price for all → nothing worth asking
    const p = pool(40, (i) => ({ brand: i < 37 ? 'A' : 'B' }), flat);
    const out = nextQuestion(req('x', 'x'), p);
    expect(out.question).toBeNull();
    expect(out.stopReason).toBe('low_value');
  });
  it('options that keep (almost) nothing are not offered; fewer than two meaningful options is no question', () => {
    const p = pool(21, (i) => ({ resolution_mp: i < 10 ? 2 : i < 20 ? 4 : 8 }), flat);
    expect(nextQuestion(req('x', 'x'), p).question!.options.map((o) => o.label)).toEqual(['۲ مگاپیکسل', '۴ مگاپیکسل']);
    const lone = pool(21, (i) => ({ brand: i < 20 ? 'A' : 'B' }), flat);
    expect(nextQuestion(req('x', 'x'), lone).stopReason).toBe('no_discriminating_question');
  });
  it('the key question of a role comes first, even when it narrows little', () => {
    // a camera: analog vs IP decides the recorder; asked before a better-splitting resolution question
    const p = pool(40, (i) => ({ camera_signal: i < 38 ? 'ahd' : 'ip', resolution_mp: [2, 4][i % 2]! }), flat);
    const cam = nextQuestion(req('c', 'دوربین', [], { kind: 'camera' }), p).question!;
    expect(cam.key).toBe('camera_signal');
    expect(cam.priority).toBe(2); // never blocks the suggestion
    // without the camera role it is a low-value split and loses
    expect(nextQuestion(req('x', 'x'), p).question!.key).toBe('resolution_mp');
  });
  it('the key question is asked even when most listings do not state it', () => {
    // 8 AHD, 8 HDCVI, 24 unreadable: coverage 0.4 < 0.5
    const p = pool(40, (i) => (i < 8 ? { camera_signal: 'ahd' } : i < 16 ? { camera_signal: 'hdcvi' } : {}), flat);
    expect(nextQuestion(req('c', 'دوربین', [], { kind: 'camera' }), p).question!.key).toBe('camera_signal');
    expect(nextQuestion(req('x', 'x'), p).question).toBeNull();
  });
  it('models a sibling rules out (IP cameras next to a stated DVR) do not count against coverage', () => {
    const p = pool(50, (i) => ({ camera_signal: i < 30 ? 'ip' : i < 40 ? 'ahd' : 'hdcvi' }), flat);
    const noIp = (_: unknown, c: { attr: string; op: string; value?: unknown }) => !(c.attr === 'camera_signal' && c.value === 'ip');
    const q = nextQuestion(req('x', 'x'), p, { answerAllowed: noIp }).question!;
    expect(q.key).toBe('camera_signal');
    expect(q.options.map((o) => o.count)).toEqual([10, 10]);
    expect(q.score!.coverage).toBe(1);
  });
  it('every facet question says why it is asked', () => {
    const p = pool(16, (i) => ({ brand: i < 8 ? 'A' : 'B' }), flat);
    expect(nextQuestion(req('x', 'x'), p).question!.why).toBe(questionWhy('brand'));
  });
});

describe('the per-item cap', () => {
  const p = pool(40, (i) => ({ brand: ['A', 'B', 'C'][i % 3]!, resolution_mp: [2, 4, 8][i % 3]!, camera_form: i % 2 ? 'dome' : 'bullet' }));
  it(`asks at most ${MAX_QUESTIONS_PER_ITEM} questions per item`, () => {
    expect(nextQuestion(req('x', 'x', [], { answeredQuestions: ['brand'] }), p).question).not.toBeNull();
    const out = nextQuestion(req('x', 'x', [], { answeredQuestions: ['brand', 'budget'] }), p);
    expect(out.question).toBeNull();
    expect(out.stopReason).toBe('question_cap');
  });
  it('answers, skips and recorded questions all count; a user statement does not', () => {
    const answer = { ...user({ attr: 'brand', op: 'eq', value: 'A' }), source: 'answer' as const };
    expect([...askedQuestions(req('x', 'x', [answer], { skippedQuestions: ['budget'] }))].sort()).toEqual(['brand', 'budget']);
    expect(askedQuestions(req('x', 'x', [user({ attr: 'brand', op: 'eq', value: 'A' })])).size).toBe(0);
    expect(nextQuestion(req('x', 'x', [answer], { skippedQuestions: ['camera_form'] }), p).stopReason).toBe('question_cap');
  });
  it('the cap is a parameter', () => {
    expect(nextQuestion(req('x', 'x', [], { answeredQuestions: ['brand', 'budget'] }), p, { maxQuestions: 3 }).question).not.toBeNull();
  });
});

describe('informationValue', () => {
  it('weights options by size, and models no option covers lower both values', () => {
    const half = informationValue([{ count: 5, prices: [1, 2] }, { count: 5, prices: [10, 20] }], 10, [1, 2, 10, 20]);
    expect(half.coverage).toBe(1);
    expect(half.narrowing).toBeCloseTo(0.5, 9);
    expect(half.spread).toBeCloseTo(1 - Math.log(2) / Math.log(20), 9);
    const partial = informationValue([{ count: 5, prices: [1, 2] }, { count: 5, prices: [10, 20] }], 20, [1, 2, 10, 20]);
    expect(partial.narrowing).toBeCloseTo(0.25, 9);
    expect(partial.spread).toBeCloseTo(half.spread / 2, 9);
    expect(informationValue([], 10, [])).toEqual({ coverage: 0, narrowing: 0, spread: 0 });
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
    expect(q.why).toContain('۱ تا ۱۲ میلیون تومان');
  });
  it('no bands for a single price', () => {
    expect(budgetBands([5_000_000, 5_000_000, 5_000_000])).toEqual([]);
  });
});
