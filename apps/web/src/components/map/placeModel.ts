/**
 * Pure view-model helpers for the "where to go" screen (PlacesView) and its map markers.
 * Everything that turns a PlacesResponse into words, tones and order lives here so it can be unit-tested.
 */
import type { PlaceBadge, PlaceMall, PlacesResponse } from '@app/core/src/api/dto';
import { formatCount, formatTomanCompact } from '../../lib/format';

export const BADGE_LABEL: Record<PlaceBadge, string> = {
  one_stop: 'همه‌چیز یک‌جا',
  cheapest: 'ارزان‌ترین',
  most_choice: 'گزینهٔ بیشتر',
  open_now: 'الان بازه',
};

/** Display priority: the reason to pick a mall first, then the reasons to prefer it. */
const BADGE_ORDER: PlaceBadge[] = ['one_stop', 'cheapest', 'open_now', 'most_choice'];

/**
 * The badges a card shows, best reason first, at most `max`. Unknown values from a newer server are dropped, and
 * «الان بازه» is dropped when the mall itself is not reported open (the two would contradict each other on screen).
 */
export function visibleBadges(mall: Pick<PlaceMall, 'badges' | 'open'>, max = 3): PlaceBadge[] {
  const set = new Set(mall.badges ?? []);
  return BADGE_ORDER.filter((b) => set.has(b) && !(b === 'open_now' && mall.open !== 'open')).slice(0, max);
}

/** «۳ از ۴» */
export function coverageText(covered: number, total: number): string {
  return `${formatCount(covered)} از ${formatCount(total)}`;
}

/** Share of the list a mall covers, 0..1 (0 for an empty list). */
export function coverageRatio(covered: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, covered / total));
}

/** Short money for a map pill: «۱۲٫۳ م», «۸۰۰ هزار», «۱٫۲ میلیارد». */
export function pillPrice(toman: number): string {
  return formatTomanCompact(toman, false).replace(/\sمیلیون$/, ' م');
}

/** The marker pill: «۴ از ۴ · ۱۲٫۳ م», or the coverage alone when nothing is priced. */
export function pillLabel(mall: Pick<PlaceMall, 'covered' | 'total' | 'totalToman'>): string {
  const cov = coverageText(mall.covered, mall.total);
  return mall.totalToman != null && mall.totalToman > 0 ? `${cov} · ${pillPrice(mall.totalToman)}` : cov;
}

export type MarkerTone = 'best' | 'normal' | 'muted';

/** Best mall gets the pulse; a closed mall or one that covers nothing is drawn muted. */
export function markerTone(mall: Pick<PlaceMall, 'id' | 'open' | 'covered'>, bestId: string | null): MarkerTone {
  if (bestId && mall.id === bestId) return 'best';
  if (mall.open === 'closed' || mall.covered === 0) return 'muted';
  return 'normal';
}

export type OpenTone = 'open' | 'closed' | 'unknown';

export function openState(mall: Pick<PlaceMall, 'open' | 'hoursText'>): { tone: OpenTone; text: string } {
  if (mall.open === 'open') return { tone: 'open', text: mall.hoursText ? `باز، ${mall.hoursText}` : 'الان باز است' };
  if (mall.open === 'closed') return { tone: 'closed', text: mall.hoursText ? `بسته، ${mall.hoursText}` : 'الان بسته است' };
  return { tone: 'unknown', text: mall.hoursText ?? 'ساعت کاری معلوم نیست' };
}

/** «طبقهٔ ۲، طبقهٔ ۶» – at most `max`, the rest folded into «و ۲ طبقهٔ دیگر». */
export function floorsText(floors: readonly string[], max = 3): string {
  const clean = floors.map((f) => f.trim()).filter(Boolean);
  if (clean.length <= max) return clean.join('، ');
  return `${clean.slice(0, max).join('، ')} و ${formatCount(clean.length - max)} طبقهٔ دیگر`;
}

/** True when the recommended mall carries every item of the list. */
export function hasFullCoverage(places: PlacesResponse): boolean {
  const best = places.malls.find((m) => m.id === places.bestId);
  return !!best && best.total > 0 && best.covered >= best.total;
}

/**
 * The banner line. The server's headline wins; without one it is rebuilt from the best mall. Null when no mall was
 * recommended (the screen then shows its "nothing has it all" state).
 */
export function headlineFor(places: PlacesResponse): string | null {
  const best = places.malls.find((m) => m.id === places.bestId);
  if (!best) return null;
  if (places.headline) return places.headline;
  if (best.covered >= best.total) return `همهٔ ${formatCount(best.total)} مورد در ${best.name} هست`;
  return `${coverageText(best.covered, best.total)} مورد در ${best.name} هست`;
}

/** The mall to select first: the recommendation, else the first ranked. */
export function initialSelection(places: PlacesResponse): string | null {
  if (places.bestId && places.malls.some((m) => m.id === places.bestId)) return places.bestId;
  return places.malls[0]?.id ?? null;
}

/* ---- marker collision ---- */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Greedy label placement: walks the rects in priority order (the caller sorts: selected, best, then rank) and keeps a
 * rect only when it does not overlap one already kept. Returns the indices (into `rects`) whose full pill can show;
 * the others collapse to a dot. The first rect always shows.
 */
export function resolveCollisions(rects: readonly Rect[], gap = 4): Set<number> {
  const kept: Rect[] = [];
  const shown = new Set<number>();
  rects.forEach((r, i) => {
    if (kept.every((k) => !overlaps(k, r, gap))) {
      kept.push(r);
      shown.add(i);
    }
  });
  return shown;
}

/* ---- bottom sheet snapping ---- */

/**
 * Where a released sheet settles. `snaps` are visible heights in px (any order); a quick flick (|velocity| above
 * `flick` px/ms, positive = growing) moves one snap in that direction, otherwise the nearest snap wins.
 * Returns the index into `snaps`.
 */
export function settleSnap(height: number, velocity: number, snaps: readonly number[], flick = 0.45): number {
  if (snaps.length === 0) return -1;
  const order = snaps.map((h, i) => ({ h, i })).sort((a, b) => a.h - b.h);
  if (Math.abs(velocity) > flick) {
    if (velocity > 0) return (order.find((s) => s.h > height + 1) ?? order[order.length - 1]!).i;
    const below = [...order].reverse().find((s) => s.h < height - 1);
    return (below ?? order[0]!).i;
  }
  let best = order[0]!;
  for (const s of order) if (Math.abs(s.h - height) < Math.abs(best.h - height)) best = s;
  return best.i;
}

/** Rubber-band resistance past the ends of the sheet's range. */
export function rubberBand(height: number, min: number, max: number): number {
  if (height > max) return max + (height - max) * 0.25;
  if (height < min) return min - (min - height) * 0.25;
  return height;
}

/** Exponential ease-out used by the count-up and the hero. */
export function easeOutExpo(t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return 1 - Math.pow(2, -10 * t);
}
