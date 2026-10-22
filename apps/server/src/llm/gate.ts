import { isIPv4, isIPv6 } from 'node:net';

/**
 * Cost / abuse controls for the LLM path (separate from, and stricter than, the HTTP rate limit):
 *  - per client: at most `perMinute` LLM calls per minute and `dailyPerClient` per UTC day;
 *  - global: at most `dailyGlobal` LLM calls per UTC day and `maxConcurrent` calls in flight.
 * A denied ticket never fails the request: the caller answers deterministically (and flags `degraded`).
 *
 * In-memory and per process (one Render instance). Memory is bounded: at most `maxClients` client entries are kept
 * (least recently seen evicted). Client keys come from `clientKey()`, so behind a proxy they are only as good as
 * the TRUST_PROXY hop count (see docs/SECURITY.md).
 */

/**
 * Rate-limit key of a client address: IPv4 as is, IPv4-mapped IPv6 as the IPv4 address, any other IPv6 address by
 * its /64 prefix (one subscriber usually owns a whole /64, so per-address keys would be trivially rotated).
 * Same policy as @fastify/rate-limit's default key generator.
 */
export function clientKey(ip: string | undefined | null): string {
  const raw = String(ip ?? '').trim().toLowerCase();
  if (raw === '') return 'unknown';
  if (isIPv4(raw)) return raw;
  if (isIPv6(raw)) {
    const g = expandIPv6(raw);
    if (!g) return raw.slice(0, 64);
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff].join('.');
    }
    return `${g
      .slice(0, 4)
      .map((x) => x.toString(16))
      .join(':')}::/64`;
  }
  return raw.slice(0, 64);
}

/** 8 hextets of an IPv6 address (zone id dropped, embedded IPv4 tail converted), or null. */
function expandIPv6(addr: string): number[] | null {
  let s = addr.split('%')[0] ?? '';
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const b = v4.slice(1, 5).map(Number);
    if (b.some((x) => x > 255)) return null;
    s = `${s.slice(0, v4.index)}${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const dbl = s.indexOf('::');
  let parts: string[];
  if (dbl >= 0) {
    const head = s.slice(0, dbl) ? s.slice(0, dbl).split(':') : [];
    const tail = s.slice(dbl + 2) ? s.slice(dbl + 2).split(':') : [];
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    parts = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else parts = s.split(':');
  if (parts.length !== 8) return null;
  const out = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
  return out.every((x) => Number.isFinite(x)) ? out : null;
}

export interface GateOptions {
  /** LLM calls per client per minute (0 = the LLM path is off). */
  perMinute: number;
  dailyPerClient: number;
  dailyGlobal: number;
  maxConcurrent: number;
  /** Bound on tracked clients (memory). */
  maxClients?: number;
  now?: () => number;
}

export type GateDenial = 'per_minute' | 'daily_client' | 'daily_global' | 'concurrency';
export type GateTicket = { ok: true; release(): void } | { ok: false; reason: GateDenial };

interface ClientCounters {
  minuteStart: number;
  minuteCount: number;
  dayCount: number;
}

const MINUTE_MS = 60_000;

export class LlmGate {
  private inFlight = 0;
  private day = '';
  private globalCount = 0;
  private readonly clients = new Map<string, ClientCounters>();
  private readonly now: () => number;
  private readonly maxClients: number;

  constructor(private readonly opts: GateOptions) {
    this.now = opts.now ?? Date.now;
    this.maxClients = Math.max(1, opts.maxClients ?? 50_000);
  }

  private rollDay(now: number): void {
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.globalCount = 0;
      this.clients.clear();
    }
  }

  /** Reserve one LLM call for `key`. On ok, `release()` MUST be called when the call settles (idempotent). */
  acquire(key: string): GateTicket {
    const now = this.now();
    this.rollDay(now);
    if (this.inFlight >= this.opts.maxConcurrent) return { ok: false, reason: 'concurrency' };
    if (this.globalCount >= this.opts.dailyGlobal) return { ok: false, reason: 'daily_global' };
    let c = this.clients.get(key);
    if (c) this.clients.delete(key); // re-insert: Map order = least recently seen first
    else c = { minuteStart: now, minuteCount: 0, dayCount: 0 };
    if (now - c.minuteStart >= MINUTE_MS) {
      c.minuteStart = now;
      c.minuteCount = 0;
    }
    this.clients.set(key, c);
    while (this.clients.size > this.maxClients) {
      const oldest = this.clients.keys().next().value;
      if (oldest === undefined) break;
      this.clients.delete(oldest);
    }
    if (c.dayCount >= this.opts.dailyPerClient) return { ok: false, reason: 'daily_client' };
    if (c.minuteCount >= this.opts.perMinute) return { ok: false, reason: 'per_minute' };
    c.minuteCount += 1;
    c.dayCount += 1;
    this.globalCount += 1;
    this.inFlight += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
      },
    };
  }

  /** Counters only (no client keys): for tests and metrics. */
  snapshot(): { inFlight: number; globalToday: number; trackedClients: number } {
    return { inFlight: this.inFlight, globalToday: this.globalCount, trackedClients: this.clients.size };
  }
}
