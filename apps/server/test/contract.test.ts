/**
 * API contract on the hand-made fixture market (no real dataset needed):
 * - /api/parse items go verbatim into /api/resolve, /api/plan and /api/options;
 * - listing condition honesty: used / refurbished / copy listings are never auto-picked, stay visible flagged,
 *   and become eligible only when the user asks for them (text, answer or chip) or pins one;
 * - one stop per building, with its shops (floor / unit each) and their lines.
 */
import path from 'node:path';
import type { Api } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureMarket, SHOPS } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { byId, expectNoExactSuggestion, expectPlanInvariants, options, parseToState, plan, post, resolve, type App } from './contract-helpers.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
let app: App;

beforeAll(async () => {
  const dir = tmpDir();
  app = (await makeApp({ databasePath: buildFixtureMarket(path.join(dir, 'm.sqlite')), rateLimit: 1_000_000 }, { now: () => NOW })).app;
});
afterAll(async () => {
  await app.close();
  cleanupTmp();
});

describe('parse -> resolve contract', () => {
  it('accepts parser items verbatim (no chips, no other state fields) and derives chips for the response', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس');
    expect(parsed.items).toHaveLength(1);
    const it0 = parsed.items[0]!;
    expect(it0.constraints).toEqual([{ attr: 'brand', op: 'eq', value: 'asus', source: 'user' }]);
    expect((it0 as unknown as Record<string, unknown>).chips).toBeUndefined();
    const r = await resolve(app, state);
    const laptop = byId(r, it0.id);
    expect(laptop.chips).toEqual([{ key: 'brand', label: 'ایسوس', constraint: { attr: 'brand', op: 'eq', value: 'asus' } }]);
    expect(laptop.categoryLabel).toBe('لپ تاپ و نوت بوک');
    expect(laptop.condition).toBe('new');
  });

  it('rejects nothing the parser can emit: notes, candidates, inherited, rawText, confidence, domain', async () => {
    // the fixture has no phone synonym: «قاب» states the model, «گلس» inherits it from the CASE (not a phone)
    const { parsed, state } = await parseToState(app, 'گوشی سامسونگ A56 با قاب و گلس');
    const glass = parsed.items.find((i) => i.kind === 'screen_protector')!;
    expect(glass.inherited).toEqual([{ attr: 'fits_models', fromItemId: parsed.items.find((i) => i.kind === 'phone_case')!.id }]);
    const r = await resolve(app, state);
    expect(r.items).toHaveLength(parsed.items.length);
    // inherited from a sibling accessory: no compat rule re-derives it, so it stays a stated constraint
    const g = byId(r, glass.id);
    expect(g.chips?.find((ch) => ch.key === 'fits_models')?.label).toBe('Galaxy A56');
    expect(g.state).toBe('suggested');
    expectNoExactSuggestion(r);
  });

  it('a phone model inherited from the phone item is re-derived by the compat rule (follows the phone)', async () => {
    const phone: Api.ParsedItem = {
      id: 'i1', text: 'گوشی سامسونگ A56', qty: 1, categoryIds: [15], kind: 'phone',
      constraints: [{ attr: 'phone_model', op: 'eq', value: 'galaxy a56', source: 'user' }],
      rawText: 'گوشی سامسونگ A56', confidence: 0.9, categoryCandidates: [], notes: [], domain: 'phone',
    };
    const kase: Api.ParsedItem = {
      id: 'i2', text: 'قاب', qty: 1, categoryIds: [16], kind: 'phone_case',
      constraints: [{ attr: 'fits_models', op: 'contains', value: 'galaxy a56', source: 'user' }],
      inherited: [{ attr: 'fits_models', fromItemId: 'i1' }],
      rawText: 'قاب', confidence: 0.8, categoryCandidates: [], notes: [], domain: 'phone_accessory',
    };
    const r = await resolve(app, { requirements: [phone, kase] });
    const c = byId(r, 'i2');
    expect(c.chips?.some((ch) => ch.inherited && ch.key === 'derived:fits_models')).toBe(true);
    expect(c.chips?.some((ch) => !ch.inherited && ch.key === 'fits_models')).toBe(false);
    // the user changes the phone: the case follows (the stale inherited constraint is not kept)
    const changed = { ...phone, constraints: [{ attr: 'phone_model' as const, op: 'eq' as const, value: 'galaxy a57', source: 'user' as const }] };
    const r2 = await resolve(app, { requirements: [changed, kase] });
    expect(byId(r2, 'i2').product?.id).toBe('61');
  });

  it('options and plan accept the same verbatim state', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس');
    const o = await options(app, state, parsed.items[0]!.id);
    expect(o.models.length).toBeGreaterThan(0);
    const p = await plan(app, state);
    expectPlanInvariants(p);
  });

  it('still rejects oversized or malformed items (public endpoint limits)', async () => {
    const big = { id: 'x', text: 'ا'.repeat(600), qty: 1, categoryIds: [], constraints: [] };
    const res = await app.inject({ method: 'POST', url: '/api/resolve', payload: { state: { requirements: [big] } } });
    expect(res.statusCode).toBe(400);
    const bad = { id: 'x', text: 'لپ تاپ', qty: 1, constraints: [{ attr: 'not_an_attr', op: 'eq', value: 1 }] };
    const res2 = await app.inject({ method: 'POST', url: '/api/resolve', payload: { state: { requirements: [bad] } } });
    expect(res2.statusCode).toBe(400);
  });
});

