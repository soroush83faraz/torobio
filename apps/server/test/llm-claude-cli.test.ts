import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  buildCliArgs,
  ClaudeCliLlmClient,
  CLI_BASE_ARGS,
  classifyResultFailure,
  cliPromptText,
  CliStreamChecker,
  hasToolCallMarkup,
  resolveCliBin,
  type ClaudeCliOptions,
} from '../src/llm/claude-cli-client.js';
import { AnthropicLlmClient, CircuitBreaker, createLlmClient, LlmConfigError, LlmError, llmUsable, NullLlmClient, type LlmRequest } from '../src/llm/client.js';
import type { ParseResult } from '../src/parse/index.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { initEvent, okLines, resultEvent, toolResultEvent, toolUseEvent, writeFakeCli, type FakeCliScenario, type FakeLine } from './llm-fake-cli.js';
import { buildParseFixture } from './parse-fixture.js';

// Every test here drives a FAKE `claude` executable (test/llm-fake-cli.ts). The real CLI is never started: the
// client only runs the absolute path it is given, and the factory never looks `claude` up on PATH under NODE_ENV=test.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCHEMA = { type: 'object', properties: { word: { type: 'string' } }, required: ['word'], additionalProperties: false };
const SYSTEM = 'SYSTEM-MARKER static system prompt';
const USER = '<user_text>\nUSER-MARKER یه هارد بزرگ لازم دارم\n</user_text>';
const req = (o: Partial<LlmRequest> = {}): LlmRequest => ({ op: 'parse', system: SYSTEM, user: USER, schema: SCHEMA, maxTokens: 300, ...o });

/** The server's environment as the client sees it: full of things that must never reach the CLI. */
const PARENT_ENV: NodeJS.ProcessEnv = {
  HOME: '/home/tester',
  PATH: '/opt/evil/bin:.:/usr/bin',
  LLM_API_KEY: 'sk-ant-SECRET-1',
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-2',
  ANTHROPIC_BASE_URL: 'https://evil.example',
  NODE_OPTIONS: '--require /tmp/evil.js',
  CLAUDECODE: '1',
  CLAUDE_CODE_MESSAGING_TOKEN: 'SECRET-3',
  CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
  AWS_SECRET_ACCESS_KEY: 'SECRET-4',
  DATABASE_PATH: '/srv/evil/market.sqlite',
  HTTPS_PROXY: 'http://proxy.local:3128',
  NO_PROXY: 'localhost',
  CLAUDE_CONFIG_DIR: '/home/tester/.claude',
};

const EXPECTED_ENV_KEYS = [
  'HOME',
  'PATH',
  'LANG',
  'TMPDIR',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_THINKING', // haiku + thinking 'auto', as the API client
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_AUTOUPDATER',
  'DISABLE_TELEMETRY',
  'DISABLE_ERROR_REPORTING',
  'CLAUDE_CODE_DISABLE_FILE_MENTIONS',
  'CLAUDE_CODE_DISABLE_ATTACHMENTS',
  'CLAUDE_CODE_DISABLE_CLAUDE_MDS',
  'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
  'ENABLE_CLAUDEAI_MCP_SERVERS',
  'CLAUDE_CONFIG_DIR',
  'HTTPS_PROXY',
  'NO_PROXY',
];

const clients: ClaudeCliLlmClient[] = [];
const apps: { close(): Promise<undefined | void> }[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.idle()));
  await Promise.all(apps.splice(0).map((a) => a.close()));
  cleanupTmp();
});

function cli(scenario: FakeCliScenario, o: Partial<ClaudeCliOptions> = {}) {
  const dir = tmpDir();
  const tmpBase = path.join(dir, 'calls');
  mkdirSync(tmpBase);
  const fake = writeFakeCli(dir, scenario);
  const events: Array<{ op: string; outcome: string; ms: number }> = [];
  const client = new ClaudeCliLlmClient({ bin: fake.bin, model: 'claude-haiku-5-5', timeoutMs: 5000, env: PARENT_ENV, tmpBase, onOutcome: (e) => events.push(e), ...o });
  clients.push(client);
  return { client, fake, events, tmpBase };
}

