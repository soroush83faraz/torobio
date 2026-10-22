/**
 * Splitting a free-text request into item segments (raw text slices, exactly as typed).
 *
 * Separators: newline, «،» «,» «؛» «;» «+», sentence dot, « و » and a companion «با / همراه» before a known noun.
 * NOT separators (the point of this module):
 *  - a comma between digits («۲,۵», «۱,۰۰۰,۰۰۰», «۲،۵») and a «+» glued to alphanumerics («3×95+50», «5V+»);
 *  - «و» inside a number phrase («دو و نیم», «صد و بیست»), see numwords.ts;
 *  - «و» inside a protected category phrase («کلید و پریز», «کیف و کاور گوشی»);
 *  - a fragment that only carries spec words after «و»: «هارد ۲ ترابایت و ۶۴ مگ کش» stays one item, while
 *    «هارد ۲ ترابایت و ضبط‌کننده ۴ کانال» splits (the right side names a thing). Unit words follow numbers, so a
 *    fragment made only of numbers, units and qualifiers belongs to the previous item.
 */
import { FA_NUMBER_WORDS, normalizeFa, tokenizeForSearch } from '@app/core';
import { HUNDREDS } from './budget.js';
import { hasHeadNoun, startsWithHeadNoun, type Lexicon } from './lexicon.js';
import { joinsNumber } from './numwords.js';
import { QTY_MARKER_WORDS, SPEC_UNIT_WORDS, align } from './text.js';

const DIGIT = '[0-9\\u06F0-\\u06F9\\u0660-\\u0669]';
const NUM_RE = `${DIGIT}+(?:[.,/٫]${DIGIT}+)?`;
const PURE_NUMBER = new RegExp(`^\\s*${NUM_RE}\\s*$`);
const TRAILING_NUMBER = new RegExp(`\\s+${NUM_RE}\\s*$`);
const SEP = /\s+و\s+|[،,؛;\r\n]+|\+|\.(?=\s|$)|:(?!\d)/g;
const COMPANION = /\s+(?:با|به\s*همراه|بهمراه|همراه|به\s*علاوه|بعلاوه)\s+/g;
/** Qualifier words that never name a thing on their own (colours, sizes, "original"...). */
const QUALIFIER_WORDS: ReadonlySet<string> = new Set([
  'مشکی', 'سفید', 'قرمز', 'آبی', 'سبز', 'بنفش', 'طوسی', 'نقره', 'ای', 'طلایی', 'اصلی', 'نو', 'اورجینال', 'مدل', 'نوع', 'و', 'با', 'یا',
  'بیشتر', 'کمتر', 'حداقل', 'حداکثر', 'مناسب', 'خوب', 'کیفیت', 'ظرفیت', 'حجم', 'دور', 'مربع', 'سایز', 'نمره',
]);

function isNumericToken(t: string): boolean {
  return /^\d+(?:\.\d+)?[a-z]*$/.test(t) || t in FA_NUMBER_WORDS || t in HUNDREDS || t === 'نیم';
}

/** A fragment is "spec only" when every token is a number, a unit word or a qualifier (no thing is named). */
export function isSpecOnly(fragment: string): boolean {
  const toks = tokenizeForSearch(align(fragment));
  if (toks.length === 0) return false;
  return toks.every((t) => isNumericToken(t) || SPEC_UNIT_WORDS.has(t) || QTY_MARKER_WORDS.has(t) || QUALIFIER_WORDS.has(t));
}

function lastWord(s: string): string {
  const w = normalizeFa(s).split(/[\s‌]+/).filter(Boolean);
  return w[w.length - 1] ?? '';
}
function firstWord(s: string): string {
  return normalizeFa(s).split(/[\s‌]+/).filter(Boolean)[0] ?? '';
}

/** First pass: cut at separators that are really separators. Each part remembers the separator before it. */
function cutAtSeparators(text: string, lex: Lexicon): { text: string; sep: string }[] {
  const parts: { text: string; sep: string }[] = [];
  let start = 0;
  let sepBefore = '';
  for (const m of text.matchAll(SEP)) {
    const idx = m.index ?? 0;
    const sep = m[0];
    const before = text[idx - 1] ?? '';
    const after = text[idx + sep.length] ?? '';
    if ((sep === ',' || sep === '،') && new RegExp(DIGIT).test(before) && new RegExp(DIGIT).test(after)) continue;
    if (sep === '+' && /[A-Za-z0-9\u06F0-\u06F9\u0660-\u0669]/.test(before) && /[A-Za-z0-9\u06F0-\u06F9\u0660-\u0669]/.test(after)) continue;
    if (/^\s+و\s+$/.test(sep)) {
      const leftWord = lastWord(text.slice(start, idx));
      const rightWord = firstWord(text.slice(idx + sep.length));
      if (lex.protectedPairs.has(`${leftWord} و ${rightWord}`)) continue;
      // «دو و نیم», «بیست و پنج», «۲ و نیم»: the « و » joins one number phrase
      if (joinsNumber(leftWord, rightWord)) continue;
    }
    parts.push({ text: text.slice(start, idx), sep: sepBefore });
    start = idx + sep.length;
    sepBefore = sep;
  }
  parts.push({ text: text.slice(start), sep: sepBefore });
  return parts;
}

/** Second pass: split «<thing> با <thing>» (a companion that itself names a known thing). */
function cutAtCompanions(part: string, lex: Lexicon): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of part.matchAll(COMPANION)) {
    const idx = m.index ?? 0;
    const left = part.slice(start, idx);
    const rightToks = tokenizeForSearch(align(part.slice(idx + m[0].length)));
    // optional leading quantity («با ۲ کاور»)
    const skip = rightToks[0] !== undefined && /^\d+$/.test(rightToks[0]) ? 1 : 0;
    if (hasHeadNoun(lex, tokenizeForSearch(align(left))) && startsWithHeadNoun(lex, rightToks, skip)) {
      out.push(left);
      start = idx + m[0].length;
    }
  }
  out.push(part.slice(start));
  return out;
}

export function splitSegments(text: string, lex: Lexicon): string[] {
  const first = cutAtSeparators(text, lex);
  // Merge spec-only fragments into the previous item (newlines are always hard boundaries only by SEP above,
  // so a spec-only line is still merged: «هارد\n۲ ترابایت» is one item).
  const merged: string[] = [];
  for (const { text: frag, sep } of first) {
    if (frag.trim() === '') continue;
    const prev = merged[merged.length - 1];
    if (prev !== undefined && PURE_NUMBER.test(frag) && TRAILING_NUMBER.test(prev)) {
      // «سیم برق ۲٫۵ و ۱٫۵»: a bare number after a number is the same request with another value
      merged.push(prev.replace(TRAILING_NUMBER, ' ' + frag.trim()).trim());
    } else if (prev !== undefined && isSpecOnly(frag)) {
      // keep «و» so the extractors still see «۸ گیگ رم و ۲۵۶ گیگ حافظه»
      merged[merged.length - 1] += (/^\s+و\s+$/.test(sep) ? ' و ' : ' ') + frag.trim();
    } else merged.push(frag.trim());
  }
  return merged.flatMap((p) => cutAtCompanions(p, lex)).map((s) => s.trim()).filter((s) => s !== '');
}