describe('listing condition honesty (laptop: cheapest ASUS is used, next refurbished)', () => {
  it('never auto-picks a used / refurbished listing; keeps them visible and flagged', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس');
    const id = parsed.items[0]!.id;
    const r = await resolve(app, state);
    const it0 = byId(r, id);
    expect(it0.state).toBe('suggested');
    expect(it0.product?.id).toBe('102');
    expect(it0.eligibleCount).toBe(1);
    expect(it0.conditionExcludedCount).toBe(2);
    expect(it0.conditionNote).toMatch(/کارکرده/);
    expect(it0.productFlags).toBeUndefined();
    const o = await options(app, state, id);
    const used = o.models.find((m) => m.productId === '100')!;
    const refurb = o.models.find((m) => m.productId === '101')!;
    expect(used.fit).toBe('differs');
    expect(used.flags).toEqual(['used']);
    expect(used.flagLabels).toEqual(['کارکرده (استوک)']);
    expect(used.specs).toContain('کارکرده (استوک)');
    expect(used.conflict).toMatch(/کارکرده \(استوک\) طبق عنوان آگهی/);
    // refurbished only detectable from the title at query time (the build attrs say nothing)
    expect(refurb.flags).toEqual(['refurbished']);
    const p = await plan(app, state);
    expectPlanInvariants(p);
    const line = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id)!;
    expect(line.productId).toBe('102');
    expect(line.flags).toBeUndefined();
  });

  it('«لپ تاپ ایسوس استوک» asks for used listings: only those are eligible, picked as a suggestion, flagged', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس استوک');
    const it0 = parsed.items[0]!;
    expect(it0.condition).toBe('used');
    expect(it0.notes.some((n) => n.code === 'unparsed_fragment')).toBe(false);
    const r = await resolve(app, state);
    const res = byId(r, it0.id);
    expect(res.state).toBe('suggested');
    expect(res.product?.id).toBe('100');
    expect(res.eligibleCount).toBe(2);
    expect(res.productFlags).toEqual(['used']);
    expect(res.chips?.map((c) => c.label)).toContain('کارکرده (استوک)');
    const p = await plan(app, state);
    const line = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === it0.id)!;
    expect(line.flags).toEqual(['used']);
    expect(line.state).toBe('suggested');
  });

  it('an answer condition=any (or a chip) allows used listings too; a pin is always exact', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس');
    const id = parsed.items[0]!.id;
    const anyState = { ...state, answers: { [id]: { condition: 'c~eq~condition~"any"' } } };
    expect(byId(await resolve(app, anyState), id).product?.id).toBe('100');
    const chipState: Api.RequirementStateInput = {
      requirements: [{ id: 'l', text: 'لپ تاپ ایسوس', qty: 1, chips: [{ key: 'condition', label: 'نو یا کارکرده', constraint: { attr: 'condition', op: 'eq', value: 'any' } }] }],
    };
    expect(byId(await resolve(app, chipState), 'l').product?.id).toBe('100');
    const pinned = await resolve(app, { ...state, pins: { [id]: '100' } });
    expect(byId(pinned, id).state).toBe('exact');
    expect(byId(pinned, id).productFlags).toEqual(['used']);
  });

  it('a typed model code that only a used listing carries is not «مدل مشخص»', async () => {
    const r = await resolve(app, { requirements: [{ id: 'm', text: 'لپ تاپ X455', qty: 1, categoryIds: [20], constraints: [], modelCode: 'X455' }] });
    const m = byId(r, 'm');
    expect(m.state).not.toBe('exact');
    expect(m.product).toBeUndefined();
  });
});

