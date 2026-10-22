import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Writable } from 'node:stream';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDb, type Db } from './db.js';
import { clientErrorHandler, frameworkErrors, installBodySanitizer, installErrorHandler } from './errors.js';
import { createLlmClient, type LlmClient, type OutcomeListener } from './llm/client.js';
import { LlmGate } from './llm/gate.js';
import { createParseRefiner } from './llm/refiner.js';
import { assistRoutes } from './routes/assist.js';
import { healthRoutes } from './routes/health.js';
import { metaRoutes } from './routes/meta.js';
import { optionsRoutes } from './routes/options.js';
import { planRoutes } from './routes/plan.js';
import { resolveRoutes } from './routes/resolve.js';
import { parseRoutes } from './routes/parse.js';
import { stubRoutes } from './routes/stubs.js';
import { installNotFound, registerCompression, registerWeb } from './web.js';

export interface BuildOptions {
  config: Config;
  /** Test seams. */
  db?: Db;
  llm?: LlmClient;
  logStream?: Writable;
  /** Clock seam for visit-day resolution («امروز/فردا») in the decision routes. */
  now?: () => Date;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const { config } = opts;
  const db = opts.db ?? openDb(config.databasePath);
  // LLM outcome log: category + latency only (never prompts, user text, model output or the key).
  let log: FastifyBaseLogger | undefined;
  const onOutcome: OutcomeListener = (e) => log?.info({ llm: { op: e.op, outcome: e.outcome, ms: e.ms } }, 'llm call');
  const llm = opts.llm ?? createLlmClient(config, { onOutcome });
  const llmGate = new LlmGate({
    perMinute: config.llmPerMinute,
    dailyPerClient: config.llmDailyPerClient,
    dailyGlobal: config.llmDailyGlobal,
    maxConcurrent: config.llmMaxConcurrent,
  });
  const ctx: AppContext = { config, db, llm, llmGate, ...(llm.configured ? { parseRefiner: createParseRefiner({ llm, db }) } : {}) };

  const serverOptions: FastifyServerOptions = {
    // Logging policy: structured JSON, never request/response bodies, query strings, headers or
    // error messages (they may contain user text). Only method, path, status, timing, ids.
    logger: {
      level: config.logLevel,
      ...(opts.logStream ? { stream: opts.logStream } : {}),
      redact: ['req.headers', 'res.headers'],
      serializers: {
        req: (req) => ({ method: req.method, url: String(req.url ?? '').split('?')[0], id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
    // Framework-level failures (bad URL, malformed HTTP) still answer in the Persian envelope.
    frameworkErrors,
    clientErrorHandler,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    handlerTimeout: config.requestTimeoutMs,
    connectionTimeout: config.requestTimeoutMs * 2,
    keepAliveTimeout: 65_000, // above typical load-balancer idle timeouts (60 s)
    // Trust only the nearest N proxy hops (Fastify's numeric form fails closed, so use a function):
    // the client IP is then the address the Nth proxy saw, which a caller cannot forge.
    trustProxy: config.trustProxyHops > 0 ? (_addr: string, hop: number) => hop < config.trustProxyHops : false,
  };
  const app = Fastify(serverOptions) as unknown as FastifyInstance;
  log = app.log;
  // Strict content types: only application/json bodies are accepted (drop Fastify's text/plain parser).
  app.removeContentTypeParser('text/plain');

  // --- security headers (helmet-style, no extra dependency) ---------------------------------
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header('Content-Security-Policy', CSP);
    if (config.nodeEnv === 'production') reply.header('Strict-Transport-Security', 'max-age=15552000');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  // CORS is deliberately NOT enabled: the web app is served same-origin.

  // --- per-IP rate limit on /api/* (health exempt via route config; static files unlimited) ----
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/api/'),
    errorResponseBuilder: (_req, context) => {
      const err = new Error('rate_limited') as Error & { statusCode: number };
      err.statusCode = context.statusCode;
      return err;
    },
  });

  // --- errors + input sanitising (errors.ts): every error is the Persian envelope; request text is cleaned ---
  installErrorHandler(app);
  installBodySanitizer(app);

  await registerCompression(app);

  // --- routes -------------------------------------------------------------------------------
  healthRoutes(app, ctx);
  metaRoutes(app, ctx);
  resolveRoutes(app, ctx);
  planRoutes(app, ctx, opts.now ? { now: opts.now } : {});
  optionsRoutes(app, ctx, opts.now ? { now: opts.now } : {});
  parseRoutes(app, ctx);
  assistRoutes(app, ctx, opts.now ? { now: opts.now } : {});
  stubRoutes(app, ctx);

  // --- web app + SPA fallback ---------------------------------------------------------------
  const hasWeb = await registerWeb(app, config.webDist);
  installNotFound(app, hasWeb);

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, ctx };
}
