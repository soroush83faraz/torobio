/**
 * TESTING-ONLY LLM backend: one headless local Claude Code session (`claude -p`) per call.
 *
 * Why it exists: the project owner has no API key yet and asked to test the LLM layer through headless Claude Code
 * sessions (their own local Claude Code login). Production uses AnthropicLlmClient with a real key. This backend is
 * opt-in only (LLM_BACKEND=claude-cli), never the default, never required, and refused under NODE_ENV=production
 * unless LLM_ALLOW_CLI_IN_PROD=1 (config.ts and createLlmClient). Without the CLI the client is unconfigured and the
 * product runs deterministically, exactly as without a key.
 *
 * Same contract as AnthropicLlmClient: implements LlmClient, throws only LlmError, reports only { op, outcome, ms },
 * uses the same CircuitBreaker, and every caller still validates the JSON with zod against its closed schema and
 * falls back deterministically. The LlmGate budgets and the `degraded` flags in the routes apply unchanged.
 *
 * Isolation of every spawned process (flags and env switches verified against Claude Code 2.1.306 with live probes):
 *  - spawned WITHOUT a shell (argv array) from an absolute binary path resolved once at start-up (absolute PATH
 *    entries only); argv holds static flags, the static JSON schema and a temp file path. The prompt text (user
 *    data) goes to STDIN only; the system prompt goes in a 0600 file, so argv never carries prompt text;
 *  - no tools (`--tools ""`; the only tool left is the CLI's own StructuredOutput tool for --json-schema), no MCP
 *    servers (--strict-mcp-config, claude.ai connectors off), no user / project / local settings, hooks, plugins,
 *    skills, CLAUDE.md / AGENTS.md or slash commands (--setting-sources "", --safe-mode, --restricted,
 *    --disable-slash-commands, env switches), permission mode dontAsk with nobody to answer prompts, no session
 *    persistence, bounded turns and spend;
 *  - `@path` file mentions are disabled twice: by env switch and by making '@' inert in the prompt (a probe showed
 *    that `@/abs/path` in the prompt text otherwise attaches that file, even with no tools);
 *  - an empty per-call cwd and a separate TMPDIR inside a private 0700 temp dir (never the repository), removed
 *    after the call;
 *  - an explicit allowlisted environment: HOME (where the CLI keeps its login), CLAUDE_CONFIG_DIR and proxy
 *    variables when set, a fixed PATH and LANG, and the hardening switches. Nothing else is inherited (no
 *    LLM_API_KEY, ANTHROPIC_*, NODE_OPTIONS, parent Claude Code session tokens, ...);
 *  - verified at run time on every call (stream-json): the init event must list no tool but StructuredOutput and no
 *    MCP server, every tool_use must be StructuredOutput, and no hook event may appear; otherwise the process
 *    group is killed and the circuit opens for 10 minutes;
 *  - hard timeout (SIGTERM then SIGKILL to the whole process group), stdout byte cap (stderr is discarded), a
 *    concurrency cap of 1-2 calls in flight (and at most twice as many live processes: an answered or killed one
 *    gets 2 s to exit before its group is killed), and output checks: one JSON object, size-capped, no tool-call
 *    markup.
 * Privacy: prompts, model output, stderr and CLI paths are never logged or put in errors.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
// client.ts imports this module for its factory (an ESM cycle). That is safe because nothing here touches a
// client.ts binding at module evaluation time: CircuitBreaker, LlmError and MAX_TOKENS_CAP are used inside functions.
import {
  CircuitBreaker,
  LlmError,
  MAX_TOKENS_CAP,
  type BreakerState,
  type BreakerTicket,
  type LlmBackend,
  type LlmClient,
  type LlmClientConfig,
  type LlmErrorKind,
  type LlmOp,
  type LlmOutcome,
  type LlmRequest,
  type OutcomeListener,
  type ThinkingMode,
} from './client.js';
import { stripInvisibleKeepLines } from './sanitize.js';

/** The tool the CLI adds for --json-schema (structured output): the only tool a call may ever list or use. */
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_SYSTEM_BYTES = 32 * 1024;
const MAX_SCHEMA_BYTES = 32 * 1024;
const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;
/** Anything longer than this from a JSON-only call is not a plausible answer (same bound as the API client). */
const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_KILL_GRACE_MS = 300;
/** A process still not closed this long after it was killed no longer holds a concurrency slot. */
const REAP_DEADLINE_MS = 5000;
/** After its result line the CLI gets this long to exit on its own before its process group is killed. */
const EXIT_AFTER_RESULT_MS = 2000;
/** Config errors (no login, no access, unknown model, missing binary) do not fix themselves. */
const HARD_TRIP_MS = 5 * 60_000;
/** The CLI reported a capability outside the allowlist: stop using it for a long while. */
const ISOLATION_TRIP_MS = 10 * 60_000;
const RATE_LIMIT_TRIP_MS = 30_000;
const MAX_CONCURRENT_CAP = 2;
/** The structured-output tool takes 2 turns; this leaves room for one retry and nothing more. */
const MAX_TURNS = 4;
const MAX_BUDGET_USD = '0.5';
const FIXED_PATH = '/usr/local/bin:/usr/bin:/bin';
/** A model id or alias (one argv element): never something that could read as a flag. Same rule as config.ts. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

/** Flags of every call. */
export const CLI_BASE_ARGS: readonly string[] = [
  '-p',
  '--output-format=stream-json', // one JSON event per line: init (tools, MCP servers), messages, result
  '--verbose', // required by stream-json in print mode
  '--include-hook-events', // no hook may run; if one does, its event shows up and the call is rejected
  '--input-format=text', // the prompt is read from stdin
  '--tools',
  '', // no built-in tools at all
  '--strict-mcp-config', // MCP servers only from --mcp-config, which is never passed: none
  '--setting-sources',
  '', // no user / project / local settings files (hooks, permissions, env, plugins, model)
  '--safe-mode', // no CLAUDE.md, skills, installed plugins, hooks, MCP servers, custom commands / agents
  '--restricted', // code-running tools stay off even by name; settings files ignored; bypassPermissions refused
  '--disable-slash-commands',
  '--permission-mode=dontAsk', // anything not pre-approved is denied, and nothing is pre-approved
  '--permission-prompts=none', // nobody answers a permission prompt: denied
  '--no-session-persistence', // no transcript on disk
  `--max-turns=${MAX_TURNS}`,
  `--max-budget-usd=${MAX_BUDGET_USD}`,
  '--effort=low', // as the API client
];

