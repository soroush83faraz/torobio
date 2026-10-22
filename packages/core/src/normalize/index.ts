/**
 * Persian text normalisation shared by the data build (index side) and the
 * server (query side). Both sides MUST use these functions so that words map
 * to the same tokens.
 *
 * Display text is never replaced by normalised text; normalised text goes to
 * *_norm columns and the FTS index only.
 */

export const ZWNJ = '\u200C';

import { stripInvisible } from './sanitize';

export { sanitizeText, sanitizeDeep, type SanitizeOptions } from './sanitize';

const DIGIT_MAP: Record<string, string> = {};
for (let i = 0; i < 10; i++) {
  DIGIT_MAP[String.fromCharCode(0x06f0 + i)] = String(i); // Persian ۰-۹
  DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i); // Arabic-Indic ٠-٩
}

/** Single-character replacements applied by normalizeFa. */
const CHAR_MAP: Record<string, string> = {
  ...DIGIT_MAP,
  'ي': 'ی', // Arabic yeh ي
  'ى': 'ی', // alef maksura ى
  'ے': 'ی', // yeh barree ے
  'ك': 'ک', // Arabic kaf ك
  'ڪ': 'ک', // swash kaf ڪ
  'ة': 'ه', // teh marbuta ة
  'ۀ': 'ه', // heh with yeh above ۀ
  'ە': 'ه', // ae ە
  'أ': 'ا', // alef with hamza above أ
  'إ': 'ا', // alef with hamza below إ
  'ٱ': 'ا', // alef wasla ٱ
  'ؤ': 'و', // waw with hamza ؤ
  '٫': '.', // Arabic decimal separator ٫
  '٬': ',', // Arabic thousands separator ٬
  '،': '،', // keep Arabic comma (identity, documented)
  ' ': ' ', // NBSP
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '　': ' ',
  '\t': ' ',
  '\r': ' ',
  '\n': ' ',
  '​': ZWNJ, // zero width space -> ZWNJ
  '‍': ZWNJ, // ZWJ -> ZWNJ
  '¬': ZWNJ, // NOT SIGN, typed as ZWNJ on some keyboards
  '﻿': '', // BOM
  '‎': '', // LRM
  '‏': '', // RLM
  '‪': '',
  '‫': '',
  '‬': '',
  '‭': '',
  '‮': '',
  '⁦': '',
  '⁧': '',
  '⁨': '',
  '⁩': '',
  'ـ': '', // tatweel ـ
  '­': '', // soft hyphen
};

/** Arabic diacritics (harakat, tanwin, shadda, sukun, superscript alef). */
const DIACRITICS_RE = /[ً-ٰٟۖ-ۭ]/g;

/**
 * Normalise Persian/Arabic/Latin mixed text:
 * - Arabic ي/ك (and similar letters) -> Persian ی/ک; ة/ۀ -> ه; أ/إ -> ا; ؤ -> و
 * - Persian and Arabic-Indic digits -> Latin digits; ٫ -> '.'
 * - removes diacritics, tatweel, bidi marks
 * - all zero-width joiners/spaces -> a single ZWNJ; ZWNJ next to a space or at
 *   the edges is removed; repeated ZWNJ collapsed
 * - whitespace collapsed and trimmed
 * - Latin letters lower-cased
 * 'آ' and 'ء'/'ئ' are kept (they are real Persian letters).
 */
export function normalizeFa(input: string | null | undefined): string {
  if (input == null) return '';
  let out = '';
  for (const ch of stripInvisible(String(input).replace(/\u200B/g, ZWNJ))) {
    const m = CHAR_MAP[ch];
    out += m === undefined ? ch : m;
  }
  out = out.replace(DIACRITICS_RE, '');
  out = out.toLowerCase();
  out = out
    .replace(/\u200C{2,}/g, ZWNJ)
    .replace(/ *\u200C */g, (m) => (m.includes(' ') ? ' ' : ZWNJ))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\u200C+|\u200C+$/g, '');
  return out;
}

