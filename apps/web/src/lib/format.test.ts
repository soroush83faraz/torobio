import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatJalaliDate,
  formatNumber,
  formatRelativeDay,
  formatTime,
  formatToman,
  formatTomanCompact,
  formatWeekday,
  parseNumberInput,
  toLatinDigits,
  toPersianDigits,
} from './format';

describe('digits', () => {
  it('converts Latin digits to Persian', () => {
    expect(toPersianDigits('HAC 2024 / 15')).toBe('HAC ۲۰۲۴ / ۱۵');
    expect(toPersianDigits(0)).toBe('۰');
  });
  it('converts Persian and Arabic-Indic digits back to Latin', () => {
    expect(toLatinDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(toLatinDigits('٠١٢٣')).toBe('0123');
  });
});

describe('numbers and toman', () => {
  it('uses «٬» as thousands separator', () => {
    expect(formatNumber(3200000)).toBe('۳٬۲۰۰٬۰۰۰');
  });
  it('formats exact toman', () => {
    expect(formatToman(3200000)).toBe('۳٬۲۰۰٬۰۰۰ تومان');
    expect(formatToman(0)).toBe('۰ تومان');
  });
  it('formats compact toman with «٫» decimals', () => {
    expect(formatTomanCompact(3_200_000)).toBe('۳٫۲ میلیون تومان');
    expect(formatTomanCompact(18_400_000)).toBe('۱۸٫۴ میلیون تومان');
    expect(formatTomanCompact(3_000_000)).toBe('۳ میلیون تومان');
    expect(formatTomanCompact(800_000)).toBe('۸۰۰ هزار تومان');
    expect(formatTomanCompact(96_000)).toBe('۹۶ هزار تومان');
    expect(formatTomanCompact(1_200_000_000)).toBe('۱٫۲ میلیارد تومان');
  });
  it('can drop the unit for «از ۲٫۵ میلیون»', () => {
    expect(formatTomanCompact(2_500_000, false)).toBe('۲٫۵ میلیون');
  });
  it('never prints «۱۰۰۰ هزار»', () => {
    expect(formatTomanCompact(999_600)).toBe('۱ میلیون تومان');
  });
  it('shows small amounts exactly', () => {
    expect(formatTomanCompact(450)).toBe('۴۵۰ تومان');
  });
});

describe('Jalali dates and time', () => {
  // 13 Oct 2026 = ۲۱ مهر ۱۴۰۵ (the dataset snapshot date)
  const snapshot = new Date('2026-10-13T08:00:00Z');
  it('formats the snapshot date in the Persian calendar', () => {
    expect(formatJalaliDate(snapshot)).toBe('۲۱ مهر ۱۴۰۵');
  });
  it('formats the weekday name', () => {
    expect(formatWeekday(snapshot)).toBe('سه‌شنبه');
    expect(formatWeekday(new Date('2026-10-16T08:00:00Z'))).toBe('جمعه');
  });
  it('formats 24-hour time in Tehran time with Persian digits', () => {
    expect(formatTime(new Date('2026-10-13T16:00:00Z'))).toBe('۱۹:۳۰');
    expect(formatTime(new Date('2026-10-13T06:50:00Z'))).toBe('۱۰:۲۰');
  });
  it('formats HH:MM strings', () => {
    expect(formatClock('19:30')).toBe('۱۹:۳۰');
    expect(formatClock('9:05')).toBe('۰۹:۰۵');
    expect(formatClock('نامعتبر')).toBe('نامعتبر');
  });
  it('names today and yesterday', () => {
    const now = new Date('2026-10-21T08:00:00Z');
    expect(formatRelativeDay(new Date('2026-10-21T05:00:00Z'), now)).toBe('امروز');
    expect(formatRelativeDay(new Date('2026-10-20T09:00:00Z'), now)).toBe('دیروز');
    expect(formatRelativeDay(new Date('2026-10-13T09:00:00Z'), now)).toBe('۲۱ مهر');
  });
});

describe('parseNumberInput', () => {
  it('accepts Persian, Arabic and Latin digits with separators', () => {
    expect(parseNumberInput('۳٬۴۰۰٬۰۰۰')).toBe(3_400_000);
    expect(parseNumberInput('3,400,000')).toBe(3_400_000);
    expect(parseNumberInput('٣٤٠٠')).toBe(3400);
    expect(parseNumberInput('۲٫۵')).toBe(2.5);
  });
  it('rejects non-numbers', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('۱۲ تومان')).toBeNull();
  });
});
