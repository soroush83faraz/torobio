import type { PlanAlternative } from '../api/types';
import { t } from '../copy/fa';

/** The two bucket words the engine has always used; neither tells one alternative from another. */
const GENERIC = new Set(['ارزان‌تر', 'کم‌توقف‌تر']);

const norm = (s: string) => s.replace(/[‌\s]+/g, '').trim();
const genericKeys = new Set([...GENERIC].map(norm));

/**
 * What names an alternative in the plan switcher. The server's `label` is used when it says something specific and
 * differs from every other alternative's («۳ توقف»); a bare bucket word, a blank or a duplicate would make the options
 * indistinguishable, so then the label is derived from what is true of the plan itself: its stop count
 * (current stops + deltaStops). The price difference stays in the description next to it.
 */
export function altLabel(a: PlanAlternative, all: PlanAlternative[], currentStops: number): string {
  const own = (a.label ?? '').trim();
  const key = norm(own);
  const specific = key !== '' && !genericKeys.has(key);
  const unique = all.filter((b) => norm(b.label ?? '') === key).length === 1;
  if (specific && unique) return own;
  return t.plan.altStops(Math.max(1, currentStops + a.deltaStops));
}
