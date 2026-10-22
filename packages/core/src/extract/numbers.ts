import { FA_NUMBER_WORDS, normalizeFa } from '../normalize/index';

/**
 * Text form every extractor works on: normalizeFa (Latin digits, lower-case
 * Latin, unified Persian letters) with ZWNJ turned into a plain space.
 */
export function prep(text: string | null | undefined): string {
  return normalizeFa(text).replace(/\u200C/g, ' ');
}

const NUM_WORDS = Object.keys(FA_NUMBER_WORDS).sort((a, b) => b.length - a.length);
const NUM_WORD_ALT = NUM_WORDS.join('|');
/** «سی و شش», «دو», «شانزده» ... (word boundaries are handled by callers). */
export const FA_NUM_PHRASE = `(?:${NUM_WORD_ALT})(?:\\s+و\\s+(?:${NUM_WORD_ALT}))?`;
/** 12 | 2.5 | 2/5 (Persian decimal slash) */
export const NUM = `\\d+(?:[.,/]\\d+)?`;

const LETTER = 'a-z\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF';

export function parseNum(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+(?:[.,/]\d+)?$/.test(s)) {
    const v = Number(s.replace(/[,/]/, '.'));
    return Number.isFinite(v) ? v : null;
  }
  // number words
  const words = s.split(/\s+و\s+|\s+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    const v = FA_NUMBER_WORDS[w];
    if (v === undefined) return null;
    total += v;
  }
  return words.length ? total : null;
}

export interface QuantityHit {
  value: number;
  unit: string;
  index: number;
  raw: string;
}

/**
 * Find "<number> <unit>" occurrences. `unitAlt` is a regex alternation of unit
 * spellings (already normalised text: Latin lower-case, Persian unified).
 * The number may be Latin digits (with . or / as decimal) or Persian number words.
 * The unit must not be followed by another letter (so «مگ» does not match inside
 * «مگابایت» unless listed), and the number must not be glued to a preceding
 * Latin letter/digit (so model codes like «hfw1200» are not read as numbers).
 */
export function findQuantities(text: string, unitAlt: string, opts: { words?: boolean } = {}): QuantityHit[] {
  const numPart = opts.words === false ? NUM : `${NUM}|${FA_NUM_PHRASE}`;
  const re = new RegExp(`(?<![a-z0-9.,/])(${numPart})\\s*[-_]?\\s*(${unitAlt})(?![${LETTER}])`, 'g');
  const out: QuantityHit[] = [];
  for (const m of text.matchAll(re)) {
    const rawNum = m[1] ?? '';
    // number words must start at a word boundary
    if (!/^\d/.test(rawNum)) {
      const before = text[(m.index ?? 0) - 1];
      if (before && new RegExp(`[${LETTER}]`).test(before)) continue;
    }
    const v = parseNum(rawNum);
    if (v === null) continue;
    out.push({ value: v, unit: m[2] ?? '', index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

/** The single distinct value, or null when none / several distinct values. */
export function single(values: number[]): number | null {
  const uniq = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))];
  return uniq.length === 1 ? (uniq[0] as number) : null;
}

export function hasWord(text: string, alt: string): boolean {
  return new RegExp(`(?<![${LETTER}0-9])(?:${alt})(?![${LETTER}0-9])`).test(text);
}
