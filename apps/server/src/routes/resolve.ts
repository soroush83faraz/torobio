import { Api } from '@app/core';
import type { FastifyInstance } from 'fastify';
import { planState, resolveResponse } from '../adapter/engine.js';
import type { AppContext } from '../context.js';
import { ok, validate } from '../http.js';
import { catalogFor } from '../retrieval/catalog.js';
import { labelNearby } from '../retrieval/notfound.js';
import type { DecisionRouteOptions } from './plan.js';

/**
 * POST /api/resolve — per-item state, next question, counts and price ranges (B3.7). Stateless.
 * The item cards are those of the plan's compatibility guard (same as /api/plan `items`): a pick that would
 * conflict with another item's pick is never shown, and an assigned item shows the product the selected plan buys,
 * so /api/resolve and /api/plan always agree.
 */
export function resolveRoutes(app: FastifyInstance, ctx: AppContext, opts: DecisionRouteOptions = {}): void {
  const now = opts.now ?? (() => new Date());
  app.post('/api/resolve', async (req) => {
    const { state } = validate(Api.ResolveRequestSchema, req.body);
    const catalog = catalogFor(ctx.db);
    const ps = planState(catalog, state, now());
    // the same cards as /api/plan for this state: what the selected plan (variant included) actually buys
    const res = resolveResponse(catalog, ps.rs, ps.selected);
    labelNearby(catalog, res.items, (id) => state.requirements.find((r) => r.id === id)?.text);
    return ok(res);
  });
}
