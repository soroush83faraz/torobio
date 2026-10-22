/**
 * G1a regressions on the real market.sqlite (read-only; skipped when absent). Point DATABASE_PATH at it.
 * Repros of the independent verifier's findings, through /api/parse exactly as the web app calls it:
 *  1. an adapter whose listing states another voltage was auto-picked next to the cameras inside a «complete» total;
 *  2. «کافیه» picked an adapter without a stated voltage, the fewest-stops plan a PoE (48 V) adapter;
 *  3. «A56 under 50 M» / «iPhone 15 stock» came back as a dead end (alternative, no product, no reason);
 *  4. a wire's item line mixed per-metre and per-roll prices before the unit was chosen;
 *  5. the missing line called not-found items «بدون قیمت یا انتخاب».
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { expectNoAutoPickConflict, options, parseToState, plan, resolve, settle, type App } from './contract-helpers.js';
import { makeApp } from './helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');
const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور';
const ANALOG = 'c~in~recorder_kind~["xvr","dvr"]';

let app: App;
const itemOf = (p: Api.PlanResponse, id: string) => p.items!.find((i) => i.itemId === id)!;
const lineOf = (p: Api.PlanResponse, id: string) => p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id);

/** Specs of a product as the options list shows them (Persian), e.g. «۱۲ ولت». */
async function specsOf(state: Api.RequirementStateInput, itemId: string, productId: string): Promise<string[]> {
  const o = await options(app, state, itemId, productId);
  const m = o.models.find((x) => x.productId === productId);
  if (m) return m.specs;
  // not in the capped list: the sellers list still names it; fall back to the current model
  return o.models.find((x) => x.current)?.specs ?? [];
}

