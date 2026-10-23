import { describe, expect, it } from 'vitest';
import { mockParse, mockPlaces, mockPlan } from '../api/mock/engine';
import type { PlaceMall } from '../api/types';
import { emptyState } from '../store/plans';
import { applyMallPick, bestMall, buildingName, mallPins, placesKey, placesStateOf, teaserLine } from './places';
import { allLines } from './stops';

const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';
const NOW = new Date('2026-10-21T08:00:00Z'); // Wednesday

const mall = (over: Partial<PlaceMall> = {}): PlaceMall => ({
  id: 'm:x',
  name: 'علاءالدین',
  lat: 35.69,
  lon: 51.42,
  floors: [],
  shopCount: 2,
  covered: 2,
  total: 3,
  totalToman: 1_000_000,
  open: 'open',
  badges: [],
  items: [
    { itemId: 'a', itemName: 'الف', covered: true, shopId: 's1' },
    { itemId: 'b', itemName: 'ب', covered: true, shopId: 's2' },
    { itemId: 'c', itemName: 'ج', covered: false },
  ],
  ...over,
});

describe('places helpers', () => {
  it('pins every covered item to its shop and settles it; uncovered items are left alone', () => {
    const p = { shopPins: { c: 'old' } as Record<string, string>, settled: {} as Record<string, boolean> };
    expect(applyMallPick(p, mall())).toBe(2);
    expect(p.shopPins).toEqual({ a: 's1', b: 's2', c: 'old' });
    expect(p.settled).toEqual({ a: true, b: true });
    expect(mallPins(mall({ items: [{ itemId: 'a', itemName: 'x', covered: true }] }))).toEqual({});
  });

  it('asks about the list without the seller pins (the map compares malls), so pins do not change the key', () => {
    const s = emptyState(mockParse(CCTV).items);
    expect(placesStateOf({ ...s, shopPins: { x: 'y' } }).shopPins).toEqual({});
    expect(placesKey({ ...s, shopPins: { x: 'y' } })).toBe(placesKey(s));
    expect(placesKey({ ...s, settled: { x: true } })).not.toBe(placesKey(s));
  });

  it('words the teaser and the building name', () => {
    expect(teaserLine(mall({ covered: 4, total: 4 }))).toBe('همهٔ ۴ مورد یک‌جا پیدا می‌شود');
    expect(teaserLine(mall({ covered: 2, total: 2 }))).toBe('هر دو مورد یک‌جا پیدا می‌شود');
    expect(teaserLine(mall())).toBe('۲ از ۳ مورد یک‌جا پیدا می‌شود');
    expect(buildingName('علاءالدین')).toBe('پاساژ علاءالدین');
    expect(buildingName('پاساژ علاءالدین')).toBe('پاساژ علاءالدین');
    expect(buildingName('مجتمع چارسو')).toBe('مجتمع چارسو');
    expect(bestMall({ malls: [mall()], bestId: 'm:x' })?.id).toBe('m:x');
    expect(bestMall({ malls: [mall()], bestId: null })).toBeNull();
  });

  it('picking a mall (mock engine) turns the plan into that mall for every item it covers, before questions are answered', () => {
    const state = emptyState(mockParse(CCTV).items);
    const places = mockPlaces(placesStateOf(state), NOW);
    // a mall that is not the plan's own first choice proves the pins steer the plan
    expect(places.malls.filter((x) => x.covered >= 2).length).toBeGreaterThan(1);
    for (const m of places.malls.filter((x) => x.covered >= 2)) {
      const next = structuredClone(state);
      applyMallPick(next, m);
      const plan = mockPlan(next, NOW);
      const covered = new Set(m.items.filter((i) => i.covered).map((i) => i.itemId));
      const lines = allLines(plan.stops).filter((l) => covered.has(l.itemId));
      expect(lines.length, m.name).toBe(covered.size);
      for (const st of plan.stops) if (allLines([st]).some((l) => covered.has(l.itemId))) expect(st.mall).toBe(m.name);
    }
  });
});
