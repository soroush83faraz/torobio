/**
 * G1a on the hand-made fixture market (runs everywhere):
 * - the assumed 12 V adapter rule is structural and asked as a compat-critical question;
 * - the plan's compatibility guard: a conflict never stands next to an automatic pick (replace, else leave out);
 * - noMatch: an item with nothing eligible says why, what to lift and the nearest products, and picks nothing;
 * - the missing line names its groups («پیدا نشد» / «منتظر انتخاب» / «قیمت ثبت نشده»).
 */
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureMarket, CAT, SHOPS } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { chip, cctvJob, item, state } from './scenarios.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;

beforeAll(async () => {
  const dir = tmpDir();
  app = (await makeApp({ databasePath: buildFixtureMarket(path.join(dir, 'm.sqlite')), rateLimit: 1_000_000 }, { now: () => NOW })).app;
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
const resolve = (s: Api.RequirementState) => post<Api.ResolveResponse>('/api/resolve', { state: s });
const plan = (s: Api.RequirementState) => post<Api.PlanResponse>('/api/plan', { state: s });
const options = (s: Api.RequirementState, itemId: string) => post<Api.OptionsResponse>('/api/options', { state: s, itemId });
const byId = (r: { items: Api.ItemResolution[] }, id: string) => r.items.find((i) => i.itemId === id)!;
const lineOf = (p: Api.PlanResponse, id: string) => p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id);
const ANALOG = 'c~in~recorder_kind~["xvr","dvr"]';

/** The CCTV job with a bare «آداپتور» (no voltage stated). */
function bareAdapterJob(): Api.RequirementState {
  const s = cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
  s.requirements[3] = item('adp', 'آداپتور', { categoryIds: [CAT.adapter] });
  s.answers = { rec: { recorder_kind: ANALOG } };
  return s;
}

/**
 * The invariant: every conflict line involves something the user pinned (their explicit choice); an automatic
 * pick never stands next to a conflict, and a complete total never hides one the engine caused.
 */
function expectNoAutoConflict(p: Api.PlanResponse, s: Api.RequirementState): void {
  for (const c of p.compat.filter((x) => x.level === 'conflict')) {
    expect(c.itemIds.some((id) => s.pins[id] !== undefined), `conflict without a pin: ${c.text}`).toBe(true);
  }
}

describe('12 V adapter next to cameras: an assumption, asked, never a silent wrong pick', () => {
  it('the voltage is asked first (12 V offered as the usual camera voltage); the adapter is not counted meanwhile', async () => {
    const s = bareAdapterJob();
    const r = await resolve(s);
    const adp = byId(r, 'adp');
    expect(adp).toMatchObject({ state: 'needs_info', question: { id: 'voltage_v', kind: 'compat', skippable: true } });
    expect(adp.product).toBeUndefined();
    expect(adp.question!.options[0]).toMatchObject({ id: 'c~eq~voltage_v~12', label: '۱۲ ولت (معمول برای دوربین)' });
    expect(adp.question!.why).toContain('فرض عمومی');
    expect(adp.question!.prompt).toContain('فرض عمومی');
    const p = await plan(s);
    expect(p.complete).toBe(false);
    expect(p.missingLine).toBe('منتظر انتخاب: آداپتور');
    expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
  });

  it('«کافیه، پیشنهاد بده» keeps the assumption: the cheapest 12 V adapter, never the cheaper 5 V one', async () => {
    const s = bareAdapterJob();
    s.settled = { adp: true };
    const r = await resolve(s);
    const adp = byId(r, 'adp');
    expect(adp.state).toBe('suggested');
    expect(['30', '31']).toContain(adp.product?.id); // a 12 V listing; never 32 (5 V, cheapest)
    expect(adp.derivedChips?.[0]?.label).toContain('فرض عمومی');
    const p = await plan(s);
    expect(p.complete).toBe(true);
    expect(lineOf(p, 'adp')?.productId).not.toBe('32');
    expect(p.compat.find((c) => c.ruleId === 'camera_adapter_12v')).toMatchObject({ level: 'assumed' });
    expectNoAutoConflict(p, s);
    // the 5 V adapter stays visible, with the reason worded as an assumption
    const o = await options(s, 'adp');
    const five = o.models.find((m) => m.productId === '32')!;
    expect(five.fit).toBe('differs');
    expect(five.conflict).toContain('فرض عمومی');
  });

  it('the user can lift it: choosing 5 V or «فرقی نمی‌کند» is never reported as a conflict', async () => {
    const s = bareAdapterJob();
    s.answers = { ...s.answers, adp: { voltage_v: 'c~eq~voltage_v~5' } };
    let p = await plan(s);
    expect(byId({ items: p.items! }, 'adp')).toMatchObject({ state: 'suggested', product: { id: '32' } });
    expect(p.compat.find((c) => c.ruleId === 'camera_adapter_12v')).toMatchObject({ level: 'unknown' });
    expect(p.compat.find((c) => c.ruleId === 'camera_adapter_12v')!.text).toContain('خودت خواستی');
    s.answers = { ...s.answers, adp: { voltage_v: 'any' } };
    p = await plan(s);
    expect(byId({ items: p.items! }, 'adp')).toMatchObject({ state: 'suggested', product: { id: '32' } });
    expect(p.compat.find((c) => c.ruleId === 'camera_adapter_12v')).toMatchObject({ level: 'unknown' });
    expectNoAutoConflict(p, s);
  });
});

describe('plan guard: a conflict never stands next to an automatic pick', () => {
  it('a pinned NVR: the automatically picked camera follows it (IP), resolve and plan agree', async () => {
    const s = cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
    s.pins = { rec: '11' };
    const p = await plan(s);
    expect(lineOf(p, 'cam')?.productId).toBe('2');
    expect(p.compat.find((c) => c.ruleId === 'camera_recorder_signal')?.level).toBe('assumed');
    expectNoAutoConflict(p, s);
    const cam = byId(await resolve(s), 'cam');
    expect(cam.product?.id).toBe('2');
    expect(cam.derivedChips?.some((c) => c.label.includes('برای جور شدن با'))).toBe(true);
    // the HDCVI camera that would have conflicted stays in the options, with the reason
    const o = await options(s, 'cam');
    expect(o.models.find((m) => m.productId === '1')).toMatchObject({ fit: 'differs' });
  });

  it('shop exclusions that would force an NVR next to the analog camera leave the recorder out instead', async () => {
    const s = cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
    s.settled = { rec: true }; // the camera-type question is skipped: any readable kind may be picked
    s.excludedShops = { rec: [SHOPS.a1, SHOPS.b1] }; // only the NVR (shop c1) would be left for the recorder
    const p = await plan(s);
    expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
    expect(lineOf(p, 'rec')?.productId).not.toBe('11');
    expect(p.complete).toBe(false);
    expect(p.coverage.missing.map((m) => m.itemId)).toContain('rec');
    for (const alt of p.alternatives) expect(alt.id).toMatch(/^stops:/);
  });

  it('a pinned A57 case next to a phone stated as A56: the conflict stays visible and the phone is kept', async () => {
    const s = state(
      [
        item('ph', 'گوشی سامسونگ A56', { categoryIds: [CAT.phone], chips: [chip('m', 'A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56' })] }),
        item('cs', 'قاب', { categoryIds: [CAT.phoneCase] }),
      ],
      { pins: { cs: '61' } },
    );
    const p = await plan(s);
    expect(p.compat.find((c) => c.ruleId === 'phone_accessory_fit')?.level).toBe('conflict');
    expect(byId({ items: p.items! }, 'ph')).toMatchObject({ state: 'suggested', product: { id: '50' } });
    expectNoAutoConflict(p, s);
  });

  it('property: 120 seeded random CCTV / phone states never show a conflict the engine caused', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pickOne = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const shopIds = Object.values(SHOPS);
    for (let n = 0; n < 120; n++) {
      const cctv = rnd() < 0.7;
      const s = cctv
        ? bareAdapterJob()
        : state([
            item('ph', 'گوشی سامسونگ', { categoryIds: [CAT.phone], chips: [chip('b', 'سامسونگ', { attr: 'brand', op: 'eq', value: 'samsung' })] }),
            item('cs', 'قاب', { categoryIds: [CAT.phoneCase] }),
            item('gl', 'گلس', { categoryIds: [CAT.protector] }),
          ]);
      const ids = s.requirements.map((r) => r.id);
      if (cctv && rnd() < 0.5) s.answers = {};
      for (const id of ids) if (rnd() < 0.5) s.settled[id] = true;
      if (cctv && rnd() < 0.3) s.answers.adp = { voltage_v: pickOne(['any', 'c~eq~voltage_v~5', 'c~eq~voltage_v~12']) };
      if (rnd() < 0.3) s.pins[pickOne(ids)] = pickOne(cctv ? ['1', '2', '10', '11', '12', '30', '32'] : ['50', '51', '60', '61', '70', '71']);
      for (const id of ids) if (rnd() < 0.25) s.excludedShops[id] = [pickOne(shopIds), pickOne(shopIds)];
      if (rnd() < 0.3) s.variant = 'fewest';
      if (rnd() < 0.2) s.visit = { day: 'date', date: '2026-10-23', window: 'exact', time: '13:00' }; // a Friday
      const p = await plan(s);
      expectNoAutoConflict(p, s);
      // /api/resolve shows the same picks as the plan's item cards
      const r = await resolve(s);
      for (const it of r.items) expect(it.product?.id).toBe(byId({ items: p.items! }, it.itemId).product?.id);
      if (p.complete) for (const c of p.compat) if (c.level === 'conflict') expect(c.itemIds.some((id) => s.pins[id])).toBe(true);
    }
  });
});

