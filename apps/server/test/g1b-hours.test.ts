import { describe, expect, it } from 'vitest';
import { parseHours } from '../src/adapter/rows.js';

const normal = [[540, 1080]];
const day24 = [[0, 1440]];

describe('placeholder Friday (00:00-23:59) in shops.hours', () => {
  it('is unknown when every other open day is a normal schedule', () => {
    const h = parseHours(JSON.stringify({ sat: normal, sun: normal, mon: normal, tue: normal, wed: normal, thu: [[540, 840]], fri: day24 }));
    expect(h).toEqual({ sat: normal, sun: normal, mon: normal, tue: normal, wed: normal, thu: [[540, 840]] });
    expect(h).not.toHaveProperty('fri');
  });

  it('is unknown even when the other days include closed ones', () => {
    expect(parseHours(JSON.stringify({ sat: normal, sun: [], fri: day24 }))).toEqual({ sat: normal, sun: [] });
  });

  it('is kept when the shop is round-the-clock on any other day (a real 24 h shop)', () => {
    const all = Object.fromEntries(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, day24]));
    expect(parseHours(JSON.stringify(all))).toEqual(all);
    expect(parseHours(JSON.stringify({ sat: day24, sun: normal, fri: day24 }))).toEqual({ sat: day24, sun: normal, fri: day24 });
  });

  it('is kept when there is no other open day to compare with', () => {
    expect(parseHours(JSON.stringify({ fri: day24 }))).toEqual({ fri: day24 });
    expect(parseHours(JSON.stringify({ sat: [], fri: day24 }))).toEqual({ sat: [], fri: day24 });
  });

  it('only exactly 00:00-24:00 on Friday counts; real Friday hours and other 24 h days are untouched', () => {
    expect(parseHours(JSON.stringify({ sat: normal, fri: [[600, 840]] }))).toEqual({ sat: normal, fri: [[600, 840]] });
    expect(parseHours(JSON.stringify({ sat: day24, sun: normal, fri: [[0, 1439]] }))).toEqual({ sat: day24, sun: normal, fri: [[0, 1439]] });
    expect(parseHours(JSON.stringify({ sat: normal, sun: day24 }))).toEqual({ sat: normal, sun: day24 });
  });
});
