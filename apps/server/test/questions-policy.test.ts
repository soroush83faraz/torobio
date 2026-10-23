/**
 * Question policy through the decision API on the hand-made fixture market (runs everywhere):
 * few questions per item (cap 2; a compatibility question is never dropped), every question says why it is asked,
 * every option says where it leads («۳ مدل · از ۵٫۵ میلیون»), an option that keeps nothing is never offered, and
 * every answered question counts against the cap. Ranking and low-value suppression are covered in core
 * (packages/core/src/questions/__tests__); the real-data counts in questions-policy-real.test.ts.
 */
import path from 'node:path';
import { Api, MAX_QUESTIONS_PER_ITEM } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toEngineRequirement } from '../src/adapter/engine.js';
import { buildFixtureMarket, CAT } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { cctvJob, item, state } from './scenarios.js';

const NOW = new Date('2026-10-21T10:00:00+03:30');
type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;

beforeAll(async () => {
  app = (await makeApp({ databasePath: buildFixtureMarket(path.join(tmpDir(), 'm.sqlite')) }, { now: () => NOW })).app;
});
afterAll(async () => {
  await app.close();
  cleanupTmp();
});

async function resolve(s: Api.RequirementState): Promise<Api.ResolveResponse> {
  const res = await app.inject({ method: 'POST', url: '/api/resolve', payload: { state: s } });
  if (res.statusCode !== 200) throw new Error(`resolve ${res.statusCode} ${res.body}`);
  return (res.json() as { data: Api.ResolveResponse }).data;
}
const byId = (r: Api.ResolveResponse, id: string) => r.items.find((i) => i.itemId === id)!;
const job = () => cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter });

/** Answer every shown question with its first real option until none is left; the questions shown per item. */
async function walk(s: Api.RequirementState): Promise<Map<string, Api.Question[]>> {
  const shown = new Map<string, Api.Question[]>();
  for (let round = 0; round < 8; round++) {
    const r = await resolve(s);
    const asking = r.items.filter((i) => i.question);
    if (!asking.length) break;
    for (const it of asking) {
      const q = it.question!;
      shown.set(it.itemId, [...(shown.get(it.itemId) ?? []), q]);
      const opt = q.options.find((o) => o.id !== Api.SKIP_OPTION_ID)!;
      s.answers[it.itemId] = { ...(s.answers[it.itemId] ?? {}), [q.id]: opt.id };
    }
  }
  return shown;
}

describe('question policy on the fixture market', () => {
  it('the CCTV job: at most two questions per item, each with a why and consequence hints', async () => {
    const shown = await walk(job());
    expect(shown.size).toBeGreaterThan(0);
    for (const [, qs] of shown) {
      expect(qs.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ITEM);
      for (const q of qs) {
        expect(q.why, q.id).toBeTruthy();
        for (const o of q.options.filter((x) => x.id !== Api.SKIP_OPTION_ID)) expect(o.hint).toMatch(/^[۰-۹٬]+ مدل/);
      }
    }
  });

  it('the recorder question says how many models and from what price each answer leads to', async () => {
    const q = byId(await resolve(job()), 'rec').question!;
    expect(q.why).toBe(Api.apiCopy.questionWhy.camera_recorder_signal);
    // analog: XVR 10 (5.5 M, eligible) and XVR 14 (4 M, but its channels come from a spec block: counted, never the
    // price); the 8-channel DVR fails the stated «۴ کانال». IP: NVR 11 (6 M)
    expect(q.options.map((o) => o.hint)).toEqual(['۲ مدل · از ۵٫۵ میلیون', '۱ مدل · از ۶ میلیون', undefined]);
  });

  it('an accessory with no phone: which phone, with counts and prices; never an option that keeps nothing', async () => {
    const r = await resolve(state([item('case', 'قاب', { categoryIds: [CAT.phoneCase] })]));
    const q = byId(r, 'case').question!;
    expect(q).toMatchObject({ id: 'fits_models', kind: 'compat' });
    expect(q.options.map((o) => [o.label, o.hint])).toEqual([
      ['Galaxy A56', '۱ مدل · از ۳۰۰ هزار'],
      ['Galaxy A57', '۱ مدل · از ۲۰۰ هزار'],
      ['فرقی نمی‌کند', undefined],
    ]);
  });

  it('a compatibility question is never dropped by the cap', async () => {
    const s = job();
    s.answers = { rec: { brand: Api.SKIP_OPTION_ID, budget: Api.SKIP_OPTION_ID } };
    const rec = byId(await resolve(s), 'rec');
    expect(rec.question).toMatchObject({ id: 'recorder_kind', kind: 'compat' });
    expect(rec.state).toBe('needs_info');
  });

  it('every answered question counts (an option, «فرقی نمی‌کند» or a budget band); stated constraints do not', () => {
    const s = job();
    s.answers = {
      cam: { camera_signal: 'c~eq~camera_signal~"hdcvi"', budget: 'b~1~2000000', brand: Api.SKIP_OPTION_ID, junk: 'not-an-option' },
    };
    const req = toEngineRequirement(s.requirements[0]!, s);
    expect(req.answeredQuestions).toEqual(['camera_signal', 'budget', 'brand']);
    expect(req.skippedQuestions).toEqual(['brand']);
    expect(toEngineRequirement(s.requirements[1]!, s).answeredQuestions).toBeUndefined();
  });
});
