import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { CASES } from './parse-cases.js';
import { cleanupTmp, testConfig } from './helpers.js';

const realPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : '';
afterAll(cleanupTmp);

describe.skipIf(!realPath || !existsSync(realPath))('POST /api/parse latency on the real database', () => {
  it('p95 over 200 calls stays well under the interactive budget', async () => {
    const config = { ...testConfig(), databasePath: realPath, rateLimit: 100_000 };
    expect(loadConfig({ NODE_ENV: 'test' }).rateLimit).toBeGreaterThan(0);
    const { app } = await buildApp({ config });
    await app.ready();
    const phrases = CASES.map((c) => c.text);
    const timings: number[] = [];
    for (let i = 0; i < 200; i++) {
      const text = phrases[i % phrases.length] as string;
      const t0 = performance.now();
      const res = await app.inject({ method: 'POST', url: '/api/parse', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ text }) });
      timings.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }
    timings.sort((a, b) => a - b);
    const p = (q: number) => timings[Math.min(timings.length - 1, Math.floor(q * timings.length))] as number;
    console.log(`/api/parse latency over ${timings.length} calls (ms): p50=${p(0.5).toFixed(1)} p95=${p(0.95).toFixed(1)} max=${p(1).toFixed(1)}`);
    expect(p(0.95)).toBeLessThan(100);
    await app.close();
  });
});
