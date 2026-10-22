import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export interface Config {
  port: number;
  /** Default 0.0.0.0; 127.0.0.1 for the claude-cli backend (it spends the developer's own Claude subscription). */
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  databasePath: string;
  /** Optional. When absent the LLM features are off and the product runs on its deterministic path. */
  llmApiKey: string | undefined;
  llmModel: string;
  /**
   * Selected LLM backend (LLM_BACKEND). Default: 'anthropic' when LLM_API_KEY is set, else 'none'. 'claude-cli' is a
   * TESTING-ONLY backend (a local headless Claude Code session per call, llm/claude-cli-client.ts): it needs an
   * explicit LLM_BACKEND=claude-cli and is refused under NODE_ENV=production unless LLM_ALLOW_CLI_IN_PROD=1.
   */
  llmBackend: LlmBackendName;
  /** claude-cli only: absolute path of the CLI (default: `claude` on PATH, resolved once at startup). */
  llmCliBin: string | undefined;
  /** claude-cli only: model id or alias passed to the CLI (default: llmModel). */
  llmCliModel: string;
  /** claude-cli only: CLI calls in flight (1-2; beyond, the call is skipped and the answer is deterministic). */
  llmCliConcurrency: number;
  llmAllowCliInProd: boolean;
  /** Default 3000 ms; 20000 ms for the claude-cli backend (process start-up + a full Claude Code turn). */
  llmTimeoutMs: number;
  /** 'auto' = thinking off for the Haiku 5 family, the model's default otherwise (llm/client.ts). */
  llmThinking: 'auto' | 'off' | 'adaptive';
  /** Consecutive LLM failures that open the circuit, and the first cooldown before a half-open probe. */
  llmBreakerThreshold: number;
  llmBreakerCooldownMs: number;
  /** LLM calls per client per minute (/api/parse refinement + /api/assist); 0 = LLM path off. */
  llmPerMinute: number;
  /** LLM calls per client per UTC day. */
  llmDailyPerClient: number;
  /** LLM calls per UTC day for the whole instance (cost ceiling). */
  llmDailyGlobal: number;
  /** LLM calls in flight at once (beyond: deterministic answer). */
  llmMaxConcurrent: number;
  /** Max /api/assist requests per client per minute (stricter than RATE_LIMIT). */
  assistRateLimit: number;
  /** Max requests per IP per minute on /api/* (health is exempt). */
  rateLimit: number;
  /** Number of reverse-proxy hops to trust for client IP (0 = none). */
  trustProxyHops: number;
  webDist: string;
  bodyLimitBytes: number;
  /** Hard cap on handler time. Default 10000 ms; for claude-cli at least LLM timeout + 5 s (the LLM race fits in it). */
  requestTimeoutMs: number;
  logLevel: string;
  commit: string;
}

export type LlmBackendName = 'anthropic' | 'claude-cli' | 'none';

/** A model id or alias: one argv element for the CLI, so never something that could read as a flag. */
const CLI_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_PATH: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BACKEND: z.enum(['anthropic', 'claude-cli', 'none']).optional(),
  LLM_CLI_BIN: z.string().refine((p) => path.isAbsolute(p), 'must be an absolute path').optional(),
  LLM_CLI_MODEL: z.string().regex(CLI_MODEL_RE).optional(),
  LLM_CLI_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  LLM_ALLOW_CLI_IN_PROD: z.enum(['0', '1']).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).optional(),
  LLM_THINKING: z.enum(['auto', 'off', 'adaptive']).default('auto'),
  LLM_BREAKER_THRESHOLD: z.coerce.number().int().min(1).max(50).default(3),
  LLM_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
  LLM_RATE_LIMIT: z.coerce.number().int().min(0).max(10000).default(10),
  LLM_DAILY_PER_IP: z.coerce.number().int().min(0).default(150),
  LLM_DAILY_GLOBAL: z.coerce.number().int().min(0).default(3000),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(4),
  ASSIST_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT: z.coerce.number().int().min(1).default(120),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).optional(),
  WEB_DIST: z.string().optional(),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(256).default(16 * 1024),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).optional(),
  LOG_LEVEL: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
});

