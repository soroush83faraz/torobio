import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, httpAdapter, isAborted, mapMeta } from './http';
import type { Requirement, RequirementState } from './types';
import { toWireState } from './wire';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item: Requirement = {
  id: 'i1',
  text: 'دوربین داهوا',
  qty: 4,
  categoryIds: [1153],
  kind: 'camera',
  constraints: [{ attr: 'brand', op: 'eq', value: 'dahua', source: 'user' }],
  rawText: '۴ دوربین داهوا',
  confidence: 0.7,
  categoryCandidates: [{ id: 1153, name: 'دوربین مدار بسته', score: 0.75 }],
  notes: [],
} as Requirement;

const state: RequirementState = {
  requirements: [item],
  answers: {},
  settled: {},
  pins: {},
  shopPins: {},
  excludedShops: {},
  variant: null,
  visit: { day: 'today', window: 'any' },
};

afterEach(() => vi.unstubAllGlobals());

/** Awaits a promise that must reject and returns the ApiError. */
const err = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (x) => x as ApiError,
  );

describe('wire glue', () => {
  it('sends the parser item verbatim, without diagnostics and without synthesized chips', () => {
    const w = toWireState(state).requirements[0]!;
    expect(w).toMatchObject({ id: 'i1', rawText: '۴ دوربین داهوا', constraints: item.constraints, kind: 'camera', categoryIds: [1153] });
    expect(w).not.toHaveProperty('chips');
    expect(w).not.toHaveProperty('categoryId');
    expect(w).not.toHaveProperty('categoryLabel');
    // diagnostics never leave the device
    expect(w).not.toHaveProperty('categoryCandidates');
    expect(w).not.toHaveProperty('confidence');
    // the stored item is not mutated
    expect(state.requirements[0]).toHaveProperty('categoryCandidates');
  });

  it('keeps inherited markers as sent by the parser', () => {
    const w = toWireState({
      ...state,
      requirements: [{ ...item, inherited: [{ attr: 'brand', fromItemId: 'i0' }] } as Requirement],
    }).requirements[0]!;
    expect(w.inherited).toEqual([{ attr: 'brand', fromItemId: 'i0' }]);
  });
});

describe('http adapter', () => {
  it('unwraps the { data } envelope and posts JSON to the same origin', async () => {
    const f = vi.fn(async () => json({ data: { items: [], pendingItemCount: 0 } }));
    vi.stubGlobal('fetch', f);
    const r = await httpAdapter.resolve({ state });
    expect(r).toEqual({ items: [], pendingItemCount: 0 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/resolve');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string).state.requirements[0].constraints).toEqual(item.constraints);
  });

  it('surfaces the server Persian message, never raw English', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'BAD_REQUEST', messageFa: 'درخواست نامعتبر است.' } }, 400)));
    await expect(httpAdapter.plan({ state })).rejects.toMatchObject({ code: 'BAD_REQUEST', messageFa: 'درخواست نامعتبر است.' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'X', messageFa: 'Internal Server Error' } }, 500)));
    const e = await err(httpAdapter.plan({ state }));
    expect(e.messageFa).toMatch(/[؀-ۿ]/);
    expect(e.messageFa).not.toMatch(/Internal/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const e2 = await err(httpAdapter.options({ state, itemId: 'i1' }));
    expect(e2.messageFa).toMatch(/[؀-ۿ]/);
  });

  it('retries a network failure once, then reports a Persian connection error', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', f);
    const e = await err(httpAdapter.parse({ text: 'x' }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(e.code).toBe('NETWORK');
    expect(e.messageFa).toContain('اتصال');
  });

  it('does not retry a 4xx', async () => {
    const f = vi.fn(async () => json({ error: { code: 'BAD_REQUEST', messageFa: 'متن درخواست خالی است.' } }, 400));
    vi.stubGlobal('fetch', f);
    await httpAdapter.parse({ text: ' ' }).catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a newer plan call aborts the one still in flight', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
        }
        return Promise.resolve(json({ data: { stops: [], coverage: { covered: 0, total: 0, missing: [] } } }));
      }),
    );
    const first = httpAdapter.plan({ state }).catch((e) => e);
    const second = await httpAdapter.plan({ state });
    expect(second.stops).toEqual([]);
    expect(isAborted(await first)).toBe(true);
  });

  it('times out with a Persian message', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))),
      );
      const p = err(httpAdapter.meta());
      await vi.advanceTimersByTimeAsync(6_100);
      await vi.advanceTimersByTimeAsync(400); // retry back-off
      await vi.advanceTimersByTimeAsync(6_100);
      const e = await p;
      expect(e.code).toBe('TIMEOUT');
      expect(e.messageFa).toContain('طول کشید');
    } finally {
      vi.useRealTimers();
    }
  });

  it('assist: 501 degrades to the chips-only assistant', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/api/assist') return json({ error: { code: 'NOT_IMPLEMENTED', messageFa: 'این بخش هنوز آماده نیست.' } }, 501);
      return json({ data: { stops: [], coverage: { covered: 0, total: 0, missing: [] }, alternatives: [{ id: 'stops:1', label: 'کم‌توقف‌تر', description: 'یک توقف کمتر', deltaToman: 5, deltaStops: -1 }] } });
    });
    vi.stubGlobal('fetch', f);
    const cheaper = await httpAdapter.assist({ state, chip: 'cheaper' });
    expect(cheaper).toMatchObject({ supported: true, action: { type: 'set_variant', value: null } });
    const fewer = await httpAdapter.assist({ state, chip: 'fewer_stops' });
    expect(fewer).toMatchObject({ supported: true, action: { type: 'set_variant', value: 'stops:1' } });
    const free = await httpAdapter.assist({ state, text: 'یک چیز عجیب' });
    expect(free.supported).toBe(false);
    expect(free.message).toMatch(/[؀-ۿ]/);
  });
});

describe('mapMeta', () => {
  it('maps today\'s shape and the announced one', () => {
    const today = mapMeta({ snapshotDate: '2026-10-13', dataVersion: 'v', counts: { products: 225903, shops: 6476 } });
    expect(today).toMatchObject({ snapshotDate: '2026-10-13', productCount: 225903, shopCount: 6476, dataVersion: 'v' });
    expect(today.areas.length).toBeGreaterThan(0);
    // the real server: shopCount = shops with price listings, counts.shops = every shop in the data
    const real = mapMeta({ shopCount: 3792, snapshotDateFa: '۲۱ مهر ۱۴۰۵', counts: { products: 225903, shops: 6476, shops_with_offers: 3792 } });
    expect(real).toMatchObject({ shopCount: 3792, shopsTotal: 6476, productCount: 225903, snapshotLabel: '۲۱ مهر ۱۴۰۵' });
    const next = mapMeta({ snapshot_date: '2026-10-13', snapshot_jalali: '۲۱ مهر ۱۴۰۵', counts: { products: 1, shops: 2 }, data_version: 'd', fictionalShopNames: true });
    expect(next).toMatchObject({ snapshotDate: '2026-10-13', snapshotLabel: '۲۱ مهر ۱۴۰۵', fictionalShopNames: true, dataVersion: 'd' });
  });
});
