/**
 * Suggestion quality on the REAL market.sqlite (audit F3, docs/AUDIT-suggestions.md): every wrong-kind or
 * wrong-unit first suggestion found by the audit, as a regression. parse -> resolve (settled) -> options, exactly as
 * the web app calls them. Skipped when the file is absent; point DATABASE_PATH at it.
 * Assertions are about the KIND of the pick (title head words, stated specs) and the honesty rules, never exact prices.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { answer, byId, expectNoExactSuggestion, options, parseToState, resolve, settle, type App } from './contract-helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');

let app: App;

function productIdByTitle(title: string): string | undefined {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT id FROM products WHERE title = ? AND offer_count > 0').get(title) as { id: number } | undefined;
    return row ? String(row.id) : undefined;
  } finally {
    db.close();
  }
}

/** First suggestion for a one-item request, after «کافیه، پیشنهاد بده» (and a sale-unit answer for wire). */
async function firstPick(text: string, unit?: 'roll' | 'meter'): Promise<{ state: Api.RequirementStateInput; item: Api.ItemResolution }> {
  let { parsed, state } = await parseToState(app, text);
  const id = parsed.items[0]!.id;
  state = settle(state, id);
  let r = await resolve(app, state);
  const q = byId(r, id).question;
  if (unit && q?.id === 'sale_unit') {
    state = answer(state, q, (o) => o.id === `c~eq~sale_unit~"${unit}"`);
    r = await resolve(app, state);
  }
  expectNoExactSuggestion(r);
  const item = byId(r, id);
  expect(item.state).toBe('suggested');
  expect(item.productFlags).toBeUndefined(); // used / replica never auto-picked
  return { state, item };
}

const head = (title: string) => title.trim().split(/[\s‌]+/)[0]!;

describe.skipIf(!HAS_DB)('suggestion quality on market.sqlite (audit F3 regressions)', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('«آداپتور»: an adapter, not the adapter plug «فیش آداپتور…»; the plug stays listed as differing, with the reason', async () => {
    const { state, item } = await firstPick('آداپتور');
    expect(head(item.product!.name)).toMatch(/^آ?داپتور$/);
    const plug = productIdByTitle('فیش آداپتور نری سر زرد دیسمکن 1.7 میلی متری');
    expect(plug).toBeDefined();
    expect(item.product!.id).not.toBe(plug);
    const o = await options(app, state, item.itemId, plug);
    const m = o.models.find((x) => x.productId === plug);
    expect(m?.fit).toBe('differs');
    expect(m?.conflict).toContain('«فیش»');
    expect(o.sellers.length).toBeGreaterThan(0); // the plug's sellers can still be opened
  });

  it('«سیم ۲.۵» by the roll: never a roll listing priced like one metre (e.g. 45,000)', async () => {
    const roll = await firstPick('سیم ۲.۵', 'roll');
    const metre = await firstPick('سیم ۲.۵', 'meter');
    expect(roll.item.unitLabel).toBe('حلقهٔ ۱۰۰ متری');
    // a 100 m roll costs tens of times one metre of the same wire; the bad listings were ~1x
    expect(roll.item.unitPrice!).toBeGreaterThan(10 * metre.item.unitPrice!);
    const bad = productIdByTitle('سیم افشان سیمیا ۲.۵ میلیمتر طول ۱۰۰ متر با روکش PVC');
    expect(bad).toBeDefined();
    expect(roll.item.product!.id).not.toBe(bad);
    const o = await options(app, roll.state, roll.item.itemId, bad);
    const cheap = o.sellers.filter((s) => s.priceNote);
    expect(cheap.length).toBeGreaterThan(0);
    for (const s of cheap) expect(s.price).toBeNull();
  });

  it('«پریز برق»: a socket, not «کلید بین راهی»', async () => {
    const { item } = await firstPick('پریز برق');
    expect(head(item.product!.name)).toBe('پریز');
  });

  it('«ساعت هوشمند»: a watch, not an AirPods cover', async () => {
    const { item } = await firstPick('ساعت هوشمند');
    expect(head(item.product!.name)).toBe('ساعت');
  });

  it('«هدفون»: headphones, not in-ear handsfree; «پاوربانک»: a power bank, not a battery cell', async () => {
    expect(head((await firstPick('هدفون')).item.product!.name)).toBe('هدفون');
    expect(head((await firstPick('پاوربانک')).item.product!.name)).toMatch(/^پاور/);
  });

  it('«پروژکتور خورشیدی»: a floodlight, not a pack of deck lights', async () => {
    const { item } = await firstPick('پروژکتور خورشیدی');
    expect(item.product!.name).toMatch(/پرو?ژکتور/);
  });

  it('stated specs the engine used to drop are honoured: watts, mAh, inches, solid wire', async () => {
    const charger = await firstPick('شارژر ۲۵ وات');
    expect(charger.item.chips?.map((c) => c.label)).toContain('۲۵ وات');
    expect(charger.item.product!.name).toMatch(/(25|۲۵) ?وات/);
    expect((await firstPick('پروژکتور ال ای دی ۱۰۰ وات')).item.product!.name).toMatch(/(100|۱۰۰) ?وات/);
    expect((await firstPick('پاوربانک ۲۰۰۰۰')).item.product!.name).toMatch(/20000|۲۰۰۰۰|(20|۲۰) ?هزار/);
    const tv = await firstPick('تلویزیون سامسونگ ۵۵ اینچ');
    expect(tv.item.product!.name).toMatch(/(55|۵۵) ?اینچ/);
    const solid = await firstPick('سیم ۴ مفتولی', 'roll');
    expect(solid.item.product!.name).not.toMatch(/افشان/);
  });
});
