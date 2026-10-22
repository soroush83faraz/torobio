/**
 * Budget phrases («زیر ۵ میلیون», «تا ۳ میلیون», «حدود ۲ میلیون», «بودجه ۸ میلیون», «بین ۲ تا ۳ میلیون»).
 *
 * Works on the length-preserving `align()` string and returns the spans to cut from the user's text.
 *
 * Semantics (all amounts in TOMAN, `Budget` bounds are INCLUSIVE and PER UNIT):
 *  - upper words  (زیر, کمتر از, تا, حداکثر, نهایتا, سقف, بودجه)  -> { max }        «تا ۳ میلیون» -> max 3,000,000
 *  - lower words  (بالای, بیشتر از, حداقل)                         -> { min }
 *  - approx words (حدود, نزدیک, تقریبا, around) or a bare amount  -> { min: 0.8x, max: 1.2x }
 *  - ranges       (بین ۲ تا ۳ میلیون, ۲ میلیون تا ۳ میلیون)        -> { min, max }
 *  - "total" words (جمعا, در مجموع, کلا, روی هم)  mark the amount as the budget of the WHOLE item line; the caller
 *    divides it by the quantity to get the per-unit band. Without such a word the amount is per unit
 *    («۴ دوربین زیر ۵ میلیون» = each camera at most 5M).
 *  - A bare «۲۰ هزار» (no currency, no keyword) is NOT a budget: «پاوربانک ۲۰ هزار» means 20,000 mAh.
 */
import type { Budget } from '@app/core';
import { FA_NUMBER_WORDS, parseFaNumberWords } from '@app/core';
import { FA_LETTERS, type Span } from './text.js';

/** Hundreds are only needed for amounts: «دو میلیون و پانصد هزار». */
export const HUNDREDS: Record<string, number> = { صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900 };
const WORD_ALT = [...Object.keys(FA_NUMBER_WORDS), ...Object.keys(HUNDREDS)]
  .filter((w, i, all) => all.indexOf(w) === i)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WORD_NUM = `(?:${WORD_ALT})(?:\\s+و\\s+(?:${WORD_ALT}))*`;
const NUMBER = `(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:[./]\\d+)?|${WORD_NUM})`;
const MAGN = '(?:میلیارد|میلیون|هزار)';
const CUR = '(?:تومان|تومن|ریال)';
const NB = `(?<![${FA_LETTERS}0-9.,/])`; // number must not be glued to a letter or another number
const NA = `(?![${FA_LETTERS}0-9])`;

// number, optional magnitude, optional «و <number> هزار», optional currency
const AMOUNT_SRC = `${NB}(${NUMBER})\\s*(${MAGN})?(?:ی${NA})?(?:\\s+و\\s+(${NUMBER})\\s*(هزار))?(?:\\s*(${CUR}))?${NA}`;

const UPPER_KW = /(?:زیر|کمتر\s+از|کمتر|حداکثر|حد\s*اکثر|نهایتا|نهایت|سقف|ماکزیمم|تا|بودجه(?:\s+(?:ام|من|م))?(?:\s+(?:تا|زیر))?|قیمت\s+تا|نه\s+بیشتر\s+از)\s*$/;
const LOWER_KW = /(?:بالای|بیشتر\s+از|بیش\s+از|حداقل|حد\s*اقل|از)\s*$/;
const APPROX_KW = /(?:حدود|در\s+حدود|حدودا|نزدیک(?:\s+به)?|تقریبا|حوالی|اطراف|یه\s+چیزی\s+تو\s+حدود)\s*$/;
const BUDGET_APPROX_KW = /بودجه(?:\s+(?:ام|من|م))?\s+(?:حدود|در\s+حدود|حدودا|تقریبا)\s*$/;
const TOTAL_KW = new RegExp(`(?<![${FA_LETTERS}])(?:جمعا|مجموعا|در\\s+مجموع|کلا|روی\\s+هم|در\\s+کل)\\s*(?:\\S+\\s*){0,2}$`);

export interface BudgetHit {
  budget: Budget;
  /** true: the amount is for the whole line (divide by qty). */
  total: boolean;
  spans: Span[];
}

function toNumber(tok: string): number | null {
  if (/^\d{1,3}(?:,\d{3})+$/.test(tok)) return Number(tok.replace(/,/g, ''));
  if (/^\d+(?:[./]\d+)?$/.test(tok)) return Number(tok.replace('/', '.'));
  const words = tok.split(/\s+و\s+|\s+/).filter(Boolean);
  const hundreds = words.filter((w) => w in HUNDREDS);
  if (hundreds.length === 0) return parseFaNumberWords(tok);
  const rest = words.filter((w) => !(w in HUNDREDS));
  const restValue = rest.length ? parseFaNumberWords(rest.join(' ')) : 0;
  return restValue === null ? null : restValue + hundreds.reduce((a, w) => a + (HUNDREDS[w] ?? 0), 0);
}

