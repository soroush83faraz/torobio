/**
 * Persian formatters. Built on Intl only (fa-IR, Persian calendar) - no date libraries.
 * Persian digits, thousands separator «٬», decimal «٫», 24-hour time, Jalali dates.
 */

const TZ = 'Asia/Tehran';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const numberFmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 20 });
const oneDecimalFmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
const jalaliDateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
});
const jalaliShortFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const weekdayFmt = new Intl.DateTimeFormat('fa-IR', { weekday: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TZ,
});

/** Latin digits in any string -> Persian digits. Leaves other characters untouched. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/** Persian / Arabic-Indic digits -> Latin digits (for parsing and indexing). */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/** 3200000 -> «۳٬۲۰۰٬۰۰۰» */
export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

/** Exact toman amount: «۳٬۲۰۰٬۰۰۰ تومان» */
export function formatToman(n: number): string {
  return `${numberFmt.format(Math.round(n))} تومان`;
}

/**
 * Compact toman for lists: «۳٫۲ میلیون تومان», «۸۰۰ هزار تومان», «۱٫۲ میلیارد تومان».
 * Pass `withUnit: false` to drop the trailing «تومان» (e.g. «از ۲٫۵ میلیون»).
 */
export function formatTomanCompact(n: number, withUnit = true): string {
  const abs = Math.abs(n);
  const unit = withUnit ? ' تومان' : '';
  if (abs >= 1_000_000_000) {
    return `${oneDecimalFmt.format(roundTo(n / 1_000_000_000, 1))} میلیارد${unit}`;
  }
  if (abs >= 1_000_000 - 50_000) {
    // 950k+ rounds up into the million range so we never print «۱۰۰۰ هزار».
    return `${oneDecimalFmt.format(roundTo(n / 1_000_000, 1))} میلیون${unit}`;
  }
  if (abs >= 1_000) {
    return `${numberFmt.format(Math.round(n / 1_000))} هزار${unit}`;
  }
  return withUnit ? formatToman(n) : numberFmt.format(Math.round(n));
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Jalali date with month name: «۲۱ مهر ۱۴۰۵» */
export function formatJalaliDate(date: Date | string | number): string {
  return jalaliDateFmt.format(new Date(date));
}

/** Jalali day and month only: «۲۱ مهر» */
export function formatJalaliShort(date: Date | string | number): string {
  return jalaliShortFmt.format(new Date(date));
}

/** Weekday name, week starts on شنبه in the UI: «سه‌شنبه» */
export function formatWeekday(date: Date | string | number): string {
  return weekdayFmt.format(new Date(date));
}

/** 24-hour time: «۱۹:۳۰» */
export function formatTime(date: Date | string | number): string {
  return timeFmt.format(new Date(date));
}

/** 'HH:MM' (any digits) -> «۱۹:۳۰». Returns the input unchanged when it is not a time. */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(toLatinDigits(hhmm));
  if (!m) return hhmm;
  return toPersianDigits(`${m[1]!.padStart(2, '0')}:${m[2]}`);
}

/** Whole hours: 19 -> «۱۹» */
export function formatHour(h: number): string {
  return toPersianDigits(String(h));
}

/** «امروز ۱۱:۲۰», «دیروز ۱۱:۲۰» or «۲۰ مهر ۱۱:۲۰» relative to `now`. */
export function formatRelativeDayTime(date: Date | string | number, now: Date = new Date()): string {
  const d = new Date(date);
  return `${formatRelativeDay(d, now)} ${formatTime(d)}`;
}

/** «امروز» / «دیروز» / «۲۰ مهر» */
export function formatRelativeDay(date: Date | string | number, now: Date = new Date()): string {
  const d = new Date(date);
  const diff = dayNumber(now) - dayNumber(d);
  if (diff === 0) return 'امروز';
  if (diff === 1) return 'دیروز';
  return formatJalaliShort(d);
}

/** Calendar day index in Tehran time (stable across the process). */
function dayNumber(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
  const [y, m, day] = parts.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

/**
 * Parse a user-typed number: accepts Persian/Arabic/Latin digits and the separators
 * «٬» «,» (thousands) and «٫» «.» (decimal). Returns null when it is not a number.
 */
export function parseNumberInput(input: string): number | null {
  const cleaned = toLatinDigits(input)
    .replace(/[٬,،\s]/g, '')
    .replace(/٫/g, '.')
    .trim();
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Quantity prefix for item text: 4 -> «۴», keeps it short. */
export function formatCount(n: number): string {
  return numberFmt.format(n);
}
