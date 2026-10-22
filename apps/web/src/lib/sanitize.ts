/**
 * Client-side sanitising of text that is typed, stored, shared or rendered.
 *
 * ONE implementation: the same module the server uses (packages/core/src/normalize/sanitize.ts). It removes the bidi
 * embedding / override / isolate controls (U+202A-202E, U+2066-2069), the implicit direction marks (LRM U+200E,
 * RLM U+200F, ALM U+061C), zero-width space and the other invisible characters, and control characters; it keeps
 * ZWNJ (U+200C, the Persian half-space) and ZWJ.
 *
 * The web app wants one-line text (plan names, titles, chips), so line breaks, tabs and Unicode line / paragraph
 * separators become a space here (`multiline: false`); the server keeps line breaks of a multi-line request.
 * Only the deep file is imported, so nothing else of @app/core (zod...) is bundled.
 */
import { sanitizeDeep as coreSanitizeDeep, sanitizeText as coreSanitizeText } from '@app/core/src/normalize/sanitize';

const ONE_LINE = { multiline: false } as const;

export function sanitizeText(s: string): string {
  return coreSanitizeText(typeof s === 'string' ? s : null, ONE_LINE);
}

/** Sanitises every string inside a JSON-like value (arrays and plain objects), returning a copy. */
export function sanitizeDeep<T>(value: T): T {
  return coreSanitizeDeep(value, ONE_LINE);
}
