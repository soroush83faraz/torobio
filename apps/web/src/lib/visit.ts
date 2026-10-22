import type { VisitTime } from '../api/types';
import { t } from '../copy/fa';
import { formatClock, formatJalaliShort, formatWeekday, toLatinDigits, toPersianDigits } from './format';

const TZ = 'Asia/Tehran';

/** YYYY-MM-DD in Tehran time. */
export function isoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** The next `count` days starting today, for the day picker. */
export function upcomingDays(count = 14, now: Date = new Date()): { iso: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getTime() + i * 86_400_000);
    return { iso: isoDay(d), label: `${formatWeekday(d)} ${formatJalaliShort(d)}` };
  });
}

export function dayLabel(v: VisitTime): string {
  if (v.day === 'today') return t.visit.today;
  if (v.day === 'tomorrow') return t.visit.tomorrow;
  if (v.date) {
    const d = new Date(`${v.date}T12:00:00+03:30`);
    return `${formatWeekday(d)} ${formatJalaliShort(d)}`;
  }
  return t.visit.today;
}

export function windowLabel(v: VisitTime): string {
  switch (v.window) {
    case 'morning':
      return t.visit.morning;
    case 'noon':
      return t.visit.noon;
    case 'evening':
      return t.visit.evening;
    case 'exact':
      return v.time ? formatClock(v.time) : t.visit.exactLabel;
    default:
      return t.visit.any;
  }
}

/** «کی می‌روی؟ هر زمان» or «فردا · عصر». */
export function visitChipLabel(v: VisitTime): string {
  if (v.day === 'today' && v.window === 'any') return `${t.workspace.when} ${t.workspace.whenAny}`;
  return `${dayLabel(v)} · ${windowLabel(v)}`;
}

/** Parses «۱۹:۳۰», «19:30» or «۱۹.۳۰» into 'HH:MM', or null. */
export function parseClock(input: string): string | null {
  const m = /^(\d{1,2})\s*[:.٫]\s*(\d{2})$/.exec(toLatinDigits(input).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export const faDigits = toPersianDigits;
