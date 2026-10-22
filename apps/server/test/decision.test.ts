/**
 * Decision API (resolve / plan / options) through buildApp().inject on the hand-made fixture market.
 * Runs everywhere (no real dataset needed). Clock: Wednesday 2026-10-21 10:00 Tehran.
 */
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADVERSARIAL_SELLER_TITLE, ADVERSARIAL_TITLE, BENIGN_TITLE, buildFixtureMarket, CAT, SHOPS } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { chip, cctvJob, item, state } from './scenarios.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;
let benignApp: App;

beforeAll(async () => {
  const dir = tmpDir();
  app = (await makeApp({ databasePath: buildFixtureMarket(path.join(dir, 'm.sqlite')) }, { now: () => NOW })).app;
  benignApp = (await makeApp({ databasePath: buildFixtureMarket(path.join(dir, 'b.sqlite'), { benign: true }) }, { now: () => NOW })).app;
});
afterAll(async () => {
  await app.close();
  await benignApp.close();
  cleanupTmp();
});

async function post<T>(url: string, payload: unknown, a: App = app): Promise<T> {
  const res = await a.inject({ method: 'POST', url, payload: payload as object });
  if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body}`);
  return (res.json() as { data: T }).data;
}
const resolve = (s: Api.RequirementState, a?: App) => post<Api.ResolveResponse>('/api/resolve', { state: s }, a);
const plan = (s: Api.RequirementState, a?: App) => post<Api.PlanResponse>('/api/plan', { state: s }, a);
const options = (s: Api.RequirementState, itemId: string, productId?: string) =>
  post<Api.OptionsResponse>('/api/options', productId ? { state: s, itemId, productId } : { state: s, itemId });
const byId = (r: { items: Api.ItemResolution[] }, id: string) => r.items.find((i) => i.itemId === id)!;

const job = () => cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
/** The job after answering the compat question «آنالوگ». */
function answeredJob(): Api.RequirementState {
  const s = job();
  s.answers = { rec: { recorder_kind: 'c~in~recorder_kind~["xvr","dvr"]' } };
  return s;
}

describe('CCTV job (4 Dahua 2MP cameras, 4ch recorder, 2TB HDD, 12V adapter)', () => {
  it('resolves item states honestly and asks the compat-critical question first', async () => {
    const r = await resolve(job());
    const cam = byId(r, 'cam');
    expect(cam.state).toBe('suggested');
    expect(cam.label).toBe('پیشنهاد');
    expect(cam.product?.id).toBe('1'); // cheapest eligible; the cheaper camera without a readable MP (5) is not picked
    expect(cam.eligibleCount).toBe(3);
    expect(cam.incompleteSpecsCount).toBe(1);
    expect(cam.rule).toBe('ارزان‌ترین مطابق خواسته');
    const rec = byId(r, 'rec');
    expect(rec.state).toBe('needs_info');
    expect(rec.question?.kind).toBe('compat');
    expect(rec.question?.id).toBe('recorder_kind');
    expect(rec.question?.options.map((o) => o.id)).toEqual(['c~in~recorder_kind~["xvr","dvr"]', 'c~in~recorder_kind~["nvr"]', 'any']);
    expect(rec.product).toBeUndefined();
    expect(byId(r, 'hdd').state).toBe('suggested');
    expect(byId(r, 'adp').state).toBe('suggested');
    expect(byId(r, 'adp').product?.id).toBe('30'); // the adjustable adapter has no single voltage: never picked
    expect(r.pendingItemCount).toBe(1);
  });

  it('never labels a suggestion as an exact model; exact only for a typed code or a pin', async () => {
    const r = await resolve(answeredJob());
    for (const i of r.items) {
      if (i.state === 'suggested') expect(i.label).toBe('پیشنهاد');
      expect(i.state).not.toBe('exact');
    }
    const typed = answeredJob();
    typed.requirements[1]!.modelCode = 'XVR1B04-I';
    typed.pins = { hdd: '22' };
    const t = await resolve(typed);
    expect(byId(t, 'rec')).toMatchObject({ state: 'exact', label: 'مدل مشخص', product: { id: '10' } });
    expect(byId(t, 'hdd')).toMatchObject({ state: 'exact', rule: 'انتخاب خودت', product: { id: '22' } });
    expect(byId(t, 'cam').state).toBe('suggested');
  });

  it('a spec-block value never gets a product auto-picked', async () => {
    const r = await resolve(answeredJob());
    const rec = byId(r, 'rec');
    expect(rec.state).toBe('suggested');
    expect(rec.product?.id).toBe('10'); // 14 is cheaper but its channel count is only in the seller spec
  });

  it('partial plan: the total carries its coverage and the missing item', async () => {
    const p = await plan(job());
    expect(p.complete).toBe(false);
    expect(p.coverage).toMatchObject({ covered: 3, total: 4 });
    expect(p.coverage.missing).toEqual([{ itemId: 'rec', name: 'ضبط‌کننده ۴ کانال', why: 'منتظر انتخاب تو' }]);
    expect(p.totalLine).toMatch(/^فقط ۳ از ۴ مورد/);
    expect(p.totalToman).toBe(4 * 1_450_000 + 3_000_000 + 240_000);
    expect(p.reason).toMatch(/ناقص/);
    expect(p.reason).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین/);
  });

  it('complete plan: Pareto alternatives, coverage-aware totals and three compat levels', async () => {
    const p = await plan(answeredJob());
    expect(p.complete).toBe(true);
    expect(p.coverage).toMatchObject({ covered: 4, total: 4, missing: [] });
    expect(p.totalToman).toBe(4 * 1_450_000 + 5_500_000 + 3_000_000 + 240_000);
    expect(p.totalLine).toMatch(/^جمع ۴ مورد/);
    expect(p.usesSuggestions).toBe(true);
    expect(p.stopCount).toBe(2);
    const lineSum = p.stops.flatMap((s) => s.lines).reduce((a, l) => a + (l.lineTotal ?? 0), 0);
    expect(lineSum).toBe(p.totalToman);
    expect(p.alternatives).toEqual([
      { id: 'stops:1', label: 'کم‌توقف‌تر', description: '۵۰۰ هزار تومان بیشتر، یک توقف کمتر', deltaToman: 500_000, deltaStops: -1 },
    ]);
    const lv = (rule: string) => p.compat.filter((c) => c.ruleId === rule).map((c) => c.level);
    expect(lv('recorder_channels')).toEqual(['stated']); // «۴ کانال» read from the recorder title
    expect(lv('camera_recorder_signal')).toEqual(['assumed']); // general rule, never verified
    expect(lv('recorder_hdd_internal')).toEqual(['assumed']);
    expect(lv('hdd_surveillance')).toEqual(['unknown']); // the cheaper Seagate does not say «surveillance»
    expect(lv('camera_adapter_12v')).toEqual(['assumed']);
    for (const c of p.compat) if (c.level !== 'stated') expect(c.askSeller).toBeTruthy();
    // ask-seller lines go to the seller of the item they are about
    const hddLine = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === 'hdd')!;
    expect(hddLine.askSeller).toEqual(['این هارد مخصوص ضبط تصویر (سورویلنس) است؟']);
  });

  it('variant «fewest» switches to the one-stop plan and reports the delta back', async () => {
    const s = answeredJob();
    s.variant = 'fewest';
    const p = await plan(s);
    expect(p.stopCount).toBe(1);
    expect(p.activeVariant).toBe('fewest');
    expect(p.totalToman).toBe(15_040_000);
    expect(p.alternatives[0]).toMatchObject({ id: 'stops:2', deltaToman: -500_000, deltaStops: 1, label: 'ارزان‌تر' });
  });

  it('excluded shops and seller pins are respected', async () => {
    const s = answeredJob();
    s.excludedShops = { '*': [SHOPS.c1] };
    s.shopPins = { cam: SHOPS.a1 };
    const p = await plan(s);
    const shopsUsed = p.stops.map((x) => x.shopId);
    expect(shopsUsed).not.toContain(SHOPS.c1);
    expect(p.stops.find((x) => x.lines.some((l) => l.itemId === 'cam'))?.shopId).toBe(SHOPS.a1);
  });

  it('options: models by price with deltas, incomplete ones flagged, sellers of the current product', async () => {
    const o = await options(answeredJob(), 'cam');
    expect(o.models.map((m) => m.productId)).toEqual(['1', '6', '2', '5', '4', '3']);
    const first = o.models[0]!;
    expect(first.current).toBe(true);
    expect(o.models[1]!.diffLabel).toBe('۱۵۰ هزار تومان بیشتر');
    expect(o.models.find((m) => m.productId === '5')!.diffLabel).toContain('مشخصات کامل نیست');
    expect(o.models.find((m) => m.productId === '3')!.conflict).toContain('مگاپیکسل');
    expect(o.sellers.map((s) => s.shopId)).toEqual([SHOPS.b1, SHOPS.a1]);
    expect(o.sellers[0]).toMatchObject({ price: 1_450_000, current: true, mall: 'پاساژ ب', floor: 'طبقهٔ منفی ۱' });
    const other = await options(answeredJob(), 'cam', '2');
    expect(other.sellers).toHaveLength(1);
    expect(other.onlyOneSeller).toBe(true);
  });
});

describe('electrical: wire needs its sale unit; sockets; floodlight', () => {
  const wireState = (answers?: Record<string, string>, settled = false) =>
    state(
      [
        item('w', '۵۰ متر سیم برق ۲.۵', {
          qty: 50,
          unit: 'متر',
          categoryIds: [CAT.wire],
          chips: [chip('s', '۲٫۵', { attr: 'wire_section_mm2', op: 'eq', value: 2.5 })],
        }),
        item('p', 'پریز'),
        item('f', 'پروژکتور ۵۰ وات'),
      ],
      { answers: answers ? { w: answers } : {}, settled: settled ? { w: true } : {} },
    );

  it('wire stays «needs_info» until the unit is chosen; no mixed-unit range; the question cannot be skipped', async () => {
    for (const s of [wireState(), wireState({ sale_unit: 'any' }, true)]) {
      const w = byId(await resolve(s), 'w');
      expect(w.state).toBe('needs_info');
      expect(w.question).toMatchObject({ id: 'sale_unit', kind: 'unit', skippable: false });
      expect(w.question!.options.map((o) => o.id)).toEqual(['c~eq~sale_unit~"meter"', 'c~eq~sale_unit~"roll"']);
      expect(w.question!.options.map((o) => o.label)).toEqual(['متری (برش به اندازه)', 'حلقهٔ ۱۰۰ متری']);
      expect(w.rangeLow).toBeUndefined();
      expect(w.rangeHigh).toBeUndefined();
    }
    const p = await plan(wireState());
    expect(p.coverage.missing.map((m) => m.itemId)).toContain('w');
    expect(p.stops.flatMap((s) => s.lines).some((l) => l.itemId === 'w')).toBe(false);
  });

  it('roll: whole 100 m rolls, labelled; listings with another or a spec-only unit are never eligible', async () => {
    const s = wireState({ sale_unit: 'c~eq~sale_unit~"roll"' });
    const w = byId(await resolve(s), 'w');
    expect(w).toMatchObject({ state: 'suggested', product: { id: '40' }, unitLabel: 'حلقهٔ ۱۰۰ متری', saleUnit: 'roll', eligibleCount: 1 });
    const line = (await plan(s)).stops.flatMap((x) => x.lines).find((l) => l.itemId === 'w')!;
    expect(line).toMatchObject({ qty: 1, unitPrice: 2_700_000, lineTotal: 2_700_000, unitLabel: 'حلقهٔ ۱۰۰ متری' });
  });

  it('metre: priced per metre, quantity in metres', async () => {
    const s = wireState({ sale_unit: 'c~eq~sale_unit~"meter"' });
    const line = (await plan(s)).stops.flatMap((x) => x.lines).find((l) => l.itemId === 'w')!;
    expect(line).toMatchObject({ qty: 50, unitPrice: 30_000, lineTotal: 1_500_000, unitLabel: 'قیمت هر متر' });
    const o = await options(s, 'w');
    // no price delta is ever shown between a roll and a metre listing
    const roll = o.models.find((m) => m.productId === '40')!;
    expect(roll.diffLabel ?? '').not.toMatch(/بیشتر|ارزان‌تر/);
  });

  it('items without categories are voted from the data; free words narrow inside the category', async () => {
    const r = await resolve(wireState());
    expect(byId(r, 'p')).toMatchObject({ state: 'suggested', categoryIds: [CAT.socket], product: { id: '80' } });
    const f = byId(r, 'f');
    expect(f).toMatchObject({ state: 'suggested', categoryIds: [CAT.flood], product: { id: '92' }, searchTerms: ['50', 'وات'] });
    expect(f.eligibleCount).toBe(2);
  });
});

describe('phone A56 + case + screen protector', () => {
  const phoneState = (extra: Partial<Api.RequirementState> = {}) =>
    state(
      [
        item('ph', 'گوشی سامسونگ A56', {
          categoryIds: [CAT.phone],
          chips: [chip('m', 'Galaxy A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56' })],
        }),
        item('cs', 'قاب', { categoryIds: [CAT.phoneCase] }),
        item('gl', 'گلس', { categoryIds: [CAT.protector] }),
      ],
      extra,
    );

  it('accessories inherit the phone model; the cheaper A57 case is excluded with its reason', async () => {
    const r = await resolve(phoneState());
    expect(byId(r, 'ph')).toMatchObject({ state: 'suggested', product: { id: '50' } });
    const cs = byId(r, 'cs');
    expect(cs).toMatchObject({ state: 'suggested', product: { id: '60' }, sellerCount: 1, eligibleCount: 1, kind: 'phone_case' });
    expect(cs.derivedChips?.[0]).toMatchObject({ inherited: true, constraint: { attr: 'fits_models', op: 'contains', value: 'galaxy a56' } });
    expect(cs.derivedChips?.[0]?.label).toContain('Galaxy A56');
    // 'galaxy a56 5g' on the protector listing matches the phone stated without a network suffix
    expect(byId(r, 'gl')).toMatchObject({ state: 'suggested', eligibleCount: 2, product: { id: '71' } });
    const o = await options(phoneState(), 'cs');
    const a57 = o.models.find((m) => m.productId === '61')!;
    expect(a57.fit).toBe('differs');
    expect(a57.conflict).toContain('galaxy a57');
    expect(o.onlyOneSeller).toBe(true);
  });

  it('compat: listing-stated fit; a pinned A57 case is a conflict, never «compatible»', async () => {
    const p = await plan(phoneState());
    expect(p.compat.filter((c) => c.ruleId === 'phone_accessory_fit').map((c) => c.level)).toEqual(['stated', 'stated']);
    expect(p).toMatchObject({ complete: true, stopCount: 1, totalToman: 39_000_000 + 300_000 + 120_000 });
    const pinned = await plan(phoneState({ pins: { cs: '61' } }));
    const fit = pinned.compat.find((c) => c.ruleId === 'phone_accessory_fit' && c.itemIds[0] === 'cs')!;
    expect(fit.level).toBe('conflict');
    expect(fit.askSeller).toBeTruthy();
  });

  it('accessories without a phone item ask which phone (compat question)', async () => {
    const s = state([item('cs', 'قاب', { categoryIds: [CAT.phoneCase] })]);
    const cs = byId(await resolve(s), 'cs');
    expect(cs.state).toBe('needs_info');
    expect(cs.question).toMatchObject({ id: 'fits_models', kind: 'compat' });
    expect(cs.question!.options.map((o) => o.label)).toEqual(['Galaxy A56', 'Galaxy A57', 'فرقی نمی‌کند']);
  });
});

describe('not found and visit time', () => {
  it('an item that is not in the data is «not_found» with real categories; the rest is still planned', async () => {
    const s = cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });
    s.requirements.push(item('x', 'قایق موتوری'));
    const r = await resolve(s);
    const x = byId(r, 'x');
    expect(x.state).toBe('not_found');
    expect(x.reason).toBe('«قایق موتوری» در فهرست این بازار پیدا نشد.');
    expect(x.nearbyCategories?.length).toBeGreaterThan(0);
    const p = await plan(s);
    expect(p.coverage.covered).toBe(3);
    expect(p.coverage.missing.find((m) => m.itemId === 'x')?.why).toBe('پیدا نشد');
  });

  it('Friday 13:00: closed shops are excluded, unknown hours are kept, closed notes explain the change', async () => {
    const s = answeredJob();
    s.visit = { day: 'date', date: '2026-10-23', window: 'exact', time: '13:00' };
    const p = await plan(s);
    expect(p.visitActive).toBe(true);
    for (const st of p.stops) expect(st.open).not.toBe('closed');
    expect(p.stops.map((x) => x.shopId)).toEqual([SHOPS.c1]);
    expect(p.coverage.missing).toEqual(
      expect.arrayContaining([
        { itemId: 'rec', name: 'ضبط‌کننده ۴ کانال', why: 'فروشنده‌هایش در این زمان بسته‌اند' },
        { itemId: 'adp', name: 'آداپتور ۱۲ ولت', why: 'فروشنده‌هایش در این زمان بسته‌اند' },
      ]),
    );
    expect(p.closedNotes.map((n) => n.text).join(' ')).toContain('فروشگاه ب');
    expect(p.stops[0]!.hoursText).toBe('ساعت کار جمعه: ۱۰ تا ۲۲');
    // a shop with no hours is never called closed
    const o = await options(s, 'rec', '14');
    expect(o.sellers[0]).toMatchObject({ shopId: SHOPS.a2, open: 'unknown', hoursText: 'ساعت کاری ثبت نشده' });
  });

  it('Saturday 19:30: shops closing earlier drop out; a single-seller case becomes missing', async () => {
    const s = state(
      [
        item('ph', 'گوشی A56', { categoryIds: [CAT.phone], chips: [chip('m', 'A56', { attr: 'phone_model', op: 'eq', value: 'galaxy a56' })] }),
        item('cs', 'قاب', { categoryIds: [CAT.phoneCase] }),
        item('gl', 'گلس', { categoryIds: [CAT.protector] }),
      ],
      { visit: { day: 'date', date: '2026-10-24', window: 'exact', time: '19:30' } },
    );
    const p = await plan(s);
    expect(p.stops.map((x) => x.shopId)).toEqual([SHOPS.c1]);
    expect(p.totalToman).toBe(40_000_000 + 150_000);
    expect(p.coverage.missing).toEqual([{ itemId: 'cs', name: 'قاب', why: 'فروشنده‌هایش در این زمان بسته‌اند' }]);
    expect(p.closedNotes[0]!.text).toContain('فروشگاه د');
  });
});

describe('adversarial listing text', () => {
  it('instruction-like titles are data: identical behaviour to a plain title', async () => {
    const s = answeredJob();
    s.excludedShops = { cam: [SHOPS.a1, SHOPS.b1] }; // force the camera to the shop that sells product 6
    const norm = (x: unknown, ...titles: string[]) => {
      let j = JSON.stringify(x);
      for (const t of titles) j = j.split(JSON.stringify(t).slice(1, -1)).join('<TITLE>');
      return JSON.parse(j) as unknown;
    };
    const adv = await plan(s);
    const ben = await plan(s, benignApp);
    expect(norm(adv, ADVERSARIAL_SELLER_TITLE, ADVERSARIAL_TITLE)).toEqual(norm(ben, BENIGN_TITLE));
    const line = adv.stops.flatMap((x) => x.lines).find((l) => l.itemId === 'cam')!;
    expect(line).toMatchObject({ productId: '6', state: 'suggested', unitPrice: 1_600_000, lineTotal: 6_400_000 });
    expect(norm(await resolve(s), ADVERSARIAL_TITLE)).toEqual(norm(await resolve(s, benignApp), BENIGN_TITLE));
  });
});

describe('validation and failure modes', () => {
  it('rejects malformed state with a Persian 400 envelope; ignores undecodable answers', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/plan', payload: { state: { requirements: 'x' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.messageFa).toMatch(/[؀-ۿ]/);
    const many = state(Array.from({ length: 13 }, (_, i) => item(`i${i}`, 'پریز')));
    expect((await app.inject({ method: 'POST', url: '/api/resolve', payload: { state: many } })).statusCode).toBe(400);
    const s = job();
    s.answers = { rec: { recorder_kind: 'c~eq~recorder_kind~"rm -rf"', brand: "c~eq~brand~'; DROP TABLE products;--" } };
    expect(byId(await resolve(s), 'rec').state).toBe('needs_info');
  });

  it('options for an unknown item is a 404; no database is a 503', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/options', payload: { state: job(), itemId: 'nope' } });
    expect(res.statusCode).toBe(404);
    const { app: empty } = await makeApp();
    const r = await empty.inject({ method: 'POST', url: '/api/plan', payload: { state: job() } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('DB_UNAVAILABLE');
    await empty.close();
  });
});