const MULT: Record<string, number> = { میلیارد: 1e9, میلیون: 1e6, هزار: 1e3 };

interface Amount {
  start: number;
  end: number;
  value: number;
  hasMagnitude: boolean;
  hasCurrency: boolean;
  /** «۲۰ هزار» style: magnitude "thousand" alone. */
  thousandOnly: boolean;
}

function findAmounts(a: string): Amount[] {
  const out: Amount[] = [];
  for (const m of a.matchAll(new RegExp(AMOUNT_SRC, 'g'))) {
    const [full, numTok = '', magn, num2, magn2, cur] = m;
    const hasMagnitude = !!magn;
    const hasCurrency = !!cur;
    if (!hasMagnitude && !hasCurrency) continue; // bare number: a spec, not money
    const base = toNumber(numTok);
    if (base === null) continue;
    let value = base * (magn ? (MULT[magn] ?? 1) : 1);
    if (num2 && magn2) {
      const extra = toNumber(num2);
      if (extra !== null) value += extra * 1e3;
    }
    if (cur === 'ریال') value /= 10;
    value = Math.round(value);
    if (!(value >= 1000)) continue;
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + full.length, value, hasMagnitude, hasCurrency, thousandOnly: magn === 'هزار' && !num2 });
  }
  return out;
}

export function extractBudget(a: string): BudgetHit | null {
  const amounts = findAmounts(a);
  if (amounts.length === 0) return null;

  // Range: «بین ۲ تا ۳ میلیون» / «۲ میلیون تا ۳ میلیون» / «از ۲ تا ۳ میلیون»
  const rangeRe = new RegExp(`(?:(?:بین|از)\\s+)?(${NUMBER})\\s*(${MAGN})?\\s*(?:تا|الی|-|–|لغایت)\\s*(${NUMBER})\\s*(${MAGN})(?:\\s*${CUR})?${NA}`);
  const rm = rangeRe.exec(a);
  if (rm) {
    const lo = toNumber(rm[1] ?? '');
    const hi = toNumber(rm[3] ?? '');
    const magnHi = MULT[rm[4] ?? ''] ?? 1;
    const magnLo = rm[2] ? (MULT[rm[2]] ?? 1) : magnHi;
    if (lo !== null && hi !== null) {
      const min = Math.round(lo * magnLo);
      const max = Math.round(hi * magnHi);
      if (min >= 1000 && max >= min) {
        const start = rm.index;
        return { budget: { min, max }, total: TOTAL_KW.test(a.slice(Math.max(0, start - 20), start)), spans: [{ start, end: start + rm[0].length }] };
      }
    }
  }

  // Single amount: take the first one that qualifies.
  for (const am of amounts) {
    const before = a.slice(Math.max(0, am.start - 28), am.start);
    const upper = UPPER_KW.exec(before);
    const lower = !upper ? LOWER_KW.exec(before) : null;
    const approx = !upper && !lower ? APPROX_KW.exec(before) : null;
    const bApprox = BUDGET_APPROX_KW.exec(before);
    const kw = bApprox ?? upper ?? lower ?? approx;
    // A bare thousand-amount without currency or keyword is a spec (mAh etc.), and so is any word-only phrase.
    if (!kw && am.thousandOnly && !am.hasCurrency) continue;
    const start = kw ? am.start - kw[0].length : am.start;
    const totalM = TOTAL_KW.exec(a.slice(Math.max(0, start - 24), start));
    const spanStart = totalM ? start - totalM[0].length : start;
    let budget: Budget;
    if (bApprox || approx || !kw) budget = { min: Math.round(am.value * 0.8), max: Math.round(am.value * 1.2) };
    else if (lower) budget = { min: am.value };
    else budget = { max: am.value };
    return { budget, total: !!totalM, spans: [{ start: spanStart, end: am.end }] };
  }
  return null;
}

/** Per-unit band for a "total" budget over `qty` units. */
export function perUnit(b: Budget, qty: number): Budget {
  if (qty <= 1) return b;
  const out: Budget = {};
  if (b.min !== undefined) out.min = Math.ceil(b.min / qty);
  if (b.max !== undefined) out.max = Math.floor(b.max / qty);
  return out;
}
