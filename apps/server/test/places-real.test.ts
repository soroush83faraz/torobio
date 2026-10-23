/**
 * POST /api/places and the additive image / coordinate fields on the REAL market.sqlite, with /api/parse output
 * fed verbatim into the state (as the web app does). Skipped when the file is absent; point DATABASE_PATH at it:
 *   DATABASE_PATH=/path/to/data/market.sqlite npx vitest run apps/server/test/places-real.test.ts
 * Assertions are structure and honesty rules, never specific prices or mall names.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { parseToState, plan, post, resolve, type App } from './contract-helpers.js';
import { expectPlacesInvariants } from './places-helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30'); // Wednesday

const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';
/** Tehran's bazaar belt, generously. */
const inTehran = (lat: number, lon: number) => lat > 35.5 && lat < 35.9 && lon > 51.2 && lon < 51.7;

let app: App;
const places = (state: Api.RequirementStateInput) => post<Api.PlacesResponse>(app, '/api/places', { state });

describe.skipIf(!HAS_DB)('places-real: POST /api/places on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('CCTV list: buildings that hold several items, with images and coordinates, before any question is answered', async () => {
    const { parsed, state } = await parseToState(app, CCTV);
    expect(parsed.items.map((i) => i.kind)).toEqual(['camera', 'recorder', 'hdd', 'adapter']);
    // the recorder still waits on its compat question: places evaluates it with the default pick rule
    const r = await resolve(app, state);
    expect(r.items.some((i) => i.state === 'needs_info')).toBe(true);

    const t0 = performance.now();
    const p = await places(state);
    const ms = performance.now() - t0;
    expectPlacesInvariants(p);
    expect(p.malls.length).toBeGreaterThanOrEqual(1);
    expect(p.malls.length).toBeLessThanOrEqual(8);
    expect(p.malls.some((m) => m.covered > 1)).toBe(true);
    const top = p.malls[0]!;
    expect(top.total).toBe(4);
    expect(top.covered).toBeGreaterThan(1);
    expect(p.bestId).toBe(top.id);
    expect(p.headline).toContain(top.covered === top.total ? 'همهٔ ۴ مورد' : `از ۴ مورد`);
    for (const m of p.malls) {
      expect(inTehran(m.lat, m.lon), `${m.id} ${m.lat},${m.lon}`).toBe(true);
      expect(m.floors.length).toBeLessThanOrEqual(m.shopCount);
    }
    const covered = p.malls.flatMap((m) => m.items.filter((i) => i.covered));
    expect(covered.length).toBeGreaterThan(0);
    // nearly every product in the snapshot has an image (224 684 of 225 903)
    expect(covered.filter((i) => i.imageUrl).length / covered.length).toBeGreaterThan(0.9);
    for (const i of covered) if (i.imageUrl) expect(i.imageUrl).toMatch(/^https:\/\//);
    // generous bound: the first call also warms the category pools
    expect(ms).toBeLessThan(15_000);
  });

  it('plan and resolve carry product images and stop / shop coordinates', async () => {
    const { state } = await parseToState(app, CCTV);
    const p = await plan(app, state);
    expect(p.stops.length).toBeGreaterThan(0);
    for (const st of p.stops) {
      expect(inTehran(st.lat!, st.lon!)).toBe(true);
      for (const sh of st.shops!) expect(inTehran(sh.lat!, sh.lon!)).toBe(true);
      for (const l of st.lines) expect(l.imageUrl).toMatch(/^https:\/\//);
    }
    const r = await resolve(app, state);
    for (const i of r.items) if (i.product) expect(i.product.imageUrl).toMatch(/^https:\/\//);
  });

  it('a phone with its accessories: the response keeps every invariant', async () => {
    const { state } = await parseToState(app, 'گوشی سامسونگ A56، قاب و گلس');
    const p = await places(state);
    expectPlacesInvariants(p);
    expect(p.malls.length).toBeGreaterThan(0);
  });
});
