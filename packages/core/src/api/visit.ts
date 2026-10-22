/**
 * VisitTime (what the UI stores) -> engine Visit (weekday + minute), in Tehran time.
 * «امروز، هر زمان» means no time filter at all (visitActive = false), as in the UI.
 */
import type { Visit, Weekday } from '../types/index';
import type { VisitTime } from './dto';

export const VISIT_TZ = 'Asia/Tehran';

/** Representative minute for each time window (documented, shown in the time sheet). */
export const WINDOW_MINUTE = { morning: 10 * 60, noon: 13 * 60, evening: 18 * 60 } as const;

const JS_DAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function isVisitActive(v: VisitTime): boolean {
  return !(v.day === 'today' && v.window === 'any');
}

/** Weekday of a Date in Tehran. */
export function tehranWeekday(d: Date): Weekday {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: VISIT_TZ }).format(d);
  const i = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
  return JS_DAYS[i < 0 ? 0 : i]!;
}

/** Weekday of an ISO calendar date (the date is a Tehran calendar day). */
export function weekdayOfIsoDate(iso: string): Weekday | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  return JS_DAYS[d.getUTCDay()]!;
}

/** Minute of the day (0..1439) of a Date in Tehran. */
export function tehranMinute(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: VISIT_TZ }).format(d);
  const [h, m] = parts.split(':').map(Number) as [number, number];
  return (h % 24) * 60 + (m || 0);
}

function parseHHMM(t: string | undefined): number | undefined {
  const m = t ? /^(\d{2}):(\d{2})$/.exec(t) : null;
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : undefined;
}

/** Engine visit, or undefined when no time filter applies. */
export function toEngineVisit(v: VisitTime, now: Date): Visit | undefined {
  if (!isVisitActive(v)) return undefined;
  let day: Weekday | null;
  if (v.day === 'today') day = tehranWeekday(now);
  else if (v.day === 'tomorrow') day = tehranWeekday(new Date(now.getTime() + 86_400_000));
  else day = v.date ? weekdayOfIsoDate(v.date) : null;
  if (!day) return undefined;
  let minute: number | undefined;
  if (v.window === 'exact') minute = parseHHMM(v.time);
  else if (v.window !== 'any') minute = WINDOW_MINUTE[v.window];
  return minute === undefined ? { day } : { day, minute };
}
