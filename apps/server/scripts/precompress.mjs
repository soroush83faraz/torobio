// Build-time step: write .br and .gz siblings for every compressible text asset in a web build, so
// @fastify/static (preCompressed) can serve them with zero per-request CPU.
// Usage: node apps/server/scripts/precompress.mjs apps/web/dist
// A sibling is only kept when it is at least 5% smaller than the original; woff2/png/etc. are never touched.
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.txt', '.xml', '.map']);
const MIN_BYTES = 512;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const root = process.argv[2];
if (!root) {
  console.error('usage: precompress.mjs <dir>');
  process.exit(2);
}
let files = 0;
let before = 0;
let best = 0;
for (const file of walk(root)) {
  if (!TEXT.has(path.extname(file).toLowerCase())) continue;
  const input = readFileSync(file);
  if (input.length < MIN_BYTES) continue;
  const br = brotliCompressSync(input, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: input.length },
  });
  const gz = gzipSync(input, { level: 9 });
  let wrote = false;
  if (br.length < input.length * 0.95) { writeFileSync(`${file}.br`, br); wrote = true; }
  if (gz.length < input.length * 0.95) { writeFileSync(`${file}.gz`, gz); wrote = true; }
  if (wrote) {
    files++;
    before += input.length;
    best += Math.min(br.length, gz.length);
  }
}
console.log(`precompress: ${files} files, ${before} -> ${best} bytes (best of br/gz) in ${path.resolve(root)}`);
