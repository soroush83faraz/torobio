/**
 * Pure geometry for the map screens. No Leaflet, no DOM: everything here is unit-tested and safe to import from the
 * Home bundle (the hero uses the projections, Leaflet stays in its own lazy chunk).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const DEG = Math.PI / 180;

/** True for a finite coordinate inside the WGS84 range. */
export function hasCoords<T extends Partial<LatLon>>(p: T | null | undefined): p is T & LatLon {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}

/**
 * Smallest box around the points, grown so it is never narrower than `minSpanDeg` (one mall alone would otherwise
 * zoom the map to the maximum) and padded by `padRatio` of its span on every side. Null when no point is usable.
 */
export function boundsOf(points: readonly Partial<LatLon>[], opts: { minSpanDeg?: number; padRatio?: number } = {}): Bounds | null {
  const { minSpanDeg = 0.004, padRatio = 0 } = opts;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (!hasCoords(p)) continue;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  if (south === Infinity) return null;
  const grow = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    if (span >= minSpanDeg) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - minSpanDeg / 2, mid + minSpanDeg / 2];
  };
  [south, north] = grow(south, north);
  [west, east] = grow(west, east);
  const padLat = (north - south) * padRatio;
  const padLon = (east - west) * padRatio;
  return { south: south - padLat, west: west - padLon, north: north + padLat, east: east + padLon };
}

/** Centre of a bounds box. */
export function boundsCenter(b: Bounds): LatLon {
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

/**
 * Leaflet padding for fitBounds when a bottom sheet covers the lower part of the map: the markers must land in the
 * visible band above the sheet, never under it. Returns [paddingTopLeft, paddingBottomRight] as [x, y] pairs.
 * The band is never allowed to shrink below `minVisible` px (a nearly-full sheet would otherwise invert it).
 */
export function sheetAwarePadding(
  mapHeight: number,
  sheetVisible: number,
  opts: { top?: number; side?: number; gap?: number; minVisible?: number } = {},
): { topLeft: [number, number]; bottomRight: [number, number] } {
  const { top = 56, side = 36, gap = 28, minVisible = 120 } = opts;
  const maxBottom = Math.max(0, mapHeight - top - minVisible);
  const bottom = Math.min(Math.max(0, sheetVisible) + gap, maxBottom);
  return { topLeft: [side, top], bottomRight: [side, bottom] };
}

/**
 * Linear (equirectangular, cos-latitude corrected) projection of a point into a w x h box that contains `b` with
 * `pad` px of margin, keeping the aspect ratio (the box is letterboxed, never stretched). North is up and east points
 * screen-rightwards; a map is never mirrored in RTL.
 */
export function projectToBox(p: LatLon, b: Bounds, w: number, h: number, pad = 0): [number, number] {
  const k = Math.cos(((b.south + b.north) / 2) * DEG);
  const spanX = Math.max((b.east - b.west) * k, 1e-9);
  const spanY = Math.max(b.north - b.south, 1e-9);
  const innerW = Math.max(w - 2 * pad, 0);
  const innerH = Math.max(h - 2 * pad, 0);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const offX = pad + (innerW - spanX * scale) / 2;
  const offY = pad + (innerH - spanY * scale) / 2;
  return [offX + (p.lon - b.west) * k * scale, offY + (b.north - p.lat) * scale];
}

export interface FisheyeOptions {
  /** Focus of the lens (the dense bazaar core). */
  center: LatLon;
  /** Distance (degrees of latitude) that maps to the edge of the box; farther points are clamped to the edge. */
  radiusDeg: number;
  /** 0 < gamma <= 1. Lower values spread the dense centre further apart; 1 is a plain linear projection. */
  gamma: number;
  width: number;
  height: number;
  /** Margin kept free inside the box, px. */
  margin?: number;
}

/**
 * Radial "lens" projection: the bazaar core (a few hundred malls within ~1 km) would be one blob in a linear
 * projection of the whole belt, so distances from the centre are compressed with r' = (r / R) ^ gamma.
 * Direction is preserved (north stays up), the unit circle is stretched to the box's ellipse.
 */
export function projectFisheye(p: LatLon, o: FisheyeOptions): [number, number] {
  const margin = o.margin ?? 0;
  const k = Math.cos(o.center.lat * DEG);
  const dx = (p.lon - o.center.lon) * k;
  const dy = p.lat - o.center.lat;
  const r = Math.hypot(dx, dy);
  const cx = o.width / 2;
  const cy = o.height / 2;
  if (r === 0) return [cx, cy];
  const rn = Math.min(r / o.radiusDeg, 1);
  const rp = Math.pow(rn, o.gamma);
  const rx = Math.max(o.width / 2 - margin, 0);
  const ry = Math.max(o.height / 2 - margin, 0);
  return [cx + (dx / r) * rp * rx, cy - (dy / r) * rp * ry];
}

/**
 * Empirical CDF of `values` as a function: v -> 0..1 (linear between samples, ties share their mean rank).
 * Used to density-equalise the hero map per axis: a crowded strip of the bazaar gets room proportional to how many
 * malls it holds, while the order of everything (who is north / east of whom) is kept.
 */
export function cdf(values: readonly number[]): (v: number) => number {
  const s = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return () => 0.5;
  if (n === 1) return () => 0.5;
  return (v: number) => {
    if (v <= s[0]!) return 0;
    if (v >= s[n - 1]!) return 1;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid]! <= v) lo = mid;
      else hi = mid;
    }
    // first/last index of the tie block containing s[lo]
    let a = lo;
    while (a > 0 && s[a - 1] === s[lo]) a--;
    const rankLo = (a + lo) / 2;
    const span = s[hi]! - s[lo]!;
    const t = span > 0 ? (v - s[lo]!) / span : 0;
    return (rankLo + t * (hi - rankLo)) / (n - 1);
  };
}

/** Great-circle distance in metres (haversine). */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * A quadratic arc from a to b (SVG path data) bowed sideways by `bend` of the chord length. Used by the hero's
 * route arcs; the control point is perpendicular to the chord so short hops get small arcs.
 */
export function arcPath(a: [number, number], b: [number, number], bend = 0.28): string {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(x1)} ${f(y1)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`;
}

/** Approximate length of a quadratic Bezier (sampled), for stroke-dash animation. */
export function quadLength(a: [number, number], c: [number, number], b: [number, number], steps = 24): number {
  let len = 0;
  let px = a[0];
  let py = a[1];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return len;
}
