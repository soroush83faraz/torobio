/**
 * Input sanitising for text that comes from outside (requests, saved states, share links).
 *
 * Bidi override / embedding / isolate characters (U+202A-202E, U+2066-2069) let a request make the DISPLAYED text
 * read differently from what was typed (U+202E reverses everything after it), so they are removed. So are the
 * implicit direction marks (LRM, RLM, ALM), control characters, zero-width space / word joiner / invisible
 * operators, the BOM, interlinear annotation marks, tag characters and lone surrogates. Line / paragraph
 * separators, NBSP and tabs become a plain space. ZWNJ (U+200C) and ZWJ (U+200D) are kept: Persian spelling
 * needs them; runs of them collapse to one and they are dropped next to whitespace and at the edges.
 */

/** Control characters (except tab, LF, CR, which sanitizeText handles) become a space. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Invisible and direction-changing characters, removed outright. */
const STRIP_RE =
  /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB\uFFFE\uFFFF]|\uDB40[\uDC00-\uDC7F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Separators that become a plain space. */
const SPACE_RE = /[\u2028\u2029\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\t]/g;

/** Remove the always-invisible / direction-changing characters (no whitespace handling). */
export function stripInvisible(input: string): string {
  return input.replace(CONTROL_RE, ' ').replace(STRIP_RE, '');
}

export interface SanitizeOptions {
  /** keep line breaks (default true); false turns them into spaces */
  multiline?: boolean;
}

/**
 * Safe text for display and storage: see the module comment. Idempotent. Does NOT change letters or digits
 * (use normalizeFa for search normalisation) and keeps \u00AB\n\u00BB unless `multiline: false`.
 */
export function sanitizeText(input: string | null | undefined, opts: SanitizeOptions = {}): string {
  if (input == null) return '';
  let out = stripInvisible(String(input)).replace(/\r\n?/g, '\n').replace(SPACE_RE, ' ');
  if (opts.multiline === false) out = out.replace(/\n/g, ' ');
  return out
    .replace(/[\u200C\u200D]{2,}/g, (m) => m[0] as string)
    .replace(/[ \n]*[\u200C\u200D]+[ \n]*/g, (m) => (m.includes('\n') ? '\n' : m.includes(' ') ? ' ' : m))
    .replace(/^[\u200C\u200D]+|[\u200C\u200D]+$/g, '');
}

/** sanitizeText over every string inside a JSON-like value (plain objects, arrays); other values pass through. */
export function sanitizeDeep<T>(value: T, opts: SanitizeOptions = {}): T {
  if (typeof value === 'string') return sanitizeText(value, opts) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, opts)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== '__proto__') out[k] = sanitizeDeep(v, opts);
    return out as T;
  }
  return value;
}
