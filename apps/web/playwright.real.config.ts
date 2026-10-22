import net from 'node:net';
import { defineConfig } from '@playwright/test';

/**
 * REAL-data suite: builds the web app and the server, starts the built server on a free port against the
 * real market.sqlite (E2E_DB overrides the path) and drives the UI at 390x844 and 360x640.
 *   npm run e2e:real -w @app/web
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

// Workers re-import this file: the port is chosen once (env is inherited by them).
const port = Number(process.env.E2E_REAL_PORT) || (await freePort());
process.env.E2E_REAL_PORT = String(port);

export default defineConfig({
  testDir: './e2e-real',
  testMatch: /.*\.real\.e2e\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    hasTouch: true,
    isMobile: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    // The offline-shell worker would sit between the page and Playwright's request routing; only the offline-shell
    // tests (fixes.real.e2e.ts) turn it on.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'm390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'm360', use: { viewport: { width: 360, height: 640 } } },
  ],
  webServer: {
    command: 'node e2e-real/serve.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
