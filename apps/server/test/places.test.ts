/**
 * POST /api/places («کجا بروم») and the additive image / coordinate fields, through buildApp().inject on the
 * hand-made fixture market. Runs everywhere (no real dataset needed). Clock: Wednesday 2026-10-21 10:00 Tehran.
 */
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureMarket, CAT, fixtureImage, SHOPS } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { expectPlacesInvariants } from './places-helpers.js';
import { cctvJob, chip, item, state } from './scenarios.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;

beforeAll(async () => {
  app = (await makeApp({ databasePath: buildFixtureMarket(path.join(tmpDir(), 'm.sqlite')) }, { now: () => NOW })).app;
});
afterAll(async () => {
  await app.close();
  cleanupTmp();
});

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object });
  if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body}`);
  return (res.json() as { data: T }).data;
}
const places = (s: Api.RequirementState) => post<Api.PlacesResponse>('/api/places', { state: s });
const job = () => cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
const IMG = /^https:\/\/image\.torob\.com\/fixture\/\d+\.jpg$/;

describe('POST /api/places', () => {
  it('ranks the one building that has the whole CCTV list first, before its question is answered', async () => {
    const p = await places(job());
    expectPlacesInvariants(p);
    const top = p.malls[0]!;
    // mall B: camera 1 450 000 ×4, XVR 5 500 000 (the recorder's default pick rule), WD 3 500 000, adapter 240 000
    expect(top).toMatchObject({ id: 'm:ب', name: 'پاساژ ب', covered: 4, total: 4, totalToman: 15_040_000, shopCount: 1, open: 'open' });
    expect(top.badges).toEqual(['one_stop', 'cheapest', 'open_now']);
    expect(top.floors).toEqual(['طبقهٔ منفی ۱']);
    expect(top.lat).toBeCloseTo(35.692, 6);
    expect(top.lon).toBeCloseTo(51.421, 6);
    const rec = top.items.find((i) => i.itemId === 'rec')!;
    expect(rec).toMatchObject({ covered: true, unitPrice: 5_500_000, qty: 1, shopName: 'فروشگاه ب', floor: 'طبقهٔ منفی ۱', unit: 'واحد ⁦A4⁩', shopsWithItem: 1 });
    expect(top.items.find((i) => i.itemId === 'cam')).toMatchObject({ unitPrice: 1_450_000, qty: 4, imageUrl: fixtureImage(1) });
    for (const i of top.items) expect(i.imageUrl).toMatch(IMG);
    expect(p.bestId).toBe('m:ب');
    expect(p.headline).toBe('همهٔ ۴ مورد در پاساژ ب هست (جمع ۱۵ میلیون تومان).');
    // mall A also has everything (dearer); the street shop has no 12 V adapter, and its only 4-channel recorder is
    // an NVR, which cannot run the analog (AHD) camera bought there: the compat guard leaves it uncovered
    const a = p.malls.find((m) => m.id === 'm:الف')!;
    expect(a).toMatchObject({ covered: 4, totalToman: 15_550_000, shopCount: 1 });
    expect(a.badges).toContain('one_stop');
    const street = p.malls.find((m) => m.id === 'c:35.7,51.43')!;
    expect(street).toMatchObject({ name: 'فروشگاه خیابانی', areaLabel: 'بازار', covered: 2 });
    expect(street.items.find((i) => i.itemId === 'cam')).toMatchObject({ covered: true, imageUrl: fixtureImage(6) });
    expect(street.items.find((i) => i.itemId === 'rec')).toEqual({ itemId: 'rec', itemName: 'ضبط‌کننده ۴ کانال', covered: false });
    expect(street.items.find((i) => i.itemId === 'adp')).toEqual({ itemId: 'adp', itemName: 'آداپتور ۱۲ ولت', covered: false });
  });

  it('leaves out shops closed at the visit time and excluded shops, like the planner', async () => {
    // Friday 2026-10-23: shop_a1 and shop_b1 are closed (shop_a2 has no hours, so it is never closed)
    const friday = await places({ ...job(), visit: { day: 'date', date: '2026-10-23', window: 'any' } });
    expectPlacesInvariants(friday);
    expect(friday.malls.map((m) => m.id)).not.toContain('m:ب');
    expect(friday.malls[0]!.id).toBe('c:35.7,51.43');
    const without = await places({ ...job(), excludedShops: { '*': [SHOPS.b1] } });
    expectPlacesInvariants(without);
    expect(without.malls.map((m) => m.id)).not.toContain('m:ب');
    expect(without.bestId).toBe('m:الف');
  });

  it('says so when no building has two items, and when nothing is priced', async () => {
    const one = await places(state([item('ph', 'گوشی سامسونگ A56', { categoryIds: [CAT.phone], chips: [chip('m', 'A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56 5g' })] })]));
    expectPlacesInvariants(one);
    expect(one.bestId).toBeNull();
    expect(one.malls.map((m) => [m.id, m.covered])).toEqual([['m:د', 1], ['c:35.7,51.43', 1]]);
    expect(one.headline).toBe('این مورد در ۲ جا پیدا شد؛ ارزان‌ترین در پاساژ د.');
    const none = await places(state([item('x', 'پروژکتور خورشیدی ۲۰۰ وات', { categoryIds: [CAT.flood], chips: [chip('w', '۲۰۰ وات', { attr: 'power_w', op: 'eq', value: 200 })] })]));
    expect(none).toEqual({ malls: [], bestId: null, headline: 'هنوز هیچ موردی قیمت و فروشنده ندارد؛ جایی برای پیشنهاد نیست.' });
  });

  it('validates like /api/plan', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/places', payload: { state: { requirements: 'x' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: { code: 'BAD_REQUEST', messageFa: expect.any(String) } });
    const res = await app.inject({ method: 'POST', url: '/api/places', payload: { state: job() } });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('additive images and coordinates', () => {
  it('fills imageUrl on item products, model options and stop lines, and lat/lon on stops and their shops', async () => {
    const s = job();
    s.answers = { rec: { recorder_kind: 'c~in~recorder_kind~["xvr","dvr"]' } };
    const p = await post<Api.PlanResponse>('/api/plan', { state: s });
    expect(p.stops.length).toBeGreaterThan(0);
    for (const st of p.stops) {
      for (const sh of st.shops!) {
        expect(typeof sh.lat).toBe('number');
        expect(typeof sh.lon).toBe('number');
      }
      expect(st.lat).toBeCloseTo(st.shops!.reduce((n, x) => n + x.lat!, 0) / st.shops!.length, 9);
      expect(st.lon).toBeCloseTo(st.shops!.reduce((n, x) => n + x.lon!, 0) / st.shops!.length, 9);
      for (const l of st.lines) expect(l.imageUrl).toBe(fixtureImage(Number(l.productId)));
    }
    for (const i of p.items ?? []) if (i.product) expect(i.product.imageUrl).toBe(fixtureImage(Number(i.product.id)));
    const r = await post<Api.ResolveResponse>('/api/resolve', { state: s });
    expect(r.items.find((i) => i.itemId === 'cam')!.product!.imageUrl).toBe(fixtureImage(1));
    const o = await post<Api.OptionsResponse>('/api/options', { state: s, itemId: 'cam' });
    for (const m of o.models) expect(m.imageUrl).toBe(fixtureImage(Number(m.productId)));
  });
});
