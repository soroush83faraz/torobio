import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildWeb } from '../sw/testBuild';

/**
 * The offline shell refreshes on every deploy: after a NEW build is served, the new worker takes over, deletes the
 * old build's cache (named after the old build) and precaches the new files. Two real builds of the web app are made
 * into temp dirs and served by a tiny static server whose root is switched between them (no API, no market data).
 * This guards the bug where the cache name stayed «shell-__BUILD_ID__» across builds and old files piled up.
 */
test.describe('SW cache refresh across builds', () => {
  test.use({ serviceWorkers: 'allow' });
  test.describe.configure({ mode: 'serial' });

  let tmp = '';
  let server: Server;
  let origin = '';
  let root = '';

  const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

  test.beforeAll(async ({}, info) => {
    test.skip(info.project.name !== 'm390', 'builds are viewport-independent: run once');
    test.setTimeout(180_000);
    tmp = mkdtempSync(path.join(tmpdir(), 'sw-e2e-'));
    await buildWeb(path.join(tmp, 'a'), 'A');
    await buildWeb(path.join(tmp, 'b'), 'B');
    root = path.join(tmp, 'a');
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(503).end();
        return;
      }
      let file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!file.startsWith(root) || !statSync(file, { throwIfNoEntry: false })?.isFile()) file = path.join(root, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  const snapshot = (page: Page) =>
    page.evaluate(async () => {
      const out: Record<string, string[]> = {};
      for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname).sort();
      return out;
    });
  const assetsOf = (dir: string) => readdirSync(path.join(tmp, dir, 'assets')).filter((f) => !f.endsWith('.map')).map((f) => `/assets/${f}`).sort();
  const cacheNameIn = (dir: string) => `shell-${/const BUILD_ID = '([0-9a-f]+)'/.exec(readFileSync(path.join(tmp, dir, 'sw.js'), 'utf8'))![1]}`;

  test('a new build replaces the old shell cache: old files are gone, new files are precached', async ({ page }) => {
    const nameA = cacheNameIn('a');
    const nameB = cacheNameIn('b');
    expect(nameA).not.toBe(nameB);
    const [assetsA, assetsB] = [assetsOf('a'), assetsOf('b')];
    expect(assetsA.filter((u) => /\/index-.*\.js$/.test(u)).some((u) => assetsB.includes(u)), 'the two builds have different entry files').toBe(false);

    // ---- deploy A: the worker installs and precaches A's shell
    await page.goto(`${origin}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برای خریدت چی لازم داری؟');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => Object.keys(await snapshot(page)), { timeout: 15_000 }).toEqual([nameA]);
    const first = await snapshot(page);
    expect(first[nameA]).toEqual(expect.arrayContaining(['/', ...assetsA]));

    // ---- deploy B: same URL, other build. The browser's update check finds the new sw.js.
    root = path.join(tmp, 'b');
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg!.update();
    });
    // the new worker installs (precaches B), skips waiting, and on activate deletes A's cache
    await expect.poll(async () => Object.keys(await snapshot(page)), { timeout: 20_000, message: 'only the new cache is left' }).toEqual([nameB]);
    const second = await snapshot(page);
    expect(second[nameB]).toEqual(expect.arrayContaining(['/', ...assetsB]));
    // (files with unchanged content keep their hashed name in both builds: only the A-only files must be gone)
    const onlyA = assetsA.filter((u) => !assetsB.includes(u));
    expect(onlyA.length).toBeGreaterThan(0);
    for (const old of onlyA) expect(Object.values(second).flat(), `${old} (old build) must not stay cached`).not.toContain(old);

    // ---- a reload serves B (network first) and the page still works
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برای خریدت چی لازم داری؟');
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname));
    expect(loaded.some((u) => assetsB.includes(u))).toBe(true);
    expect(loaded.some((u) => onlyA.includes(u))).toBe(false);
    expect(Object.keys(await snapshot(page))).toEqual([nameB]);
  });
});
