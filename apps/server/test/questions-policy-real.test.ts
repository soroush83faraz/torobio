/**
 * Question policy on the real market.sqlite (read-only; skipped when absent). Point DATABASE_PATH at it.
 * Through /api/parse exactly as the web app calls it, the CCTV and phone examples ask at most two questions per
 * item, whichever answers the user gives (first option, last option, or «فرقی نمی‌کند» every time), and every
 * question shown carries its «چرا می‌پرسم» line and per-option consequence hints. Audit: docs/AUDIT-questions.md.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Api, MAX_QUESTIONS_PER_ITEM } from '@app/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { parseToState, resolve, type App } from './contract-helpers.js';
import { makeApp } from './helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');

const EXAMPLES = [
  '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور',
  'دوربین مداربسته',
  'گوشی سامسونگ A56 با قاب و گلس',
  'گوشی موبایل',
  'قاب گوشی',
];

type Strategy = 'first' | 'last' | 'skip';
let app: App;

/** Answer every shown question by `strategy` until none is left; the questions shown per item. */
async function walk(text: string, strategy: Strategy): Promise<Map<string, Api.Question[]>> {
  const { state } = await parseToState(app, text);
  const answers: Record<string, Record<string, string>> = {};
  const shown = new Map<string, Api.Question[]>();
  for (let round = 0; round < 8; round++) {
    const r = await resolve(app, { ...state, answers });
    const asking = r.items.filter((i) => i.question);
    if (!asking.length) break;
    for (const it of asking) {
      const q = it.question!;
      shown.set(it.itemId, [...(shown.get(it.itemId) ?? []), q]);
      const real = q.options.filter((o) => o.id !== Api.SKIP_OPTION_ID);
      const skip = q.options.find((o) => o.id === Api.SKIP_OPTION_ID);
      const opt = strategy === 'skip' ? (skip ?? real[0]!) : strategy === 'first' ? real[0]! : real.at(-1)!;
      answers[it.itemId] = { ...(answers[it.itemId] ?? {}), [q.id]: opt.id };
    }
  }
  return shown;
}

describe.skipIf(!HAS_DB)('question policy on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
  });
  afterAll(async () => {
    await app?.close();
  });

  for (const text of EXAMPLES) {
    it(`«${text}»: at most ${MAX_QUESTIONS_PER_ITEM} questions per item, each explained`, async () => {
      for (const strategy of ['first', 'last', 'skip'] as const) {
        const shown = await walk(text, strategy);
        for (const [itemId, qs] of shown) {
          expect(qs.length, `${strategy} ${itemId}: ${qs.map((q) => q.id).join(', ')}`).toBeLessThanOrEqual(MAX_QUESTIONS_PER_ITEM);
          expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length); // never the same question twice
          for (const q of qs) {
            expect(q.why, q.id).toBeTruthy();
            const real = q.options.filter((o) => o.id !== Api.SKIP_OPTION_ID);
            expect(real.length, q.id).toBeGreaterThanOrEqual(1);
            for (const o of real) expect(o.hint, `${q.id} ${o.label}`).toMatch(/^[۰-۹٬]+ مدل/);
          }
        }
      }
    });
  }

  it('the CCTV example asks the analog-vs-IP question on the camera first and the compat question on the recorder', async () => {
    const shown = await walk(EXAMPLES[0]!, 'first');
    expect(shown.get('i1')?.[0]?.id).toBe('camera_signal');
    expect(shown.get('i2')?.[0]).toMatchObject({ id: 'recorder_kind', kind: 'compat' });
    // the stated specs are never asked again
    expect([...shown.values()].flat().map((q) => q.id)).not.toContain('channels');
    expect(shown.get('i3')?.map((q) => q.id)).not.toContain('capacity_tb');
  });
});
