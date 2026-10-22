import { Api } from '@app/core';
import type { FastifyInstance } from 'fastify';
import { planResponse, planState } from '../adapter/engine.js';
import type { AppContext } from '../context.js';
import { ok, validate } from '../http.js';
import { catalogFor } from '../retrieval/catalog.js';
import { labelNearby } from '../retrieval/notfound.js';

export interface DecisionRouteOptions {
  /** Clock seam for «امروز / فردا» and open-now status (tests). */
  now?: () => Date;
}

/** POST /api/plan — full recompute from the requirement state: stops, totals with coverage, compat (B3.7). */
export function planRoutes(app: FastifyInstance, ctx: AppContext, opts: DecisionRouteOptions = {}): void {
  const now = opts.now ?? (() => new Date());
  app.post('/api/plan', async (req) => {
    const { state } = validate(Api.PlanRequestSchema, req.body);
    const catalog = catalogFor(ctx.db);
    const res = planResponse(planState(catalog, state, now()), state, catalog);
    labelNearby(catalog, res.items ?? [], (id) => state.requirements.find((r) => r.id === id)?.text);
    return ok(res);
  });
}
