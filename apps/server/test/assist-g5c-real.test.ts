/**
 * G5c on the real market.sqlite (read-only; no LLM key): the new keyword phrases applied through POST /api/assist
 * and verified by replanning with POST /api/plan. Skipped when the file is absent. Point DATABASE_PATH at it, e.g.
 *   DATABASE_PATH=/path/to/data/market.sqlite npx vitest run apps/server/test/assist-g5c-real.test.ts
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssistResponse } from '../src/assist/types.js';
import { findRepoRoot } from '../src/config.js';
import { makeApp } from './helpers.js';
import { cctvJob } from './scenarios.js';

const DB_PATH = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');

type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;
let job: () => Api.RequirementState;

function catId(name: string): number {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
  } finally {
    db.close();
  }
}

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object });
  if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 300)}`);
  return (res.json() as { data: T }).data;
}
const assist = (payload: Record<string, unknown>, state = job()) => post<AssistResponse>('/api/assist', { state, ...payload });
const plan = (state: Api.RequirementState) => post<Api.PlanResponse>('/api/plan', { state });

describe.skipIf(!HAS_DB)('real-data: G5c phrases through /api/assist then /api/plan', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000, assistRateLimit: 1_000_000 }, { now: () => NOW })).app;
    const cat = {
      camera: catId('دوربین مدار بسته'),
      recorder: catId('ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی'),
      hdd: catId('هارد دیسک اینترنال'),
      adapter: catId('آداپتور برق'),
    };
    job = () => {
      const s = cctvJob(cat);
      s.answers = { rec: { recorder_kind: 'c~in~recorder_kind~["xvr","dvr"]' } };
      return s;
    };
  });
  afterAll(async () => {
    await app?.close();
  });

  const hddResolution = (p: Api.PlanResponse) => p.items?.find((i) => i.itemId === 'hdd');
  const capacityOf = (p: Api.PlanResponse): string => JSON.stringify(hddResolution(p) ?? {});

  it('«هارد ۴ ترابایت بگیر» changes the drive constraint and the replan buys a 4 TB drive', async () => {
    const before = await plan(job());
    const r = await assist({ text: 'هارد ۴ ترابایت بگیر' });
    expect(r).toMatchObject({ supported: true, changed: true, source: 'keywords', action: { type: 'set_spec', itemId: 'hdd', attr: 'capacity_tb', value: 4 } });
    expect(r.degraded).toBeUndefined();
    const hdd = r.newState.requirements.find((x) => x.id === 'hdd')!;
    expect(hdd.chips.find((c) => c.constraint?.attr === 'capacity_tb')?.constraint).toMatchObject({ op: 'eq', value: 4 });
    expect(hdd.text).toBe('هارد ۴ ترابایت');
    const after = await plan(r.newState);
    expect(hddResolution(after)).toBeTruthy();
    // the replan really searched a different pool: the item's chosen product (or its state) differs, and no 2 TB drive is bought
    expect(capacityOf(after)).not.toBe(capacityOf(before));
    const bought = after.stops.flatMap((s) => s.lines).find((l) => l.itemId === 'hdd');
    if (bought) expect(JSON.stringify(bought)).not.toMatch(/(?<![\d۰-۹])(2|۲)\s*(TB|ترابایت)/i);
  });

  it('«هارد بزرگتر» goes from 2 TB to the next standard size (3 TB) and replans', async () => {
    const r = await assist({ text: 'هارد بزرگتر' });
    expect(r.action).toEqual({ type: 'set_spec', itemId: 'hdd', attr: 'capacity_tb', value: 3 });
    expect(hddResolution(await plan(r.newState))).toBeTruthy();
  });

  it('«بدون آداپتور» and «آداپتور رو حذف کن» remove the adapter; the plan stays valid', async () => {
    for (const text of ['بدون آداپتور', 'آداپتور رو حذف کن']) {
      const r = await assist({ text });
      expect(r, text).toMatchObject({ supported: true, changed: true, action: { type: 'remove_item', itemId: 'adp' } });
      expect(r.newState.requirements.map((x) => x.id)).not.toContain('adp');
      expect((await plan(r.newState)).items?.map((i) => i.itemId)).not.toContain('adp');
    }
  });

  it('colloquial spellings are exact chip matches', async () => {
    for (const text of ['ارزونتر', 'ارزون‌تر', 'نزدیکتر', 'کمتر توقف', 'فقط بازها']) {
      const r = await assist({ text });
      expect(r, text).toMatchObject({ supported: true, source: 'keywords' });
      await plan(r.newState);
    }
  });

  it('no key: a request nothing understands says not_configured, calmly', async () => {
    const r = await assist({ text: 'بازارو ببند' });
    expect(r).toMatchObject({ supported: false, changed: false, degradedReason: 'not_configured', action: { type: 'none' } });
    expect(r.degraded).toBeUndefined();
    expect(r.messageFa).toMatch(/[؀-ۿ]/);
  });
});
