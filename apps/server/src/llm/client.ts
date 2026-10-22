import Anthropic from '@anthropic-ai/sdk';
import { createClaudeCliClient } from './claude-cli-client.js';

/**
 * Provider-neutral LLM interface plus the Anthropic implementation, and the factory that picks the backend
 * (LLM_BACKEND: 'anthropic' | 'claude-cli' | 'none'; claude-cli is a TESTING-ONLY backend, see claude-cli-client.ts).
 *
 * Trust model (PLAN B3.6): the LLM only interprets words. Every caller validates the returned JSON with zod
 * against a closed schema and falls back to deterministic behaviour on ANY LlmError, so the product is complete
 * and correct with the LLM absent, slow, failing or malicious.
 *
 * Privacy: nothing in this module logs or rethrows prompts, user text, model output, provider error messages or
 * the key. The only observable signal is `onOutcome({ op, outcome, ms })`: an outcome category and a latency.
 */

/** Stable operation names (used for outcome logs; never user data). */
export type LlmOp = 'parse' | 'assist' | 'smoke';

/** Which backend serves LLM calls. The only LLM detail /api/health exposes (with `llm: boolean`). */
export type LlmBackend = 'anthropic' | 'claude-cli' | 'none';

export interface LlmRequest {
  op: LlmOp;
  system: string;
  /** Untrusted data, already delimited and sanitised by the caller (llm/sanitize.ts). */
  user: string;
  /**
   * JSON Schema the answer must follow (structured output). Keep it STATIC per operation: the provider caches the
   * compiled grammar per schema, and per-request values (ids, shortlists) are validated by the caller instead.
   */
  schema?: Record<string, unknown>;
  maxTokens: number;
  /** Per-call budget; never above the client's own budget. */
  timeoutMs?: number;
  /** Caller-side abort (e.g. the parse race timed out): the call is cancelled and counted as a timeout. */
  signal?: AbortSignal;
}

export type LlmErrorKind =
  | 'not_configured'
  | 'circuit_open'
  | 'timeout'
  /** 401: bad or revoked key. */
  | 'auth'
  /** 402 / 403: billing or permission problem. */
  | 'forbidden'
  /** 404: unknown model id, or a model this key cannot use. */
  | 'model_not_found'
  | 'rate_limited'
  /** 529 */
  | 'overloaded'
  /** other 5xx */
  | 'server'
  /** 400 / 413 / 422: our request was rejected (e.g. a parameter the configured model does not accept). */
  | 'bad_request'
  | 'network'
  /** HTTP 200 but the model declined (stop_reason refusal). */
  | 'refusal'
  /** HTTP 200 but cut off (max_tokens) or implausibly long. */
  | 'truncated'
  | 'empty'
  | 'provider'
  /** claude-cli: the local process cap is reached; nothing was started (not a backend failure). */
  | 'busy'
  /** claude-cli: the process answered outside the expected shape (non-JSON stream, no result, tool-call markup). */
  | 'invalid_output'
  /** claude-cli: the process reported a capability outside its allowlist (tool, MCP server, hook): killed, circuit opened. */
  | 'isolation';

export type LlmOutcome = 'ok' | LlmErrorKind;

export class LlmError extends Error {
  constructor(public readonly kind: LlmErrorKind) {
    super(`llm_${kind}`); // never include provider messages: they may echo prompt text
    this.name = 'LlmError';
  }
}

export type OutcomeListener = (e: { op: LlmOp; outcome: LlmOutcome; ms: number }) => void;

export interface LlmClient {
  /** True only when calls can actually be attempted (key present / CLI found). */
  readonly configured: boolean;
  readonly model: string;
  /** Backend name (optional for simple test doubles). */
  readonly backend?: LlmBackend;
  /**
   * False while the circuit is open (or a half-open probe is in flight): callers skip the LLM path at no cost.
   * Optional for simple test doubles; use `llmUsable()`.
   */
  available?(): boolean;
  /** The model's text output (JSON when `schema` is set). Throws LlmError, never anything else. */
  complete(req: LlmRequest): Promise<string>;
}

/** Configured and not short-circuited right now. */
export function llmUsable(c: LlmClient): boolean {
  return c.configured && (c.available ? c.available() : true);
}