describe.skipIf(!HAS_DB)('G1a on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('defect 1: amps answered, voltage not: the adapter asks the voltage; the plan is partial, never a conflict', async () => {
    for (const amps of ['0.5', '1']) {
      const { state } = await parseToState(app, CCTV);
      const s: Api.RequirementStateInput = { ...state, answers: { i2: { recorder_kind: ANALOG }, i4: { current_a: `c~eq~current_a~${amps}` } } };
      const p = await plan(app, s);
      expectNoAutoPickConflict(p);
      expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
      const ad = itemOf(p, 'i4');
      expect(ad.state).toBe('needs_info');
      expect(ad.question).toMatchObject({ id: 'voltage_v', kind: 'compat' });
      expect(ad.question!.options[0]!.id).toBe('c~eq~voltage_v~12');
      expect(p.complete).toBe(false);
      expect(p.totalLine).toMatch(/^فقط ۳ از ۴ مورد/);
      expect(p.missingLine).toBe('منتظر انتخاب: آداپتور');
      // one more tap: 12 V at 0.5 A is the 210 k «آداپتور 12 ولت 500 میلی آمپر» (product 4958), not the 4.2 V one
      const s12: Api.RequirementStateInput = { ...s, answers: { ...s.answers, i4: { ...s.answers!.i4, voltage_v: 'c~eq~voltage_v~12' } } };
      const p12 = await plan(app, s12);
      expect(p12.complete).toBe(true);
      expect(p12.compat.find((c) => c.ruleId === 'camera_adapter_12v')?.level).toBe('assumed');
      if (amps === '0.5') expect(itemOf(p12, 'i4').product?.id).toBe('4958');
      expect(await specsOf(s12, 'i4', lineOf(p12, 'i4')!.productId!)).toContain('۱۲ ولت');
    }
  });

  it('defect 2: «کافیه» on every item: a 12 V adapter (4958), the recorder follows the HDCVI camera; fewest stops too', async () => {
    const { parsed, state } = await parseToState(app, CCTV);
    let s = state;
    for (const it of parsed.items) s = settle(s, it.id);
    for (const variant of [null, 'fewest'] as const) {
      const sv: Api.RequirementStateInput = { ...s, variant };
      const p = await plan(app, sv);
      expectNoAutoPickConflict(p);
      expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
      expect(p.complete).toBe(true);
      const adLine = lineOf(p, 'i4')!;
      // G3a: the card shows what the plan buys (a 12 V adapter; the cheapest overall, 4958, or one at a used stop)
      expect(itemOf(p, 'i4').product?.id).toBe(adLine.productId);
      expect(['162445', '107981']).not.toContain(adLine.productId); // unknown voltage / PoE 48 V
      expect(await specsOf(sv, 'i4', adLine.productId!)).toContain('۱۲ ولت');
      expect(p.compat.find((c) => c.ruleId === 'camera_recorder_signal')?.level).toBe('assumed');
    }
    // /api/resolve agrees with the plan's cards
    const r = await resolve(app, s);
    const p = await plan(app, s);
    for (const it of r.items) expect(it.product?.id).toBe(itemOf(p, it.itemId).product?.id);
    // the unknown-voltage and PoE adapters stay listed, flagged, with the reason
    const o = await options(app, s, 'i4');
    for (const m of o.models.filter((x) => x.fit !== 'eligible')) expect(m.conflict ?? m.diffLabel).toBeTruthy();
  });

  it('property: settled CCTV / phone / accessory requests (both variants) never show a conflict', async () => {
    const requests = [
      CCTV,
      '۸ دوربین هایک ویژن، دی وی آر ۸ کانال، هارد ۴ ترابایت و آداپتور',
      'دوربین تحت شبکه، ضبط کننده و آداپتور',
      'دوربین مداربسته و ضبط کننده ۱۶ کانال',
      'گوشی سامسونگ A56 با قاب و گلس',
      'گوشی و قاب',
      'قاب و گلس',
    ];
    for (const text of requests) {
      const { parsed, state } = await parseToState(app, text);
      let s = state;
      for (const it of parsed.items) s = settle(s, it.id);
      for (const variant of [null, 'fewest'] as const) {
        const p = await plan(app, { ...s, variant });
        expectNoAutoPickConflict(p);
        expect(p.compat.some((c) => c.level === 'conflict'), `${text} [${variant}]`).toBe(false);
      }
    }
  });

  it('defect 3: «A56 under 50 M» and «iPhone 15 stock» say why, what to lift and the nearest models; nothing is picked', async () => {
    const { state } = await parseToState(app, 'گوشی سامسونگ A56 زیر ۵۰ میلیون');
    const a56 = (await resolve(app, state)).items[0]!;
    expect(a56.state).toBe('alternative');
    expect(a56.product).toBeUndefined();
    expect(a56.noMatch?.reasonFa).toMatch(/^هیچ مدلی با بودجهٔ ۵۰ میلیون پیدا نشد؛ ارزان‌ترین مدل .+ میلیون تومان است$/);
    expect(a56.noMatch!.relax[0]).toEqual({ attr: 'budget', label: 'بودجه را بردار' });
    expect(a56.noMatch!.closest.length).toBeGreaterThan(0);
    for (const m of a56.noMatch!.closest) {
      expect(m.fit).not.toBe('eligible');
      expect(m.name).toMatch(/A56/i);
      expect(m.conflict).toContain('بیرون از بودجه');
    }
    const { state: s2 } = await parseToState(app, 'گوشی آیفون ۱۵ استوک');
    const ip = (await resolve(app, s2)).items[0]!;
    expect(ip.product).toBeUndefined();
    expect(ip.noMatch?.reasonFa).toContain('کارکرده');
    expect(ip.noMatch!.relax.map((r) => r.attr)).toContain('condition');
    expect(ip.noMatch!.closest[0]!.name).toMatch(/iPhone 15/i);
  });

  it('defect 4 + 5: no mixed-unit range before the wire unit; the missing line names its groups', async () => {
    const { state } = await parseToState(app, 'سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز');
    const r = await resolve(app, state);
    const w = r.items[0]!;
    expect(w.state).toBe('needs_info');
    expect(w.reason).not.toMatch(/ تا /);
    expect(w.detail).not.toMatch(/ تا /);
    expect(w.rangeLow).toBeUndefined();
    const { state: cctv } = await parseToState(app, `${CCTV} و زیردریایی اتمی`);
    const p = await plan(app, cctv);
    expect(p.missingLine).toMatch(/منتظر انتخاب: /);
    expect(p.missingLine).not.toContain('بدون قیمت یا انتخاب');
    for (const m of p.coverage.missing) expect(m.why).toBeTruthy();
  });
});