/** Latin digits -> Persian digits (for display strings built in code). */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}

/** Persian/Arabic digits -> Latin digits only (no other change). */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
}

const PERSIAN_LETTER = '\\u0600-\\u06FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const SPLIT_FA_DIGIT_RE = new RegExp(`([${PERSIAN_LETTER}])(?=[0-9])|([0-9])(?=[${PERSIAN_LETTER}])`, 'g');
const NON_TOKEN_RE = /[^\p{L}\p{N}\p{M}]+/u;

/**
 * Small Persian stop-word list (function words that carry no product meaning).
 * Only removed when `dropStopwords` is requested.
 */
export const FA_STOPWORDS: ReadonlySet<string> = new Set([
  'و', 'با', 'به', 'از', 'در', 'برای', 'که', 'را', 'یا', 'تا', 'این', 'آن', 'هم', 'مدل', 'مناسب',
  'ی', 'های', 'ها', 'می', 'یک', 'عدد', 'تایی', 'the', 'for', 'with', 'and',
]);

export interface TokenizeOptions {
  /** remove FA_STOPWORDS (default false) */
  dropStopwords?: boolean;
}

/**
 * Tokenise for search. Index side and query side both use this, and the FTS
 * text column is stored as these tokens joined by single spaces, so the FTS5
 * unicode61 tokenizer sees exactly the same tokens.
 * - normalizeFa first
 * - ZWNJ is a token separator («دوربین\u200Cهای» -> «دوربین», «های»)
 * - a Persian letter glued to a digit is split («۴کانال» -> «4», «کانال»),
 *   Latin letter+digit runs are kept whole (model codes like «xvr1b04»)
 * - every other non letter/number character separates tokens
 */
export function tokenizeForSearch(text: string | null | undefined, opts: TokenizeOptions = {}): string[] {
  const n = normalizeFa(text).replace(/\u200C/g, ' ').replace(SPLIT_FA_DIGIT_RE, '$1$2 ');
  const toks = n.split(NON_TOKEN_RE).filter((t) => t.length > 0);
  return opts.dropStopwords ? toks.filter((t) => !FA_STOPWORDS.has(t)) : toks;
}

/** Text as stored in the FTS index (tokens joined by single spaces). */
export function toFtsText(...parts: Array<string | null | undefined>): string {
  return parts.flatMap((p) => tokenizeForSearch(p)).join(' ');
}

export interface FtsQueryOptions {
  /** 'and' (default): every token must match; 'or': any token. */
  mode?: 'and' | 'or';
  /** add a prefix wildcard to the last token (default true) */
  prefixLast?: boolean;
  dropStopwords?: boolean;
}

/**
 * Build a safe FTS5 MATCH expression from free user text.
 * Every token is wrapped in double quotes (FTS5 string syntax; embedded quotes
 * doubled), so user text can never inject FTS operators (AND/OR/NEAR/col:...).
 * The last token gets a prefix wildcard so partially typed words match.
 * Returns '' when there is nothing to search (callers must skip the MATCH).
 */
export function buildFtsQuery(text: string | null | undefined, opts: FtsQueryOptions = {}): string {
  const toks = tokenizeForSearch(text, { dropStopwords: opts.dropStopwords });
  if (toks.length === 0) return '';
  const prefixLast = opts.prefixLast ?? true;
  const parts = toks.map((t, i) => {
    const q = `"${t.replace(/"/g, '""')}"`;
    return prefixLast && i === toks.length - 1 ? `${q}*` : q;
  });
  return parts.join(opts.mode === 'or' ? ' OR ' : ' ');
}

/**
 * Canonical form of a model code for matching: digits -> Latin, upper-case,
 * every character other than A-Z/0-9 removed.
 * «XVR1B04-I» -> «XVR1B04I», «DH-HAC-HDW1200CLQP» -> «DHHACHDW1200CLQP».
 * Returns '' when nothing remains.
 */
