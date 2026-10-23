/**
 * Real HTTP adapter for the decision API (same-origin `/api`).
 *
 * - Envelope: success `{ data }`, failure `{ error: { code, messageFa } }`.
 * - Every failure surfaces as an ApiError whose `messageFa` is Persian (never raw English).
 * - Per-call timeout via AbortController. Calls that carry a `key` (resolve / plan / options) supersede
 *   each other: starting a new one aborts the previous in-flight call (its promise rejects with code
 *   ABORTED, which callers ignore).
 * - Retries only network failures and 502/503/504, once, and only for the pure (stateless) endpoints.
 * - No tracking: no request ids, no cookies, and user text is never logged.
 */
import { assistFallback } from './assistLocal';
import type { ApiAdapter } from './client';
import type {
  AssistRequest,
  AssistResponse,
  MetaResponse,
  OptionsRequest,
  OptionsResponse,
  ParseRequest,
  ParseResponse,
  PlacesRequest,
  PlacesResponse,
  PlanRequest,
  PlanResponse,
  ResolveRequest,
  ResolveResponse,
} from './types';
import { useConnection } from '../store/connection';
import { toWireState } from './wire';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageFa: string,
    public readonly status = 0,
  ) {
    super(code);
    this.name = 'ApiError';
  }
  get aborted() {
    return this.code === 'ABORTED';
  }
}

export const isAborted = (e: unknown): boolean => e instanceof ApiError && e.aborted;

const MSG = {
  network: 'اتصال به سرور برقرار نشد؛ اینترنتت را بررسی کن و دوباره امتحان کن.',
  timeout: 'پاسخ‌گویی طول کشید؛ دوباره تلاش کن.',
  generic: 'مشکلی پیش آمد؛ دوباره تلاش کن.',
  bad: 'پاسخ سرور قابل‌خواندن نبود؛ دوباره تلاش کن.',
  rate: 'درخواست‌ها زیاد بود؛ چند لحظه دیگر دوباره تلاش کن.',
  notFound: 'موردی پیدا نشد.',
} as const;

const HAS_PERSIAN = /[؀-ۿ]/;

function messageFor(status: number, serverMsg?: string): string {
  if (serverMsg && HAS_PERSIAN.test(serverMsg)) return serverMsg;
  if (status === 429) return MSG.rate;
  if (status === 404) return MSG.notFound;
  return MSG.generic;
}

interface CallOptions {
  /** Calls with the same key supersede each other. */
  key?: string;
  timeoutMs: number;
  /** Extra attempts on network errors and 502/503/504 (safe: every endpoint here is stateless). */
  retries?: number;
}

const inflight = new Map<string, AbortController>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function attempt<T>(method: 'GET' | 'POST', path: string, body: unknown, opts: CallOptions, signal: AbortSignal): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs);
  const onAbort = () => ctl.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        signal: ctl.signal,
        credentials: 'omit',
        headers: method === 'POST' ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (signal.aborted) throw new ApiError('ABORTED', '');
      if (timedOut) throw new ApiError('TIMEOUT', MSG.timeout, 0);
      useConnection.getState().setServerDown(true);
      throw new ApiError('NETWORK', MSG.network, 0);
    }
    // any answer from the server (even an error) means it is reachable; a gateway error means the app behind it is not
    useConnection.getState().setServerDown(res.status === 502 || res.status === 503 || res.status === 504);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    const env = (json && typeof json === 'object' ? json : {}) as { data?: T; error?: { code?: string; messageFa?: string } };
    if (!res.ok || env.error) {
      throw new ApiError(env.error?.code ?? `HTTP_${res.status}`, messageFor(res.status, env.error?.messageFa), res.status);
    }
    if (env.data === undefined || env.data === null) throw new ApiError('BAD_RESPONSE', MSG.bad, res.status);
    return env.data;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body: unknown, opts: CallOptions): Promise<T> {
  const ctl = new AbortController();
  if (opts.key) {
    inflight.get(opts.key)?.abort();
    inflight.set(opts.key, ctl);
  }
  try {
    const tries = 1 + (opts.retries ?? 0);
    for (let i = 0; ; i++) {
      try {
        return await attempt<T>(method, path, body, opts, ctl.signal);
      } catch (e) {
        const retryable = e instanceof ApiError && (e.code === 'NETWORK' || e.status === 502 || e.status === 503 || e.status === 504);
        if (!retryable || i + 1 >= tries || ctl.signal.aborted) throw e;
        await sleep(350 * (i + 1));
        if (ctl.signal.aborted) throw new ApiError('ABORTED', '');
      }
    }
  } finally {
    if (opts.key && inflight.get(opts.key) === ctl) inflight.delete(opts.key);
  }
}

