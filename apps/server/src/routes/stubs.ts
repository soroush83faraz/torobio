import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError } from '../http.js';

/**
 * Placeholders for the real endpoints (PLAN B3.7). Each unit replaces its stub by registering a real
 * route module and removing the name from this list. All of them are stateless POSTs that take the
 * whole requirement state in the (small, JSON) body.
 */
export const STUB_ENDPOINTS: readonly string[] = [];

export function stubRoutes(app: FastifyInstance, _ctx: AppContext): void {
  for (const name of STUB_ENDPOINTS) {
    app.post(`/api/${name}`, async () => {
      throw new AppError('NOT_IMPLEMENTED');
    });
  }
}
