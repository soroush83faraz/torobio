import { Api } from '@app/core';
import type { FastifyInstance } from 'fastify';
import { planState } from '../adapter/engine.js';
import { placesResponse, placesState } from '../adapter/places.js';
import type { AppContext } from '../context.js';
import { ok, validate } from '../http.js';
import { catalogFor } from '../retrieval/catalog.js';
import type { DecisionRouteOptions } from './plan.js';

/**
 * POST /api/places — «کجا بروم»: buildings ranked for the whole list (coverage, then total, then choice), with a
 * one-line recommendation. Same body as /api/plan (`{ state }`); stateless. Items still waiting on a question are
 * evaluated with the default rule, compat guard included (adapter/places.ts `placesState`).
 */
export function placesRoutes(app: FastifyInstance, ctx: AppContext, opts: DecisionRouteOptions = {}): void {
  const now = opts.now ?? (() => new Date());
  app.post('/api/places', async (req) => {
    const { state } = validate(Api.PlanRequestSchema, req.body);
    const catalog = catalogFor(ctx.db);
    const settled = placesState(state);
    return ok(placesResponse(planState(catalog, settled, now()), settled));
  });
}
