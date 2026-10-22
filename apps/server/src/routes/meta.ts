import type { Api } from '@app/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { DbUnavailableError } from '../db.js';
import { AppError, ok } from '../http.js';

/** Keys in the `meta` table that look like counts: `counts` (JSON object), `count_*`, `n_*`, `*_count`. */
const COUNT_KEY = /^(count_|n_)|_count$/;
/** An area is listed when it holds at least this share of the shops with offers (documented in MetaResponse). */
const AREA_MIN_SHARE = 0.05;
/** Category names served for home-screen suggestions (largest first). */
const MAX_CATEGORIES = 600;

function parseJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** «۲۱ مهر ۱۴۰۵» for an ISO date (noon UTC avoids a day shift in Tehran). */
export function jalaliDisplay(iso: string | null): string | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tehran' }).format(d);
  } catch {
    return undefined;
  }
}

function tableExists(ctx: AppContext, name: string): boolean {
  return !!ctx.db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined;
}

/** GET /api/meta payload: the shape apps/web expects (Api.MetaResponse), from the meta table plus small aggregates. */
export function readMeta(ctx: AppContext): Api.MetaResponse {
  const rows = ctx.db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
  const kv = new Map(rows.map((r) => [r.key, r.value]));
  const counts: Record<string, number> = {};
  const embedded = kv.has('counts') ? parseJson(kv.get('counts')!) : null;
  if (embedded && typeof embedded === 'object') {
    for (const [k, v] of Object.entries(embedded as Record<string, unknown>)) {
      const n = num(v);
      if (n !== undefined) counts[k] = n;
    }
  }
  for (const [k, v] of kv) {
    if (!COUNT_KEY.test(k)) continue;
    const n = num(parseJson(v));
    if (n !== undefined) counts[k.replace(/^(count_|n_)/, '').replace(/_count$/, '')] = n;
  }

  let areas: string[] = [];
  let shopsWithOffers = counts.shops_with_offers;
  if (tableExists(ctx, 'shops')) {
    const areaRows = ctx.db
      .prepare(
        `SELECT area_label AS area, COUNT(*) AS n FROM shops WHERE offer_count > 0 AND area_label IS NOT NULL AND area_label <> ''
         GROUP BY area_label ORDER BY n DESC, area_label`,
      )
      .all() as { area: string; n: number }[];
    const total = (ctx.db.prepare('SELECT COUNT(*) AS n FROM shops WHERE offer_count > 0').get() as { n: number }).n;
    shopsWithOffers ??= total;
    areas = areaRows.filter((r) => total > 0 && r.n / total >= AREA_MIN_SHARE).map((r) => r.area);
  }
  let categories: string[] = [];
  if (tableExists(ctx, 'categories')) {
    categories = (
      ctx.db.prepare('SELECT name FROM categories WHERE product_count > 0 ORDER BY product_count DESC, id LIMIT ?').all(MAX_CATEGORIES) as { name: string }[]
    ).map((r) => r.name);
  }

  const snapshotDate = kv.get('snapshot_date') ?? '';
  const dataVersion = kv.get('data_version') ?? '';
  const out: Api.MetaResponse = {
    snapshotDate,
    shopCount: shopsWithOffers ?? counts.shops ?? 0,
    productCount: counts.products ?? 0,
    areas,
    categories,
    dataVersion,
    counts,
    fictionalShopNames: true,
    buildTime: kv.get('build_time') ?? null,
    snapshot_date: snapshotDate,
    data_version: dataVersion,
  };
  const fa = jalaliDisplay(snapshotDate);
  if (fa) out.snapshotDateFa = fa;
  return out;
}

export function metaRoutes(app: FastifyInstance, ctx: AppContext): void {
  let cached: Api.MetaResponse | null = null; // the database is read-only for the life of the process
  app.get('/api/meta', async () => {
    try {
      cached ??= readMeta(ctx);
      return ok(cached);
    } catch (err) {
      if (err instanceof DbUnavailableError) throw new AppError('DB_UNAVAILABLE');
      throw err;
    }
  });
}
