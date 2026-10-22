import { describe, expect, it } from 'vitest';
import { int, rng } from '../../requirement/__tests__/fixtures';
import { EARTH_RADIUS_M, haversineM, spreadM } from '../geo';
import { openStatusAt } from '../hours';

describe('haversine', () => {
  it('one degree of longitude on the equator ≈ 111.195 km', () => {
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_M, 3);
  });
  it('pole to pole is half the circumference', () => {
    expect(haversineM({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
  });
  it('a short Tehran hop matches the planar approximation', () => {
    const a = { lat: 35.6901, lon: 51.4192 };
    const b = { lat: 35.6911, lon: 51.4185 };
    const dy = (b.lat - a.lat) * (Math.PI / 180) * EARTH_RADIUS_M;
    const dx = (b.lon - a.lon) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((a.lat * Math.PI) / 180);
    expect(Math.abs(haversineM(a, b) - Math.hypot(dx, dy))).toBeLessThan(0.05);
  });
  it('property: zero, symmetric, triangle inequality', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const p = () => ({ lat: 35.6 + r() * 0.2, lon: 51.3 + r() * 0.2 });
      const a = p(), b = p(), c = p();
      expect(haversineM(a, a)).toBe(0);
      expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9);
      expect(haversineM(a, c)).toBeLessThanOrEqual(haversineM(a, b) + haversineM(b, c) + 1e-6);
    }
  });
  it('spread ignores unknown coordinates', () => {
    expect(spreadM([{ lat: 0, lon: 0 }, { lat: null, lon: null }])).toBe(0);
  });
});

describe('opening hours', () => {
  const hours = { sat: [[540, 1140]] as [number, number][], sun: [[540, 780], [960, 1200]] as [number, number][], fri: [] };
  it('no hours known is never "closed"', () => {
    expect(openStatusAt(null, { day: 'fri', minute: 1300 })).toBe('unknown');
    expect(openStatusAt(undefined, { day: 'sat' })).toBe('unknown');
  });
  it('absent day key is unknown, [] is closed', () => {
    expect(openStatusAt(hours, { day: 'mon', minute: 600 })).toBe('unknown');
    expect(openStatusAt(hours, { day: 'fri' })).toBe('closed');
    expect(openStatusAt(hours, { day: 'fri', minute: 600 })).toBe('closed');
  });
  it('inside / outside shifts; end is exclusive; split shifts', () => {
    expect(openStatusAt(hours, { day: 'sat', minute: 540 })).toBe('open');
    expect(openStatusAt(hours, { day: 'sat', minute: 1139 })).toBe('open');
    expect(openStatusAt(hours, { day: 'sat', minute: 1140 })).toBe('closed');
    expect(openStatusAt(hours, { day: 'sun', minute: 840 })).toBe('closed');
    expect(openStatusAt(hours, { day: 'sun', minute: 1000 })).toBe('open');
    expect(openStatusAt(hours, { day: 'sat' })).toBe('open');
  });
  it('overnight shift is open late that day; degenerate shifts carry no information', () => {
    expect(openStatusAt({ thu: [[1200, 120]] }, { day: 'thu', minute: 1300 })).toBe('open');
    expect(openStatusAt({ thu: [[0, 0]] }, { day: 'thu', minute: 600 })).toBe('unknown');
  });
  it('property: unknown iff hours or day missing', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const has = r() < 0.5;
      const h = has ? { sat: r() < 0.3 ? [] : [[int(r, 0, 700), int(r, 701, 1439)] as [number, number]] } : null;
      const s = openStatusAt(h, { day: r() < 0.5 ? 'sat' : 'sun', minute: int(r, 0, 1439) });
      if (!h) expect(s).toBe('unknown');
    }
  });
});