/** Dead or a zombie (killed, not yet reaped by its new parent). */
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    return /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return true;
  }
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

describe('ClaudeCliLlmClient: a call (fake CLI)', () => {
  it('returns the structured output as JSON; prompt on stdin; empty private cwd outside the repo, removed afterwards', async () => {
    const { client, fake, events, tmpBase } = cli({ lines: okLines({ word: 'هارد' }) });
    expect(client.backend).toBe('claude-cli');
    expect(llmUsable(client)).toBe(true);
    expect(JSON.parse(await client.complete(req()))).toEqual({ word: 'هارد' });
    const [rec] = fake.records();
    expect(rec!.stdin).toBe(USER);
    expect(rec!.cwdEntries).toEqual([]);
    expect(path.basename(rec!.cwd)).toBe('cwd');
    expect(rec!.cwd.startsWith(REPO_ROOT + path.sep)).toBe(false);
    expect(rec!.system).toBe(SYSTEM);
    expect(rec!.systemMode).toBe(0o600);
    expect(path.dirname(rec!.systemFile!)).not.toBe(rec!.cwd); // the cwd stays empty
    await client.idle();
    expect(existsSync(path.dirname(rec!.cwd))).toBe(false);
    expect(readdirSync(tmpBase)).toEqual([]);
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!).sort()).toEqual(['ms', 'op', 'outcome']);
    expect(events[0]).toMatchObject({ op: 'parse', outcome: 'ok' });
    expect(JSON.stringify(events)).not.toMatch(/MARKER|هارد/);
  });

  it('argv: static flags, model, system prompt FILE and static schema; never prompt text', async () => {
    const { client, fake } = cli({ lines: okLines({ word: 'x' }) });
    await client.complete(req());
    const [rec] = fake.records();
    expect(rec!.argv).toEqual(buildCliArgs({ model: 'claude-haiku-5-5', systemFile: rec!.systemFile!, schemaJson: JSON.stringify(SCHEMA) }));
    expect(rec!.argv.slice(0, CLI_BASE_ARGS.length)).toEqual([...CLI_BASE_ARGS]);
    for (const a of rec!.argv) {
      expect(a).not.toContain('USER-MARKER');
      expect(a).not.toContain('هارد');
      expect(a).not.toContain('SYSTEM-MARKER');
    }
    const at = (flag: string) => rec!.argv[rec!.argv.indexOf(flag) + 1];
    expect(at('--tools')).toBe('');
    expect(at('--setting-sources')).toBe('');
    for (const f of ['-p', '--strict-mcp-config', '--safe-mode', '--restricted', '--disable-slash-commands', '--no-session-persistence', '--permission-mode=dontAsk', '--permission-prompts=none', '--output-format=stream-json', '--include-hook-events']) {
      expect(rec!.argv).toContain(f);
    }
    expect(rec!.argv.some((a) => /dangerously|bypass|--add-dir|--mcp-config|--allowed-?tools|--plugin|--settings[= ]|--agents?\b|--resume|--continue/i.test(a))).toBe(false);
  });

  it('environment: an explicit allowlist (no API keys, NODE_OPTIONS, parent session tokens or unrelated variables)', async () => {
    const { client, fake } = cli({ lines: okLines({ word: 'x' }) });
    await client.complete(req());
    const [rec] = fake.records();
    expect(Object.keys(rec!.env).sort()).toEqual([...EXPECTED_ENV_KEYS].sort());
    expect(rec!.env).toMatchObject({ HOME: '/home/tester', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '300', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });
    expect(rec!.env.TMPDIR).toBe(path.join(path.dirname(rec!.cwd), 'tmp'));
    expect(JSON.stringify(rec!.env)).not.toMatch(/SECRET|evil|sdk-ts/);
  });

  it('stdin: invisible / bidi / control characters stripped (line feeds and ZWNJ kept), @ inert, untagged text wrapped', async () => {
    const zwnj = String.fromCodePoint(0x200c);
    const { client, fake } = cli({ lines: okLines({ word: 'x' }) });
    await client.complete(req({ user: `<user_text>\nمی${zwnj}خوام‮ @/etc/passwd\u0000\r\nok⁦x⁩\n</user_text>` }));
    await client.complete(req({ user: '/login !cat ~/.ssh/id_rsa #remember' }));
    const [a, b] = fake.records();
    expect(a!.stdin).toBe(`<user_text>\nمی${zwnj}خوام ＠/etc/passwd\nokx\n</user_text>`);
    expect(b!.stdin).toBe('<input>\n/login !cat ~/.ssh/id_rsa #remember\n</input>');
    expect(cliPromptText('a@b')).toBe('<input>\na＠b\n</input>');
  });

  it('a result carrying the JSON only in its text is accepted; prose for a schema call is not', async () => {
    const a = cli({ lines: [initEvent(), resultEvent(undefined, { result: '{"word":"x"}' })] });
    expect(JSON.parse(await a.client.complete(req()))).toEqual({ word: 'x' });
    const b = cli({ lines: [initEvent(), resultEvent(undefined, { result: 'Sure! Here is the JSON: {"word":"x"}' })] });
    await expect(b.client.complete(req())).rejects.toMatchObject({ kind: 'invalid_output' });
  });
});

