/**
 * Runtime shape of POST /api/places (Api.PlacesResponse) and the invariants every response keeps, shared by the
 * fixture and real-data suites. Strict objects: an unexpected key fails, so the contract stays the one in dto.ts.
 */
import type { Api } from '@app/core';
import { expect } from 'vitest';
import { z } from 'zod';

const PlaceItemLineSchema = z.strictObject({
  itemId: z.string().min(1),
  itemName: z.string(),
  covered: z.boolean(),
  productName: z.string().optional(),
  imageUrl: z.string().url().optional(),
  unitPrice: z.number().positive().nullable().optional(),
  qty: z.number().int().positive().optional(),
  shopName: z.string().optional(),
  shopId: z.string().min(1).optional(),
  floor: z.string().optional(),
  unit: z.string().optional(),
  shopsWithItem: z.number().int().positive().optional(),
});

const PlaceMallSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  areaLabel: z.string().optional(),
  floors: z.array(z.string()),
  shopCount: z.number().int().positive(),
  covered: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  totalToman: z.number().positive().nullable(),
  open: z.enum(['open', 'closed', 'unknown']),
  hoursText: z.string().optional(),
  badges: z.array(z.enum(['one_stop', 'cheapest', 'most_choice', 'open_now'])),
  items: z.array(PlaceItemLineSchema),
});

export const PlacesResponseSchema = z.strictObject({
  malls: z.array(PlaceMallSchema).max(8),
  bestId: z.string().nullable(),
  headline: z.string().min(1).optional(),
});

// compile-time: the runtime schema and the contract type describe the same shape (both directions)
type Parsed = z.infer<typeof PlacesResponseSchema>;
export const contractMatches: [(x: Parsed) => Api.PlacesResponse, (x: Api.PlacesResponse) => Parsed] = [(x) => x, (x) => x];

const PERSIAN_DIGIT = /[۰-۹]/;
const LATIN_DIGIT = /[0-9]/;

/** Shape plus the ranking / badge / headline rules of POST /api/places. */
export function expectPlacesInvariants(p: Api.PlacesResponse): void {
  const parsed = PlacesResponseSchema.safeParse(p);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  expect(p.headline).toBeTruthy();
  // Persian digits everywhere except inside an isolated Latin name
  expect(p.headline!.replace(/⁦[^⁩]*⁩/g, '')).not.toMatch(LATIN_DIGIT);
  for (let i = 0; i < p.malls.length; i++) {
    const m = p.malls[i]!;
    const covered = m.items.filter((x) => x.covered);
    expect(m.covered).toBe(covered.length);
    expect(m.items.length).toBe(m.total);
    expect(new Set(m.items.map((x) => x.itemId)).size).toBe(m.items.length);
    // the total is the sum of the covered lines (price × qty)
    const sum = covered.reduce((s, x) => s + x.unitPrice! * x.qty!, 0);
    if (covered.length) expect(m.totalToman).toBe(sum);
    else expect(m.totalToman).toBeNull();
    for (const x of covered) {
      expect(x.unitPrice).toBeGreaterThan(0);
      expect(x.shopName).toBeTruthy();
      // the shop to pin (shopPins) when the user picks this mall
      expect(x.shopId).toBeTruthy();
      expect(x.shopsWithItem).toBeGreaterThanOrEqual(1);
      expect(x.shopsWithItem!).toBeLessThanOrEqual(m.shopCount);
    }
    for (const x of m.items.filter((y) => !y.covered)) {
      expect(x.unitPrice).toBeUndefined();
      expect(x.shopId).toBeUndefined();
    }
    // coverage first, then the total
    const next = p.malls[i + 1];
    if (next) {
      expect(m.covered).toBeGreaterThanOrEqual(next.covered);
      if (m.covered === next.covered) expect(m.totalToman ?? 0).toBeLessThanOrEqual(next.totalToman ?? 0);
    }
    expect(m.badges.includes('one_stop')).toBe(m.total >= 2 && m.covered === m.total);
    expect(m.badges.includes('open_now')).toBe(m.open === 'open');
  }
  expect(p.malls.filter((m) => m.badges.includes('cheapest')).length).toBeLessThanOrEqual(1);
  expect(p.malls.filter((m) => m.badges.includes('most_choice')).length).toBeLessThanOrEqual(1);
  const top = p.malls[0];
  expect(p.bestId).toBe(top && top.covered >= 2 ? top.id : null);
  if (p.bestId) expect(p.headline!).toMatch(PERSIAN_DIGIT);
}