/* ---------------- response shaping ---------------- */

const DEFAULT_AREAS = ['فردوسی', 'شیخ‌هادی', 'بهارستان'];

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Maps whatever GET /api/meta sends (camel or snake case, with or without a Jalali string) to the UI shape. */
export function mapMeta(raw: unknown): MetaResponse {
  const r: Loose = isObj(raw) ? raw : {};
  const counts: Loose = isObj(r.counts) ? r.counts : {};
  const jalaliKey = Object.keys(r).find((k) => /jalali|DateFa$/i.test(k) && typeof r[k] === 'string');
  const areas = Array.isArray(r.areas) ? r.areas.filter((a): a is string => typeof a === 'string') : [];
  const cats = Array.isArray(r.categories) ? r.categories.filter((a): a is string => typeof a === 'string') : [];
  return {
    snapshotDate: str(r.snapshotDate) || str(r.snapshot_date),
    snapshotLabel: jalaliKey ? str(r[jalaliKey]) : undefined,
    // the server's shopCount is the shops WITH price listings; counts.shops is every shop in the data
    shopCount: num(r.shopCount) || num(counts.shops_with_offers) || num(counts.shops) || num(counts.shop_count),
    shopsTotal: num(counts.shops) || num(counts.shop_count),
    productCount: num(r.productCount) || num(counts.products) || num(counts.product_count),
    areas: areas.length ? areas : DEFAULT_AREAS,
    categories: cats,
    dataVersion: str(r.dataVersion) || str(r.data_version),
    fictionalShopNames: r.fictionalShopNames === true,
  };
}

function need<T extends object>(v: T, ...keys: (keyof T)[]): T {
  if (!isObj(v) || keys.some((k) => !(k in v))) throw new ApiError('BAD_RESPONSE', MSG.bad);
  return v;
}

/* ---------------- the adapter ---------------- */

export const httpAdapter: ApiAdapter = {
  parse: async (req: ParseRequest) => {
    const d = await call<ParseResponse>('POST', '/api/parse', { text: req.text }, { timeoutMs: 12_000, retries: 1 });
    need(d, 'items');
    return { ...d, title: d.title || req.text.slice(0, 40) };
  },
  resolve: async (req: ResolveRequest) =>
    need(
      await call<ResolveResponse>('POST', '/api/resolve', { state: toWireState(req.state) }, { key: 'resolve', timeoutMs: 10_000, retries: 1 }),
      'items',
    ),
  plan: async (req: PlanRequest) =>
    need(await call<PlanResponse>('POST', '/api/plan', { state: toWireState(req.state) }, { key: 'plan', timeoutMs: 12_000, retries: 1 }), 'stops', 'coverage'),
  places: async (req: PlacesRequest) =>
    need(
      await call<PlacesResponse>('POST', '/api/places', { state: toWireState(req.state) }, { key: 'places', timeoutMs: 12_000, retries: 1 }),
      'malls',
      'bestId',
    ),
  options: async (req: OptionsRequest) =>
    need(
      await call<OptionsResponse>(
        'POST',
        '/api/options',
        { state: toWireState(req.state), itemId: req.itemId, ...(req.productId ? { productId: req.productId } : {}) },
        { key: 'options', timeoutMs: 10_000, retries: 1 },
      ),
      'models',
      'sellers',
    ),
  assist: async (req: AssistRequest): Promise<AssistResponse> => {
    try {
      return await call<AssistResponse>('POST', '/api/assist', { ...req, state: toWireState(req.state) }, { key: 'assist', timeoutMs: 15_000 });
    } catch (e) {
      if (isAborted(e)) throw e;
      // The server understood the request and refused it (too long, rate limit...): its Persian message is the answer.
      if (e instanceof ApiError && [400, 413, 422, 429].includes(e.status)) throw e;
      // 501 (not built yet), 5xx or unreachable: the chips keep working without the server-side assistant.
      return assistFallback(req, httpAdapter);
    }
  },
  meta: async () => mapMeta(await call<unknown>('GET', '/api/meta', undefined, { timeoutMs: 6_000, retries: 1 })),
};
