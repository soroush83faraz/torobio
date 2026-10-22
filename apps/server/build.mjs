// Bundles the server into a single ESM file. @app/core is TypeScript source (no build step), so it is
// aliased to its entry and compiled by esbuild; the native better-sqlite3 addon stays external and
// must be present in node_modules next to the bundle at runtime (see Dockerfile).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  external: ['better-sqlite3'],
  alias: { '@app/core': path.join(here, '../../packages/core/src/index.ts') },
  // CJS dependencies (fastify, pino...) call require() for node builtins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
