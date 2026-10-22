import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  AnthropicLlmClient,
  CircuitBreaker,
  classifyError,
  createLlmClient,
  LlmError,
  llmUsable,
  MAX_TOKENS_CAP,
  NullLlmClient,
  type AnthropicLike,
  type LlmRequest,
} from '../src/llm/client.js';

const req: LlmRequest = { op: 'parse', system: 'SYSTEM-PROMPT', user: 'USER-TEXT', maxTokens: 200 };
const ok = (text: string, stop: string | null = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason: stop });

function fakeSdk(impl: AnthropicLike['messages']['create']): AnthropicLike & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(impl);
  return { messages: { create }, create };
}

const apiError = (status: number, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'SECRET provider echo of USER-TEXT' } }, 'SECRET provider echo', new Headers(headers));

/** A provider call that only ends when aborted (like fetch with a signal). */
const hang: AnthropicLike['messages']['create'] = (_b, o) =>
  new Promise((_res, rej) => o?.signal?.addEventListener('abort', () => rej(new Anthropic.APIUserAbortError())));

describe('NullLlmClient and createLlmClient', () => {
  it('without a key the client is the Null client: unconfigured, unavailable, refuses calls', async () => {
    const c = createLlmClient({ llmModel: 'm', llmTimeoutMs: 1000 });
    expect(c).toBeInstanceOf(NullLlmClient);
    expect(c.configured).toBe(false);
    expect(llmUsable(c)).toBe(false);
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('with a key it is the Anthropic client', () => {
    const c = createLlmClient({ llmApiKey: 'k', llmModel: 'claude-haiku-5-5', llmTimeoutMs: 1000 });
    expect(c).toBeInstanceOf(AnthropicLlmClient);
    expect(c.configured).toBe(true);
    expect(llmUsable(c)).toBe(true);
  });

  it('under NODE_ENV=test a configured client can never reach the network', async () => {
    const c = createLlmClient({ llmApiKey: 'sk-ant-test', llmModel: 'claude-haiku-5-5', llmTimeoutMs: 1000, nodeEnv: 'test' });
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('AnthropicLlmClient request shape', () => {
  it('sends a structured-output request: static system prompt (cache breakpoint), user turn, schema, capped tokens, no retries', async () => {
    const sdk = fakeSdk(async () => ok('{"a":1}'));
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'claude-haiku-5-5', timeoutMs: 1000, sdk });
    const schema = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false };
    expect(await c.complete({ ...req, schema, maxTokens: 999_999 })).toBe('{"a":1}');
    const [body, opts] = sdk.create.mock.calls[0]!;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(MAX_TOKENS_CAP);
    expect(body.system).toEqual([{ type: 'text', text: 'SYSTEM-PROMPT', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'USER-TEXT' }]);
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema } });
    expect(body.thinking).toEqual({ type: 'disabled' }); // auto: off for the Haiku 5 family
    expect(opts).toMatchObject({ maxRetries: 0, timeout: 1000 });
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['auto', 'claude-sonnet-5-5', undefined],
    ['auto', 'claude-haiku-5-5', { type: 'disabled' }],
    ['off', 'claude-sonnet-5-5', { type: 'disabled' }],
    ['adaptive', 'claude-haiku-5-5', undefined],
  ] as const)('thinking %s on %s -> %j', async (mode, model, expected) => {
    const sdk = fakeSdk(async () => ok('x'));
    await new AnthropicLlmClient({ apiKey: 'k', model, timeoutMs: 1000, thinking: mode, sdk }).complete(req);
    expect(sdk.create.mock.calls[0]![0].thinking).toEqual(expected);
  });

  it('per-call budget never exceeds the client budget', async () => {
    const sdk = fakeSdk(async () => ok('x'));
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 500, sdk });
    await c.complete({ ...req, timeoutMs: 60_000 });
    await c.complete({ ...req, timeoutMs: 200 });
    expect(sdk.create.mock.calls.map((x) => x[1]?.timeout)).toEqual([500, 200]);
  });

  it('returns the concatenated text blocks only', async () => {
    const sdk = fakeSdk(async () => ({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }], stop_reason: 'end_turn' }));
    expect(await new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 1000, sdk }).complete(req)).toBe('ab');
  });
});

