import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { LlmBackend } from '../llm/client.js';

const BACKENDS: ReadonlySet<string> = new Set<LlmBackend>(['anthropic', 'claude-cli', 'none']);

/** The serving backend, always one of BACKENDS (a client without a name, e.g. a test double, reads by `configured`). */
function llmBackendName(ctx: AppContext): LlmBackend {
  const b = ctx.llm.backend;
  if (b !== undefined && BACKENDS.has(b)) return b;
  return ctx.llm.configured ? 'anthropic' : 'none';
}

/**
 * Flat (non-enveloped) on purpose: load balancers and monitors read it directly.
 * Always HTTP 200 while the process is up, so a deploy without data (db:false) still goes live.
 * Never exposes the LLM key, paths or any config values: about the LLM only `llm` (calls possible) and the backend
 * name from a closed set (never a model id, CLI path or version).
 */
export function healthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', { config: { rateLimit: false } }, async () => ({
    status: ctx.db.present ? 'ok' : 'degraded',
    db: ctx.db.present,
    llm: ctx.llm.configured,
    llmBackend: llmBackendName(ctx),
    uptimeSec: Math.round(process.uptime()),
    commit: ctx.config.commit,
  }));
}
