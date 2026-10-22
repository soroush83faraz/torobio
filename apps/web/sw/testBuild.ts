import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the web app (with the real vite.config.ts, so the service-worker plugin runs) into `outDir`.
 * `variant` adds a statement to the entry module, which changes the hashed file names: two variants are two deploys.
 * Used by the build-output test and by the cache-refresh e2e; never by the app.
 */
export async function buildWeb(outDir: string, variant = ''): Promise<void> {
  const before = process.env.VITE_API;
  const cwd = process.cwd();
  process.env.VITE_API = ''; // the real-API build: only that one registers the service worker
  process.chdir(webDir); // tailwind resolves its config and content globs from the working directory
  try {
    await build({
      root: webDir,
      configFile: path.join(webDir, 'vite.config.ts'),
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
      },
      plugins: variant
        ? [
            {
              name: 'deploy-variant',
              transform(code, id) {
                return id.endsWith('/src/main.tsx') ? `${code}\nconsole.debug(${JSON.stringify(`deploy ${variant}`)});\n` : null;
              },
            },
          ]
        : [],
    });
  } finally {
    process.chdir(cwd);
    if (before === undefined) delete process.env.VITE_API;
    else process.env.VITE_API = before;
  }
}