describe('ClaudeCliLlmClient: failures (all LlmError, never CLI text)', () => {
  it('timeout: answered at the budget; the whole process group is killed (grandchild too); temp dir removed', async () => {
    const { client, fake, events, tmpBase } = cli({ lines: [initEvent()], hang: true, grandchild: true, ignoreTerm: true }, { timeoutMs: 500, killGraceMs: 50 });
    const t0 = Date.now();
    const err = await client.complete(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(2500);
    await client.idle();
    const [rec] = fake.records();
    expect(await waitFor(() => gone(rec!.pid))).toBe(true);
    expect(await waitFor(() => gone(rec!.grandchildPid!))).toBe(true);
    expect(readdirSync(tmpBase)).toEqual([]);
    expect(events.map((e) => e.outcome)).toEqual(['timeout']);
  });

  it("a caller's abort kills the process (counted as a timeout)", async () => {
    const { client, fake } = cli({ lines: [initEvent()], hang: true }, { timeoutMs: 20_000 });
    const ac = new AbortController();
    const call = client.complete(req({ signal: ac.signal }));
    expect(await waitFor(() => fake.records().length === 1)).toBe(true);
    ac.abort();
    await expect(call).rejects.toMatchObject({ kind: 'timeout' });
    await client.idle();
    expect(await waitFor(() => gone(fake.records()[0]!.pid))).toBe(true);
    // an already-aborted signal never starts a process
    await expect(client.complete(req({ signal: AbortSignal.abort() }))).rejects.toMatchObject({ kind: 'timeout' });
    expect(fake.records()).toHaveLength(1);
  });

  it('non-JSON output: invalid_output, killed, and counted as a backend failure', async () => {
    const breaker = new CircuitBreaker({ threshold: 5 });
    const { client, fake } = cli({ lines: ['Hello! I am not stream-json.', initEvent()], hang: true }, { breaker });
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(breaker.failureCount).toBe(1);
    await client.idle();
    expect(await waitFor(() => gone(fake.records()[0]!.pid))).toBe(true);
  });

  it('oversized output: the process is killed at the byte cap (truncated)', async () => {
    const { client, fake } = cli({ lines: [initEvent()], floodBytes: 4_000_000, hang: true }, { maxStdoutBytes: 64 * 1024 });
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'truncated' });
    await client.idle();
    expect(await waitFor(() => gone(fake.records()[0]!.pid))).toBe(true);
  });

  it('an oversized answer inside a valid result is rejected (truncated)', async () => {
    const { client } = cli({ lines: okLines({ word: 'x'.repeat(25_000) }) });
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('non-zero exit without a result: provider; API statuses in the result are mapped, a 401 trips the breaker hard', async () => {
    const a = cli({ exitCode: 1 });
    const err = await a.client.complete(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'provider' });
    expect(String((err as Error).message)).toBe('llm_provider');

    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    const failed = resultEvent(undefined, { is_error: true, api_error_status: 401, result: 'Failed to authenticate. USER-MARKER' });
    const b = cli({ lines: [initEvent(), failed], exitCode: 1 }, { breaker, now: () => t });
    const e2 = await b.client.complete(req()).catch((e: unknown) => e);
    expect(e2).toMatchObject({ kind: 'auth' });
    expect(String((e2 as Error).message)).not.toMatch(/authenticate|MARKER/);
    expect(breaker.state).toBe('open');
    t += 5 * 60_000 - 1;
    expect(breaker.state).toBe('open');
    t += 1;
    expect(breaker.state).toBe('half_open');
  });

  it.each([
    [{ api_error_status: 403 }, 'forbidden'],
    [{ api_error_status: 404 }, 'model_not_found'],
    [{ api_error_status: 429 }, 'rate_limited'],
    [{ api_error_status: 400 }, 'bad_request'],
    [{ api_error_status: 500 }, 'server'],
    [{ api_error_status: 529 }, 'overloaded'],
    [{ api_error_status: null, subtype: 'error_during_execution' }, 'provider'],
    [{ api_error_status: null, subtype: 'error_max_turns' }, 'truncated'],
    [{ api_error_status: null, subtype: 'error_max_budget_usd' }, 'truncated'],
    [{ api_error_status: null, subtype: 'error_max_structured_output_retries' }, 'invalid_output'],
  ] as const)('result failure %j -> %s', (r, kind) => {
    expect(classifyResultFailure({ subtype: 'success', ...r }).kind).toBe(kind);
  });

  it('content errors (structured-output retries exhausted, empty answer, tool markup) leave the breaker closed', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    const retries = { type: 'result', subtype: 'error_max_structured_output_retries', is_error: true };
    const a = cli({ lines: [initEvent(), retries] }, { breaker });
    await expect(a.client.complete(req())).rejects.toMatchObject({ kind: 'invalid_output' });
    const b = cli({ lines: [initEvent(), resultEvent(undefined, { result: '  ' })] }, { breaker });
    await expect(b.client.complete(req())).rejects.toMatchObject({ kind: 'empty' });
    const c = cli({ lines: okLines({ word: '<function_calls><invoke name="Bash">' }) }, { breaker });
    await expect(c.client.complete(req())).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(breaker.state).toBe('closed');
    expect(breaker.failureCount).toBe(0);
  });

  it('the binary vanished since start-up: not_configured, circuit opened hard', async () => {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 3, now: () => t });
    const client = new ClaudeCliLlmClient({ bin: path.join(tmpDir(), 'no-such-claude'), model: 'claude-haiku-5-5', timeoutMs: 2000, env: PARENT_ENV, breaker, now: () => t });
    clients.push(client);
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'not_configured' });
    await client.idle();
    expect(breaker.state).toBe('open');
  });
});