describe('AnthropicLlmClient failures (all become LlmError, never provider text)', () => {
  it('times out a call that never ends and aborts it', async () => {
    let signal: AbortSignal | undefined;
    const sdk = fakeSdk((b, o) => {
      signal = o?.signal;
      return hang(b, o);
    });
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 30, sdk });
    const t0 = Date.now();
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(signal?.aborted).toBe(true);
  });

  it('times out even when the provider ignores the abort signal', async () => {
    const sdk = fakeSdk(() => new Promise(() => {}));
    await expect(new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 30, sdk }).complete(req)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it("a caller's abort cancels the provider call (counted as a timeout)", async () => {
    let signal: AbortSignal | undefined;
    const sdk = fakeSdk((b, o) => {
      signal = o?.signal;
      return hang(b, o);
    });
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 5000, sdk });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await expect(c.complete({ ...req, signal: ac.signal })).rejects.toMatchObject({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [402, 'forbidden'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [413, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
    [529, 'overloaded'],
  ] as const)('HTTP %i -> %s', async (status, kind) => {
    const sdk = fakeSdk(async () => {
      throw apiError(status);
    });
    const err = await new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 1000, sdk }).complete(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind });
    expect(String((err as Error).message)).not.toMatch(/SECRET|USER-TEXT/);
  });

  it('connection errors, SDK timeouts and fetch aborts are categorised', () => {
    expect(classifyError(new Anthropic.APIConnectionError({ message: 'x' }), false).kind).toBe('network');
    expect(classifyError(new Anthropic.APIConnectionTimeoutError(), false).kind).toBe('timeout');
    expect(classifyError(Object.assign(new Error('x'), { name: 'AbortError' }), false).kind).toBe('timeout');
    expect(classifyError(new TypeError('boom'), false).kind).toBe('provider');
    expect(classifyError(apiError(429, { 'retry-after': '7' }), false)).toEqual({ kind: 'rate_limited', tripForMs: 7000 });
    expect(classifyError(apiError(401), false).tripForMs).toBeGreaterThanOrEqual(60_000);
  });

  it('refusal, truncation and empty answers are errors, but the provider counts as healthy', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    for (const [res, kind] of [
      [ok('{"x":1}', 'refusal'), 'refusal'],
      [ok('{"x":', 'max_tokens'), 'truncated'],
      [ok('   '), 'empty'],
      [{ content: [], stop_reason: 'end_turn' }, 'empty'],
    ] as const) {
      const sdk = fakeSdk(async () => res);
      await expect(new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 1000, sdk, breaker }).complete(req)).rejects.toMatchObject({ kind });
    }
    expect(breaker.state).toBe('closed');
    expect(breaker.failureCount).toBe(0);
  });

  it('reports outcome category and latency only (no prompt, no output, no key)', async () => {
    const events: unknown[] = [];
    const sdk = fakeSdk(async () => ok('MODEL-OUTPUT'));
    const c = new AnthropicLlmClient({ apiKey: 'sk-ant-KEY', model: 'm', timeoutMs: 1000, sdk, onOutcome: (e) => events.push(e) });
    await c.complete(req);
    const failing = new AnthropicLlmClient({ apiKey: 'sk-ant-KEY', model: 'm', timeoutMs: 1000, sdk: fakeSdk(async () => { throw apiError(500); }), onOutcome: (e) => events.push(e) });
    await failing.complete(req).catch(() => {});
    expect(events).toHaveLength(2);
    for (const e of events) expect(Object.keys(e as object).sort()).toEqual(['ms', 'op', 'outcome']);
    expect(events.map((e) => (e as { outcome: string }).outcome)).toEqual(['ok', 'server']);
    expect(JSON.stringify(events)).not.toMatch(/SYSTEM-PROMPT|USER-TEXT|MODEL-OUTPUT|KEY/);
  });
});

