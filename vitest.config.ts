import { configDefaults, defineConfig } from 'vitest/config';

// Root run: pick up every workspace's tests, but never agent worktrees or e2e specs.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', '**/e2e/**'],
    env: { NODE_ENV: 'test' },
    // The real-data suites load a 130 MB database and category pools on their first call (about 2.5 s alone);
    // on a busy machine the default 5 s limit turned that into intermittent timeouts, never real failures.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
