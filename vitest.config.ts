import { configDefaults, defineConfig } from 'vitest/config';

// Root run: pick up every workspace's tests, but never agent worktrees or e2e specs.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**', '**/e2e/**'],
    env: { NODE_ENV: 'test' },
  },
});
