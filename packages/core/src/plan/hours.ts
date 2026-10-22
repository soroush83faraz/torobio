import type { OpenStatus, Visit, WeeklyHours } from '../types/index';

/**
 * Open status of a shop at the visit time.
 * - hours null / day key absent → 'unknown' (a shop without hours is NEVER treated as closed);
 * - day = [] → 'closed';
 * - no minute given → 'open' when the day has any shift;
 * - minute given → 'open' when inside a shift [start, end). A shift with end < start wraps past midnight
 *   (open from start to 24:00 on that day). Degenerate shifts (start = end) carry no information.
 */
export function openStatusAt(hours: WeeklyHours | null | undefined, visit: Visit): OpenStatus {
  if (!hours) return 'unknown';
  const day = hours[visit.day];
  if (!Array.isArray(day)) return 'unknown';
  if (day.length === 0) return 'closed';
  const shifts = day.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && s !== e);
  if (shifts.length === 0) return 'unknown';
  if (visit.minute === undefined) return 'open';
  const m = visit.minute;
  for (const [s, e] of shifts) {
    if (e > s ? m >= s && m < e : m >= s) return 'open';
  }
  return 'closed';
}