describe('circuit breaker', () => {
  it('opens after N consecutive failures; while open the provider is not called', async () => {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
    const sdk = fakeSdk(async () => {
      throw apiError(500);
    });
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 1000, sdk, breaker, now: () => t });
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'server' });
    expect(c.available()).toBe(true);
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'server' });
    expect(c.available()).toBe(false);
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(sdk.create).toHaveBeenCalledTimes(2);
    t = 999;
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'circuit_open' });
    expect(sdk.create).toHaveBeenCalledTimes(2);
  });

  it('half-open lets exactly one probe through; success closes the circuit', async () => {
    let t = 0;
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => t });
    let release: ((v: ReturnType<typeof ok>) => void) | undefined;
    const sdk = fakeSdk(() => new Promise((res) => (release = res)));
    const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 5000, sdk, breaker, now: () => t });
    breaker.failure(breaker.acquire()!); // open
    t = 1000;
    expect(breaker.state).toBe('half_open');
    const probe = c.complete(req);
    await expect(c.complete(req)).rejects.toMatchObject({ kind: 'circuit_open' }); // concurrent caller fails fast
    expect(sdk.create).toHaveBeenCalledTimes(1);
    release!(ok('fine'));
    expect(await probe).toBe('fine');
    expect(breaker.state).toBe('closed');
  });

  it('a failed probe re-opens with a doubled cooldown', () => {
    let t = 0;
    const b = new CircuitBreaker({ threshold: 1, cooldownMs: 1000, now: () => t });
    b.failure(b.acquire()!);
    t = 1000;
    const probe = b.acquire();
    expect(probe?.probe).toBe(true);
    b.failure(probe!);
    t = 2500;
    expect(b.state).toBe('open');
    t = 3000;
    expect(b.state).toBe('half_open');
  });

  it('a bad key (401) or an unknown model (404) trips it at once; a 429 for its retry-after', async () => {
    let t = 0;
    for (const [status, headers, openFor] of [
      [401, {}, 5 * 60_000],
      [404, {}, 5 * 60_000],
      [429, { 'retry-after': '5' }, 5000],
    ] as const) {
      const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => t });
      const sdk = fakeSdk(async () => {
        throw apiError(status, headers);
      });
      const c = new AnthropicLlmClient({ apiKey: 'k', model: 'm', timeoutMs: 1000, sdk, breaker, now: () => t });
      await c.complete(req).catch(() => {});
      expect(breaker.state).toBe('open');
      t += openFor - 1;
      expect(breaker.state).toBe('open');
      t += 1;
      expect(breaker.state).toBe('half_open');
    }
  });
});

describe('config', () => {
  it('applies defaults (LLM optional, conservative budgets)', () => {
    const c = loadConfig({}, process.cwd());
    expect(c.port).toBe(8080);
    expect(c.llmModel).toBe('claude-haiku-5-5');
    expect(c.llmApiKey).toBeUndefined();
    expect(c.llmTimeoutMs).toBe(3000);
    expect(c.llmThinking).toBe('auto');
    expect(c).toMatchObject({ llmBreakerThreshold: 3, llmBreakerCooldownMs: 30_000, llmPerMinute: 10, llmDailyPerClient: 150, llmDailyGlobal: 3000, llmMaxConcurrent: 4, assistRateLimit: 30 });
    expect(c.databasePath.endsWith('data/market.sqlite')).toBe(true);
  });

  it('treats empty env values as unset and parses numbers', () => {
    const c = loadConfig({ LLM_API_KEY: '', LLM_MODEL: '  ', PORT: '9000', RATE_LIMIT: '7', NODE_ENV: 'production', ASSIST_RATE_LIMIT: '5', LLM_DAILY_GLOBAL: '0' }, process.cwd());
    expect(c.llmApiKey).toBeUndefined();
    expect(c.llmModel).toBe('claude-haiku-5-5');
    expect(c.port).toBe(9000);
    expect(c.rateLimit).toBe(7);
    expect(c.trustProxyHops).toBe(1);
    expect(c.assistRateLimit).toBe(5);
    expect(c.llmDailyGlobal).toBe(0);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
    expect(() => loadConfig({ LLM_THINKING: 'maybe' })).toThrow();
    expect(() => loadConfig({ LLM_TIMEOUT_MS: '100' })).toThrow();
  });
});