describe('ClaudeCliLlmClient: isolation is verified on every call', () => {
  const answer = { word: 'x' };
  const tail: FakeLine[] = [toolUseEvent(answer), toolResultEvent(), resultEvent(answer)];
  it.each([
    ['an extra built-in tool', [initEvent(['StructuredOutput', 'Bash']), ...tail]],
    ['an MCP tool', [initEvent(['StructuredOutput', 'mcp__files__read']), ...tail]],
    ['a connected MCP server', [initEvent(['StructuredOutput'], { mcp_servers: [{ name: 'files', status: 'connected' }] }), ...tail]],
    ['another permission mode', [initEvent(['StructuredOutput'], { permissionMode: 'bypassPermissions' }), ...tail]],
    ['a malformed init event', [{ type: 'system', subtype: 'init', tools: 'all' }, ...tail]],
    ['a hook event', [initEvent(), { type: 'system', subtype: 'hook_started', hook_event: 'PreToolUse' }, ...tail]],
    ['a tool_use of another tool', [initEvent(), toolUseEvent({ command: 'cat ~/.claude/.credentials.json' }, 'Bash'), ...tail]],
    ['a nameless tool_use', [initEvent(), { type: 'assistant', message: { content: [{ type: 'tool_use', input: {} }] } }, ...tail]],
    ['no init event before the answer', tail],
  ] as const)('%s -> killed, isolation, circuit open for 10 minutes', async (_name, lines) => {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
    const { client, fake } = cli({ lines: [...lines], hang: true }, { breaker, now: () => t });
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'isolation' });
    expect(breaker.state).toBe('open');
    t += 10 * 60_000 - 1;
    expect(breaker.state).toBe('open');
    await client.idle();
    expect(await waitFor(() => gone(fake.records()[0]!.pid))).toBe(true);
  });

  it('without a schema not even the StructuredOutput tool is allowed', async () => {
    const { client } = cli({ lines: okLines({ word: 'x' }) });
    await expect(client.complete(req({ schema: undefined }))).rejects.toMatchObject({ kind: 'isolation' });
  });

  it('a plain-text call (no schema) returns the result text', async () => {
    const { client } = cli({ lines: [initEvent([]), { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }, resultEvent(undefined, { result: 'hi' })] });
    expect(await client.complete(req({ schema: undefined }))).toBe('hi');
  });

  it('unknown event types are ignored; events before init other than messages are fine', () => {
    const c = new CliStreamChecker(new Set(['StructuredOutput']));
    expect(c.accept({ type: 'system', subtype: 'ui_invalidate' })).toEqual({ kind: 'continue' });
    expect(c.accept({ type: 'rate_limit_event' })).toEqual({ kind: 'continue' });
    expect(c.accept(initEvent())).toEqual({ kind: 'continue' });
    expect(c.accept({ type: 'stream_event', event: {} })).toEqual({ kind: 'continue' });
    expect(c.accept({ type: 'result', subtype: 'success' })).toEqual({ kind: 'invalid' }); // no is_error
  });
});

