/**
 * Contract: /api/parse output -> /api/assist -> /api/plan, exactly as the web uses them.
 *
 * The web puts the parser's items verbatim into `state.requirements` (`constraints`, no `chips`) and applies
 * `newState` wholesale. So for every chip and typed phrase: `newState` must validate against the request DTO, keep
 * parser items parser items, and be accepted by /api/plan. Runs on the fixture market, and on the real
 * market.sqlite when present (DATABASE_PATH or data/market.sqlite).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistRequestSchema, ASSIST_CHIPS, type AssistResponse } from '../src/assist/types.js';
import { findRepoRoot } from '../src/config.js';
import { buildFixtureMarket } from './fixture-market.js';
import { makeApp } from './helpers.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
const SENTENCE = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';
const REAL_DB = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');

type App = Awaited<ReturnType<typeof makeApp>>['app'];

function contract(name: string, skip: boolean, databasePath: () => string) {
  describe.skipIf(skip)(`assist contract on parser-item state: ${name}`, () => {
    let app: App;
    let base: Api.RequirementStateInput; // what the web would store right after /api/parse

    async function post<T>(url: string, payload: unknown): Promise<T> {
      const res = await app.inject({ method: 'POST', url, payload: payload as object });
      if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 300)}`);
      return (res.json() as { data: T }).data;
    }
    const assist = (state: unknown, body: Record<string, unknown>) => post<AssistResponse>('/api/assist', { state, ...body });
    const plan = (state: unknown) => post<Api.PlanResponse>('/api/plan', { state });

    /** The shape guarantee + the plan route accepts the state. Returns the replan. */
    async function expectUsable(r: AssistResponse, label: string): Promise<Api.PlanResponse> {
      expect(Api.RequirementStateSchema.safeParse(r.newState).success, `${label}: validates`).toBe(true);
      expect(AssistRequestSchema.safeParse({ state: r.newState, chip: 'cheaper' }).success, `${label}: usable as the next request`).toBe(true);
      for (const q of r.newState.requirements) {
        expect(q.constraints, `${label}: ${q.id} stays a parser item`).toBeDefined();
        expect(q, `${label}: ${q.id} has no chips`).not.toHaveProperty('chips');
      }
      return plan(r.newState);
    }

    beforeAll(async () => {
      app = (await makeApp({ databasePath: databasePath(), rateLimit: 1_000_000, assistRateLimit: 1_000_000 }, { now: () => NOW })).app;
      const parsed = await post<{ items: Api.RequirementInput[] }>('/api/parse', { text: SENTENCE });
      expect(parsed.items).toHaveLength(4);
      base = { requirements: parsed.items }; // verbatim, exactly as the web stores them
    });
    afterAll(async () => {
      await app?.close();
    });

    it('every chip returns a newState the plan accepts', async () => {
      const first = await plan(base);
      expect(first.stops.length).toBeGreaterThan(0);
      for (const chip of ASSIST_CHIPS) {
        const r = await assist(base, { chip, context: chip === 'without_shop' ? { shopId: first.stops[0]!.shopId } : undefined });
        expect(r.supported, chip).toBe(true);
        await expectUsable(r, chip);
      }
    });

    it('«بدون این مغازه» with no shop in context returns one choice per shop of the plan; a choice applies', async () => {
      const first = await plan(base);
      const shopIds = first.stops.flatMap((s) => (s.shops ?? [s]).map((x) => x.shopId));
      const ask = await assist(base, { text: 'بدون این مغازه' });
      if (shopIds.length === 1) {
        expect(ask).toMatchObject({ supported: true, action: { type: 'exclude_shop', shopId: shopIds[0] } });
      } else {
        expect(ask).toMatchObject({ supported: false, changed: false });
        expect(ask.choices!.map((c) => c.request.context?.shopId)).toEqual(shopIds);
        await expectUsable(ask, 'ask');
        const picked = await assist(base, ask.choices![0]!.request);
        expect(picked).toMatchObject({ supported: true, action: { type: 'exclude_shop', shopId: shopIds[0] } });
        expect((await expectUsable(picked, 'picked')).stops.flatMap((s) => (s.shops ?? [s]).map((x) => x.shopId))).not.toContain(shopIds[0]);
      }
    });

    it('excluding a mall of the plan (stop = building) removes that building from the replan, or refuses calmly', async () => {
      const first = await plan(base);
      const stop = first.stops.find((s) => s.buildingKey?.startsWith('m:') && s.mall);
      if (!stop) return;
      const r = await assist(base, { text: `پاساژ ${stop.mall} رو نمی‌خوام` });
      const replan = await expectUsable(r, 'mall');
      if (r.supported) {
        expect(r.action).toEqual({ type: 'exclude_mall', mallKey: stop.buildingKey });
        expect(replan.stops.map((s) => s.buildingKey)).not.toContain(stop.buildingKey);
      } else {
        expect(r.changed).toBe(false);
      }
    });

    it('«برند را عوض کن» offers the item\'s real brands (not "unsupported"), and a choice swaps the brand', async () => {
      const ask = await assist(base, { text: 'برند را عوض کن' });
      expect(ask).toMatchObject({ supported: false, changed: false, source: 'keywords', action: { type: 'none' } });
      expect(ask.messageFa).toContain('کدام برند');
      const labels = ask.choices!.map((c) => c.label);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels).not.toContain('داهوا'); // the current brand is not offered back
      expect(new Set(labels).size).toBe(labels.length);
      expect(ask.choices!.every((c) => c.request.context?.itemId === 'i1')).toBe(true);
      await expectUsable(ask, 'ask');

      const picked = await assist(base, ask.choices![0]!.request);
      expect(picked).toMatchObject({ supported: true, changed: true, source: 'keywords', action: { type: 'swap_brand', itemId: 'i1' } });
      const swap = picked.action as Extract<typeof picked.action, { type: 'swap_brand' }>;
      expect(swap.brand).not.toBe('dahua');
      const cam = picked.newState.requirements[0]!;
      expect(cam.constraints!.filter((c) => c.attr === 'brand')).toEqual([{ attr: 'brand', op: 'eq', value: swap.brand, source: 'user' }]);
      expect(cam.text).not.toContain('داهوا');
      expect(cam.rawText).not.toContain('داهوا');
      expect(cam.rawText).toContain(labels[0]!);
      const replan = await expectUsable(picked, 'picked');
      const camLine = replan.items?.find((i) => i.itemId === 'i1');
      expect(camLine?.chips?.some((c) => c.label.includes(labels[0]!))).toBe(true); // the engine's own chip shows the new brand
    });

    it('«بودجه ۵ میلیون» asks which item; with the item it sets `budget`', async () => {
      const ask = await assist(base, { text: 'بودجه ۵ میلیون' });
      expect(ask).toMatchObject({ supported: false, changed: false });
      expect(ask.choices!.length).toBe(4);
      await expectUsable(ask, 'ask');
      const r = await assist(base, ask.choices![0]!.request);
      expect(r).toMatchObject({ supported: true, changed: true, action: { type: 'set_budget', itemId: 'i1', max: 5_000_000 } });
      expect(r.newState.requirements[0]!.budget).toEqual({ max: 5_000_000 });
      await expectUsable(r, 'budget');
    });

    it('«بدون هایک ویژن» (not the stated brand) changes nothing and stays usable; «بدون داهوا» offers other brands', async () => {
      const r = await assist(base, { text: 'بدون هایک ویژن' });
      expect(r).toMatchObject({ supported: false, changed: false });
      expect(r.messageFa).not.toBe('');
      await expectUsable(r, 'without other brand');
      const own = await assist(base, { text: 'بدون داهوا' });
      expect(own).toMatchObject({ supported: false, changed: false, source: 'keywords' });
      expect(own.choices!.length).toBeGreaterThan(0);
      await expectUsable(own, 'without own brand');
    });

    it('«فقط مغازه‌های باز» sets the visit filter; the plan accepts it', async () => {
      const r = await assist(base, { text: 'فقط مغازه‌های باز' });
      expect(r).toMatchObject({ supported: true, changed: true, action: { type: 'only_open', value: true }, source: 'keywords' });
      expect(r.newState.visit).toMatchObject({ day: 'today', window: 'exact' });
      await expectUsable(r, 'only_open');
    });

    it('relax and remove work on parser items; the replan follows', async () => {
      const relaxed = await assist(base, { text: 'برند مهم نیست', context: { itemId: 'i1' } });
      expect(relaxed).toMatchObject({ supported: true, changed: true, action: { type: 'relax_constraint', itemId: 'i1', attr: 'brand' } });
      expect(relaxed.newState.requirements[0]!.constraints!.some((c) => c.attr === 'brand')).toBe(false);
      await expectUsable(relaxed, 'relax');
      const removed = await assist(base, { text: 'هارد رو حذف کن' });
      expect(removed).toMatchObject({ supported: true, changed: true, action: { type: 'remove_item', itemId: 'i3' } });
      expect(removed.newState.requirements.map((q) => q.id)).toEqual(['i1', 'i2', 'i4']);
      await expectUsable(removed, 'remove');
    });

    it('add_item appends the parser\'s item verbatim', async () => {
      const r = await assist(base, { text: 'یک آداپتور ۵ ولت هم اضافه کن' });
      expect(r).toMatchObject({ supported: true, changed: true, action: { type: 'add_item' } });
      const added = r.newState.requirements[4]!;
      expect(added).toMatchObject({ id: 'a1', kind: 'adapter' });
      expect(added.constraints).toContainEqual(expect.objectContaining({ attr: 'voltage_v', op: 'eq', value: 5 }));
      expect(added.rawText).toBeTruthy();
      await expectUsable(r, 'add');
    });
  });
}

let fixtureDir: string | undefined;
afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

contract('fixture market', false, () => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'assist-contract-'));
  return buildFixtureMarket(path.join(fixtureDir, 'm.sqlite'));
});
contract('real market.sqlite', !existsSync(REAL_DB), () => REAL_DB);