export class NullLlmClient implements LlmClient {
  readonly configured = false;
  readonly model = 'none';
  readonly backend: LlmBackend = 'none';
  available(): boolean {
    return false;
  }
  async complete(): Promise<string> {
    throw new LlmError('not_configured');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------------------------------------------

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  threshold?: number;
  /** First cooldown before a half-open probe. A failed probe doubles it, up to `maxCooldownMs`. */
  cooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
}

export interface BreakerTicket {
  readonly probe: boolean;
}

/**
 * closed -> (threshold consecutive failures, or a hard trip) -> open -> (cooldown) -> half_open: exactly ONE probe
 * call is let through; concurrent callers fail fast. Probe success closes the circuit, probe failure re-opens it
 * with a doubled cooldown. Hard trips (bad key, unknown model, provider rate limit) open it immediately.
 */
export class CircuitBreaker {
  private failures = 0;
  private st: BreakerState = 'closed';
  private openedAt = 0;
  private openFor = 0;
  private probing = false;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = Math.max(1, opts.threshold ?? 3);
    this.cooldownMs = Math.max(1, opts.cooldownMs ?? 30_000);
    this.maxCooldownMs = Math.max(this.cooldownMs, opts.maxCooldownMs ?? 10 * 60_000);
    this.now = opts.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this.st === 'open' && this.now() - this.openedAt >= this.openFor) return 'half_open';
    return this.st;
  }

  /** Consecutive failures since the last success. */
  get failureCount(): number {
    return this.failures;
  }

  /** Could a call be attempted right now (without reserving it)? */
  canAttempt(): boolean {
    const s = this.state;
    return s === 'closed' || (s === 'half_open' && !this.probing);
  }

  /** Reserve a call. null = rejected (open, or a half-open probe is already in flight). */
  acquire(): BreakerTicket | null {
    const s = this.state;
    if (s === 'closed') return { probe: false };
    if (s === 'half_open' && !this.probing) {
      this.st = 'half_open';
      this.probing = true;
      return { probe: true };
    }
    return null;
  }

  success(t: BreakerTicket): void {
    if (t.probe) this.probing = false;
    this.failures = 0;
    this.st = 'closed';
    this.openFor = 0;
  }

  /** `tripForMs`: open immediately for that long (hard failure / provider rate limit). */
  failure(t: BreakerTicket, opts: { tripForMs?: number } = {}): void {
    if (t.probe) this.probing = false;
    this.failures += 1;
    if (opts.tripForMs !== undefined) {
      this.open(Math.min(this.maxCooldownMs, Math.max(1, opts.tripForMs)));
    } else if (t.probe) {
      this.open(Math.min(this.maxCooldownMs, Math.max(this.cooldownMs, this.openFor * 2)));
    } else if (this.failures >= this.threshold && this.st === 'closed') {
      this.open(this.cooldownMs);
    }
  }

  private open(ms: number): void {
    this.st = 'open';
    this.openedAt = this.now();
    this.openFor = ms;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------------------------------------------

type CreateBody = Anthropic.MessageCreateParamsNonStreaming;

/** Minimal slice of the Anthropic SDK that we use, so tests inject a fake (no network). */
export interface AnthropicLike {
  messages: {
    create(
      body: CreateBody,
      options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
    ): Promise<{ content: ReadonlyArray<{ type: string; text?: string }>; stop_reason?: string | null }>;
  };
}

/**
 * 'auto': thinking off for the Haiku 5 family (lowest latency for a ~3 s budget; accepted there at effort 'low'),
 * the model's default elsewhere (some models reject `disabled`). 'off' / 'adaptive' force one or the other.
 */
export type ThinkingMode = 'auto' | 'off' | 'adaptive';

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
  /** Hard per-call budget (also the upper bound for LlmRequest.timeoutMs). */
  timeoutMs: number;
  thinking?: ThinkingMode;
  breaker?: CircuitBreaker;
  onOutcome?: OutcomeListener;
  now?: () => number;
  /** Test seam. */
  sdk?: AnthropicLike;
}

/** Hard ceiling for any request's max_tokens (cost control). */
export const MAX_TOKENS_CAP = 4096;
/** Config errors (bad key, unknown model, billing) do not fix themselves: stop calling for a while. */
const HARD_TRIP_MS = 5 * 60_000;
const DEFAULT_RATE_LIMIT_TRIP_MS = 30_000;
const MAX_RATE_LIMIT_TRIP_MS = 60_000;
/** Anything longer than this from a JSON-only, max_tokens-capped call is not a plausible answer. */
const MAX_OUTPUT_CHARS = 20_000;

