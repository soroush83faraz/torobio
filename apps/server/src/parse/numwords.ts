/**
 * Persian number words in requests: «پنجاه», «دو و نیم», «صد و بیست», «سه چهارم».
 *
 * - `NUMBER_PHRASE` is a regex source for a candidate phrase on the length-preserving `align()` string; the value
 *   is always decided by core's strict `parseFaNumberPhrase` (grammar: magnitudes go down, «نیم» last).
 * - `joinsNumber` tells the splitter that a « و » belongs to one number phrase («دو و نیم», «بیست و پنج»), so it
 *   is not an item separator.
 * - Thousands («هزار متر», «دو هزار و پانصد عدد») are NOT part of `NUMBER_PHRASE` (a bare «۲۰ هزار» is 20 000 mAh or a
 *   price): `THOUSANDS_PHRASE` / `thousandsValue` are used only where a quantity unit follows (phrases.ts).
 * - «یکصد» / «یک صد» is one hundred.
 * - `wordsToDigits` rewrites unambiguous phrases as digits («دو و نیم» -> «2.5») for the extractors, which read
 *   digits. The user's own text (item.text) is never changed.
 */
import { FA_HUNDRED_WORDS, FA_NUMBER_WORDS, faNumberWordValue, normalizeFa, parseFaNumberPhrase } from '@app/core';
import { LB, RB, align } from './text.js';

const ALL_WORDS = [...new Set([...Object.keys(FA_NUMBER_WORDS), ...Object.keys(FA_HUNDRED_WORDS)])].sort((a, b) => b.length - a.length);
const WORD = `(?:${ALL_WORDS.join('|')})`;
/** «سه چهارم», «یک دوم»: numerator word + ordinal denominator. */
const FRACTION = `(?:${Object.keys(FA_NUMBER_WORDS).filter((w) => FA_NUMBER_WORDS[w]! < 5).join('|')})\\s+(?:دوم|سوم|چهارم|پنجم)`;
/** Candidate phrase (not yet validated): «پنجاه», «دو و نیم», «صد و بیست و پنج», «سه چهارم», «نیم». */
export const NUMBER_PHRASE = `(?:${FRACTION}|(?:یک\\s+صد|${WORD}|نیم)(?:\\s+و\\s+(?:${WORD}|نیم))*)`;
/** A digit string followed by «و نیم»: «۲ و نیم». */
export const DIGIT_AND_HALF = '\\d{1,4}\\s+و\\s+نیم';

/** Value of a phrase found by the regexes above (aligned text): digits, «N و نیم» or words. */
export function phraseValue(tok: string): number | null {
  // «یک صد» (typed with a space or ZWNJ) is «یکصد»
  const t = tok.trim().replace(/(^|\s)یک\s+صد(?=\s|$)/g, '$1یکصد');
  const dh = /^(\d+)\s+و\s+نیم$/.exec(t);
  if (dh) return Number(dh[1]) + 0.5;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return parseFaNumberPhrase(t);
}

const THOUSAND_PART = `(?:${NUMBER_PHRASE}|\\d{1,3})`;
/** «هزار», «دو هزار», «ده هزار», «هزار و پانصد», «دو هزار و ۵۰۰», «۲ هزار». */
export const THOUSANDS_PHRASE = `(?:${THOUSAND_PART}\\s+)?هزار(?:\\s+و\\s+${THOUSAND_PART})?`;

/** Value of a `THOUSANDS_PHRASE` match; null unless the result is a whole number (the part after «و» below 1000). */
export function thousandsValue(tok: string): number | null {
  const m = /^(?:(.+?)\s+)?هزار(?:\s+و\s+(.+))?$/.exec(tok.trim());
  if (!m) return null;
  const left = m[1] === undefined ? 1 : phraseValue(m[1]);
  const right = m[2] === undefined ? 0 : phraseValue(m[2]);
  if (left === null || right === null || left <= 0 || right < 0 || right >= 1000 || !Number.isInteger(right)) return null;
  const v = left * 1000 + right;
  return Number.isInteger(v) ? v : null;
}

const magnitude = (v: number): 1 | 2 | 3 => (v >= 100 ? 3 : v >= 20 ? 2 : 1);

/** `left` / `right`: the words on both sides of a « و ». True when they are parts of one number phrase. */
export function joinsNumber(left: string, right: string): boolean {
  const l = normalizeFa(left);
  const r = normalizeFa(right);
  // «دو و نیم», «۲ و نیم», «چهار متر و نیم»
  if (r === 'نیم') return /^\d+$/.test(l) || faNumberWordValue(l) !== undefined || l === 'متر';
  const lv = faNumberWordValue(l);
  const rv = faNumberWordValue(r);
  // «هزار و پانصد», «دو هزار و ۵۰۰»: what follows «هزار» is the remainder below a thousand
  if (l === 'هزار') return (rv !== undefined && rv < 1000) || /^\d{1,3}$/.test(r);
  return lv !== undefined && rv !== undefined && magnitude(lv) > magnitude(rv);
}

export interface WordsToDigitsOptions {
  /**
   * Also convert a single small number word (1-9) that ends the text or is followed by a section unit
   * («سیم افشان دو» is not enough on its own to know it is a section, so this is for wire items only).
   */
  small?: boolean;
}

const TOKEN_RE = new RegExp(`${LB}(?:${DIGIT_AND_HALF}|${NUMBER_PHRASE})${RB}`, 'g');
const SECTION_UNIT_AFTER = new RegExp(`^\\s*(?:میل|میلی|مربع|mm)`);
/** «سیم دو در یک و نیم»: the «2» before «در <number>» is the core count of a «cores × section» size. */
const TIMES_NUMBER_AFTER = new RegExp(`^\\s*(?:ضرب\\s+در|در|[x×*])\\s*(?:\\d|${NUMBER_PHRASE}${RB})`);

/** Rewrite unambiguous number phrases as digits; the string length changes, the rest of the text does not. */
export function wordsToDigits(raw: string, opts: WordsToDigitsOptions = {}): string {
  const a = align(raw);
  let out = '';
  let pos = 0;
  for (const m of a.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const text = m[0];
    const value = phraseValue(text);
    if (value === null) continue;
    const words = text.split(/\s+/);
    const multi = words.length > 1;
    const single = words[0] as string;
    const sv = faNumberWordValue(single);
    let convert = multi || (/^\d/.test(text) ? false : single !== 'نیم' && sv !== undefined && sv >= 20 && single !== 'سی');
    if (!convert && opts.small && !multi && sv !== undefined && sv >= 1 && sv <= 9 && single !== 'نه') {
      const rest = a.slice(start + text.length);
      convert = rest.trim() === '' || SECTION_UNIT_AFTER.test(rest) || TIMES_NUMBER_AFTER.test(rest);
    }
    if (single === 'نیم' && !multi) convert = false;
    if (!convert) continue;
    out += raw.slice(pos, start) + String(value);
    pos = start + text.length;
  }
  return out + raw.slice(pos);
}
