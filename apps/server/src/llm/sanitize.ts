/**
 * Everything that goes into a prompt is untrusted DATA (user text, item texts, shop / mall / category names). It is
 * normalised and delimited here so that it cannot pose as instructions or break out of its delimiter tag:
 *  - NFKC first (full-width «＜ｉｇｎｏｒｅ＞» and Arabic presentation forms become plain characters, so the later
 *    filters see them);
 *  - invisible / formatting characters removed: C0/C1 controls, bidi embeddings, overrides, isolates and marks,
 *    line/paragraph separators, zero-width characters other than ZWNJ (needed by Persian), BOM, variation
 *    selectors and the Unicode "tag" block (invisible ASCII smuggling);
 *  - '<' and '>' replaced by look-alike guillemets in free text, escaped as < / > inside JSON blocks;
 *  - whitespace collapsed, length clipped by code points.
 *
 * The character classes are built from numeric code points (no raw invisible characters in this source file).
 */

/** Inclusive code point ranges that are removed. ZWNJ (0x200C) is deliberately not listed. */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL + C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x034f, 0x034f], // combining grapheme joiner
  [0x061c, 0x061c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer invisible vowels
  [0x180b, 0x180f], // Mongolian variation selectors / vowel separator
  [0x200b, 0x200b], // zero width space
  [0x200d, 0x200f], // ZWJ, LRM, RLM
  [0x2028, 0x202e], // line / paragraph separators, LRE RLE PDF LRO RLO
  [0x2060, 0x206f], // word joiner, invisible operators, LRI RLI FSI PDI, deprecated format chars
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // BOM / zero width no-break space
  [0xffa0, 0xffa0], // half-width Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation
  [0xe0000, 0xe007f], // tag characters (invisible ASCII)
  [0xe0100, 0xe01ef], // variation selectors supplement
];

const esc = (cp: number) => (cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`);
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join('')}]`, 'gu');
/** Characters that act as line breaks: replaced by a space (before the invisible filter runs). */
const BREAKS = new RegExp(`[${[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029].map(esc).join('')}]`, 'gu');
const LINE_SEPS = new RegExp(`[${[0x2028, 0x2029].map(esc).join('')}]`, 'g');

/** Remove invisible / bidi / control characters (line breaks become spaces). ZWNJ is kept. */
export function stripInvisible(s: string): string {
  return String(s ?? '').replace(BREAKS, ' ').replace(INVISIBLE, '');
}

/** The invisible ranges with the line feed (0x0A) carved out. */
const KEEP_LF_RANGES: ReadonlyArray<readonly [number, number]> = INVISIBLE_RANGES.flatMap(([a, b]): Array<readonly [number, number]> =>
  a <= 0x0a && 0x0a <= b ? ([[a, 0x09], [0x0b, b]] as const).filter(([x, y]) => x <= y) : [[a, b]],
);
const INVISIBLE_KEEP_LF = new RegExp(`[${KEEP_LF_RANGES.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join('')}]`, 'gu');
const BREAKS_EXCEPT_LF = new RegExp(`[${[0x09, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029].map(esc).join('')}]`, 'gu');

/**
 * stripInvisible for a whole multi-line prompt (its tagged blocks are line-delimited): line feeds survive (CR and
 * CRLF become LF), every other break becomes a space, and the same invisible / bidi / control characters go.
 */
export function stripInvisibleKeepLines(s: string): string {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(BREAKS_EXCEPT_LF, ' ')
    .replace(INVISIBLE_KEEP_LF, '');
}

/** True when the text contains any character that stripInvisible removes (or a line break). */
export function hasInvisible(s: string): boolean {
  INVISIBLE.lastIndex = 0;
  BREAKS.lastIndex = 0;
  const r = INVISIBLE.test(s) || BREAKS.test(s);
  INVISIBLE.lastIndex = 0;
  BREAKS.lastIndex = 0;
  return r;
}

/** Clip to `max` code points (never splits a surrogate pair). */
export function clipChars(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : `${cps.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** Free text bound for a prompt (or echoed into a templated message). */
export function untrustedText(s: string | null | undefined, maxChars: number): string {
  const t = stripInvisible(String(s ?? '').normalize('NFKC'))
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
    .replace(/\s+/g, ' ')
    .trim();
  return clipChars(t, maxChars);
}

/** JSON for a prompt data block: no raw '<' '>' and no line separators, so data cannot open or close a tag. */
export function promptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(LINE_SEPS, (c) => (c.codePointAt(0) === 0x2028 ? '\\u2028' : '\\u2029'));
}

/** JSON.parse that never throws (null on failure); rejects absurdly large inputs before parsing. */
export function parseJsonSafe(raw: string, maxChars = 20_000): unknown {
  if (typeof raw !== 'string' || raw.length > maxChars) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
