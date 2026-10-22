/**
 * API contract on the REAL market.sqlite: /api/parse output fed VERBATIM into /api/resolve -> (answer a
 * question) -> /api/plan, for the five demo scenarios. Skipped when the file is absent; point DATABASE_PATH at it:
 *   DATABASE_PATH=/path/to/data/market.sqlite npx vitest run apps/server/test/contract-real.test.ts
 * Assertions are honesty rules and structure (item states, no suggestion labelled exact, coverage-aware totals,
 * compat levels, one stop per building), never specific prices.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { answer, byId, expectNoExactSuggestion, expectPlanInvariants, options, parseToState, plan, resolve, settle, type App } from './contract-helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30'); // Wednesday

let app: App;

function productTitle(id: string): string {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT title FROM products WHERE id = ?').get(Number(id)) as { title: string }).title;
  } finally {
    db.close();
  }
}
const USED_WORDS = /استوک|کارکرده|کار کرده|دست دوم|ریفر|اوپن باکس|در حد نو|کپی|طرح (?:اپل|نوکیا|سامسونگ|آیفون)/;

describe.skipIf(!HAS_DB)('contract-real: parse -> resolve -> answer -> plan on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('1. CCTV job: compat question first, answered -> plan with compat levels and coverage-aware total', async () => {
    let { parsed, state } = await parseToState(app, '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور');
    const kinds = parsed.items.map((i) => i.kind);
    expect(kinds).toEqual(['camera', 'recorder', 'hdd', 'adapter']);
    const [cam, rec, hdd, ad] = parsed.items.map((i) => i.id) as [string, string, string, string];
    expect(parsed.items[0]!.qty).toBe(4);
    let r = await resolve(app, state);
    expectNoExactSuggestion(r);
    expect(byId(r, cam).state).toBe('suggested');
    expect(byId(r, cam).chips?.map((c) => c.label)).toEqual(expect.arrayContaining(['داهوا', '۲ مگاپیکسل']));
    const recRes = byId(r, rec);
    expect(recRes.state).toBe('needs_info');
    expect(recRes.question?.kind).toBe('compat');
    expect(recRes.question?.id).toBe('recorder_kind');
    expect(recRes.chips?.map((c) => c.label)).toContain('۴ کانال');
    // before answering, the recorder adds nothing to the total
    let p = await plan(app, state);
    expectPlanInvariants(p);
    expect(p.coverage.missing.map((m) => m.itemId)).toContain(rec);

    state = answer(state, recRes.question!, (o) => o.id.includes('xvr'));
    r = await resolve(app, state);
    expectNoExactSuggestion(r);
    expect(byId(r, rec).question?.kind).not.toBe('compat');
    for (const id of [rec, ad]) if (byId(r, id).state === 'needs_info') state = settle(state, id);
    r = await resolve(app, state);
    for (const id of [cam, rec, hdd]) expect(['suggested', 'alternative', 'no_price']).toContain(byId(r, id).state);
    p = await plan(app, state);
    expectPlanInvariants(p);
    expect(p.coverage.covered).toBeGreaterThanOrEqual(3);
    expect(p.usesSuggestions).toBe(true);
    const rules = new Set(p.compat.map((c) => c.ruleId));
    expect(rules.has('camera_recorder_signal')).toBe(true);
    expect(rules.has('recorder_channels')).toBe(true);
    // the signal pairing is a general rule unless both titles state it; never a silent "compatible"
    // nothing here is pinned: every pick is automatic, so no line may be a conflict (the plan guard's invariant)
    for (const c of p.compat.filter((x) => x.ruleId === 'camera_recorder_signal')) expect(['stated', 'assumed', 'unknown']).toContain(c.level);
    expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
    for (const c of p.compat) if (c.level !== 'stated') expect(c.askSeller).toBeTruthy();
  });

  it('2. electrical refit: «۵۰ متر» is the quantity; the sale unit must be chosen before any wire price is totalled', async () => {
    let { parsed, state } = await parseToState(app, 'سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز');
    const wire = parsed.items[0]!;
    expect(wire.kind).toBe('wire');
    expect([wire.qty, wire.unit]).toEqual([50, 'متر']);
    expect(wire.constraints.some((c) => c.attr === 'length_m')).toBe(false);
    let r = await resolve(app, state);
    const w = byId(r, wire.id);
    expect(w.state).toBe('needs_info');
    expect(w.question?.id).toBe('sale_unit');
    expect(w.question?.kind).toBe('unit');
    expect(w.question?.skippable).toBe(false);
    expect(w.rangeLow).toBeUndefined(); // no price range across sale units
    let p = await plan(app, state);
    expectPlanInvariants(p);
    expect(p.stops.flatMap((s) => s.lines).some((l) => l.itemId === wire.id)).toBe(false);

    // by the metre: 50 metres are bought, priced per metre
    const metre = answer(state, w.question!, (o) => o.id === 'c~eq~sale_unit~"meter"');
    r = await resolve(app, metre);
    expect(byId(r, wire.id).state).toBe('suggested');
    expect(byId(r, wire.id).unitLabel).toBe('قیمت هر متر');
    p = await plan(app, settle(metre, parsed.items[1]!.id));
    expectPlanInvariants(p);
    const line = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === wire.id)!;
    expect(line.qty).toBe(50);
    expect(line.unitLabel).toBe('قیمت هر متر');
    expect(line.lineTotal).toBe(line.unitPrice! * 50);

    // by the roll: 50 m -> one 100 m roll
    state = answer(state, w.question!, (o) => o.id === 'c~eq~sale_unit~"roll"');
    p = await plan(app, state);
    expectPlanInvariants(p);
    const roll = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === wire.id)!;
    expect(roll.qty).toBe(1);
    expect(roll.unitLabel).toBe('حلقهٔ ۱۰۰ متری');
  });

  it('3. phone A56 + case + glass: accessories inherit the model, compat is listing-stated, never exact', async () => {
    let { parsed, state } = await parseToState(app, 'گوشی سامسونگ A56 با قاب و گلس');
    expect(parsed.items.map((i) => i.kind)).toEqual(['phone', 'phone_case', 'screen_protector']);
    const [phone, kase, glass] = parsed.items.map((i) => i.id) as [string, string, string];
    let r = await resolve(app, state);
    expectNoExactSuggestion(r);
    expect(byId(r, phone).state).toBe('suggested');
    expect(productTitle(byId(r, phone).product!.id)).not.toMatch(USED_WORDS);
    for (const id of [kase, glass]) {
      const it0 = byId(r, id);
      // inherited from the phone item: re-derived by the compat rule, shown as an inherited chip
      expect(it0.chips?.some((c) => c.inherited && /A56/.test(c.label))).toBe(true);
      if (it0.state === 'needs_info') state = settle(state, id);
    }
    r = await resolve(app, state);
    const p = await plan(app, state);
    expectPlanInvariants(p);
    const fit = p.compat.filter((c) => c.ruleId === 'phone_accessory_fit');
    expect(fit.length).toBeGreaterThan(0);
    for (const c of fit) expect(c.level).toBe('stated'); // every picked accessory names A56 in its title
    for (const l of p.stops.flatMap((s) => s.lines)) expect(l.flags).toBeUndefined();
  });

  it('4. laptop «لپ‌تاپ ایسوس»: the used AUSUS X455 is never auto-picked; it stays listed, flagged', async () => {
    const { parsed, state } = await parseToState(app, 'لپ‌تاپ ایسوس');
    const id = parsed.items[0]!.id;
    expect(parsed.items[0]!.condition).toBeUndefined();
    const r = await resolve(app, state);
    const lap = byId(r, id);
    expectNoExactSuggestion(r);
    expect(lap.state).toBe('suggested');
    expect(lap.product?.id).not.toBe('167157');
    expect(productTitle(lap.product!.id)).not.toMatch(USED_WORDS);
    expect(lap.productFlags).toBeUndefined();
    expect(lap.conditionExcludedCount).toBeGreaterThanOrEqual(1);
    const o = await options(app, state, id);
    const used = o.models.find((m) => m.productId === '167157');
    expect(used).toBeDefined();
    expect(used!.flags).toEqual(['used']);
    expect(used!.fit).toBe('differs');
    for (const m of o.models.filter((x) => x.fit === 'eligible')) expect(m.flags).toBeUndefined();
    const p = await plan(app, state);
    expectPlanInvariants(p);
    const line = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id)!;
    expect(line.productId).toBe(lap.product!.id);
    expect(line.flags).toBeUndefined();

    // asking for used ones («استوک») searches used ones
    const usedChain = await parseToState(app, 'لپ‌تاپ ایسوس استوک');
    expect(usedChain.parsed.items[0]!.condition).toBe('used');
    const ru = byId(await resolve(app, usedChain.state), usedChain.parsed.items[0]!.id);
    expect(ru.state).toBe('suggested');
    expect(ru.productFlags?.length).toBeGreaterThan(0);
  });

  it('4b. «موبایل استوک» asks among used phones only; copies are never eligible', async () => {
    let { parsed, state } = await parseToState(app, 'موبایل استوک');
    const it0 = parsed.items[0]!;
    expect(it0.condition).toBe('used');
    state = settle(state, it0.id);
    const r = byId(await resolve(app, state), it0.id);
    expect(r.state).toBe('suggested');
    expect(r.productFlags).toContain('used');
    expect(r.productFlags).not.toContain('replica');
    expect(r.chips?.some((c) => c.key === 'condition')).toBe(true);
  });

  it('5. absent grocery item: «پیدا نشد» with real nearby categories; the other item still plans', async () => {
    let { parsed, state } = await parseToState(app, 'برنج هاشمی، هارد ۲ ترابایت');
    const [rice, hdd] = parsed.items.map((i) => i.id) as [string, string];
    expect(parsed.items[0]!.notes.some((n) => n.code === 'not_in_catalog')).toBe(true);
    const r = await resolve(app, state);
    expect(byId(r, rice).state).toBe('not_found');
    expect(byId(r, rice).reason).toMatch(/پیدا نشد/);
    expect(byId(r, rice).nearbyCategories?.length).toBeGreaterThan(0);
    if (byId(r, hdd).state === 'needs_info') state = settle(state, hdd);
    const p = await plan(app, state);
    expectPlanInvariants(p);
    expect(p.coverage.total).toBe(2);
    expect(p.coverage.covered).toBe(1);
    expect(p.coverage.missing.map((m) => m.itemId)).toEqual([rice]);
    expect(p.totalLine).toMatch(/^فقط ۱ از ۲ مورد/);
  });
});