export function normalizeModelCode(code: string | null | undefined): string {
  if (code == null) return '';
  return toLatinDigits(String(code)).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Persian number words (cardinal and ordinal stems) -> value, for extractors. */
export const FA_NUMBER_WORDS: Readonly<Record<string, number>> = {
  'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16,
  'هفده': 17, 'هجده': 18, 'نوزده': 19, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60,
  'هفتاد': 70, 'هشتاد': 80, 'نود': 90, 'صد': 100,
};
export const FA_ORDINAL_WORDS: Readonly<Record<string, number>> = {
  'اول': 1, 'یکم': 1, 'دوم': 2, 'سوم': 3, 'چهارم': 4, 'پنجم': 5, 'ششم': 6, 'هفتم': 7, 'هشتم': 8, 'نهم': 9,
  'دهم': 10, 'یازدهم': 11, 'دوازدهم': 12, 'سیزدهم': 13, 'چهاردهم': 14, 'پانزدهم': 15,
};

/**
 * Parse a small Persian cardinal phrase («سی و شش» -> 36, «ده» -> 10).
 * Returns null if any word is not a number word.
 */
export function parseFaNumberWords(phrase: string): number | null {
  const words = normalizeFa(phrase).split(/\s+و\s+|\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let total = 0;
  for (const w of words) {
    const v = FA_NUMBER_WORDS[w];
    if (v === undefined) return null;
    total += v;
  }
  return total;
}

/** Hundreds («دویست» ... «نهصد»); «صد» is also in FA_NUMBER_WORDS. */
export const FA_HUNDRED_WORDS: Readonly<Record<string, number>> = {
  'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'شیشصد': 600,
  'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900,
};
const FRACTION_DENOMINATORS: Readonly<Record<string, number>> = { 'دوم': 2, 'سوم': 3, 'چهارم': 4, 'پنجم': 5 };

/** Value of one Persian number word (1-19, tens, hundreds), or undefined. */
export function faNumberWordValue(word: string): number | undefined {
  return FA_HUNDRED_WORDS[word] ?? FA_NUMBER_WORDS[word];
}

/** Magnitude class of a number word: 3 = hundreds, 2 = tens (20-90), 1 = 1-19. */
function numberClass(v: number): 1 | 2 | 3 {
  return v >= 100 ? 3 : v >= 20 ? 2 : 1;
}

/**
 * Strict Persian number phrase -> value (decimals allowed). Unlike parseFaNumberWords this checks the grammar:
 *  - «و»-joined parts must go down in magnitude: «صد و بیست و پنج» = 125, «بیست و پنج» = 25 («دو و سه» is null);
 *  - a final «نیم» adds one half: «دو و نیم» = 2.5, «یک و نیم» = 1.5, «بیست و دو و نیم» = 22.5; «نیم» alone = 0.5;
 *  - «سه چهارم» = 0.75, «یک دوم» = 0.5 (numerator below the denominator).
 * Returns null for anything else.
 */
export function parseFaNumberPhrase(phrase: string): number | null {
  const words = normalizeFa(phrase).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 2) {
    const n = FA_NUMBER_WORDS[words[0] as string];
    const d = FRACTION_DENOMINATORS[words[1] as string];
    if (n !== undefined && d !== undefined && n < d) return n / d;
  }
  let total = 0;
  let prevClass = 4;
  let expectWord = true;
  let sawNumber = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (expectWord) {
      if (w === 'نیم') {
        if (i !== words.length - 1) return null;
        return total + 0.5;
      }
      const v = faNumberWordValue(w);
      if (v === undefined) return null;
      const cls = numberClass(v);
      if (cls >= prevClass) return null;
      prevClass = cls;
      total += v;
      sawNumber = true;
      expectWord = false;
    } else {
      if (w !== 'و') return null;
      expectWord = true;
    }
  }
  return expectWord || !sawNumber ? null : total;
}