/** Environment switches of every call (unknown ones are ignored by other CLI versions). */
const HARDENING_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', // no telemetry, error reporting, auto-update or survey traffic
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  CLAUDE_CODE_DISABLE_FILE_MENTIONS: '1', // `@path` in the prompt text would attach that file (verified)
  CLAUDE_CODE_DISABLE_ATTACHMENTS: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', // no CLAUDE.md / AGENTS.md from the cwd's parents, e.g. /tmp (verified)
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false', // no claude.ai connectors of the logged-in account
};

/** The only variables taken from the server's environment (when set): the CLI's own config dir and the proxy. */
const PASSTHROUGH_ENV = ['CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------------------------------------------

/** Fullwidth commercial at: reads the same to the model, but is no `@path` file mention for the CLI. */
const INERT_AT = '＠';

/**
 * The stdin text: the caller's delimited prompt with invisible / bidi / control characters removed (line feeds
 * kept), '@' made inert, and never starting with a character the CLI could treat as a command prefix ('/', '!',
 * '#', ...): a prompt that does not start with a tag is wrapped in a static <input> block.
 */
export function cliPromptText(user: string): string {
  const t = stripInvisibleKeepLines(user).replace(/@/g, INERT_AT);
  return t.trimStart().startsWith('<') ? t : `<input>\n${t}\n</input>`;
}

/** The full argv of one call (the prompt is never part of it). */
export function buildCliArgs(o: { model: string; systemFile: string; schemaJson?: string | undefined }): string[] {
  return [...CLI_BASE_ARGS, `--model=${o.model}`, `--system-prompt-file=${o.systemFile}`, ...(o.schemaJson ? [`--json-schema=${o.schemaJson}`] : [])];
}

/** Child environment template (TMPDIR and the token cap are added per call). */
export function buildChildEnv(parent: NodeJS.ProcessEnv, disableThinking: boolean): Record<string, string> {
  const env: Record<string, string> = { HOME: parent.HOME || homedir(), PATH: FIXED_PATH, LANG: 'C.UTF-8', ...HARDENING_ENV };
  if (disableThinking) env.CLAUDE_CODE_DISABLE_THINKING = '1';
  for (const k of PASSTHROUGH_ENV) {
    const v = parent[k];
    if (typeof v === 'string' && v !== '' && !/[\0\r\n]/.test(v)) env[k] = v;
  }
  return env;
}

/**
 * Absolute path of the CLI executable, or null. An explicit path must be absolute; the PATH lookup (disabled under
 * NODE_ENV=test, so tests can never reach the real CLI) only considers absolute PATH entries (no '.' hijack).
 * Symlinks are resolved once, here.
 */
export function resolveCliBin(o: { explicit?: string | undefined; pathEnv?: string | undefined; lookupPath: boolean }): string | null {
  const candidates = o.explicit
    ? [o.explicit]
    : o.lookupPath
      ? (o.pathEnv ?? '')
          .split(path.delimiter)
          .filter((d) => d !== '' && path.isAbsolute(d))
          .map((d) => path.join(d, 'claude'))
      : [];
  for (const c of candidates) {
    if (!path.isAbsolute(c)) continue;
    try {
      const real = realpathSync(c);
      if (!statSync(real).isFile()) continue;
      accessSync(real, fsConstants.X_OK);
      return real;
    } catch {
      /* missing, dangling symlink or not executable */
    }
  }
  return null;
}

const TOOL_CALL_MARKUP: readonly RegExp[] = [
  /<\s*\/?\s*(?:[a-z]+:)?(?:function_calls|invoke|parameter|tool_use|tool_result|tool_calls?|function_call)\b/i,
  /\bantml:/i,
  /"\s*type\s*"\s*:\s*"\s*(?:tool_use|tool_result|server_tool_use|mcp_tool_use|function)\s*"/i,
  /"\s*(?:tool_use_id|tool_calls|function_call)\s*"\s*:/i,
];

/** Keys of tool-call shapes (our closed schemas never use them). */
const TOOL_CALL_KEYS = /^(?:tool_use|tool_use_id|tool_result|tool_calls?|function_call)$/i;

/** Does any key or string value (recursively) carry a tool-call format? Such output is rejected, never repaired. */
export function hasToolCallMarkup(v: unknown, depth = 0): boolean {
  if (depth > 20) return true; // implausibly deep for our closed schemas
  if (typeof v === 'string') return TOOL_CALL_MARKUP.some((re) => re.test(v));
  if (Array.isArray(v)) return v.some((x) => hasToolCallMarkup(x, depth + 1));
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).some(([k, x]) => TOOL_CALL_KEYS.test(k) || hasToolCallMarkup(k, depth + 1) || hasToolCallMarkup(x, depth + 1));
  }
  return false;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

const InitEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  tools: z.array(z.string()),
  mcp_servers: z.array(z.unknown()),
  permissionMode: z.string().optional(),
});

const ResultEvent = z.object({
  type: z.literal('result'),
  subtype: z.string().max(80),
  is_error: z.boolean(),
  api_error_status: z.number().int().nullable().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});
export type CliResult = z.infer<typeof ResultEvent>;

export type StreamVerdict = { kind: 'continue' } | { kind: 'violation' } | { kind: 'invalid' } | { kind: 'result'; result: CliResult };

/** Names of the tool_use-like blocks of an assistant event ('' for a block without a string name). */
function toolUseNames(msg: Record<string, unknown>): string[] {
  const content = isRecord(msg.message) ? msg.message.content : undefined;
  if (!Array.isArray(content)) return [];
  return content.filter((b) => isRecord(b) && typeof b.type === 'string' && /tool_use$/.test(b.type)).map((b) => (typeof (b as Record<string, unknown>).name === 'string' ? ((b as Record<string, unknown>).name as string) : ''));
}

/**
 * Checks the stream-json events of one call. Isolation must be VERIFIED: the init event comes first and lists only
 * allowed tools and no MCP server; tool uses only of allowed tools; no hook events.
 */
export class CliStreamChecker {
  private sawInit = false;

  constructor(private readonly allowedTools: ReadonlySet<string>) {}