const SILENT_LOGGER = { error() {}, warn() {}, info() {}, debug() {} };

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  const h = (err as { headers?: { get?: (k: string) => string | null } } | null)?.headers;
  const v = typeof h?.get === 'function' ? h.get('retry-after') : null;
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(MAX_RATE_LIMIT_TRIP_MS, Math.max(1000, secs * 1000));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.min(MAX_RATE_LIMIT_TRIP_MS, Math.max(1000, at - Date.now())) : undefined;
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** Error -> outcome category (and how hard the breaker trips). Never looks at messages. */
export function classifyError(err: unknown, aborted: boolean): { kind: LlmErrorKind; tripForMs?: number } {
  if (aborted || err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) return { kind: 'timeout' };
  if (err instanceof Anthropic.APIConnectionError) return { kind: 'network' };
  const status = statusOf(err);
  if (status !== undefined) {
    if (status === 401) return { kind: 'auth', tripForMs: HARD_TRIP_MS };
    if (status === 402 || status === 403) return { kind: 'forbidden', tripForMs: HARD_TRIP_MS };
    if (status === 404) return { kind: 'model_not_found', tripForMs: HARD_TRIP_MS };
    if (status === 429) return { kind: 'rate_limited', tripForMs: retryAfterMs(err) ?? DEFAULT_RATE_LIMIT_TRIP_MS };
    if (status === 408) return { kind: 'timeout' };
    if (status === 529) return { kind: 'overloaded' };
    if (status >= 500) return { kind: 'server' };
    if (status >= 400) return { kind: 'bad_request' };
  }
  if (isAbortError(err)) return { kind: 'timeout' };
  return { kind: 'provider' };
}

/** Text of a 200 response, or the LlmError that the content means. */
function extractText(res: { content?: ReadonlyArray<{ type: string; text?: string }>; stop_reason?: string | null } | null | undefined): string {
  const stop = res?.stop_reason ?? null;
  if (stop === 'refusal') throw new LlmError('refusal');
  if (stop === 'max_tokens') throw new LlmError('truncated');
  if (stop !== null && stop !== 'end_turn' && stop !== 'stop_sequence') throw new LlmError('provider');
  const blocks = Array.isArray(res?.content) ? res.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  if (text.trim() === '') throw new LlmError('empty');
  if (text.length > MAX_OUTPUT_CHARS) throw new LlmError('truncated');
  return text;
}

export class AnthropicLlmClient implements LlmClient {
  readonly configured = true;
  readonly backend: LlmBackend = 'anthropic';
  readonly model: string;
  private readonly sdk: AnthropicLike;
  private readonly timeoutMs: number;
  private readonly breaker: CircuitBreaker;
  private readonly disableThinking: boolean;
  private readonly onOutcome: OutcomeListener | undefined;
  private readonly now: () => number;

  constructor(opts: AnthropicLlmOptions) {
    this.model = opts.model;
    this.timeoutMs = Math.max(1, opts.timeoutMs);
    this.breaker = opts.breaker ?? new CircuitBreaker();
    const mode = opts.thinking ?? 'auto';
    this.disableThinking = mode === 'off' || (mode === 'auto' && /^claude-haiku-5/.test(opts.model));
    this.onOutcome = opts.onOutcome;
    this.now = opts.now ?? Date.now;
    // maxRetries 0: the caller has a hard latency budget and a deterministic fallback.
    // logLevel 'off' + a silent logger + openTelemetry false: the SDK must never log or trace request content,
    // whatever ANTHROPIC_LOG / OTEL_* say. The key is passed explicitly (never read from other env vars).
    this.sdk =
      opts.sdk ??
      (new Anthropic({
        apiKey: opts.apiKey,
        maxRetries: 0,
        timeout: this.timeoutMs,
        logLevel: 'off',
        logger: SILENT_LOGGER,
        openTelemetry: false,
      }) as unknown as AnthropicLike);
  }

  available(): boolean {
    return this.breaker.canAttempt();
  }

  get breakerState(): BreakerState {
    return this.breaker.state;
  }

  private emit(op: LlmOp, outcome: LlmOutcome, ms: number): void {
    try {
      this.onOutcome?.({ op, outcome, ms: Math.round(ms) });
    } catch {
      /* a logging failure must never fail the call */
    }
  }

  private body(req: LlmRequest): CreateBody {
    const body: CreateBody = {
      model: this.model,
      max_tokens: Math.max(1, Math.min(MAX_TOKENS_CAP, Math.floor(req.maxTokens))),
      // The system prompt is static per operation (cache-friendly); all per-request data is in the user turn.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: req.schema ? { effort: 'low', format: { type: 'json_schema', schema: req.schema } } : { effort: 'low' },
    };
    if (this.disableThinking) body.thinking = { type: 'disabled' };
    return body;
  }

