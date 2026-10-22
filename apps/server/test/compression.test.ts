/**
 * Response compression: precompressed static assets, on-the-fly gzip/brotli for JSON and the SPA fallback,
 * identity clients, no double compression, small bodies untouched, error envelopes and the body limit intact.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureMarket, CAT } from './fixture-market.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { cctvJob } from './scenarios.js';

type App = Awaited<ReturnType<typeof makeApp>>['app'];
let app: App;
const NOW = new Date('2026-10-21T10:00:00+03:30');
const JS = `export const data = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `سلام دنیا ${i} lorem ipsum`))};\n`;
const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><div id="root"></div></body></html>'.repeat(20);

beforeAll(async () => {
  const dir = tmpDir();
  const web = path.join(dir, 'web');
  mkdirSync(path.join(web, 'assets'), { recursive: true });
  writeFileSync(path.join(web, 'index.html'), HTML);
  writeFileSync(path.join(web, 'assets', 'index-abc123.js'), JS);
  writeFileSync(path.join(web, 'assets', 'extra-def456.js'), JS);
  writeFileSync(path.join(web, 'assets', 'font.woff2'), Buffer.alloc(4000, 7));
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'scripts', 'precompress.mjs'), web]);
  expect(r.status).toBe(0);
  // extra-def456.js loses its siblings so it exercises the on-the-fly path
  rmSync(path.join(web, 'assets', 'extra-def456.js.br'));
  rmSync(path.join(web, 'assets', 'extra-def456.js.gz'));
  const db = buildFixtureMarket(path.join(dir, 'm.sqlite'));
  app = (await makeApp({ webDist: web, databasePath: db }, { now: () => NOW })).app;
});
afterAll(async () => {
  await app.close();
  cleanupTmp();
});

const get = (url: string, enc?: string, accept?: string) =>
  app.inject({ method: 'GET', url, headers: { ...(enc === undefined ? {} : { 'accept-encoding': enc }), ...(accept ? { accept } : {}) } });

describe('precompressed static assets', () => {
  it('serves .br to br clients with Vary, immutable cache and the decoded body intact', async () => {
    const res = await get('/assets/index-abc123.js', 'br, gzip');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(String(res.headers.vary).toLowerCase()).toContain('accept-encoding');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(String(res.headers['content-type'])).toContain('javascript');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    expect(brotliDecompressSync(res.rawPayload).toString()).toBe(JS);
  });

  it('serves .gz to gzip-only clients and identity to the rest', async () => {
    const gz = await get('/assets/index-abc123.js', 'gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe(JS);
    for (const enc of [undefined, 'identity']) {
      const plain = await get('/assets/index-abc123.js', enc);
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.body).toBe(JS);
    }
  });

  it('does not honour Range on assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js', headers: { range: 'bytes=0-9', 'accept-encoding': 'br' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-range']).toBeUndefined();
  });

  it('compresses index.html and the SPA fallback and keeps them no-cache', async () => {
    for (const url of ['/', '/some/client/route']) {
      const res = await get(url, 'br', 'text/html');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe('br');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(brotliDecompressSync(res.rawPayload).toString()).toBe(HTML);
    }
  });

  it('compresses an asset without a precompressed sibling on the fly, and skips woff2', async () => {
    const dyn = await get('/assets/extra-def456.js', 'gzip');
    expect(dyn.headers['content-encoding']).toBe('gzip');
    expect(dyn.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(gunzipSync(dyn.rawPayload).toString()).toBe(JS);
    const font = await get('/assets/font.woff2', 'br, gzip');
    expect(font.headers['content-encoding']).toBeUndefined();
    expect(font.rawPayload.length).toBe(4000);
  });

  it('never double-compresses', async () => {
    const first = await get('/assets/index-abc123.js', 'br');
    expect(() => brotliDecompressSync(brotliDecompressSync(first.rawPayload))).toThrow();
  });
});

describe('dynamic JSON', () => {
  const planBody = () => ({ state: cctvJob({ camera: CAT.camera, recorder: CAT.recorder, hdd: CAT.hdd, adapter: CAT.adapter }) });
  const post = (enc?: string) =>
    app.inject({ method: 'POST', url: '/api/plan', payload: planBody(), headers: enc === undefined ? {} : { 'accept-encoding': enc } });

  it('compresses a large /api/plan reply and the decoded body equals the identity body', async () => {
    const plain = await post();
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.rawPayload.length).toBeGreaterThan(1024);
    for (const [enc, decode] of [['br', brotliDecompressSync], ['gzip', gunzipSync]] as const) {
      const res = await post(enc);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBe(enc);
      expect(String(res.headers.vary).toLowerCase()).toContain('accept-encoding');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(String(res.headers['content-type'])).toContain('application/json');
      expect(res.rawPayload.length).toBeLessThan(plain.rawPayload.length);
      expect(decode(res.rawPayload).toString()).toBe(plain.body);
    }
  });

  it('identity / unknown-only Accept-Encoding gets plain JSON', async () => {
    for (const enc of ['identity', 'compress', 'zstd;q=0']) {
      const res = await post(enc);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.json().data).toBeTruthy();
    }
  });

  it('leaves small bodies (health, error envelopes) uncompressed and in envelope shape', async () => {
    const h = await get('/api/health', 'br, gzip');
    expect(h.statusCode).toBe(200);
    expect(h.headers['content-encoding']).toBeUndefined();
    const nf = await get('/api/nope', 'br, gzip');
    expect(nf.statusCode).toBe(404);
    expect(nf.headers['content-encoding']).toBeUndefined();
    expect(nf.json()).toEqual({ error: { code: 'NOT_FOUND', messageFa: expect.any(String) } });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/plan',
      payload: { state: { requirements: 'x' } },
      headers: { 'accept-encoding': 'br' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('request side', () => {
  it('does not decompress request bodies and still enforces the 16 KB limit with the envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plan',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: Buffer.from('{}'),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error).toBeTruthy();
    const big = await app.inject({ method: 'POST', url: '/api/plan', payload: { state: { x: 'a'.repeat(20_000) } } });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