describe('ClaudeCliLlmClient: breaker and concurrency', () => {
  it('the breaker opens after N consecutive failures; while open the CLI is not even started; a probe closes it', async () => {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
    const failing = cli({ exitCode: 3 }, { breaker, now: () => t });
    await expect(failing.client.complete(req())).rejects.toMatchObject({ kind: 'provider' });
    expect(failing.client.available()).toBe(true);
    await expect(failing.client.complete(req())).rejects.toMatchObject({ kind: 'provider' });
    await failing.client.idle();
    expect(failing.client.available()).toBe(false);
    expect(llmUsable(failing.client)).toBe(false);
    await expect(failing.client.complete(req())).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(failing.fake.records()).toHaveLength(2);
    t = 1000;
    const healthy = cli({ lines: okLines({ word: 'x' }) }, { breaker, now: () => t });
    expect(healthy.client.available()).toBe(true); // half-open: one probe
    expect(JSON.parse(await healthy.client.complete(req()))).toEqual({ word: 'x' });
    expect(breaker.state).toBe('closed');
  });

  it('concurrency cap 1: a second call while a process runs fails fast with busy, starts nothing, spares the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    const { client, fake, events } = cli({ lines: okLines({ word: 'x' }), delayMs: 400 }, { maxConcurrent: 1, breaker });
    const first = client.complete(req());
    expect(client.inFlight).toBe(1);
    expect(client.available()).toBe(false);
    const t0 = Date.now();
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'busy' });
    expect(Date.now() - t0).toBeLessThan(200);
    expect(JSON.parse(await first)).toEqual({ word: 'x' });
    await client.idle();
    expect(client.available()).toBe(true);
    expect(fake.records()).toHaveLength(1);
    expect(events.map((e) => e.outcome)).toEqual(['busy', 'ok']);
    expect(breaker.state).toBe('closed');
  });

  it('an answered call frees its slot at once; its lingering process is killed after 2 s; live processes <= 2 x cap', async () => {
    const { client, fake } = cli({ lines: okLines({ word: 'x' }), hang: true }, { maxConcurrent: 1 });
    expect(JSON.parse(await client.complete(req()))).toEqual({ word: 'x' });
    expect(client.inFlight).toBe(0);
    expect(client.alive).toBe(1); // answered, still exiting
    expect(JSON.parse(await client.complete(req()))).toEqual({ word: 'x' }); // no wait for the first one to exit
    expect(client.alive).toBe(2);
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'busy' }); // hard process cap
    await client.idle();
    expect(client.alive).toBe(0);
    for (const r of fake.records()) expect(await waitFor(() => gone(r.pid))).toBe(true);
    expect(fake.records()).toHaveLength(2);
  });

  it('the cap is 2 at most, whatever is configured', async () => {
    const { client, fake } = cli({ lines: okLines({ word: 'x' }), delayMs: 300 }, { maxConcurrent: 10 });
    const a = client.complete(req());
    const b = client.complete(req());
    await expect(client.complete(req())).rejects.toMatchObject({ kind: 'busy' });
    await Promise.all([a, b]);
    await client.idle();
    expect(fake.records()).toHaveLength(2);
  });

  it('oversized requests are refused before anything starts', async () => {
    const { client, fake } = cli({ lines: okLines({ word: 'x' }) });
    await expect(client.complete(req({ user: `<user_text>${'ب'.repeat(40_000)}</user_text>` }))).rejects.toMatchObject({ kind: 'bad_request' });
    expect(fake.records()).toHaveLength(0);
  });
});

