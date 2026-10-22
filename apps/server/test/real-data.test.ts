/**
 * 'real-data' suite: the decision API on the real market.sqlite (read-only).
 * Skipped when the file is absent. Point DATABASE_PATH at it, e.g.
 *   DATABASE_PATH=/path/to/data/market.sqlite npx vitest run apps/server/test/real-data.test.ts
 * Assertions are about honesty rules and structure, not about specific prices (the snapshot can change).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { chip, cctvJob, item, state } from './scenarios.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30'); // Wednesday

type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;
const cat: Record<string, number> = {};

function catId(name: string): number {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number } | undefined;
    if (!row) throw new Error(`category not found: ${name}`);
    return row.id;
  } finally {
    db.close();
  }
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object });
  if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 300)}`);
  return (res.json() as { data: T }).data;
}
const resolve = (s: Api.RequirementState) => post<Api.ResolveResponse>('/api/resolve', { state: s });
const plan = (s: Api.RequirementState) => post<Api.PlanResponse>('/api/plan', { state: s });
const options = (s: Api.RequirementState, itemId: string) => post<Api.OptionsResponse>('/api/options', { state: s, itemId });
const byId = (r: { items: Api.ItemResolution[] }, id: string) => r.items.find((i) => i.itemId === id)!;
const lines = (p: Api.PlanResponse) => p.stops.flatMap((s) => s.lines);

const ANALOG = 'c~in~recorder_kind~["xvr","dvr"]';

describe.skipIf(!HAS_DB)('real-data: decision API on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
    Object.assign(cat, {
      camera: catId('دوربین مدار بسته'),
      recorder: catId('ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی'),
      hdd: catId('هارد دیسک اینترنال'),
      adapter: catId('آداپتور برق'),
      wire: catId('سیم و کابل برق ساختمان'),
      phone: catId('گوشی موبایل'),
      phoneCase: catId('کیف و کاور گوشی'),
      protector: catId('محافظ صفحه نمایش گوشی'),
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  const job = () => cctvJob({ camera: cat.camera!, recorder: cat.recorder!, hdd: cat.hdd!, adapter: cat.adapter! });
  const answered = () => {
    const s = job();
    s.answers = { rec: { recorder_kind: ANALOG } };
    return s;
  };

  it('CCTV: suggestions are never exact; the recorder asks the compat question first', async () => {
    const r = await resolve(job());
    for (const i of r.items) {
      expect(i.state).not.toBe('exact');
      if (i.state === 'suggested') {
        expect(i.label).toBe('پیشنهاد');
        expect(i.rule).toMatch(/ارزان‌ترین مطابق خواسته/);
        expect(i.eligibleCount).toBeGreaterThan(0);
      }
    }
    expect(byId(r, 'cam').state).toBe('suggested');
    expect(byId(r, 'rec')).toMatchObject({ state: 'needs_info', question: { id: 'recorder_kind', kind: 'compat' } });
    expect(byId(r, 'rec').product).toBeUndefined();
  });

  it('CCTV: answered job plans every item; totals add up; compat never claims certainty it lacks', async () => {
    const r = await resolve(answered());
    expect(r.items.map((i) => i.state)).toEqual(['suggested', 'suggested', 'suggested', 'suggested']);
    const p = await plan(answered());
    expect(p.coverage).toMatchObject({ covered: 4, total: 4 });
    expect(p.complete).toBe(true);
    expect(p.totalLine).toMatch(/^جمع ۴ مورد/);
    expect(lines(p).reduce((a, l) => a + (l.lineTotal ?? 0), 0)).toBe(p.totalToman);
    expect(lines(p).find((l) => l.itemId === 'cam')?.qty).toBe(4);
    for (const c of p.compat) {
      // every item is an automatic suggestion and the total is complete: a conflict here is never acceptable
      expect(['stated', 'assumed', 'unknown']).toContain(c.level);
      if (c.level !== 'stated') expect(c.askSeller).toBeTruthy();
    }
    // general rules are never «stated»; the channel count is read from the recorder listing (4 >= 4)
    for (const id of ['camera_recorder_signal', 'recorder_hdd_internal', 'camera_adapter_12v'])
      expect(p.compat.filter((c) => c.ruleId === id).every((c) => c.level !== 'stated')).toBe(true);
    expect(p.compat.find((c) => c.ruleId === 'recorder_channels')?.level).toBe('stated');
    // the drive's surveillance line is «stated» only when the chosen listing says so
    const hdd = lines(p).find((l) => l.itemId === 'hdd')!;
    const surv = p.compat.find((c) => c.ruleId === 'hdd_surveillance')!;
    if (surv.level === 'stated') expect(`${hdd.productName} ${hdd.listingTitle}`).toMatch(/بنفش|purple|skyhawk|سورویلنس|surveillance|مخصوص/i);
    for (const s of p.stops) expect(['open', 'closed', 'unknown']).toContain(s.open);
    console.log('[real-data] CCTV plan:', JSON.stringify({ states: r.items.map((i) => [i.itemId, i.state, i.eligibleCount]), total: p.totalToman, stops: p.stopCount, totalLine: p.totalLine, compat: p.compat.map((c) => [c.ruleId, c.level]) }));
  });

  it('electrical: 2.5 mm² wire needs its sale unit before any price; sockets and floodlight resolve', async () => {
    const s = state([
      item('w', '۵۰ متر سیم برق ۲.۵', { qty: 50, unit: 'متر', categoryIds: [cat.wire!], chips: [chip('s', '۲٫۵', { attr: 'wire_section_mm2', op: 'eq', value: 2.5 })] }),
      item('p', 'پریز برق'),
      item('f', 'پروژکتور ۵۰ وات'),
    ]);
    s.settled = { w: true };
    const r = await resolve(s);
    const w = byId(r, 'w');
    expect(w.state).toBe('needs_info');
    expect(w.question).toMatchObject({ id: 'sale_unit', kind: 'unit', skippable: false });
    expect(w.question!.options.some((o) => o.id === 'any')).toBe(false);
    expect(w.rangeLow).toBeUndefined();
    expect(byId(r, 'p').state).not.toBe('not_found');
    expect(byId(r, 'f').state).not.toBe('not_found');
    const p0 = await plan(s);
    expect(lines(p0).some((l) => l.itemId === 'w')).toBe(false);

    s.answers = { w: { sale_unit: 'c~eq~sale_unit~"roll"' } };
    const roll = byId(await resolve(s), 'w');
    expect(roll).toMatchObject({ state: 'suggested', unitLabel: 'حلقهٔ ۱۰۰ متری', saleUnit: 'roll' });
    const line = lines(await plan(s)).find((l) => l.itemId === 'w')!;
    expect(line).toMatchObject({ qty: 1, unitLabel: 'حلقهٔ ۱۰۰ متری' });

    s.answers = { w: { sale_unit: 'c~eq~sale_unit~"meter"' } };
    const mline = lines(await plan(s)).find((l) => l.itemId === 'w')!;
    expect(mline).toMatchObject({ qty: 50, unitLabel: 'قیمت هر متر' });
    expect(mline.lineTotal).toBe(mline.unitPrice! * 50);
  });

  it('phone A56 + case + protector: model inherited, conflicts excluded with reasons', async () => {
    const s = state([
      item('ph', 'گوشی سامسونگ A56', { categoryIds: [cat.phone!], chips: [chip('m', 'Galaxy A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56' })] }),
      item('cs', 'قاب گوشی', { categoryIds: [cat.phoneCase!] }),
      item('gl', 'گلس', { categoryIds: [cat.protector!] }),
    ]);
    const r0 = await resolve(s);
    console.log('[real-data] phone states:', JSON.stringify(r0.items.map((i) => [i.itemId, i.state, i.eligibleCount, i.question?.id, i.product?.name])));
    // a loose «قاب گوشی» with many fitting cases may ask one discriminating question, never a compat one
    for (const id of ['cs', 'gl']) {
      const it = byId(r0, id);
      expect(['suggested', 'needs_info']).toContain(it.state);
      if (it.state === 'needs_info') expect(it.question?.kind).not.toBe('compat');
    }
    s.settled = { cs: true, gl: true };
    const r = await resolve(s);
    for (const id of ['ph', 'cs', 'gl']) expect(byId(r, id).state).toBe('suggested');
    expect(byId(r, 'cs').derivedChips?.[0]?.constraint).toMatchObject({ attr: 'fits_models', op: 'contains', value: 'galaxy a56' });
    const p = await plan(s);
    expect(p.compat.filter((c) => c.ruleId === 'phone_accessory_fit').map((c) => c.level)).toEqual(['stated', 'stated']);
    const o = await options(s, 'cs');
    const conflicts = o.models.filter((m) => m.fit === 'differs');
    expect(conflicts.length).toBeGreaterThan(0);
    for (const m of conflicts) expect(m.conflict).toBeTruthy();
    expect(o.onlyOneSeller).toBe(o.sellers.length === 1);
  });

  it('a missing item is not_found with real categories while the rest is still planned; laptops ARE in the data', async () => {
    const s = job();
    s.answers = { rec: { recorder_kind: ANALOG } };
    s.requirements.push(item('x', 'قایق موتوری'));
    const r = await resolve(s);
    expect(byId(r, 'x')).toMatchObject({ state: 'not_found', reason: '«قایق موتوری» در فهرست این بازار پیدا نشد.' });
    expect(byId(r, 'x').nearbyCategories!.length).toBeGreaterThan(0);
    const p = await plan(s);
    expect(p.coverage).toMatchObject({ covered: 4, total: 5 });
    expect(p.totalLine).toMatch(/^فقط ۴ از ۵ مورد/);
    // finding: the dataset has laptops (category «لپ تاپ و نوت بوک»), so «لپ‌تاپ ایسوس» is NOT a miss
    const lap = byId(await resolve(state([item('l', 'لپ تاپ ایسوس')])), 'l');
    expect(lap.state).not.toBe('not_found');
  });

  it('Friday 13:00 and Saturday 19:30: closed shops never planned, unknown hours kept', async () => {
    const base = await plan(answered());
    for (const visit of [
      { day: 'date', date: '2026-10-23', window: 'exact', time: '13:00' },
      { day: 'date', date: '2026-10-24', window: 'exact', time: '19:30' },
    ] as const) {
      const s = answered();
      s.visit = { ...visit };
      const p = await plan(s);
      expect(p.visitActive).toBe(true);
      for (const st of p.stops) expect(st.open).not.toBe('closed');
      const baseShops = new Set(base.stops.map((x) => x.shopId));
      const changed = p.stops.some((x) => !baseShops.has(x.shopId)) || p.stops.length !== base.stops.length;
      if (changed && p.coverage.covered === base.coverage.covered) expect(p.totalToman).toBeGreaterThanOrEqual(base.totalToman);
      console.log(`[real-data] visit ${visit.date} ${visit.time}:`, JSON.stringify({ covered: p.coverage.covered, total: p.totalToman, stops: p.stops.map((x) => [x.shopName, x.open]), closedNotes: p.closedNotes.length }));
    }
  });

  it('latency over 200 calls each (resolve, plan) stays interactive', async () => {
    const states = [job(), answered()];
    const time = async (url: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t = performance.now();
        await post(url, { state: states[i % states.length] });
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!;
      return { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +ms[ms.length - 1]!.toFixed(1) };
    };
    const r = await time('/api/resolve');
    const p = await time('/api/plan');
    console.log('[real-data] latency ms', JSON.stringify({ resolve: r, plan: p }));
    expect(r.p95).toBeLessThan(250);
    expect(p.p95).toBeLessThan(400);
  }, 120_000);
});
