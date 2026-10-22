/**
 * Weekly hours -> {"sat":[[540,1140]], "fri":[], ...} in minutes from 00:00.
 * - status 'declared': shifts kept; the 00:00–00:00 second-shift sentinel is
 *   dropped; an end of 00:00 after a non-zero start means midnight (1440);
 *   '23:59' end means 1440; an end before the start is an overnight shift
 *   (end + 1440). A declared day with no usable shift is unknown (key absent).
 * - status 'closed': []  (explicitly closed)
 * - status 'unsupported' / anything else: key absent (unknown)
 * - no hours object, or no day known: null (never "closed").
 * - placeholder Friday: a Friday of exactly 00:00-23:59 on a shop whose every other open day is a normal
 *   (not round-the-clock) schedule is dropped to unknown. Measured on the 2026-10 snapshot: of 916 shops open on
 *   Friday with normal other days, 64 (7 %) declare 00:00-23:59 on Friday, while any other single weekday has
 *   0.6 % round-the-clock declarations (19-27 shops of 4,472); nobody opens a bazaar shop for 24 h on the one
 *   day it otherwise keeps short hours, so it is the profile's default value, not a fact. Shops that declare
 *   round-the-clock hours on all or most days are left as declared.
 */

export const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type Day = (typeof DAYS)[number];
export type Hours = Partial<Record<Day, Array<[number, number]>>>;

interface RawShift {
  start_time?: string;
  end_time?: string;
}
interface RawDay {
  status?: string;
  shifts?: RawShift[];
}

function toMin(t: string | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export function parseShift(s: RawShift): [number, number] | null {
  const a = toMin(s.start_time);
  let b = toMin(s.end_time);
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return null; // sentinel / empty
  if (b === 0) b = 1440; // midnight
  if (b === 23 * 60 + 59) b = 1440;
  if (b === a) return null; // degenerate
  if (b < a) b += 1440; // overnight
  return [a, b];
}

function mergeShifts(list: Array<[number, number]>): Array<[number, number]> {
  const s = [...list].sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const sh of s) {
    const last = out[out.length - 1];
    if (last && sh[0] <= last[1]) last[1] = Math.max(last[1], sh[1]);
    else out.push([sh[0], sh[1]]);
  }
  return out;
}

export interface HoursStats {
  sentinelsDropped: number;
  midnightFixed: number;
  overnight: number;
  declaredEmpty: number;
  /** Fridays dropped to unknown by `dropPlaceholderFriday`. */
  placeholderFriday: number;
}

const isRoundTheClock = (shifts: ReadonlyArray<readonly [number, number]> | undefined): boolean =>
  !!shifts && shifts.length === 1 && shifts[0]![0] === 0 && shifts[0]![1] === 1440;

/** See the module comment: removes a placeholder 00:00-23:59 Friday (in place). Returns true when it did. */
export function dropPlaceholderFriday(h: Hours): boolean {
  if (!isRoundTheClock(h.fri)) return false;
  const others = DAYS.filter((d) => d !== 'fri').flatMap((d) => (h[d] && h[d]!.length > 0 ? [h[d]!] : []));
  if (others.length === 0 || others.some(isRoundTheClock)) return false;
  delete h.fri;
  return true;
}

export function parseHours(raw: unknown, stats?: HoursStats): Hours | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, RawDay>;
  const out: Hours = {};
  let known = 0;
  for (const d of DAYS) {
    const day = obj[d];
    if (!day || typeof day !== 'object') continue;
    if (day.status === 'closed') {
      out[d] = [];
      known++;
      continue;
    }
    if (day.status !== 'declared') continue;
    const shifts: Array<[number, number]> = [];
    for (const s of day.shifts ?? []) {
      const a = toMin(s.start_time);
      const b = toMin(s.end_time);
      if (a === 0 && b === 0) { if (stats) stats.sentinelsDropped++; continue; }
      if (stats && b === 0 && a) stats.midnightFixed++;
      const p = parseShift(s);
      if (p) {
        if (stats && p[1] > 1440) stats.overnight++;
        shifts.push(p);
      }
    }
    if (shifts.length === 0) { if (stats) stats.declaredEmpty++; continue; }
    out[d] = mergeShifts(shifts);
    known++;
  }
  if (dropPlaceholderFriday(out)) {
    if (stats) stats.placeholderFriday++;
    known = Object.keys(out).length;
  }
  return known ? out : null;
}
