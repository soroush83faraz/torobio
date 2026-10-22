import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { constants as zlibConstants } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from './http.js';

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>همراه بازار</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Tahoma,sans-serif;background:#f6f5f2;color:#1d1d1b}
  main{padding:24px;max-width:28rem;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .5rem}
  p{margin:0;line-height:1.9;color:#555}
</style>
</head>
<body>
<main>
  <h1>همراه بازار</h1>
  <p>سرویس در حال اجراست. رابط کاربری به‌زودی اینجا قرار می‌گیرد.</p>
</main>
</body>
</html>`;

/**
 * Response compression for dynamic output (JSON API, SPA fallback, uncompressed static files).
 * Must be registered BEFORE the routes and before @fastify/static (its global hook only covers routes added after it).
 *  - brotli (quality 4: cheap per request) preferred over gzip; deflate is not offered.
 *  - bodies under 1 KiB are sent as is (error envelopes, /api/health); already-compressed types (woff2, png, ...)
 *    are skipped by the plugin's mime-db check; a response that already carries Content-Encoding (the precompressed
 *    .br/.gz static files) is never compressed twice. The plugin sets `Vary: accept-encoding`.
 *  - request-body decompression is OFF: a Content-Encoding on a request body stays unsupported, so the
 *    16 KB body limit cannot be bypassed with a compression bomb.
 */
export async function registerCompression(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCompress, {
    global: true,
    globalDecompression: false,
    threshold: 1024,
    encodings: ['br', 'gzip'],
    brotliOptions: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 6 },
  });
}

/**
 * Serves the built web app from `webDist` (SPA fallback for non-/api GET paths without a file
 * extension) or, if it isn't built/present, a minimal Persian placeholder at "/".
 * Returns whether a real web build was found.
 */
export async function registerWeb(app: FastifyInstance, webDist: string): Promise<boolean> {
  const hasWeb = existsSync(path.join(webDist, 'index.html'));

  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      // Serve index.html.br / app.js.gz etc. (generated at image build by scripts/precompress.mjs) when the
      // client accepts them; sets Content-Encoding + Vary. No Range: a partial body of a compressed file is useless.
      preCompressed: true,
      acceptRanges: false,
      setHeaders(reply, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        reply.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  } else {
    app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(PLACEHOLDER_HTML));
  }
  return hasWeb;
}

/**
 * Static Persian page for a server error (5xx) on a browser page load: no script (the CSP forbids inline script),
 * no external assets, so it renders even when everything else is broken. «تلاش دوباره» reloads the same address.
 */
export const OFFLINE_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>همراه بازار | مشکل موقت</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Tahoma,sans-serif;background:#f6f5f2;color:#1d1d1b}
  main{padding:24px;max-width:28rem;text-align:center}
  h1{font-size:1.4rem;margin:0 0 .5rem}
  p{margin:0 0 1rem;line-height:1.9;color:#555}
  a{display:inline-block;padding:.6rem 1.4rem;border-radius:.6rem;background:#1d1d1b;color:#fff;text-decoration:none}
</style>
</head>
<body>
<main>
  <h1>الان نمی‌توانم پاسخ بدهم</h1>
  <p>مشکلی موقتی پیش آمده یا سرویس در دسترس نیست. فهرست و یادداشت‌هایی که در این دستگاه دارید سر جایش است؛ کمی بعد دوباره تلاش کنید.</p>
  <a href="">تلاش دوباره</a>
</main>
</body>
</html>`;

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/** A browser page load: GET / HEAD that accepts HTML, outside /api. */
export function isHtmlRequest(req: FastifyRequest): boolean {
  const path = req.url.split('?')[0] ?? '/';
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (isApiPath(path)) return false;
  return String(req.headers.accept ?? '').includes('text/html');
}

export function sendOfflinePage(reply: FastifyReply, status: number): FastifyReply {
  return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(OFFLINE_HTML);
}

/**
 * Unknown paths: the SPA fallback (index.html) for browser page loads when a web build exists; everything else,
 * including every unknown /api path, is the Persian JSON envelope. The response never echoes the path.
 */
export function installNotFound(app: FastifyInstance, hasWeb: boolean): void {
  app.setNotFoundHandler((req, reply) => {
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    const path = req.url.split('?')[0] ?? '/';
    const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(path);
    if (hasWeb && isGet && !isApiPath(path) && !looksLikeFile) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return sendError(reply, 'NOT_FOUND');
  });
}