  accept(msg: Record<string, unknown>): StreamVerdict {
    const type = typeof msg.type === 'string' ? msg.type : '';
    const subtype = typeof msg.subtype === 'string' ? msg.subtype : '';
    if (/hook/i.test(type) || /hook/i.test(subtype)) return { kind: 'violation' };
    if (type === 'system' && subtype === 'init') {
      const init = InitEvent.safeParse(msg);
      if (!init.success) return { kind: 'violation' };
      const { tools, mcp_servers: mcp, permissionMode } = init.data;
      if (tools.some((t) => !this.allowedTools.has(t)) || mcp.length > 0) return { kind: 'violation' };
      if (permissionMode !== undefined && permissionMode !== 'dontAsk') return { kind: 'violation' };
      this.sawInit = true;
      return { kind: 'continue' };
    }
    if ((type === 'assistant' || type === 'user' || type === 'result') && !this.sawInit) return { kind: 'violation' };
    if (type === 'assistant') return toolUseNames(msg).every((n) => this.allowedTools.has(n)) ? { kind: 'continue' } : { kind: 'violation' };
    if (type === 'result') {
      const r = ResultEvent.safeParse(msg);
      return r.success ? { kind: 'result', result: r.data } : { kind: 'invalid' };
    }
    return { kind: 'continue' };
  }
}

interface Failure {
  kind: LlmErrorKind;
  tripForMs?: number;
  /** The CLI and the provider worked; the content is what failed (the breaker counts a success, as the API client). */
  healthy?: boolean;
}

/** Outcome of a result event that reports an error. Looks at status codes and subtypes only, never at messages. */
export function classifyResultFailure(r: Pick<CliResult, 'subtype' | 'api_error_status'>): Failure {
  const s = r.api_error_status;
  if (typeof s === 'number') {
    if (s === 401) return { kind: 'auth', tripForMs: HARD_TRIP_MS };
    if (s === 402 || s === 403) return { kind: 'forbidden', tripForMs: HARD_TRIP_MS };
    if (s === 404) return { kind: 'model_not_found', tripForMs: HARD_TRIP_MS };
    if (s === 429) return { kind: 'rate_limited', tripForMs: RATE_LIMIT_TRIP_MS };
    if (s === 408) return { kind: 'timeout' };
    if (s === 529) return { kind: 'overloaded' };
    if (s >= 500) return { kind: 'server' };
    if (s >= 400) return { kind: 'bad_request' };
  }
  if (r.subtype === 'error_max_turns' || r.subtype === 'error_max_budget_usd') return { kind: 'truncated', healthy: true };
  if (r.subtype === 'error_max_structured_output_retries') return { kind: 'invalid_output', healthy: true };
  return { kind: 'provider' };
}

function parseStrictObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text.trim());
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** The answer of a successful result event: one JSON object (schema calls) or text; size-capped; no tool markup. */
export function extractAnswer(r: CliResult, structured: boolean): { ok: true; text: string } | ({ ok: false } & Failure) {
  let value: unknown;
  if (structured) {
    value = isRecord(r.structured_output) ? r.structured_output : typeof r.result === 'string' ? (parseStrictObject(r.result) ?? undefined) : undefined;
    if (value === undefined) return { ok: false, kind: (r.result ?? '').trim() === '' ? 'empty' : 'invalid_output', healthy: true };
  } else {
    if (typeof r.result !== 'string' || r.result.trim() === '') return { ok: false, kind: 'empty', healthy: true };
    value = r.result;
  }
  if (hasToolCallMarkup(value)) return { ok: false, kind: 'invalid_output', healthy: true };
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length > MAX_OUTPUT_CHARS) return { ok: false, kind: 'truncated', healthy: true };
  return { ok: true, text };
}

// ---------------------------------------------------------------------------------------------------------------
// Process bookkeeping
// ---------------------------------------------------------------------------------------------------------------

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal); // detached: the child leads its own process group
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/** Live CLI process groups of this server process and their temp dirs: killed / removed if the server exits. */
const LIVE = new Map<number, string>();
let exitHookInstalled = false;
function track(pid: number, root: string): void {
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once('exit', () => {
      for (const [p, dir] of LIVE) {
        try {
          process.kill(-p, 'SIGKILL');
        } catch {
          /* gone */
        }
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    });
  }
  LIVE.set(pid, root);
}

interface CallDirs {
  root: string;
  cwd: string;
  tmp: string;
  systemFile: string;
}

/** A private 0700 directory per call: an empty cwd, a separate TMPDIR and the 0600 system prompt file. */
function makeCallDirs(base: string, system: string): CallDirs {
  const root = mkdtempSync(path.join(base, 'bazaar-cli-'));
  const cwd = path.join(root, 'cwd');
  const tmp = path.join(root, 'tmp');
  mkdirSync(cwd, { mode: 0o700 });
  mkdirSync(tmp, { mode: 0o700 });
  const systemFile = path.join(root, 'system.txt');
  writeFileSync(systemFile, system, { mode: 0o600, flag: 'wx' });
  return { root, cwd, tmp, systemFile };
}

