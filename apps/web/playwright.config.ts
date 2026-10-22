import { defineConfig } from '@playwright/test';

/**
 * MOCK suite (fast, no server): the finished UI on the in-browser mock API.
 * Built with VITE_API=mock into dist-mock so it never overwrites the real build the server serves.
 * The REAL-data suite (built server + market.sqlite) is playwright.real.config.ts (`npm run e2e:real`).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', locale: 'fa-IR', timezoneId: 'Asia/Tehran', hasTouch: true, isMobile: true },
  projects: [
    { name: 'm390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'm360', use: { viewport: { width: 360, height: 640 } } },
  ],
  webServer: {
    command: 'VITE_API=mock npx vite build --outDir dist-mock --emptyOutDir && npx vite preview --outDir dist-mock --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