describe('noMatch: nothing eligible is not a dead end', () => {
  const a56Under = (max: number) =>
    state([
      item('ph', 'گوشی سامسونگ A56', {
        categoryIds: [CAT.phone],
        chips: [chip('m', 'A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56' })],
        budget: { max },
      }),
    ]);

  it('A56 under 30 M: the reason names the cheapest A56; budget is the first thing to lift; nothing is picked', async () => {
    const r = await resolve(a56Under(30_000_000));
    const ph = byId(r, 'ph');
    expect(ph.state).toBe('alternative');
    expect(ph.product).toBeUndefined();
    expect(ph.noMatch).toBeDefined();
    expect(ph.noMatch!.reasonFa).toBe('هیچ مدلی با بودجهٔ ۳۰ میلیون پیدا نشد؛ ارزان‌ترین مدل ۳۹ میلیون تومان است');
    expect(ph.noMatch!.relax[0]).toEqual({ attr: 'budget', label: 'بودجه را بردار' });
    expect(ph.noMatch!.closest[0]).toMatchObject({ productId: '50', fit: 'differs', current: false });
    expect(ph.noMatch!.closest[0]!.conflict).toContain('بیرون از بودجه');
    expect(ph.noMatch!.closest.length).toBeLessThanOrEqual(3);
    const p = await plan(a56Under(30_000_000));
    expect(p.stops).toEqual([]);
    expect(byId({ items: p.items! }, 'ph').noMatch?.reasonFa).toBe(ph.noMatch!.reasonFa);
  });

  it('absent when something matches', async () => {
    expect(byId(await resolve(a56Under(60_000_000)), 'ph').noMatch).toBeUndefined();
  });
});

describe('missing line wording', () => {
  it('not-found items are «پیدا نشد», items waiting for a choice «منتظر انتخاب», unpriced ones «قیمت ثبت نشده»', async () => {
    const s = state([
      item('x', 'زیردریایی اتمی'),
      item('w', 'سیم ۲.۵', { categoryIds: [CAT.wire], chips: [chip('s', '۲٫۵', { attr: 'wire_section_mm2', op: 'eq', value: 2.5 })] }),
      item('f', 'پروژکتور خورشیدی ۲۰۰ وات', { categoryIds: [CAT.flood] }),
      item('p', 'پریز برق', { categoryIds: [CAT.socket] }),
    ]);
    s.pins = { f: '93' };
    s.settled = { p: true };
    const p = await plan(s);
    expect(p.missingLine).toBe('پیدا نشد: زیردریایی اتمی · منتظر انتخاب: سیم ۲.۵ · قیمت ثبت نشده: پروژکتور خورشیدی ۲۰۰ وات');
    // wire before its unit: no price range at all in the item line
    const w = byId({ items: p.items! }, 'w');
    expect(w.reason).not.toMatch(/ تا .*تومان/);
    expect(w.rangeLow).toBeUndefined();
  });
});
