export interface LatLon {
  lat: number;
  lon: number;
}

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (straight-line) distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function hasCoords(p: { lat: number | null; lon: number | null }): p is LatLon {
  return typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

/** Max pairwise distance among points with known coordinates (0 for fewer than two). */
export function spreadM(points: ReadonlyArray<{ lat: number | null; lon: number | null }>): number {
  const known = points.filter(hasCoords);
  let max = 0;
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) max = Math.max(max, haversineM(known[i]!, known[j]!));
  return max;
}