  async complete(req: LlmRequest): Promise<string> {
    const ticket = this.breaker.acquire();
    if (!ticket) {
      this.emit(req.op, 'circuit_open', 0);
      throw new LlmError('circuit_open');
    }
    const started = this.now();
    const budget = Math.max(1, Math.min(this.timeoutMs, Math.floor(req.timeoutMs ?? this.timeoutMs)));
    const ac = new AbortController();
    const relay = () => ac.abort();
    if (req.signal?.aborted) ac.abort();
    else req.signal?.addEventListener('abort', relay, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new LlmError('timeout'));
      }, budget);
    });

    let res: Awaited<ReturnType<AnthropicLike['messages']['create']>>;
    try {
      if (ac.signal.aborted) throw new LlmError('timeout');
      res = await Promise.race([this.sdk.messages.create(this.body(req), { signal: ac.signal, timeout: budget, maxRetries: 0 }), deadline]);
    } catch (err) {
      const c = err instanceof LlmError ? { kind: err.kind } : classifyError(err, ac.signal.aborted);
      this.breaker.failure(ticket, 'tripForMs' in c && c.tripForMs !== undefined ? { tripForMs: c.tripForMs } : {});
      this.emit(req.op, c.kind, this.now() - started);
      throw new LlmError(c.kind);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', relay);
    }

    // An HTTP 200 means the provider is healthy, whatever the content turns out to be.
    this.breaker.success(ticket);
    try {
      const text = extractText(res);
      this.emit(req.op, 'ok', this.now() - started);
      return text;
    } catch (err) {
      const kind: LlmErrorKind = err instanceof LlmError ? err.kind : 'provider';
      this.emit(req.op, kind, this.now() - started);
      throw new LlmError(kind);
    }
  }
}

/** Used instead of the real SDK under NODE_ENV=test: unit tests can never reach the network or spend money. */
const OFFLINE_SDK: AnthropicLike = {
  messages: {
    async create() {
      throw new Anthropic.APIConnectionError({ message: 'network disabled under NODE_ENV=test' });
    },
  },
};

export interface LlmClientConfig {
  llmApiKey?: string | undefined;
  llmModel: string;
  llmTimeoutMs: number;
  llmThinking?: ThinkingMode;
  llmBreakerThreshold?: number;
  llmBreakerCooldownMs?: number;
  nodeEnv?: string;
  /** Default: 'anthropic' with a key, else 'none'. 'claude-cli' only when selected explicitly (TESTING ONLY). */
  llmBackend?: LlmBackend;
  /** claude-cli: absolute path of the CLI; unset = `claude` on PATH (never looked up under NODE_ENV=test). */
  llmCliBin?: string | undefined;
  llmCliModel?: string;
  llmCliConcurrency?: number;
  llmAllowCliInProd?: boolean;
}

/** A refused LLM configuration at start-up. `issues` names the variable only (index.ts logs names, never values). */
export class LlmConfigError extends Error {
  readonly issues = [{ path: ['LLM_BACKEND'] }];
  constructor(reason: string) {
    super(reason);
    this.name = 'LlmConfigError';
  }
}

export function createLlmClient(
  cfg: LlmClientConfig,
  extra: { onOutcome?: OutcomeListener; sdk?: AnthropicLike; env?: NodeJS.ProcessEnv } = {},
): LlmClient {
  const backend: LlmBackend = cfg.llmBackend ?? (cfg.llmApiKey ? 'anthropic' : 'none');
  if (backend === 'none') return new NullLlmClient();
  const breaker = new CircuitBreaker({ threshold: cfg.llmBreakerThreshold ?? 3, cooldownMs: cfg.llmBreakerCooldownMs ?? 30_000 });
  if (backend === 'claude-cli') {
    // TESTING ONLY (claude-cli-client.ts). loadConfig refuses this in production already; this is the second lock
    // for configs built in code. The API key is never handed to the CLI.
    if (cfg.nodeEnv === 'production' && !cfg.llmAllowCliInProd) throw new LlmConfigError('claude-cli LLM backend refused under NODE_ENV=production');
    return createClaudeCliClient(cfg, { breaker, onOutcome: extra.onOutcome, env: extra.env });
  }
  if (!cfg.llmApiKey) return new NullLlmClient();
  const sdk = extra.sdk ?? (cfg.nodeEnv === 'test' ? OFFLINE_SDK : undefined);
  return new AnthropicLlmClient({
    apiKey: cfg.llmApiKey,
    model: cfg.llmModel,
    timeoutMs: cfg.llmTimeoutMs,
    thinking: cfg.llmThinking ?? 'auto',
    breaker,
    ...(extra.onOutcome ? { onOutcome: extra.onOutcome } : {}),
    ...(sdk ? { sdk } : {}),
  });
}
