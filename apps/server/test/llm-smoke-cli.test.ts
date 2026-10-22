import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI_ASSIST_PROMPTS, CLI_PARSE_PROMPTS, main } from '../src/llm/smoke-cli.js';
import { cleanupTmp, tmpDir } from './helpers.js';
import { okLines, writeFakeCli } from './llm-fake-cli.js';
import { buildParseFixture } from './parse-fixture.js';

afterAll(cleanupTmp);

/** A valid assistant decision (and an invalid parse answer): every call answers with it. */
const DECISION = { action: 'set_preference', preference: 'cheapest', shop_id: null, mall_key: null, only_open: null, item_id: null, brand_key: null, attr: null, add_text: null, explanation: null };

describe('llm:smoke:cli (fake CLI; the real CLI is never started)', () => {
  it('is skipped (exit 0) unless LLM_BACKEND=claude-cli, even with an API key', async () => {
    const lines: string[] = [];
    expect(await main({ NODE_ENV: 'test', LLM_API_KEY: 'sk-ant-x' }, (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toMatch(/skipping/);
  });

  it('fails (exit 1) when the CLI cannot be found; under NODE_ENV=test PATH is never searched', async () => {
    const lines: string[] = [];
    expect(await main({ NODE_ENV: 'test', LLM_BACKEND: 'claude-cli', PATH: '/usr/bin:/bin' }, (l) => lines.push(l))).toBe(1);
    expect(lines.join('\n')).toMatch(/not found/);
  });

  it('runs ~10 prompts, reports latency percentiles, validity and 3 samples; never prints the CLI path', async () => {
    const dir = tmpDir();
    const databasePath = buildParseFixture(path.join(dir, 'm.sqlite'));
    const fake = writeFakeCli(dir, { lines: okLines(DECISION) });
    const lines: string[] = [];
    const code = await main({ NODE_ENV: 'test', LLM_BACKEND: 'claude-cli', LLM_CLI_BIN: fake.bin, DATABASE_PATH: databasePath, HOME: dir }, (l) => lines.push(l));
    expect(code).toBe(0);
    const all = lines.join('\n');
    expect(CLI_PARSE_PROMPTS.length + CLI_ASSIST_PROMPTS.length).toBe(10);
    expect(fake.records()).toHaveLength(10);
    expect(all).toMatch(/valid 4\/10 \(40%\) {2}latency p50 \d+ ms {2}p95 \d+ ms/);
    expect(all).toMatch(/parse: zod schema-valid 0\/6 \(0%\), refined 0\/6 \(0%\); assist: valid \(zod \+ ids\) 4\/4 \(100%\)/);
    expect(all).toMatch(/outcomes ok=10/);
    expect(lines.filter((l) => /^ {2}\d\. /.test(l))).toHaveLength(3);
    expect(all).not.toContain(dir);
    expect(all).not.toContain(fake.bin);
  });
});
