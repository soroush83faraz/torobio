import { describe, expect, it } from 'vitest';
import centroids from '../../assets/mallCentroids.json';
import { arcPath, boundsCenter, cdf, boundsOf, distanceM, hasCoords, projectFisheye, projectToBox, quadLength, sheetAwarePadding } from './geo';

const ALADDIN = { lat: 35.6948, lon: 51.4115 };
const BOUSHEHRI = { lat: 35.69, lon: 51.4229 };

describe('hasCoords', () => {
  it('accepts real coordinates and rejects missing or broken ones', () => {
    expect(hasCoords(ALADDIN)).toBe(true);
    expect(hasCoords({ lat: 35.7 })).toBe(false);
    expect(hasCoords({ lat: Number.NaN, lon: 51 })).toBe(false);
    expect(hasCoords({ lat: 135, lon: 51 })).toBe(false);
    expect(hasCoords(null)).toBe(false);
  });
});

describe('boundsOf', () => {
  it('returns null when no point has coordinates', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: 35.7 }, {}])).toBeNull();
  });

  it('wraps the points and skips the ones without coordinates', () => {
    const b = boundsOf([ALADDIN, {}, BOUSHEHRI])!;
    expect(b.south).toBeCloseTo(35.69);
    expect(b.north).toBeCloseTo(35.6948);
    expect(b.west).toBeCloseTo(51.4115);
    expect(b.east).toBeCloseTo(51.4229);
  });

  it('never collapses to a point: a single mall gets the minimum span around it', () => {
    const b = boundsOf([ALADDIN], { minSpanDeg: 0.004 })!;
    expect(b.north - b.south).toBeCloseTo(0.004);
    expect(b.east - b.west).toBeCloseTo(0.004);
    const c = boundsCenter(b);
    expect(c.lat).toBeCloseTo(ALADDIN.lat);
    expect(c.lon).toBeCloseTo(ALADDIN.lon);
  });

  it('pads by a ratio of the span', () => {
    const b = boundsOf([ALADDIN, BOUSHEHRI], { padRatio: 0.5 })!;
    expect(b.north - b.south).toBeCloseTo((35.6948 - 35.69) * 2);
  });
});

describe('sheetAwarePadding', () => {
  it('keeps markers above the sheet', () => {
    const p = sheetAwarePadding(800, 400, { top: 50, side: 30, gap: 20 });
    expect(p.topLeft).toEqual([30, 50]);
    expect(p.bottomRight).toEqual([30, 420]);
  });
  it('never leaves less than the minimum visible band, even under a tall sheet', () => {
    const p = sheetAwarePadding(800, 760, { top: 50, minVisible: 120 });
    expect(800 - p.topLeft[1] - p.bottomRight[1]).toBe(120);
  });
  it('treats a negative sheet height as no sheet', () => {
    expect(sheetAwarePadding(600, -20, { gap: 10 }).bottomRight[1]).toBe(10);
  });
});

describe('projectToBox', () => {
  const b = { south: 35.68, west: 51.4, north: 35.7, east: 51.43 };
  it('puts north-west at the top-left and south-east at the bottom-right (maps are never mirrored)', () => {
    const [x1, y1] = projectToBox({ lat: b.north, lon: b.west }, b, 300, 300);
    const [x2, y2] = projectToBox({ lat: b.south, lon: b.east }, b, 300, 300);
    expect(x1).toBeLessThan(x2);
    expect(y1).toBeLessThan(y2);
  });
  it('keeps the aspect ratio and centres the letterboxed content', () => {
    const [x1, y1] = projectToBox({ lat: b.north, lon: b.west }, b, 400, 200, 10);
    const [x2, y2] = projectToBox({ lat: b.south, lon: b.east }, b, 400, 200, 10);
    expect(y1).toBeCloseTo(10);
    expect(y2).toBeCloseTo(190);
    // 0.03 deg of longitude at 35.69N is 0.03 * cos(35.69) = 0.02436 "lat-degrees" wide, height spans 0.02
    expect((x2 - x1) / (y2 - y1)).toBeCloseTo((0.03 * Math.cos((35.69 * Math.PI) / 180)) / 0.02, 3);
    expect((x1 + x2) / 2).toBeCloseTo(200);
  });
});

describe('projectFisheye', () => {
  const o = { center: { lat: 35.694, lon: 51.418 }, radiusDeg: 0.09, gamma: 0.4, width: 400, height: 300, margin: 20 };
  it('maps the centre to the middle of the box', () => {
    expect(projectFisheye(o.center, o)).toEqual([200, 150]);
  });
  it('keeps every real mall inside the box', () => {
    for (const [lat, lon] of centroids.malls as [number, number, number][]) {
      const [x, y] = projectFisheye({ lat, lon }, o);
      expect(x).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(x).toBeLessThanOrEqual(380 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(y).toBeLessThanOrEqual(280 + 1e-6);
    }
  });
  it('spreads the dense core: a point 300 m away moves farther than in a linear projection', () => {
    const near = { lat: o.center.lat + 0.0027, lon: o.center.lon };
    const lens = 150 - projectFisheye(near, o)[1];
    const linear = 150 - projectFisheye(near, { ...o, gamma: 1 })[1];
    expect(lens).toBeGreaterThan(linear * 3);
  });
  it('keeps north up and east right', () => {
    const [xe] = projectFisheye({ lat: o.center.lat, lon: o.center.lon + 0.01 }, o);
    const [, yn] = projectFisheye({ lat: o.center.lat + 0.01, lon: o.center.lon }, o);
    expect(xe).toBeGreaterThan(200);
    expect(yn).toBeLessThan(150);
  });
});

describe('distance and arcs', () => {
  it('measures Aladdin to Boushehri at roughly a kilometre', () => {
    const d = distanceM(ALADDIN, BOUSHEHRI);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1250);
  });
  it('builds a quadratic arc path and measures it longer than the chord', () => {
    expect(arcPath([0, 0], [100, 0], 0.25)).toBe('M0 0Q50 25 100 0');
    const len = quadLength([0, 0], [50, 25], [100, 0]);
    expect(len).toBeGreaterThan(100);
    expect(len).toBeLessThan(120);
  });
});

describe('centroid asset', () => {
  it('stays small and inside the bazaar belt', () => {
    const rows = centroids.malls as [number, number, number][];
    expect(rows.length).toBeGreaterThan(400);
    expect(JSON.stringify(centroids).length).toBeLessThanOrEqual(20_000);
    for (const [lat, lon, n] of rows) {
      expect(lat).toBeGreaterThan(35.6);
      expect(lat).toBeLessThan(35.85);
      expect(lon).toBeGreaterThan(51.28);
      expect(lon).toBeLessThan(51.55);
      expect(n).toBeGreaterThan(0);
    }
  });
});

describe('cdf', () => {
  it('maps the sample range to 0..1, monotonically', () => {
    const f = cdf([5, 1, 3, 9]);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(0);
    expect(f(9)).toBe(1);
    expect(f(20)).toBe(1);
    expect(f(3)).toBeCloseTo(1 / 3);
    expect(f(4)).toBeCloseTo(0.5);
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(f);
    xs.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(xs[i]!));
  });
  it('gives tied samples their mean rank and copes with tiny inputs', () => {
    const f = cdf([1, 2, 2, 2, 3]);
    expect(f(2)).toBeCloseTo(0.5);
    expect(cdf([])(4)).toBe(0.5);
    expect(cdf([7])(7)).toBe(0.5);
  });
});
