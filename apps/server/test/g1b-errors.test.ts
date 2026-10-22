/**
 * Error shapes and input sanitising at the HTTP boundary:
 *  - every error (framework ones too) is the Persian envelope {error:{code,messageFa}}, never the request path;
 *  - 5xx on a browser page load is the static Persian "problem" page;
 *  - bidi-override / control characters in request text never come back in titles, item text or share-link text.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { installBodySanitizer, installErrorHandler } from '../src/errors.js';
import { OFFLINE_HTML } from '../src/web.js';
import { cleanupTmp, makeApp, tmpDir } from './helpers.js';
import { buildParseFixture } from './parse-fixture.js';

const json = { 'content-type': 'application/json' };
const PERSIAN = /[؀-ۿ]/;
const open: { close(): Promise<undefined | void> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
  cleanupTmp();
});

async function webApp(extra: Parameters<typeof makeApp>[0] = {}) {
  const dir = tmpDir();
  const webDist = path.join(dir, 'dist');
  mkdirSync(path.join(webDist, 'assets'), { recursive: true });
  writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>SPA-INDEX</title>');
  writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const built = await makeApp({ webDist, ...extra });
  open.push(built.app);
  return built;
}

/** The whole body must be exactly the envelope: one `error` key with a code and Persian text, nothing else. */
function expectEnvelope(res: { statusCode: number; body: string; headers: Record<string, unknown> }, status: number, code: string): void {
  expect(res.statusCode).toBe(status);
  expect(String(res.headers['content-type'])).toContain('application/json');
  const body = JSON.parse(res.body) as { error: { code: string; messageFa: string } };
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'messageFa']);
  expect(body.error.code).toBe(code);
  expect(body.error.messageFa).toMatch(PERSIAN);
  expect(res.body).not.toMatch(/FST_ERR|statusCode|Bad Request|Not Found|Internal Server/);
}

describe('framework errors use the Persian envelope', () => {
  it('a malformed URL (bad percent escape) is a 400 envelope that does not echo the path', async () => {
    const { app } = await webApp();
    for (const url of ['/%E0%A4%A', '/api/%E0%A4%A', '/%']) {
      const res = await app.inject(url);
      expectEnvelope(res, 400, 'BAD_URL');
      expect(res.body).not.toContain('%E0');
      expect(res.body).not.toContain('%A');
    }
  });

  it('paths that climb out of the web root (sent as-is over a real socket) are a 404 envelope, never a 500', async () => {
    const { app } = await webApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const get = (p: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { accept: 'text/html' } }, (res) => {
          let body = '';
          res.on('data', (d) => (body += d.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    const x = await get('/assets/../x');
    expect(x.status).toBe(404);
    expect(JSON.parse(x.body)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(x.body).not.toContain('/x');
    for (const p of ['/assets/%2e%2e/x', '/assets/..%2f..%2fetc/passwd', '/assets/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/%00']) {
      const r = await get(p);
      expect(r.status, p).not.toBe(500);
      expect(r.body, p).not.toContain('root:');
      expect(r.body, p).not.toContain('passwd');
    }
  });

  it('unknown /api paths, wrong methods and missing assets are the 404 envelope without the path', async () => {
    const { app } = await webApp();
    for (const [method, url] of [
      ['GET', '/api/SECRETPATH123'],
      ['GET', '/api'],
      ['POST', '/api/SECRETPATH123'],
      ['DELETE', '/api/health'],
      ['GET', '/assets/SECRETPATH123.js'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { accept: 'text/html' } });
      expectEnvelope(res, 404, 'NOT_FOUND');
      expect(res.body).not.toContain('SECRETPATH123');
    }
  });

  it('413, 415 and malformed JSON keep their statuses and the envelope', async () => {
    const { app } = await webApp();
    const big = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ text: 'x'.repeat(20 * 1024) }) });
    expectEnvelope(big, 413, 'PAYLOAD_TOO_LARGE');
    const media = await app.inject({ method: 'POST', url: '/api/parse', headers: { 'content-type': 'text/plain' }, payload: 'hello' });
    expectEnvelope(media, 415, 'UNSUPPORTED_MEDIA_TYPE');
    const bad = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: '{"text": ' });
    expectEnvelope(bad, 400, 'INVALID_JSON');
    const empty = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: '' });
    expect([400, 415]).toContain(empty.statusCode);
    expect(JSON.parse(empty.body).error.messageFa).toMatch(PERSIAN);
  });

  it('a request the HTTP parser rejects (garbage on the socket) is answered with the envelope too', async () => {
    const { app } = await webApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const raw = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write('NOT A REAL REQUEST LINE\r\n\r\n'));
      let data = '';
      sock.on('data', (d) => (data += d.toString()));
      sock.on('close', () => resolve(data));
      sock.on('error', reject);
      setTimeout(() => sock.destroy(), 2000);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 400 /);
    const body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(body).toMatch(PERSIAN);
    expect(body).not.toContain('Client Error');
  });
});