/** The claude-cli backend is for local testing only (it drives the operator's own Claude Code login). */
const CheckedEnvSchema = EnvSchema.superRefine((e, ctx) => {
  if (e.LLM_BACKEND === 'claude-cli' && e.NODE_ENV === 'production' && e.LLM_ALLOW_CLI_IN_PROD !== '1') {
    ctx.addIssue({ code: 'custom', path: ['LLM_BACKEND'], message: 'claude-cli is a testing backend: refused under NODE_ENV=production unless LLM_ALLOW_CLI_IN_PROD=1' });
  }
});

/** Walk up from `start` to the monorepo root (package.json with "workspaces"). Falls back to `start`. */
export function findRepoRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {
        /* ignore unreadable package.json */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** Empty strings in env (common in dashboards) are treated as unset. */
function clean(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === undefined || v.trim() === '' ? undefined : v.trim();
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Config {
  const e = CheckedEnvSchema.parse(clean(env));
  const root = findRepoRoot(cwd);
  const resolveArg = (p: string) => path.resolve(cwd, p);
  const llmBackend: LlmBackendName = e.LLM_BACKEND ?? (e.LLM_API_KEY ? 'anthropic' : 'none');
  const cli = llmBackend === 'claude-cli';
  const llmModel = e.LLM_MODEL ?? 'claude-haiku-5-5';
  // A CLI call starts a process and runs a full Claude Code turn: seconds, not milliseconds.
  const llmTimeoutMs = e.LLM_TIMEOUT_MS ?? (cli ? 20_000 : 3000);
  return {
    port: e.PORT,
    // claude-cli spends the developer's own Claude subscription: loopback only unless HOST is set explicitly.
    host: e.HOST ?? (cli ? '127.0.0.1' : '0.0.0.0'),
    nodeEnv: e.NODE_ENV,
    databasePath: e.DATABASE_PATH ? resolveArg(e.DATABASE_PATH) : path.join(root, 'data', 'market.sqlite'),
    llmApiKey: e.LLM_API_KEY,
    llmModel,
    llmBackend,
    llmCliBin: e.LLM_CLI_BIN,
    llmCliModel: e.LLM_CLI_MODEL ?? (CLI_MODEL_RE.test(llmModel) ? llmModel : 'claude-haiku-5-5'),
    llmCliConcurrency: e.LLM_CLI_CONCURRENCY,
    llmAllowCliInProd: e.LLM_ALLOW_CLI_IN_PROD === '1',
    llmTimeoutMs,
    llmThinking: e.LLM_THINKING,
    llmBreakerThreshold: e.LLM_BREAKER_THRESHOLD,
    llmBreakerCooldownMs: e.LLM_BREAKER_COOLDOWN_MS,
    llmPerMinute: e.LLM_RATE_LIMIT,
    llmDailyPerClient: e.LLM_DAILY_PER_IP,
    llmDailyGlobal: e.LLM_DAILY_GLOBAL,
    llmMaxConcurrent: e.LLM_MAX_CONCURRENCY,
    assistRateLimit: e.ASSIST_RATE_LIMIT,
    rateLimit: e.RATE_LIMIT,
    trustProxyHops: e.TRUST_PROXY ?? (e.NODE_ENV === 'production' ? 1 : 0),
    webDist: e.WEB_DIST ? resolveArg(e.WEB_DIST) : path.join(root, 'apps', 'web', 'dist'),
    bodyLimitBytes: e.BODY_LIMIT_BYTES,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS ?? (cli ? Math.max(10_000, llmTimeoutMs + 5000) : 10_000),
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    commit: (e.RENDER_GIT_COMMIT ?? 'dev').slice(0, 12),
  };
}
