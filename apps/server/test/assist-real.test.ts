/**
 * 'real-data' suite for POST /api/assist on the real market.sqlite (read-only; no LLM key, no network).
 * Skipped when the file is absent. Point DATABASE_PATH at it, e.g.
 *   DATABASE_PATH=/path/to/data/market.sqlite npx vitest run apps/server/test/assist-real.test.ts
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

describe.skipIf(!HAS_DB)('real-data: /api/assist on market.sqlite (deterministic, no key)', () => {
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

  it('the five chip phrases work with no LLM and the new state replans', async () => {
    const base = await plan(job());
    expect(base.stops.length).toBeGreaterThan(0);
    for (const text of ['ارزان‌تر', 'نزدیک‌تر به هم', 'کمتر توقف', 'فقط مغازه‌های باز']) {
      const r = await assist({ text });
      expect(r, text).toMatchObject({ supported: true, source: 'keywords' });
      expect(r.degraded).toBeUndefined();
      await plan(r.newState); // a valid state for the plan route
    }
    const shop = base.stops[0]!.shopId;
    const without = await assist({ text: 'بدون این مغازه', context: { shopId: shop } });
    expect(without.action).toEqual({ type: 'exclude_shop', shopId: shop });
    expect((await plan(without.newState)).stops.map((s) => s.shopId)).not.toContain(shop);
  });

  it('excluding a mall of the plan removes it from the replan (or refuses calmly when it is too big)', async () => {
    const base = await plan(job());
    const stop = base.stops.find((s) => s.buildingKey?.startsWith('m:') && s.mall);
    if (!stop) return;
    const r = await assist({ text: `پاساژ ${stop.mall} رو نمی‌خوام` });
    console.log(`[real-data] exclude mall ${stop.buildingKey}: ${r.supported ? `applied (${r.newState.excludedShops['*']?.length} shops)` : 'refused'}`);
    if (r.supported) {
      expect(r.action).toEqual({ type: 'exclude_mall', mallKey: stop.buildingKey });
      expect((await plan(r.newState)).stops.map((s) => s.buildingKey)).not.toContain(stop.buildingKey);
    } else {
      expect(r.messageFa).toMatch(/[؀-ۿ]/);
      expect(r.newState).toEqual(job());
    }
  });

  it('swapping the camera brand uses the real facets and the replan follows', async () => {
    const r = await assist({ text: 'به‌جای داهوا هایک‌ویژن بذار' });
    expect(r).toMatchObject({ supported: true, action: { type: 'swap_brand', itemId: 'cam', brand: 'hikvision' } });
    const p = await plan(r.newState);
    const cam = p.items?.find((i) => i.itemId === 'cam');
    expect(cam?.state).not.toBe('not_found');
  });

  it('stays interactive', async () => {
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      await assist({ chip: i % 2 ? 'cheaper' : 'fewer_stops' });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(0.95 * times.length)]!;
    console.log(`[real-data] /api/assist chip latency ms p50=${times[20]!.toFixed(1)} p95=${p95.toFixed(1)}`);
    expect(p95).toBeLessThan(300);
  });
});
