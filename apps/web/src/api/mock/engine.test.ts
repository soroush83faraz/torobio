import { describe, expect, it } from 'vitest';
import { emptyState } from '../../store/plans';
import { mockOptions, mockParse, mockPlan, mockResolve } from './engine';
import type { RequirementState } from '../types';

const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';
const NOW = new Date('2026-10-21T08:00:00Z'); // Wednesday

function stateFor(text: string): RequirementState {
  return emptyState(mockParse(text).items);
}

describe('mock parse', () => {
  it('splits the CCTV sentence into four items with quantity and chips', () => {
    const { items, title } = mockParse(CCTV);
    expect(items).toHaveLength(4);
    expect(title).toBe('پروژهٔ دوربین مداربسته');
    expect(items[0]!.qty).toBe(4);
    expect(items[0]!.chips!.map((c) => c.label)).toEqual(['داهوا', '۲ مگاپیکسل']);
    expect(items.map((i) => i.categoryId)).toEqual(['camera', 'recorder', 'hdd', 'adapter']);
  });

  it('lets a phone model flow into case and glass as inherited chips', () => {
    const { items } = mockParse('گوشی سامسونگ Galaxy A56، قاب و گلس');
    expect(items).toHaveLength(3);
    expect(items[1]!.chips!.find((c) => c.key === 'device')?.inherited).toBe(true);
  });

  it('marks the laptop as not found while keeping the item', () => {
    const state = stateFor('لپ‌تاپ ایسوس');
    const r = mockResolve(state);
    expect(r.items[0]!.state).toBe('not_found');
    expect(r.items[0]!.nearbyCategories?.length).toBeGreaterThan(0);
  });
});

describe('item states', () => {
  it('never calls a suggestion «exact» and exercises every state', () => {
    const cctv = stateFor(CCTV);
    const phone = stateFor('گوشی سامسونگ Galaxy A56، قاب و گلس');
    const laptop = stateFor('لپ‌تاپ');
    const states = new Set<string>();
    for (const s of [cctv, phone, laptop]) {
      const res = mockResolve(s);
      res.items.forEach((i) => states.add(i.state));
    }
    expect([...states].sort()).toEqual(['alternative', 'exact', 'needs_info', 'no_price', 'not_found', 'suggested']);
    const camera = mockResolve(cctv).items[0]!;
    expect(camera.state).toBe('suggested');
    expect(camera.eligibleCount).toBe(154);
  });

  it('asks the compatibility-critical question first, one at a time', () => {
    const s = stateFor(CCTV);
    const rec = mockResolve(s).items[1]!;
    expect(rec.state).toBe('needs_info');
    expect(rec.question?.id).toBe('signal');
    expect(rec.pendingQuestions).toBe(3);
    s.answers[s.requirements[1]!.id] = { signal: 'analog' };
    expect(mockResolve(s).items[1]!.question?.id).toBe('brand');
  });

  it('resolves via the visible default rule when the user settles', () => {
    const s = stateFor(CCTV);
    s.settled[s.requirements[1]!.id] = true;
    const rec = mockResolve(s).items[1]!;
    expect(rec.state).toBe('suggested');
    expect(rec.rule).toBe('ارزان‌ترین مطابق خواسته');
  });

  it('asks the sale unit for wire', () => {
    const s = stateFor('سیم برق برای اتاق');
    const w = mockResolve(s).items[0]!;
    expect(w.state).toBe('needs_info');
    expect(w.question?.id).toBe('gauge');
    s.answers[s.requirements[0]!.id] = { gauge: 'g25' };
    expect(mockResolve(s).items[0]!.question?.id).toBe('unit');
  });
});

describe('plan totals and coverage', () => {
  it('is partial while the recorder is unanswered and says what is missing', () => {
    const s = stateFor(CCTV);
    const plan = mockPlan(s, NOW);
    expect(plan.complete).toBe(false);
    expect(plan.coverage.total).toBe(4);
    expect(plan.coverage.covered).toBe(2);
    expect(plan.coverage.missing.map((m) => m.why).sort()).toEqual(['قیمت ثبت نشده', 'منتظر انتخاب تو']);
    expect(plan.unpriced).toHaveLength(1);
    expect(plan.totalToman).toBeGreaterThan(0);
  });

  it('stays partial (3 of 4) after the recorder is resolved because the adapter has no price', () => {
    const s = stateFor(CCTV);
    s.settled[s.requirements[1]!.id] = true;
    const plan = mockPlan(s, NOW);
    expect(plan.coverage.covered).toBe(3);
    expect(plan.complete).toBe(false);
    expect(plan.usesSuggestions).toBe(true);
    expect(plan.compat.map((c) => c.level)).toEqual(expect.arrayContaining(['stated', 'unknown']));
  });

  it('completes the phone plan and flags suggestions; offers a non-dominated alternative with deltas', () => {
    const s = stateFor('گوشی سامسونگ Galaxy A56، قاب و گلس');
    const plan = mockPlan(s, NOW);
    expect(plan.complete).toBe(true);
    expect(plan.coverage.covered).toBe(3);
    expect(plan.usesSuggestions).toBe(true);
    expect(plan.alternatives.length).toBeGreaterThan(0);
    expect(plan.alternatives[0]!.deltaToman).toBeGreaterThan(0);
    expect(plan.alternatives[0]!.deltaStops).toBeLessThan(0);
  });

  it('excludes shops that are closed on Friday and notes it', () => {
    const s = stateFor('گوشی سامسونگ Galaxy A56، قاب و گلس');
    s.visit = { day: 'date', date: '2026-10-23', window: 'morning' }; // Friday 10:00
    const plan = mockPlan(s, NOW);
    expect(plan.visitActive).toBe(true);
    for (const stop of plan.stops) expect(stop.open).not.toBe('closed');
    // the phone's only shop is closed in the morning on Friday -> the phone cannot be covered
    expect(plan.coverage.covered).toBeLessThan(3);
  });

  it('never treats shops without hours as closed', () => {
    const s = stateFor('۴ دوربین داهوا ۲ مگاپیکسل');
    s.visit = { day: 'date', date: '2026-10-23', window: 'evening' };
    const plan = mockPlan(s, NOW);
    expect(plan.stops.some((st) => st.open === 'unknown')).toBe(true);
  });

  it('handles the wire sale unit without comparing roll and metre prices', () => {
    const s = stateFor('۱۰۰ متر سیم افشان ۲٫۵');
    const id = s.requirements[0]!.id;
    s.answers[id] = { unit: 'roll' };
    const roll = mockPlan(s, NOW);
    s.answers[id] = { unit: 'metre' };
    const metre = mockPlan(s, NOW);
    expect(roll.stops[0]!.lines[0]!.unitLabel).toBe('حلقهٔ ۱۰۰ متری');
    expect(metre.stops[0]!.lines[0]!.unitLabel).toBe('قیمت هر متر');
    expect(metre.stops[0]!.lines[0]!.qty).toBe(100);
  });

  it('lists a listing-stated conflict in the case options', () => {
    const s = stateFor('گوشی سامسونگ Galaxy A56، قاب و گلس');
    const opts = mockOptions(s, s.requirements[1]!.id, NOW);
    expect(opts.models.find((m) => m.conflict)).toBeTruthy();
  });
});
