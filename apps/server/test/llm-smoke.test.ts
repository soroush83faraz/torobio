import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { ASSIST_PROMPTS, main, PARSE_PROMPTS, runSmoke } from '../src/llm/smoke.js';
import { cleanupTmp, tmpDir } from './helpers.js';
import { FakeLlmClient } from './llm-fake.js';
import { buildParseFixture } from './parse-fixture.js';

afterAll(cleanupTmp);

describe('llm:smoke', () => {
  it('is skipped (exit 0) without LLM_API_KEY', async () => {
    const lines: string[] = [];
    expect(await main({ NODE_ENV: 'test' }, (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toMatch(/skipping/);
  });

  it('never prints the key, prompts or model output (offline client under NODE_ENV=test)', async () => {
    const lines: string[] = [];
    const KEY = 'sk-ant-SMOKE-SECRET-123';
    const code = await main({ NODE_ENV: 'test', LLM_API_KEY: KEY, LLM_TIMEOUT_MS: '500', DATABASE_PATH: path.join(tmpDir(), 'none.sqlite') }, (l) => lines.push(l));
    expect(code).toBe(0);
    const all = lines.join('\n');
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(PARSE_PROMPTS[0]!);
    expect(all).toMatch(/valid 0\/20/);
    expect(all).toMatch(/outcomes .*network=/);
  });

  it('computes latency percentiles and the validity rate over ~20 Persian prompts', async () => {
    const db = openDb(buildParseFixture(path.join(tmpDir(), 'm.sqlite')));
    const fake = new FakeLlmClient({ reply: '{"not":"valid"}' });
    const lines: string[] = [];
    const stats = await runSmoke({ llm: fake, db, timeoutMs: 300, out: (l) => lines.push(l) });
    db.close();
    expect(stats.total).toBe(PARSE_PROMPTS.length + ASSIST_PROMPTS.length);
    expect(stats.total).toBeGreaterThanOrEqual(20);
    expect(stats.valid).toBe(0);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
    expect(fake.calls.map((c) => c.op).filter((o) => o === 'smoke')).toHaveLength(ASSIST_PROMPTS.length);
    expect(lines.at(-2)).toMatch(/^valid 0\/20 \(0%\)  latency p50 \d+ ms  p95 \d+ ms$/);
  });
});