describe('one stop per building', () => {
  it('two shops of one mall are ONE stop with both shops, each with its floor and unit', async () => {
    const { parsed, state } = await parseToState(app, 'لپ تاپ ایسوس، آداپتور ۱۲ ولت');
    expect(parsed.items).toHaveLength(2);
    const fewest = await plan(app, { ...state, preference: 'fewest_stops' });
    expectPlanInvariants(fewest);
    expect(fewest.stopCount).toBe(1);
    const stop = fewest.stops[0]!;
    expect(stop.buildingKey).toBe('m:الف');
    expect(stop.mall).toBe('پاساژ الف');
    expect(stop.shops?.map((s) => s.shopId).sort()).toEqual([SHOPS.a1, SHOPS.a2].sort());
    const a1 = stop.shops!.find((s) => s.shopId === SHOPS.a1)!;
    const a2 = stop.shops!.find((s) => s.shopId === SHOPS.a2)!;
    expect([a1.floor, a1.unit]).toEqual(['طبقهٔ ۱', 'واحد ۱۲']);
    expect([a2.floor, a2.unit]).toEqual(['همکف', 'واحد ۳']);
    expect(stop.lines).toHaveLength(2);
    expect(fewest.shopCount).toBe(2);
    // the cheaper plan uses two buildings: offered as an alternative with its real delta
    expect(fewest.alternatives.some((a) => a.deltaStops === 1)).toBe(true);
    const cheapest = await plan(app, state);
    expectPlanInvariants(cheapest);
    expect(cheapest.stopCount).toBe(2);
  });
});

describe('/api/meta (UI shape)', () => {
  it('serves snapshot (ISO + Jalali), counts, version, areas, categories and fictionalShopNames', async () => {
    const res = await app.inject('/api/meta');
    const m = (res.json() as { data: Api.MetaResponse }).data;
    expect(m.snapshotDate).toBe('2026-10-13');
    expect(m.snapshotDateFa).toBe('۲۱ مهر ۱۴۰۵');
    expect(m.dataVersion).toBe('fixture-1');
    expect(m.fictionalShopNames).toBe(true);
    expect(m.shopCount).toBe(5);
    expect(m.areas).toEqual(['بازار']);
    expect(m.categories).toContain('لپ تاپ و نوت بوک');
    expect(m.snapshot_date).toBe(m.snapshotDate);
  });
  it('health is unchanged', async () => {
    const h = (await app.inject('/api/health')).json() as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual(['commit', 'db', 'llm', 'llmBackend', 'status', 'uptimeSec']);
    void post;
  });
});
