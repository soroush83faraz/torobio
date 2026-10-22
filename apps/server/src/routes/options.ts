import { Api } from '@app/core';
import type { FastifyInstance } from 'fastify';
import { optionsResponse, planState } from '../adapter/engine.js';
import type { AppContext } from '../context.js';
import { AppError, ok, validate } from '../http.js';
import { catalogFor } from '../retrieval/catalog.js';
import type { DecisionRouteOptions } from './plan.js';

/** POST /api/options — models of an item (by price, with deltas) and the sellers of its current / given product. */
export function optionsRoutes(app: FastifyInstance, ctx: AppContext, opts: DecisionRouteOptions = {}): void {
  const now = opts.now ?? (() => new Date());
  app.post('/api/options', async (req) => {
    const body = validate(Api.OptionsRequestSchema, req.body);
    if (!body.state.requirements.some((r) => r.id === body.itemId)) throw new AppError('NOT_FOUND');
    const catalog = catalogFor(ctx.db);
    const res = optionsResponse(planState(catalog, body.state, now()), body.itemId, body.productId);
    if (!res) throw new AppError('NOT_FOUND');
    return ok(res);
  });
}
