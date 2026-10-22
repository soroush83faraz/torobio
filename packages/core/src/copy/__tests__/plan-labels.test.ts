/** D7b / D7c: alternative labels are distinct and truthful; the dataset total says «جمع» once. */
import { describe, expect, it } from 'vitest';
import { planCopy } from '../fa';

describe('alternative labels (D7b)', () => {
  it('each non-dominated alternative reads differently: its stop count and its price delta', () => {
    const alts = [
      { stops: 1, cost: 4_740_000 },
      { stops: 2, cost: 1_840_000 },
      { stops: 3, cost: 140_000 },
    ].map((a) => planCopy.altLabel(a.stops, a.cost));
    expect(alts).toEqual(['۱ توقف · ۴٫۷ میلیون تومان بیشتر', '۲ توقف · ۱٫۸ میلیون تومان بیشتر', '۳ توقف · ۱۴۰ هزار تومان بیشتر']);
    expect(new Set(alts).size).toBe(3);
    expect(alts.some((l) => l.includes('کم‌توقف‌تر'))).toBe(false);
  });
  it('cheaper and same-price alternatives say so', () => {
    expect(planCopy.altLabel(4, -500_000)).toBe('۴ توقف · ۵۰۰ هزار تومان ارزان‌تر');
    expect(planCopy.altLabel(2, 0)).toBe('۲ توقف · همان قیمت');
  });
});

describe('dataset total (D7c)', () => {
  it('says «جمع» once, with coverage and the marker', () => {
    expect(planCopy.datasetTotal(4, 4, 20_300_000)).toBe('جمع طبق فهرست برای ۴ مورد: ۲۰٫۳ میلیون تومان');
    expect(planCopy.datasetTotal(3, 5, 11_200_000)).toBe('جمع طبق فهرست، فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان');
    expect(planCopy.datasetTotal(4, 4, 5_000_000, 'ناسازگاری دارد')).toBe('جمع طبق فهرست برای ۴ مورد: ۵ میلیون تومان — ناسازگاری دارد');
    for (const l of [planCopy.datasetTotal(4, 4, 1), planCopy.datasetTotal(1, 2, 1, 'x')]) expect(l.match(/جمع/g)).toHaveLength(1);
  });
});
