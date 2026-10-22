import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { NullLlmClient, type LlmClient } from '../src/llm/client.js';
import { cleanupTmp, makeApp, makeFixtureDb, tmpDir } from './helpers.js';

const open: { close(): Promise<undefined | void> }[] = [];
async function app(...args: Parameters<typeof makeApp>) {
  const b = await makeApp(...args);
  open.push(b.app);
  return b;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
  cleanupTmp();
});

const json = { 'content-type': 'application/json' };
/** Every planned endpoint is real now (the assistant replaced the last stub). */
const STUBS: string[] = [];

describe('health', () => {
  it('reports db:false (still 200) when the database file is missing', async () => {
    const { app: a } = await app();
    const res = await a.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', db: false, llm: false });
    expect(typeof res.json().uptimeSec).toBe('number');
  });

  it('reports db:true with a fixture database', async () => {
    const dir = tmpDir();
    const databasePath = makeFixtureDb(path.join(dir, 'market.sqlite'));
    const { app: a } = await app({ databasePath });
    const res = await a.inject('/api/health');
    expect(res.json()).toMatchObject({ status: 'ok', db: true });
  });

  it('degrades gracefully when the file is not a valid database', async () => {
    const dir = tmpDir();
    const databasePath = path.join(dir, 'garbage.sqlite');
    writeFileSync(databasePath, 'this is not sqlite');
    const { app: a } = await app({ databasePath });
    expect((await a.inject('/api/health')).json()).toMatchObject({ db: false });
  });

  it('says llm:true when a key is configured but never leaks the key, model or paths', async () => {
    const SECRET = 'sk-ant-SECRET-VALUE-123';
    const fakeLlm: LlmClient = { configured: true, model: 'm', complete: async () => '' };
    const { app: a } = await app({ llmApiKey: SECRET }, { llm: fakeLlm });
    const res = await a.inject('/api/health');
    expect(res.json().llm).toBe(true);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain('sqlite');
    expect(Object.keys(res.json()).sort()).toEqual(['commit', 'db', 'llm', 'llmBackend', 'status', 'uptimeSec']);
    const meta = await a.inject('/api/meta');
    expect(meta.body).not.toContain(SECRET);
  });
});

describe('meta', () => {
  it('returns snapshot date, version and counts from the meta table', async () => {
    const dir = tmpDir();
    const databasePath = makeFixtureDb(path.join(dir, 'market.sqlite'));
    const { app: a } = await app({ databasePath });
    const res = await a.inject('/api/meta');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: {
        snapshotDate: '2026-10-13',
        snapshotDateFa: '۲۱ مهر ۱۴۰۵',
        shopCount: 3,
        productCount: 12,
        areas: [],
        categories: [],
        dataVersion: 'test-1',
        buildTime: '2026-10-14T00:00:00Z',
        counts: { products: 12, shops: 3, offers: 40 },
        fictionalShopNames: true,
        snapshot_date: '2026-10-13',
        data_version: 'test-1',
      },
    });
  });

  it('is a 503 Persian error envelope without a database', async () => {
    const { app: a } = await app();
    const res = await a.inject('/api/meta');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('DB_UNAVAILABLE');
    expect(res.json().error.messageFa).toMatch(/[؀-ۿ]/);
  });

  it('opens the database read-only', async () => {
    const dir = tmpDir();
    const databasePath = makeFixtureDb(path.join(dir, 'market.sqlite'));
    const { ctx } = await app({ databasePath });
    expect(() => ctx.db.prepare('INSERT INTO meta VALUES (?, ?)').run('x', 'y')).toThrow(/readonly|read-only|query_only/i);
  });
});

