// Build-time data fetch (used by the Dockerfile; no apt packages needed).
//   node fetch-data.mjs <url|local-path> <out.sqlite> [sha256]
// Downloads the asset, verifies sha256 of the downloaded bytes (when given), transparently
// decompresses .zst (detected by magic bytes, not file name) and checks the SQLite header.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';

const [src, out, expected] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: fetch-data.mjs <url|path> <out> [sha256]');
  process.exit(2);
}
const tmp = `${out}.download`;
const fail = (msg) => {
  console.error(`fetch-data: ${msg}`);
  rmSync(tmp, { force: true });
  rmSync(out, { force: true });
  process.exit(1);
};

async function download() {
  const hash = createHash('sha256');
  let input;
  if (/^https?:\/\//i.test(src)) {
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(src, { redirect: 'follow' });
        if (res.ok && res.body) break;
        if (attempt >= 3 || (res.status >= 400 && res.status < 500)) fail(`HTTP ${res.status} for the data URL`);
      } catch (e) {
        if (attempt >= 3) fail(`download failed (${e?.cause?.code ?? e?.message ?? 'error'})`);
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    input = Readable.fromWeb(res.body);
  } else {
    input = createReadStream(src);
  }
  input.on('data', (c) => hash.update(c));
  await pipeline(input, createWriteStream(tmp));
  return hash.digest('hex');
}

function head(file, n) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

const digest = await download();
if (expected) {
  if (digest !== expected.trim().toLowerCase()) fail(`sha256 mismatch (got ${digest})`);
  console.log(`fetch-data: sha256 ok`);
} else {
  console.warn(`fetch-data: WARNING no DATA_SHA256 given, download not verified (sha256 ${digest})`);
}

const magic = head(tmp, 4);
if (magic.equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
  await pipeline(createReadStream(tmp), createZstdDecompress(), createWriteStream(out));
  rmSync(tmp, { force: true });
} else {
  const { renameSync } = await import('node:fs');
  renameSync(tmp, out);
}

if (head(out, 15).toString('latin1') !== 'SQLite format 3') fail('result is not a SQLite database');
console.log(`fetch-data: wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
