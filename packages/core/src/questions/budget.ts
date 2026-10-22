import { budgetBandLabel } from '../copy/fa';
import type { Budget, QuestionOption } from '../types/index';

const LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10];

/** Round to a friendly toman number (nearest of 1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9 × 10^k). */
export function niceRound(x: number): number {
  if (!(x > 0)) return 0;
  const e = Math.floor(Math.log10(x));
  const base = 10 ** e;
  let best = LADDER[0]! * base;
  for (const m of LADDER) {
    const v = m * base;
    if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  }
  // avoid floating noise like 1.2000000000000002e6
  return Math.round(best);
}

/** Linear-interpolated quantile (type 7) of a sorted array. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

export interface BudgetBand {
  /** Display boundaries (rounded). */
  from?: number;
  to?: number;
  budget: Budget;
  count: number;
}

function countIn(prices: readonly number[], b: Budget): number {
  return prices.filter((p) => (b.min === undefined || p >= b.min) && (b.max === undefined || p <= b.max)).length;
}

function bandsFor(prices: readonly number[], bounds: readonly number[]): BudgetBand[] {
  const bands: BudgetBand[] = [];
  for (let i = 0; i <= bounds.length; i++) {
    const from = i === 0 ? undefined : bounds[i - 1];
    const to = i === bounds.length ? undefined : bounds[i];
    const budget: Budget = {};
    if (from !== undefined) budget.min = from + 1; // integer toman: "more than `from`"
    if (to !== undefined) budget.max = to;
    const band: BudgetBand = { budget, count: countIn(prices, budget) };
    if (from !== undefined) band.from = from;
    if (to !== undefined) band.to = to;
    bands.push(band);
  }
  return bands;
}

/**
 * Budget bands from the real price distribution: tertiles (≥ 9 prices) or the median (≥ 2),
 * rounded to friendly numbers; empty bands are merged away. Returns [] when fewer than two bands remain.
 */
export function budgetBands(pricesIn: readonly number[]): BudgetBand[] {
  const prices = [...pricesIn].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (prices.length < 2) return [];
  const k = prices.length >= 9 ? 3 : 2;
  let bounds: number[] = [];
  for (let i = 1; i < k; i++) bounds.push(niceRound(quantile(prices, i / k)));
  const lo = prices[0]!;
  const hi = prices[prices.length - 1]!;
  bounds = [...new Set(bounds)].filter((b) => b >= lo && b < hi).sort((a, b) => a - b);
  // drop boundaries that would leave an empty band
  for (;;) {
    const bands = bandsFor(prices, bounds);
    const empty = bands.findIndex((b) => b.count === 0);
    if (empty < 0) return bands.length >= 2 ? bands : [];
    bounds.splice(Math.min(empty, bounds.length - 1), 1);
    if (bounds.length === 0) return [];
  }
}

export function budgetOptions(prices: readonly number[]): QuestionOption[] {
  return budgetBands(prices).map((b, i) => ({
    id: `budget:${i}`,
    label: budgetBandLabel(b.from, b.to),
    count: b.count,
    apply: { budget: b.budget },
  }));
}