describe('browser navigations', () => {
  it('unknown non-/api paths keep the SPA fallback; /api never does', async () => {
    const { app } = await webApp();
    const page = await app.inject({ url: '/plan/abc', headers: { accept: 'text/html' } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('SPA-INDEX');
    expectEnvelope(await app.inject({ url: '/api/plan/abc', headers: { accept: 'text/html' } }), 404, 'NOT_FOUND');
  });

  it('a 5xx on a page load is the static Persian offline page; JSON clients and /api still get the envelope', async () => {
    const app = Fastify();
    open.push(app);
    installErrorHandler(app);
    app.get('/boom', async () => {
      throw new Error('SECRET internal detail /var/db/market.sqlite');
    });
    app.get('/api/boom', async () => {
      throw new Error('SECRET internal detail');
    });
    await app.ready();

    const html = await app.inject({ url: '/boom', headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(html.statusCode).toBe(500);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toBe(OFFLINE_HTML);
    expect(html.body).toContain('dir="rtl"');
    expect(html.body).toContain('lang="fa"');
    expect(html.body).toMatch(PERSIAN);
    expect(html.body).not.toContain('SECRET');
    expect(html.body).not.toMatch(/<script/i);

    const jsonClient = await app.inject({ url: '/boom', headers: { accept: 'application/json' } });
    expectEnvelope(jsonClient, 500, 'INTERNAL');
    expect(jsonClient.body).not.toContain('SECRET');
    const apiHtml = await app.inject({ url: '/api/boom', headers: { accept: 'text/html' } });
    expectEnvelope(apiHtml, 500, 'INTERNAL');
    expect(apiHtml.body).not.toContain('SECRET');
  });
});

describe('input sanitising at the boundary', () => {
  const RLO = String.fromCodePoint(0x202e);
  /** Direction-changing or control characters (tab, LF and CR are allowed whitespace). */
  const hasBadChars = (s: string): boolean =>
    [...s].some((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f || c === 0x61c || c < 9 || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127;
    });

  async function parseApp() {
    const dir = tmpDir();
    const databasePath = buildParseFixture(path.join(dir, 'market.sqlite'));
    const built = await makeApp({ databasePath });
    open.push(built.app);
    return built;
  }

  it('/api/parse strips RLO and friends: title, item text and rawText are clean, the request still parses', async () => {
    const { app } = await parseApp();
    const text = `${RLO}۴ دوربین ${String.fromCodePoint(0x2066)}داهوا${String.fromCodePoint(0x2069)}${String.fromCodePoint(0)}، ${RLO}هارد ۲ ترابایت`;
    const res = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ text }) });
    expect(res.statusCode).toBe(200);
    expect(hasBadChars(res.body)).toBe(false);
    expect(res.body).not.toContain('\\u202e');
    const d = (res.json() as { data: { title: string; items: { text: string; rawText: string; qty: number; kind: string }[] } }).data;
    expect(d.items.map((i) => [i.kind, i.qty])).toEqual([['camera', 4], ['hdd', 1]]);
    expect(d.title).toBe('دوربین داهوا، هارد ۲ ترابایت');
    for (const i of d.items) expect([...i.text + i.rawText].some((ch) => ch === RLO)).toBe(false);
  });

  it('a request that is only direction marks is empty, not an item', async () => {
    const { app } = await parseApp();
    const res = await app.inject({ method: 'POST', url: '/api/parse', headers: json, payload: JSON.stringify({ text: `${RLO}${RLO} ${RLO}` }) });
    expect(res.statusCode).toBe(400);
  });

  it('the body hook cleans every /api body string (state texts, assist text) before validation', async () => {
    const app = Fastify();
    open.push(app);
    installBodySanitizer(app);
    let seen: unknown;
    app.post('/api/echo', async (req) => {
      seen = req.body;
      return {};
    });
    app.post('/other', async (req) => {
      seen = req.body;
      return {};
    });
    await app.ready();
    const body = { text: `a${RLO}b`, state: { requirements: [{ id: 'x', text: `${RLO}سیم${String.fromCodePoint(0x202a)}` }], answers: { x: { k: `v${RLO}` } } }, n: 3 };
    await app.inject({ method: 'POST', url: '/api/echo', headers: json, payload: JSON.stringify(body) });
    expect(seen).toEqual({ text: 'ab', state: { requirements: [{ id: 'x', text: 'سیم' }], answers: { x: { k: 'v' } } }, n: 3 });
  });
});
