import { describe, expect, it } from 'vitest';
import type { PlanAlternative } from '../api/types';
import { altLabel } from './alternatives';
import { dropLeadingTotalWord } from '../components/CoverageTotal';

const alt = (stops: number, label: string, deltaStops: number, deltaToman = 100_000): PlanAlternative => ({
  id: `stops:${stops}`,
  label,
  description: 'x',
  deltaToman,
  deltaStops,
});

describe('altLabel: every option of the plan switcher is told apart', () => {
  it('all «کم‌توقف‌تر» from the server: labels come from the stop counts', () => {
    const all = [alt(3, 'کم‌توقف‌تر', -1), alt(2, 'کم‌توقف‌تر', -2), alt(1, 'کم‌توقف‌تر', -3)];
    const labels = all.map((a) => altLabel(a, all, 4));
    expect(labels).toEqual(['۳ توقف', '۲ توقف', '۱ توقف']);
    expect(new Set(labels).size).toBe(3);
  });

  it('a specific, unique server label is used as is', () => {
    const all = [alt(3, '۳ توقف', -1), alt(2, '۲ توقف', -2)];
    expect(all.map((a) => altLabel(a, all, 4))).toEqual(['۳ توقف', '۲ توقف']);
  });

  it('duplicate or blank server labels fall back to the derived one', () => {
    const all = [alt(5, 'گزینهٔ دیگر', 1, -50_000), alt(6, 'گزینهٔ دیگر', 2, -80_000), alt(2, '', -2)];
    expect(all.map((a) => altLabel(a, all, 4))).toEqual(['۵ توقف', '۶ توقف', '۲ توقف']);
  });

  it('a lone generic label is still replaced by the truthful stop count', () => {
    const all = [alt(1, 'ارزان‌تر', -1)];
    expect(altLabel(all[0]!, all, 2)).toBe('۱ توقف');
  });
});

describe('total wording is not composed twice', () => {
  it('«جمع ۴ مورد» loses its «جمع» next to the label «جمع طبق فهرست»', () => {
    expect(dropLeadingTotalWord('جمع ۴ مورد')).toBe('۴ مورد');
    expect(dropLeadingTotalWord('فقط ۳ از ۵ مورد')).toBe('فقط ۳ از ۵ مورد');
  });
});