describe('pure helpers', () => {
  it('hasToolCallMarkup: tool-call formats anywhere in keys or values; ordinary Persian text is fine', () => {
    for (const bad of [
      '<function_calls>',
      '</invoke>',
      '<parameter name="command">',
      '<tool_use>',
      'x <invoke name="Bash">',
      '{"type":"tool_use","name":"Bash"}',
      '{"tool_calls":[]}',
      '{ "type" : "function" }',
    ]) {
      expect(hasToolCallMarkup({ items: [{ text: bad }] }), bad).toBe(true);
    }
    expect(hasToolCallMarkup({ tool_use_id: 'x' })).toBe(true);
    expect(hasToolCallMarkup({ items: [{ text: 'دوربین داهوا ۲ مگاپیکسل', qty: 4, constraints: [{ attr: 'brand', op: 'eq', value: 'dahua', values: null }] }] })).toBe(false);
    expect(hasToolCallMarkup({ explanation: 'این دو مغازه ارزان‌ترند؛ invoke یا function کلمه‌اند، نه فراخوانی.' })).toBe(false);
  });

  it('resolveCliBin: absolute executables only; relative PATH entries and dangling links are skipped; no lookup in tests', () => {
    const dir = tmpDir();
    const good = path.join(dir, 'good');
    const rel = path.join(dir, 'rel');
    const dangling = path.join(dir, 'dangling');
    for (const d of [good, rel, dangling]) mkdirSync(d);
    writeFileSync(path.join(good, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(path.join(dir, 'plain'), 'not executable', { mode: 0o644 });
    symlinkSync(path.join(dir, 'nowhere', 'claude'), path.join(dangling, 'claude'));
    expect(resolveCliBin({ explicit: 'claude', lookupPath: true })).toBeNull();
    expect(resolveCliBin({ explicit: path.join(dir, 'plain'), lookupPath: true })).toBeNull();
    expect(resolveCliBin({ explicit: path.join(good, 'claude'), lookupPath: false })).toBe(path.join(good, 'claude'));
    expect(resolveCliBin({ pathEnv: ['.', 'rel', dangling, good].join(path.delimiter), lookupPath: true })).toBe(path.join(good, 'claude'));
    expect(resolveCliBin({ pathEnv: good, lookupPath: false })).toBeNull();
  });

  it('an invalid model id leaves the client unconfigured (it would be an argv element)', async () => {
    const dir = tmpDir();
    const fake = writeFakeCli(dir, { lines: okLines({ word: 'x' }) });
    const c = new ClaudeCliLlmClient({ bin: fake.bin, model: '--dangerously-skip-permissions', timeoutMs: 1000, env: PARENT_ENV });
    expect(c.configured).toBe(false);
    await expect(c.complete(req())).rejects.toMatchObject({ kind: 'not_configured' });
    expect(fake.records()).toHaveLength(0);
  });
});

describe('backend selection (LLM_BACKEND)', () => {
  const base = { llmModel: 'claude-haiku-5-5', llmTimeoutMs: 1000 };

  it('default: anthropic with a key, none without; none overrides a key; anthropic without a key is none', () => {
    expect(createLlmClient({ ...base, llmApiKey: 'k' })).toBeInstanceOf(AnthropicLlmClient);
    expect(createLlmClient({ ...base, llmApiKey: 'k' }).backend).toBe('anthropic');
    expect(createLlmClient(base)).toBeInstanceOf(NullLlmClient);
    expect(createLlmClient({ ...base, llmApiKey: 'k', llmBackend: 'none' })).toBeInstanceOf(NullLlmClient);
    expect(createLlmClient({ ...base, llmBackend: 'anthropic' })).toBeInstanceOf(NullLlmClient);
  });

  it('claude-cli only when selected; under NODE_ENV=test `claude` is never looked up on PATH', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = { PATH: dir, HOME: dir };
    const inTest = createLlmClient({ ...base, llmBackend: 'claude-cli', nodeEnv: 'test', llmApiKey: 'sk-ant-unused' }, { env });
    expect(inTest).toBeInstanceOf(ClaudeCliLlmClient);
    expect(inTest.backend).toBe('claude-cli');
    expect(inTest.configured).toBe(false);
    const dev = createLlmClient({ ...base, llmBackend: 'claude-cli', nodeEnv: 'development' }, { env });
    expect(dev.configured).toBe(true);
    expect(createLlmClient({ ...base, llmBackend: 'claude-cli', nodeEnv: 'development' }, { env: { PATH: '/nonexistent', HOME: dir } }).configured).toBe(false);
  });

  it('production: refused unless LLM_ALLOW_CLI_IN_PROD=1, both in loadConfig and in the factory', () => {
    let err: unknown;
    try {
      loadConfig({ NODE_ENV: 'production', LLM_BACKEND: 'claude-cli' });
    } catch (e) {
      err = e;
    }
    expect((err as { issues?: { path: unknown[] }[] }).issues?.map((i) => i.path.join('.'))).toEqual(['LLM_BACKEND']);
    expect(loadConfig({ NODE_ENV: 'production', LLM_BACKEND: 'claude-cli', LLM_ALLOW_CLI_IN_PROD: '1' }).llmBackend).toBe('claude-cli');
    expect(() => createLlmClient({ ...base, llmBackend: 'claude-cli', nodeEnv: 'production' })).toThrow(LlmConfigError);
    expect(createLlmClient({ ...base, llmBackend: 'claude-cli', nodeEnv: 'production', llmAllowCliInProd: true }, { env: { PATH: '' } })).toBeInstanceOf(ClaudeCliLlmClient);
    // the API backend is unaffected
    expect(loadConfig({ NODE_ENV: 'production', LLM_API_KEY: 'k' }).llmBackend).toBe('anthropic');
  });

  it('config: explicit opt-in, CLI defaults (longer budgets, one process), strict validation', () => {
    expect(loadConfig({ LLM_API_KEY: 'k' }).llmBackend).toBe('anthropic');
    expect(loadConfig({}).llmBackend).toBe('none');
    expect(loadConfig({}).llmTimeoutMs).toBe(3000);
    expect(loadConfig({}).requestTimeoutMs).toBe(10_000);
    expect(loadConfig({ LLM_BACKEND: 'claude-cli' })).toMatchObject({ llmBackend: 'claude-cli', llmTimeoutMs: 20_000, requestTimeoutMs: 25_000, llmCliConcurrency: 1, llmCliModel: 'claude-haiku-5-5', llmCliBin: undefined });
    expect(loadConfig({ LLM_BACKEND: 'claude-cli', LLM_TIMEOUT_MS: '8000', LLM_CLI_MODEL: 'sonnet', LLM_CLI_CONCURRENCY: '2' })).toMatchObject({ requestTimeoutMs: 13_000, llmCliModel: 'sonnet', llmCliConcurrency: 2 });
    expect(loadConfig({ LLM_BACKEND: 'claude-cli', REQUEST_TIMEOUT_MS: '40000' }).requestTimeoutMs).toBe(40_000);
    // the developer's subscription is not offered to the LAN unless HOST says so
    expect(loadConfig({ LLM_BACKEND: 'claude-cli' }).host).toBe('127.0.0.1');
    expect(loadConfig({ LLM_BACKEND: 'claude-cli', HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(loadConfig({}).host).toBe('0.0.0.0');
    expect(loadConfig({ LLM_API_KEY: 'k' }).host).toBe('0.0.0.0');
    expect(() => loadConfig({ LLM_BACKEND: 'claude' })).toThrow();
    expect(() => loadConfig({ LLM_CLI_BIN: 'claude' })).toThrow();
    expect(() => loadConfig({ LLM_CLI_MODEL: '--dangerously-skip-permissions' })).toThrow();
    expect(() => loadConfig({ LLM_CLI_CONCURRENCY: '3' })).toThrow();
    expect(() => loadConfig({ LLM_ALLOW_CLI_IN_PROD: 'yes' })).toThrow();
  });
});

describe('the CLI backend in the server (fake CLI)', () => {
  const json = { 'content-type': 'application/json' };
  const SENTENCE = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت';

  it('/api/health exposes llm and the backend name only (no path, model or version)', async () => {
    const dir = tmpDir();
    const fake = writeFakeCli(dir, { lines: okLines({ word: 'x' }) });
    const { app } = await makeApp({ llmBackend: 'claude-cli', llmCliBin: fake.bin, llmCliModel: 'claude-haiku-5-5' });
    apps.push(app);
    const res = await app.inject('/api/health');
    expect(res.json()).toMatchObject({ llm: true, llmBackend: 'claude-cli' });
    expect(Object.keys(res.json()).sort()).toEqual(['commit', 'db', 'llm', 'llmBackend', 'status', 'uptimeSec']);
    expect(res.body).not.toContain(dir);
    expect(res.body).not.toMatch(/haiku|claude-code|\d+\.\d+\.\d+/);

    const missing = await makeApp({ llmBackend: 'claude-cli' }); // no explicit binary under NODE_ENV=test
    apps.push(missing.app);
    expect((await missing.app.inject('/api/health')).json()).toMatchObject({ llm: false, llmBackend: 'claude-cli' });
    expect(missing.ctx.parseRefiner).toBeUndefined();
  });

  it('POST /api/parse is refined through the CLI (draft echoed by the fake), the prompt delimited on stdin', async () => {
    const dir = tmpDir();
    const databasePath = buildParseFixture(path.join(dir, 'market.sqlite'));
    const fake = writeFakeCli(dir, { echoDraft: true });
    const { app } = await makeApp({ databasePath, llmBackend: 'claude-cli', llmCliBin: fake.bin, llmTimeoutMs: 5000 });
    apps.push(app);
    const res = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ text: SENTENCE }) });
    const body = res.json() as { data: ParseResult & { degraded?: boolean } };
    expect(res.statusCode).toBe(200);
    expect(body.data.source).toBe('refined');
    expect(body.data.degraded).toBeUndefined();
    const [rec] = fake.records();
    expect(rec!.stdin.startsWith('<user_text>\n')).toBe(true);
    expect(rec!.stdin).toContain('<draft>');
    expect(rec!.argv.join(' ')).not.toContain('دوربین');
    expect(rec!.system).toContain('<user_text>'); // the static Persian parse prompt, from a 0600 file
  });

  it('POST /api/parse falls back deterministically (degraded) when the CLI fails', async () => {
    const dir = tmpDir();
    const databasePath = buildParseFixture(path.join(dir, 'market.sqlite'));
    const fake = writeFakeCli(dir, { exitCode: 1 });
    const { app } = await makeApp({ databasePath, llmBackend: 'claude-cli', llmCliBin: fake.bin, llmTimeoutMs: 5000 });
    apps.push(app);
    const res = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ text: SENTENCE }) });
    const body = res.json() as { data: ParseResult & { degraded?: boolean } };
    expect(res.statusCode).toBe(200);
    expect(body.data.source).toBe('deterministic');
    expect(body.data.degraded).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);
  });
});
