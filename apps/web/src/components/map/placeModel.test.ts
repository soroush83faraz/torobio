import { describe, expect, it } from 'vitest';
import type { PlaceMall, PlacesResponse } from '@app/core/src/api/dto';
import {
  coverageRatio,
  coverageText,
  easeOutExpo,
  floorsText,
  hasFullCoverage,
  headlineFor,
  initialSelection,
  markerTone,
  openState,
  pillLabel,
  resolveCollisions,
  rubberBand,
  settleSnap,
  visibleBadges,
} from './placeModel';

function mall(over: Partial<PlaceMall> = {}): PlaceMall {
  return {
    id: 'm:a',
    name: 'پاساژ علاءالدین',
    lat: 35.6948,
    lon: 51.4115,
    floors: ['طبقهٔ ۲'],
    shopCount: 12,
    covered: 4,
    total: 4,
    totalToman: 12_300_000,
    open: 'open',
    badges: [],
    items: [],
    ...over,
  };
}

describe('visibleBadges', () => {
  it('orders by the strongest reason first', () => {
    expect(visibleBadges(mall({ badges: ['most_choice', 'open_now', 'cheapest', 'one_stop'] }), 4)).toEqual([
      'one_stop',
      'cheapest',
      'open_now',
      'most_choice',
    ]);
  });
  it('caps the count', () => {
    expect(visibleBadges(mall({ badges: ['most_choice', 'open_now', 'cheapest', 'one_stop'] }), 2)).toEqual(['one_stop', 'cheapest']);
  });
  it('drops «الان بازه» when the mall is not reported open', () => {
    expect(visibleBadges(mall({ badges: ['open_now', 'cheapest'], open: 'closed' }))).toEqual(['cheapest']);
    expect(visibleBadges(mall({ badges: ['open_now'], open: 'unknown' }))).toEqual([]);
  });
  it('ignores badges it does not know and duplicates', () => {
    const badges = ['one_stop', 'one_stop', 'shiny'] as unknown as PlaceMall['badges'];
    expect(visibleBadges(mall({ badges }))).toEqual(['one_stop']);
  });
});

describe('coverage and pills', () => {
  it('writes coverage with Persian digits', () => {
    expect(coverageText(3, 4)).toBe('۳ از ۴');
    expect(coverageRatio(3, 4)).toBe(0.75);
    expect(coverageRatio(1, 0)).toBe(0);
    expect(coverageRatio(9, 4)).toBe(1);
  });
  it('builds the marker pill «۴ از ۴ · ۱۲٫۳ م»', () => {
    expect(pillLabel(mall())).toBe('۴ از ۴ · ۱۲٫۳ م');
  });
  it('uses thousands below a million and drops the price when nothing is priced', () => {
    expect(pillLabel(mall({ covered: 2, totalToman: 800_000 }))).toBe('۲ از ۴ · ۸۰۰ هزار');
    expect(pillLabel(mall({ covered: 1, totalToman: null }))).toBe('۱ از ۴');
  });
});

describe('tones and states', () => {
  it('marks the recommendation, mutes closed or empty malls', () => {
    expect(markerTone(mall({ id: 'x' }), 'x')).toBe('best');
    expect(markerTone(mall({ open: 'closed' }), 'x')).toBe('muted');
    expect(markerTone(mall({ covered: 0 }), null)).toBe('muted');
    expect(markerTone(mall(), null)).toBe('normal');
  });
  it('describes the open state', () => {
    expect(openState({ open: 'open', hoursText: 'تا ۲۱' })).toEqual({ tone: 'open', text: 'باز، تا ۲۱' });
    expect(openState({ open: 'closed' }).tone).toBe('closed');
    expect(openState({ open: 'unknown' }).text).toBe('ساعت کاری معلوم نیست');
  });
  it('folds long floor lists', () => {
    expect(floorsText(['طبقهٔ ۱', 'طبقهٔ ۲'])).toBe('طبقهٔ ۱، طبقهٔ ۲');
    expect(floorsText(['همکف', 'طبقهٔ ۱', 'طبقهٔ ۲', 'طبقهٔ ۳', 'طبقهٔ ۴'])).toBe('همکف، طبقهٔ ۱، طبقهٔ ۲ و ۲ طبقهٔ دیگر');
  });
});

describe('headline and selection', () => {
  const places = (over: Partial<PlacesResponse> = {}): PlacesResponse => ({
    malls: [mall({ id: 'a', name: 'پاساژ چارسو', covered: 3 }), mall({ id: 'b', name: 'پاساژ علاءالدین' })],
    bestId: 'b',
    ...over,
  });
  it('prefers the server headline', () => {
    expect(headlineFor(places({ headline: 'همهٔ ۴ مورد در پاساژ علاءالدین هست' }))).toBe('همهٔ ۴ مورد در پاساژ علاءالدین هست');
  });
  it('rebuilds it from the best mall when missing', () => {
    expect(headlineFor(places())).toBe('همهٔ ۴ مورد در پاساژ علاءالدین هست');
    expect(headlineFor(places({ bestId: 'a' }))).toBe('۳ از ۴ مورد در پاساژ چارسو هست');
  });
  it('has no headline and no full coverage without a recommendation', () => {
    expect(headlineFor(places({ bestId: null }))).toBeNull();
    expect(hasFullCoverage(places({ bestId: null }))).toBe(false);
    expect(hasFullCoverage(places())).toBe(true);
    expect(hasFullCoverage(places({ bestId: 'a' }))).toBe(false);
  });
  it('selects the recommendation first, else the top ranked, else nothing', () => {
    expect(initialSelection(places())).toBe('b');
    expect(initialSelection(places({ bestId: null }))).toBe('a');
    expect(initialSelection(places({ bestId: 'gone' }))).toBe('a');
    expect(initialSelection({ malls: [], bestId: null })).toBeNull();
  });
});

describe('resolveCollisions', () => {
  it('keeps the first rect and hides lower-priority ones that overlap it', () => {
    const shown = resolveCollisions([
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 50, y: 10, w: 100, h: 30 },
      { x: 300, y: 0, w: 100, h: 30 },
    ]);
    expect([...shown]).toEqual([0, 2]);
  });
  it('respects the gap', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 102, y: 0, w: 100, h: 30 },
    ];
    expect(resolveCollisions(rects, 4).size).toBe(1);
    expect(resolveCollisions(rects, 0).size).toBe(2);
  });
});

describe('sheet snapping', () => {
  const snaps = [200, 450, 750];
  it('settles at the nearest snap on a slow release', () => {
    expect(settleSnap(300, 0, snaps)).toBe(0);
    expect(settleSnap(340, 0.1, snaps)).toBe(1);
    expect(settleSnap(700, -0.2, snaps)).toBe(2);
  });
  it('moves one snap in the flick direction', () => {
    expect(settleSnap(460, 1.2, snaps)).toBe(2);
    expect(settleSnap(440, -1.2, snaps)).toBe(0);
    expect(settleSnap(760, 2, snaps)).toBe(2);
    expect(settleSnap(150, -2, snaps)).toBe(0);
  });
  it('works with unsorted snaps', () => {
    expect(settleSnap(740, 0, [750, 200, 450])).toBe(0);
  });
  it('resists past the ends', () => {
    expect(rubberBand(800, 200, 750)).toBeCloseTo(762.5);
    expect(rubberBand(100, 200, 750)).toBeCloseTo(175);
    expect(rubberBand(400, 200, 750)).toBe(400);
  });
  it('eases out', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });
});
