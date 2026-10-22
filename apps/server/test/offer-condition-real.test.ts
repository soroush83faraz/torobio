/**
 * D1 on the REAL market.sqlite: a seller whose OWN listing title says «های کپی» / «غیر اصل» / «استوک» (the product
 * title says nothing) is never auto-picked, never the price, never a plan stop unless the user pinned it; it stays
 * listed in /api/options with the flag and the reason. Skipped when the file is absent; point DATABASE_PATH at it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { answer, byId, options, parseToState, plan, settle, type App } from './contract-helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');
/** Copy / used words a seller title may carry (the verifier's sweep regex). */
const BAD = /استوک|کارکرده|دست ?دوم|کپی|ریفربیش|refurb|فیک|replica|اوپن ?باکس|open ?box|طرح اصلی|مشابه اصل|غیر ?اصل/i;

let app: App;
let db: Database.Database;

function sellerTitle(productId: string, shopId: string): string[] {
  return (db.prepare('SELECT seller_title AS t FROM offers WHERE product_id = ? AND shop_id = ?').all(Number(productId), shopId) as { t: string | null }[]).map(
    (r) => r.t ?? '',
  );
}

function expectNoFlaggedLine(p: Api.PlanResponse, pinned: ReadonlySet<string> = new Set()): void {
  for (const s of p.stops)
    for (const l of s.lines) {
      if (pinned.has(l.itemId)) continue;
      expect(l.flags ?? [], l.listingTitle).toEqual([]);
      expect(BAD.test(l.listingTitle), l.listingTitle).toBe(false);
      // the seller title of the offer actually planned (not only the line's display title)
      for (const t of sellerTitle(l.productId!, l.shopId)) expect(BAD.test(t), t).toBe(false);
    }
}

describe.skipIf(!HAS_DB)('offer-level condition on market.sqlite (D1)', () => {
  beforeAll(async () => {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
    db?.close();
  });

  it('«شارژر ۲۰ وات اپل»: the «… های کپی» seller (480 هزار) is not the pick, not the total', async () => {
    const { state } = await parseToState(app, 'شارژر ۲۰ وات اپل');
    const p = await plan(app, state);
    expect(p.totalToman).toBeGreaterThan(0);
    expect(p.totalToman).not.toBe(480_000);
    expectNoFlaggedLine(p);
    for (const it of p.items ?? []) expect(it.productFlags).toBeUndefined();
  });

  it('«هدفون سونی» + budget 9–60 M: the WH-1000XM6 «های کپی» seller is never picked; options show it flagged', async () => {
    const { parsed, state: s0 } = await parseToState(app, 'هدفون سونی');
    const id = parsed.items[0]!.id;
    let state = s0;
    const p0 = await plan(app, state);
    const q = byId({ items: p0.items ?? [] }, id).question;
    expect(q?.id).toBe('budget');
    state = answer(state, q!, (o) => o.id === 'b~9000001~60000000');
    const p = await plan(app, state);
    expectNoFlaggedLine(p);
    const o = await options(app, state, id, '123340');
    const copy = o.sellers.find((s) => s.listingTitle.includes('های کپی'));
    expect(copy).toBeDefined();
    expect(copy!.flags).toEqual(['replica']);
    expect(copy!.flagReason).toBe('در عنوان آگهی فروشنده: های کپی');
    expect(copy!.conditionExcluded).toBe(true);
    const m = o.models.find((x) => x.productId === '123340');
    if (m) {
      expect(m.fit).toBe('differs');
      expect(m.flags).toEqual(['replica']);
      expect(m.conflict).toContain('طبق عنوان آگهی فروشنده');
    }
  });

  it('pinning the product AND that seller plans it, flagged (the user’s explicit choice)', async () => {
    const { parsed, state: s0 } = await parseToState(app, 'هدفون سونی');
    const id = parsed.items[0]!.id;
    const shop = (db.prepare('SELECT shop_id AS s FROM offers WHERE product_id = 123340').get() as { s: string }).s;
    const state = { ...s0, pins: { [id]: '123340' }, shopPins: { [id]: shop } };
    const p = await plan(app, state);
    const line = p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id);
    expect(line?.productId).toBe('123340');
    expect(line?.flags).toEqual(['replica']);
  });

  it('phones, chargers, headphones, power banks, watches: no flagged seller is ever auto-picked (settled)', async () => {
    for (const text of [
      'گوشی سامسونگ گلکسی A56 و قاب و گلس',
      'آیفون ۱۶ پرو مکس ۲۵۶ گیگ و شارژر ۲۰ وات اپل',
      'ایرپاد پرو ۲ و پاوربانک شیائومی ۲۰ هزار',
      'شارژر سامسونگ ۲۵ وات و هندزفری',
      'ساعت هوشمند سامسونگ گلکسی واچ و هدفون انکر',
    ]) {
      const { parsed, state: s0 } = await parseToState(app, text);
      let state = s0;
      for (const it of parsed.items) state = settle(state, it.id);
      expectNoFlaggedLine(await plan(app, state));
    }
  });
});
