import { sanitizeDeep, sanitizeText } from '@app/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError, ok } from '../http.js';
import { clientKey } from '../llm/gate.js';
import { MAX_TEXT_CHARS, parseRequest, refineWithTimeout } from '../parse/index.js';
import { getLexicon } from '../parse/lexicon.js';
import type { ParseResult } from '../parse/index.js';

/** POST /api/parse  { text } -> { data: { title, items, preference?, totalBudget?, notes, source, degraded? } } */
export function parseRoutes(app: FastifyInstance, ctx: AppContext): void {
  getLexicon(ctx.db); // load categories + synonyms once at startup, not on the first user request
  app.post('/api/parse', async (req) => {
    const body = req.body as { text?: unknown } | null;
    if (!body || typeof body !== 'object' || typeof body.text !== 'string') throw new AppError('BAD_REQUEST', 'متن درخواست را بنویسید.');
    // Bidi overrides / control characters never reach the parser, a title or a share link (the body hook already
    // cleans /api bodies; this keeps the route safe when it is called directly).
    const text = sanitizeText(body.text);
    if (text.length > MAX_TEXT_CHARS) throw new AppError('PAYLOAD_TOO_LARGE', 'متن درخواست خیلی طولانی است؛ آن را کوتاه‌تر بنویسید (حداکثر ۵۰۰ نویسه).');
    if (text.trim() === '') throw new AppError('BAD_REQUEST', 'متن درخواست خالی است.');

    const draft = parseRequest(text, ctx.db);
    const refiner = ctx.parseRefiner;
    if (!refiner) return ok<ParseResponse>(sanitizeDeep(draft));

    // Cost / abuse control of the LLM path (llm/gate.ts): when this client's (or the instance's) LLM budget is
    // spent, the deterministic result is returned, flagged like any other unused refinement. No gate = closed.
    const ticket = ctx.llmGate?.acquire(clientKey(req.ip));
    if (!ticket || !ticket.ok) return ok<ParseResponse>(sanitizeDeep({ ...draft, degraded: true }));
    try {
      const { result, outcome } = await refineWithTimeout({ refiner, draft, text, timeoutMs: ctx.config.llmTimeoutMs });
      return ok<ParseResponse>(sanitizeDeep({ ...result, ...(outcome === 'refined' ? {} : { degraded: true }) }));
    } finally {
      ticket.release();
    }
  });
}

/** `degraded`: a refiner is configured but its result was not used (timeout, error or invalid output). */
export type ParseResponse = ParseResult & { degraded?: boolean };