describe('stub endpoints', () => {
  it('no 501 stubs remain: POST /api/assist validates its body like the other routes', async () => {
    expect(STUBS).toEqual([]);
    const { app: a } = await app();
    const res = await a.inject({ method: 'POST', url: '/api/assist', headers: json, payload: { q: 'x' } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.messageFa).toMatch(/[؀-ۿ]/);
  });

  it('unknown /api paths are a JSON 404 envelope', async () => {
    const { app: a } = await app();
    const res = await a.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('request hardening', () => {
  it('rejects bodies over the limit with 413', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ q: 'x'.repeat(20 * 1024) }) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-JSON content types with 415', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'POST', url: '/api/parse', headers: { 'content-type': 'text/plain' }, payload: 'hello' });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects malformed JSON with 400', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'POST', url: '/api/parse', headers: json, payload: '{"q": ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_JSON');
  });

  it('rate-limits /api per IP with a 429 envelope, but never /api/health', async () => {
    const { app: a } = await app({ rateLimit: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await a.inject('/api/meta')).statusCode);
    expect(codes.slice(0, 3)).toEqual([503, 503, 503]);
    expect(codes.slice(3)).toEqual([429, 429]);
    const limited = await a.inject('/api/meta');
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    for (let i = 0; i < 10; i++) expect((await a.inject('/api/health')).statusCode).toBe(200);
  });

  it('rate-limits each client IP separately', async () => {
    const { app: a } = await app({ rateLimit: 1, trustProxyHops: 1 });
    const hit = (ip: string) => a.inject({ url: '/api/meta', headers: { 'x-forwarded-for': ip } });
    expect((await hit('1.1.1.1')).statusCode).toBe(503);
    expect((await hit('1.1.1.1')).statusCode).toBe(429);
    expect((await hit('2.2.2.2')).statusCode).toBe(503);
    // a forged leftmost entry cannot dodge the limit: only the proxy-appended (rightmost) entry counts
    expect((await hit('9.9.9.9, 1.1.1.1')).statusCode).toBe(429);
  });

  it('does not enable CORS', async () => {
    const { app: a } = await app();
    const res = await a.inject({ method: 'OPTIONS', url: '/api/parse', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const get = await a.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers and no-store on API responses', async () => {
    const { app: a } = await app();
    const res = await a.inject('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('logging', () => {
  it('never logs request bodies, query strings or secrets', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const { app: a } = await app({ logLevel: 'info', llmApiKey: 'sk-ant-LOGSECRET' }, { logStream });
    await a.inject({
      method: 'POST',
      url: '/api/parse?text=QUERYMARKER',
      headers: { ...json, authorization: 'Bearer AUTHMARKER', cookie: 'c=COOKIEMARKER' },
      payload: { text: 'BODYMARKER دوربین داهوا' },
    });
    await a.inject({ method: 'POST', url: '/api/parse', headers: json, payload: '{"text": "BADJSONMARKER' });
    await a.inject({ method: 'POST', url: '/api/parse', headers: { 'content-type': 'text/plain' }, payload: 'PLAINMARKER' });
    const all = lines.join('');
    expect(all.length).toBeGreaterThan(0); // logging actually happened
    for (const marker of ['BODYMARKER', 'QUERYMARKER', 'AUTHMARKER', 'COOKIEMARKER', 'BADJSONMARKER', 'PLAINMARKER', 'LOGSECRET', 'داهوا']) {
      expect(all).not.toContain(marker);
    }
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow(); // structured JSON
  });
});

describe('web serving', () => {
  it('serves a Persian placeholder when there is no web build', async () => {
    const { app: a } = await app();
    const res = await a.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('dir="rtl"');
    expect((await a.inject('/some/page')).statusCode).toBe(404);
  });

  it('serves the built app with an SPA fallback for non-API paths', async () => {
    const dir = tmpDir();
    const webDist = path.join(dir, 'dist');
    mkdirSync(path.join(webDist, 'assets'), { recursive: true });
    writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>SPA-INDEX</title>');
    writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
    const { app: a } = await app({ webDist });

    const root = await a.inject('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('SPA-INDEX');
    const deep = await a.inject('/plan/abc');
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('SPA-INDEX');
    const asset = await a.inject('/assets/app-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await a.inject('/assets/missing.js')).statusCode).toBe(404);
    const api = await a.inject('/api/unknown');
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
  });
});

describe('null llm', () => {
  it('is used when no key is configured', async () => {
    const { ctx } = await app();
    expect(ctx.llm).toBeInstanceOf(NullLlmClient);
    expect(ctx.llm.configured).toBe(false);
  });
});
