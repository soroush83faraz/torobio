import type { FastifyInstance } from 'fastify';
import { dbFactsProvider, type FactsProvider } from '../assist/facts.js';
import { runAssist } from '../assist/service.js';
import { AssistRequestSchema, MAX_ASSIST_TEXT } from '../assist/types.js';
import type { AppContext } from '../context.js';
import { AppError, ok, validate } from '../http.js';
import { parseRequest } from '../parse/index.js';
import { clientKey } from '../llm/gate.js';

export interface AssistRouteOptions {
  /** Clock seam (only_open uses Tehran "now"). */
  now?: () => Date;
  /** Test seam: facts of the current plan without the real catalog. */
  facts?: FactsProvider;
}

/**
 * POST /api/assist  { state, text? | chip?, context? }
 *   -> { data: { action, newState, changed, supported, messageFa, message, source, degraded?, choices? } }
 *
 * Stricter per-client rate limit than the rest of /api (it may call the LLM and recomputes the plan); the LLM path
 * additionally goes through ctx.llmGate (per-client per-minute / daily and global daily budgets).
 */
export function assistRoutes(app: FastifyInstance, ctx: AppContext, opts: AssistRouteOptions = {}): void {
  const now = opts.now ?? (() => new Date());
  const facts = opts.facts ?? dbFactsProvider(ctx.db, now);
  app.post('/api/assist', { config: { rateLimit: { max: ctx.config.assistRateLimit, timeWindow: '1 minute' } } }, async (req) => {
    const body = validate(AssistRequestSchema, req.body);
    if (body.text !== undefined && Array.from(body.text).length > MAX_ASSIST_TEXT) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'متن درخواست خیلی طولانی است؛ کوتاه‌تر بنویس (حداکثر ۳۰۰ نویسه).');
    }
    if (!body.chip && (body.text === undefined || body.text.trim() === '')) {
      throw new AppError('BAD_REQUEST', 'یکی از گزینه‌ها را بزن یا درخواستت را بنویس.');
    }
    const result = await runAssist(body, {
      llm: ctx.llm,
      gate: ctx.llmGate,
      clientKey: clientKey(req.ip),
      timeoutMs: ctx.config.llmTimeoutMs,
      now: now(),
      facts: facts(body.state),
      parseItems: (text) => parseRequest(text, ctx.db).items,
    });
    return ok(result);
  });
}