const byteLength = (s: string) => Buffer.byteLength(s, 'utf8');

// ---------------------------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------------------------

export interface ClaudeCliOptions {
  /** Absolute path of the CLI executable (resolveCliBin); null = not found: the client is unconfigured. */
  bin: string | null;
  model: string;
  /** Hard per-call budget (also the upper bound for LlmRequest.timeoutMs). */
  timeoutMs: number;
  thinking?: ThinkingMode;
  /** Calls in flight, clamped to 1..2 (live processes: at most twice that). */
  maxConcurrent?: number;
  breaker?: CircuitBreaker;
  onOutcome?: OutcomeListener;
  now?: () => number;
  /** Environment the allowlist reads from (default: process.env, read once here). */
  env?: NodeJS.ProcessEnv;
  /** Where the per-call private dirs are created (default: os.tmpdir()). */
  tmpBase?: string;
  /** Test seams. */
  maxStdoutBytes?: number;
  killGraceMs?: number;
}

export class ClaudeCliLlmClient implements LlmClient {
  readonly backend: LlmBackend = 'claude-cli';
  readonly configured: boolean;
  readonly model: string;
  private readonly bin: string | null;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly breaker: CircuitBreaker;
  private readonly onOutcome: OutcomeListener | undefined;
  private readonly now: () => number;
  private readonly childEnv: Readonly<Record<string, string>>;
  private readonly tmpBase: string;
  private readonly maxStdoutBytes: number;
  private readonly killGraceMs: number;
  /** Calls not yet answered (capped at maxConcurrent). */
  private calls = 0;
  /**
   * CLI processes alive (hard-capped at 2 x maxConcurrent): a call is answered as soon as its result line arrives
   * or its deadline passes, and its process then gets a short while to exit before its group is killed, so the
   * next call does not have to wait for that.
   */
  private running = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(opts: ClaudeCliOptions) {
    this.model = opts.model;
    this.bin = opts.bin && path.isAbsolute(opts.bin) && MODEL_RE.test(opts.model) ? opts.bin : null;
    this.configured = this.bin !== null;
    this.timeoutMs = Math.max(1, opts.timeoutMs);
    this.maxConcurrent = Math.min(MAX_CONCURRENT_CAP, Math.max(1, Math.floor(opts.maxConcurrent ?? 1)));
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.onOutcome = opts.onOutcome;
    this.now = opts.now ?? Date.now;
    const mode = opts.thinking ?? 'auto';
    const disableThinking = mode === 'off' || (mode === 'auto' && /^(?:claude-)?haiku/i.test(opts.model));
    this.childEnv = Object.freeze(buildChildEnv(opts.env ?? process.env, disableThinking));
    this.tmpBase = opts.tmpBase ?? tmpdir();
    this.maxStdoutBytes = Math.max(1024, opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES);
    this.killGraceMs = Math.max(0, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  }

  /** False while unconfigured, at the concurrency cap, or while the circuit is open. */
  available(): boolean {
    return this.configured && !this.atCap() && this.breaker.canAttempt();
  }

  private atCap(): boolean {
    return this.calls >= this.maxConcurrent || this.running >= 2 * this.maxConcurrent;
  }

  get breakerState(): BreakerState {
    return this.breaker.state;
  }

  /** Calls waiting for their answer. */
  get inFlight(): number {
    return this.calls;
  }

  /** CLI processes alive right now (an answered or killed one counts until it is gone). */
  get alive(): number {
    return this.running;
  }

  /** Resolves once no CLI process of this client is alive. */
  idle(): Promise<void> {
    return this.running === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private emit(op: LlmOp, outcome: LlmOutcome, ms: number): void {
    try {
      this.onOutcome?.({ op, outcome, ms: Math.round(ms) });
    } catch {
      /* a logging failure must never fail the call */
    }
  }

  /** An immediate refusal (nothing started): reported like any outcome, returned for the caller to throw. */
  private refuse(op: LlmOp, kind: LlmErrorKind): LlmError {
    this.emit(op, kind, 0);
    return new LlmError(kind);
  }

  async complete(req: LlmRequest): Promise<string> {
    const bin = this.bin;
    if (!bin) throw this.refuse(req.op, 'not_configured');
    let prompt: string;
    let schemaJson: string | undefined;
    try {
      prompt = cliPromptText(req.user);
      schemaJson = req.schema ? JSON.stringify(req.schema) : undefined;
    } catch {
      throw this.refuse(req.op, 'bad_request');
    }
    if (
      typeof req.system !== 'string' ||
      byteLength(prompt) > MAX_PROMPT_BYTES ||
      byteLength(req.system) > MAX_SYSTEM_BYTES ||
      (schemaJson !== undefined && byteLength(schemaJson) > MAX_SCHEMA_BYTES)
    ) {
      throw this.refuse(req.op, 'bad_request');
    }
    // A local cap, not a backend failure: nothing is started and the breaker is not touched.
    if (this.atCap()) throw this.refuse(req.op, 'busy');
    const ticket = this.breaker.acquire();
    if (!ticket) throw this.refuse(req.op, 'circuit_open');
    const budget = Math.max(1, Math.min(this.timeoutMs, Math.floor(req.timeoutMs ?? this.timeoutMs)));
    const maxTokens = Math.max(1, Math.min(MAX_TOKENS_CAP, Math.floor(req.maxTokens)));
    return this.run(req, { bin, prompt, schemaJson, ticket, budget, maxTokens });
  }

  private run(
    req: LlmRequest,
    c: { bin: string; prompt: string; schemaJson: string | undefined; ticket: BreakerTicket; budget: number; maxTokens: number },
  ): Promise<string> {
    const started = this.now();
    this.calls += 1; // released when the call settles (finish)
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => failAndKill({ kind: 'timeout' });

      const finish = (r: { ok: true; text: string } | ({ ok: false } & Failure)) => {
        if (settled) return;
        settled = true;
        this.calls -= 1;
        clearTimeout(deadline);
        req.signal?.removeEventListener('abort', onAbort);
        const ms = this.now() - started;
        if (r.ok) {
          this.breaker.success(c.ticket);
          this.emit(req.op, 'ok', ms);
          resolve(r.text);
          return;
        }
        if (r.healthy) this.breaker.success(c.ticket);
        else this.breaker.failure(c.ticket, r.tripForMs !== undefined ? { tripForMs: r.tripForMs } : {});
        this.emit(req.op, r.kind, ms);
        reject(new LlmError(r.kind));
      };

      // An already-aborted caller (e.g. the parse race is over): counted as a timeout, as in the API client.
      if (req.signal?.aborted) {
        finish({ ok: false, kind: 'timeout' });
        return;
      }

      // --- reserve a process slot (held until the process is gone, not just until the call settles) -----------
      this.running += 1;
      let dirs: CallDirs | null = null;
      let child: ChildProcess | null = null;
      let released = false;
      let exited = false;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        timers.push(t);
      };
      const release = () => {
        if (released) return;
        released = true;
        for (const t of timers) clearTimeout(t);
        // our ends of the pipes (no-ops after a normal close; frees them if a stray process still holds the other end)
        child?.stdin?.destroy();
        child?.stdout?.destroy();
        if (child?.pid !== undefined) LIVE.delete(child.pid);
        if (dirs) {
          try {
            rmSync(dirs.root, { recursive: true, force: true });
          } catch {
            /* best effort; the exit hook retries for live calls only */
          }
        }
        this.running -= 1;
        if (this.running === 0) for (const w of this.idleWaiters.splice(0)) w();
      };
      let terminating = false;
      const terminate = () => {
        if (terminating || exited || !child) return;
        terminating = true;
        killGroup(child, 'SIGTERM');
        later(() => {
          if (!exited && child) killGroup(child, 'SIGKILL');
        }, this.killGraceMs);
        later(release, REAP_DEADLINE_MS);
      };
      function failAndKill(f: Failure) {
        finish({ ok: false, ...f });
        terminate();
      }

      try {
        dirs = makeCallDirs(this.tmpBase, req.system);
      } catch {
        release();
        finish({ ok: false, kind: 'provider' });
        return;
      }

      const env = { ...this.childEnv, TMPDIR: dirs.tmp, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(c.maxTokens) };
      try {
        child = spawn(c.bin, buildCliArgs({ model: this.model, systemFile: dirs.systemFile, schemaJson: c.schemaJson }), {
          cwd: dirs.cwd,
          env,
          shell: false,
          detached: true, // own process group: a timeout kills the CLI and anything it started
          stdio: ['pipe', 'pipe', 'ignore'], // stderr is never read, never logged
          windowsHide: true,
        });
      } catch {
        release();
        finish({ ok: false, kind: 'not_configured', tripForMs: HARD_TRIP_MS });
        return;
      }
      if (child.pid !== undefined) track(child.pid, dirs.root);

      deadline = setTimeout(() => failAndKill({ kind: 'timeout' }), c.budget);
      req.signal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', () => {
        // ENOENT / EACCES at spawn (the binary vanished since start-up), or a failed kill.
        failAndKill({ kind: 'not_configured', tripForMs: HARD_TRIP_MS });
        if (child?.pid === undefined) later(release, 0);
      });

