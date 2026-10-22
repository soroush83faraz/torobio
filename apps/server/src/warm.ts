/**
 * Background pre-warm of the catalog caches.
 *
 * Cold start (measured on the full snapshot): the first decision call that touches a category loads that
 * category's candidate pool (products + offers + attribute mapping), about 120–160 ms for the large demo
 * categories; later calls hit the in-memory pool (~10–15 ms per resolve/plan). Shops, categories and synonyms
 * are loaded once too.
 *
 * After the server is listening, the title-head counts of the plausibility rules (core requirement/plausibility.ts,
 * one pass over every listing, ~2 s in total) are built 10k listings per event-loop turn, then the pools of the demo
 * categories are loaded one per turn, so readiness is never delayed. A decision request that arrives during the
 * head pass finishes the remaining part synchronously (it needs the counts).
 */
import { Api } from '@app/core';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from './context.js';
import { catalogFor } from './retrieval/catalog.js';

/** Extra non-rule categories worth warming (the laptop demo). */
const EXTRA_CATEGORY_NAMES = ['لپ تاپ و نوت بوک'];
const MAX_WARM = 12;

export function warmCategoryIds(ctx: AppContext): number[] {
  const cats = [...catalogFor(ctx.db).categories().values()];
  const rule = cats.filter((c) => Api.kindForCategoryName(c.name) !== 'other');
  const extra = cats.filter((c) => EXTRA_CATEGORY_NAMES.includes(c.name));
  return [...rule.sort((a, b) => b.productCount - a.productCount || a.id - b.id), ...extra].slice(0, MAX_WARM - extra.length).concat(extra).filter((c, i, a) => a.indexOf(c) === i).map((c) => c.id);
}

/** Starts the warm-up; returns immediately. Never throws (a failure only means a cold first call). */
export function prewarm(ctx: AppContext, log: FastifyBaseLogger): void {
  if (!ctx.db.present) return;
  const started = Date.now();
  let ids: number[];
  const catalog = catalogFor(ctx.db);
  try {
    catalog.shops();
    catalog.synonyms();
    ids = warmCategoryIds(ctx);
  } catch (err) {
    log.warn({ errName: err instanceof Error ? err.name : 'unknown' }, 'prewarm skipped');
    return;
  }
  // title-head counts for the plausibility rules: one pass over the listings, 10k per event-loop turn
  const heads = () => {
    try {
      if (!catalog.warmHeadStats()) return void setImmediate(heads);
    } catch {
      /* built on first use instead */
    }
    setImmediate(() => step(0));
  };
  const step = (i: number) => {
    if (i >= ids.length) {
      log.info({ categories: ids.length, ms: Date.now() - started }, 'catalog prewarmed');
      return;
    }
    try {
      catalog.categoryPool(ids[i]!);
    } catch {
      /* cold on first use instead */
    }
    setImmediate(() => step(i + 1));
  };
  setImmediate(heads);
}
