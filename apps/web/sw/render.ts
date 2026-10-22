import { createHash } from 'node:crypto';

/** Placeholders in sw.template.js. Each must occur exactly once in the template, as code. */
const TOKENS = ['__BUILD_ID__', '__PRECACHE__'] as const;

/** A short id for a build: a hash of the built index.html and of the precached URLs. */
export function buildIdFor(indexHtml: string | Buffer, urls: string[]): string {
  const hash = createHash('sha1');
  hash.update(indexHtml);
  for (const u of urls) hash.update(u);
  return hash.digest('hex').slice(0, 12);
}

/**
 * Fills the worker template. Throws when a placeholder is missing, appears more than once (a comment that mentions
 * it would otherwise take the replacement and leave the code with the raw token: the cache name then never
 * changes between builds), or is still there after the fill.
 */
export function renderServiceWorker(template: string, buildId: string, urls: string[]): string {
  if (!/^[0-9a-f]{8,}$/.test(buildId)) throw new Error(`service worker: bad build id «${buildId}»`);
  for (const t of TOKENS) {
    const n = template.split(t).length - 1;
    if (n !== 1) throw new Error(`service worker template: ${t} must appear exactly once, found ${n}`);
  }
  const out = template.replaceAll('__BUILD_ID__', () => buildId).replaceAll('__PRECACHE__', () => JSON.stringify(urls));
  for (const t of TOKENS) if (out.includes(t)) throw new Error(`service worker: ${t} was not replaced`);
  return out;
}