      // --- stdout: stream-json, checked event by event ------------------------------------------------------
      const checker = new CliStreamChecker(new Set(c.schemaJson ? [STRUCTURED_OUTPUT_TOOL] : []));
      const decoder = new StringDecoder('utf8');
      let pending = '';
      let bytes = 0;
      let done = false; // a verdict was reached: later output is only counted
      const onLine = (line: string) => {
        if (done) return;
        const t = line.trim();
        if (t === '') return;
        let msg: unknown;
        try {
          msg = JSON.parse(t);
        } catch {
          msg = undefined;
        }
        if (!isRecord(msg)) {
          done = true;
          failAndKill({ kind: 'invalid_output' }); // not the stream-json protocol: a broken or unexpected CLI
          return;
        }
        const v = checker.accept(msg);
        if (v.kind === 'continue') return;
        done = true;
        if (v.kind === 'violation') {
          failAndKill({ kind: 'isolation', tripForMs: ISOLATION_TRIP_MS });
          return;
        }
        if (v.kind === 'invalid') {
          failAndKill({ kind: 'invalid_output' });
          return;
        }
        const r = v.result;
        if (r.is_error || r.subtype !== 'success') finish({ ok: false, ...classifyResultFailure(r) });
        else finish(extractAnswer(r, c.schemaJson !== undefined));
        later(terminate, EXIT_AFTER_RESULT_MS); // the answer is in; the CLI only has to exit now
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.maxStdoutBytes) {
          done = true;
          pending = '';
          failAndKill({ kind: 'truncated' });
          return;
        }
        if (done) return;
        pending += decoder.write(chunk);
        let nl = pending.indexOf('\n');
        while (nl >= 0 && !done) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          onLine(line);
          nl = pending.indexOf('\n');
        }
      });
      child.stdout?.on('end', () => {
        if (!done) onLine(pending + decoder.end());
        pending = '';
      });
      child.stdout?.on('error', () => failAndKill({ kind: 'provider' }));

      // --- stdin: the prompt, and nothing else ---------------------------------------------------------------
      child.stdin?.on('error', () => {
        /* EPIPE when the process died early: the close handler decides the outcome */
      });
      child.stdin?.end(c.prompt, 'utf8');

      child.on('close', (code) => {
        exited = true;
        // exited without a result line: a crash (non-zero) or an unexpected protocol (zero)
        if (!settled) finish({ ok: false, kind: code === 0 ? 'invalid_output' : 'provider' });
        if (child) killGroup(child, 'SIGKILL'); // anything the CLI left behind in its group
        release();
      });
    });
  }
}

/** Factory used by createLlmClient for LLM_BACKEND=claude-cli. */
export function createClaudeCliClient(
  cfg: LlmClientConfig,
  deps: { breaker: CircuitBreaker; onOutcome?: OutcomeListener | undefined; env?: NodeJS.ProcessEnv | undefined },
): ClaudeCliLlmClient {
  const env = deps.env ?? process.env;
  const bin = resolveCliBin({ explicit: cfg.llmCliBin, pathEnv: env.PATH, lookupPath: cfg.nodeEnv !== 'test' });
  return new ClaudeCliLlmClient({
    bin,
    model: cfg.llmCliModel ?? cfg.llmModel,
    timeoutMs: cfg.llmTimeoutMs,
    thinking: cfg.llmThinking ?? 'auto',
    maxConcurrent: cfg.llmCliConcurrency ?? 1,
    breaker: deps.breaker,
    env,
    ...(deps.onOutcome ? { onOutcome: deps.onOutcome } : {}),
  });
}
