/**
 * Quantity and preference phrases, found on the length-preserving `align()` string.
 *
 * Quantity forms: «۴ دوربین», «4 عدد دوربین», «دوربین ۴ عدد», «×4», «4x», «چهار تا دوربین», «یک دوربین»,
 * «هزار متر», «دو هزار عدد» (thousands, only before a quantity unit), «یک دوجین» (x12), «۱۰۰۰ متر».
 * Lengths in metres may be fractional («یک و نیم متر», «نیم متر», «۲.۵ متر», «۴ متر و نیم»): `qty` is the whole number
 * rounded up, `exact` is the real length.
 * A number followed by a SPEC unit is never a quantity («۲ مگاپیکسل», «۴ کانال», «۱۲ ولت», «۲ ترابایت»).
 * Default quantity is 1 and `qtyStated` is false.
 */
import { DIGIT_AND_HALF, NUMBER_PHRASE, THOUSANDS_PHRASE, phraseValue, thousandsValue } from './numwords.js';
import { FA_LETTERS, QTY_MARKER_WORDS, SPEC_UNIT_WORDS, type Span } from './text.js';
import { MAX_QTY } from './types.js';

// Quantities may be digits («۴», «۲ و نیم») or Persian number words («چهار», «پنجاه», «دو و نیم», «صد و بیست»).
const WORD_NUM = NUMBER_PHRASE;
// digits: «1,000», a decimal («2.5», only meaningful before «متر»), up to 5 digits (above 999 only before a unit / marker)
const NUM = `(?:${DIGIT_AND_HALF}|\\d{1,3}(?:,\\d{3})+|\\d{1,5}[./]\\d{1,2}|\\d{1,5}|${WORD_NUM})`;
const L = FA_LETTERS;

export interface QuantityHit {
  qty: number;
  /** Sale unit implied by the quantity word: «۲ حلقه» -> roll, «۱۰۰ متر» -> meter. */
  unit?: 'roll' | 'meter';
  /** Exact length in metres when it is fractional (`qty` is then rounded up): «یک و نیم متر» -> 1.5. */
  exact?: number;
  spans: Span[];
}

const UNIT_MARKERS: Record<string, 'roll' | 'meter'> = { حلقه: 'roll', رول: 'roll', کلاف: 'roll', قرقره: 'roll', متر: 'meter' };

function numValue(tok: string): number | null {
  const t = tok.replace(/(?<=\d),(?=\d{3})/g, '').replace(/^(\d+)\/(\d+)$/, '$1.$2');
  return phraseValue(t);
}

const THOUSAND_QTY = new RegExp(
  `(?<![${L}0-9.,/])(${THOUSANDS_PHRASE})\\s*(متر|عدد|دستگاه|تایی|عددی|حلقه|رول|کلاف|قرقره|قطعه|بسته|جفت|دست|ست)(?![${L}])`,
);
const DOZEN_QTY = new RegExp(`(?<![${L}0-9.,/])(یه|${NUM})\\s+دوجین(?![${L}])`);

/** «هزار متر», «دو هزار و پانصد عدد» and «یک دوجین» (x12): number words the generic forms below cannot read. */
function bigOrDozenQuantity(a: string): QuantityHit | null {
  const th = THOUSAND_QTY.exec(a);
  if (th) {
    const qty = thousandsValue(th[1] ?? '');
    const unit = UNIT_MARKERS[th[2] ?? ''];
    if (qty !== null && qty >= 1 && qty <= MAX_QTY) {
      return { qty, ...(unit ? { unit } : {}), spans: [{ start: th.index ?? 0, end: (th.index ?? 0) + th[0].length }] };
    }
  }
  const dz = DOZEN_QTY.exec(a);
  if (dz) {
    const n = dz[1] === 'یه' ? 1 : numValue(dz[1] ?? '');
    const qty = n === null ? null : n * 12;
    if (qty !== null && Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY) return { qty, spans: [{ start: dz.index ?? 0, end: (dz.index ?? 0) + dz[0].length }] };
  }
  return null;
}

/**
 * The integer quantity for a parsed value: pieces must be whole; a length in metres may be fractional
 * («دو و نیم متر» -> 3, rounded up because qty is an integer). null = not usable as a quantity.
 */
function wholeQty(v: number | null, unit?: 'roll' | 'meter'): number | null {
  if (v === null) return null;
  if (Number.isInteger(v)) return v;
  return unit === 'meter' ? Math.ceil(v) : null;
}

function firstWord(s: string): string {
  const m = new RegExp(`^\\s*([${L}a-z0-9]+)`).exec(s);
  return m?.[1] ?? '';
}

export function extractQuantity(a: string): QuantityHit | null {
  // 0. «هزار متر», «دو هزار عدد», «یک دوجین»
  const big = bigOrDozenQuantity(a);
  if (big) return big;
  // 1. Leading number: «۴ دوربین داهوا», «چهار تا دوربین», «×4 دوربین»
  const lead = new RegExp(`^[\\s:\\-–]*(?:[x×*]\\s*)?(${NUM})(?![\\d.,/])\\s*(?:[x×*](?=\\s)\\s*)?`).exec(a);
  // «4xvr1b04» style glued Latin right after the number is a model code, not a quantity
  if (lead && !(!/\s$/.test(lead[0]) && /^[a-z]/.test(a.slice(lead[0].length)))) {
    const rest = a.slice(lead[0].length);
    const w = firstWord(rest);
    let raw = numValue(lead[1] ?? '');
    const unit = UNIT_MARKERS[w];
    // «۴ متر و نیم» = 4.5 m
    const halfAfter = unit === 'meter' && raw !== null ? new RegExp(`^\\s+و\\s+نیم(?![${L}])`).exec(rest.slice(rest.indexOf(w) + w.length)) : null;
    if (halfAfter && raw !== null) raw += 0.5;
    const qty = wholeQty(raw, unit);
    const isWordNum = !/^\d/.test(lead[1] ?? '');
    // a number word must be a separate word («دو» in «دوربین» never reaches here: regex needs a non-letter after)
    const separated = !isWordNum || /\s|[x×*]/.test(a[lead[0].length - 1] ?? '') || rest === '';
    // «سی» is also the Persian letter name in «سی سی تی وی»: it is a quantity only before a marker or sale unit
    const ambiguousWord = lead[1] === 'سی' && !QTY_MARKER_WORDS.has(w) && !unit;
    if (qty !== null && qty >= 1 && qty <= MAX_QTY && separated && w !== '' && !ambiguousWord) {
      if (QTY_MARKER_WORDS.has(w)) {
        const after = rest.slice(rest.indexOf(w) + w.length);
        if (!(w === 'تا' && new RegExp(`^\\s*(?:\\d|${WORD_NUM}${`(?![${L}])`})`).test(after))) {
          return { qty, spans: [{ start: 0, end: lead[0].length + rest.indexOf(w) + w.length }] };
        }
      } else if (unit) {
        const end = lead[0].length + rest.indexOf(w) + w.length + (halfAfter ? halfAfter[0].length : 0);
        return { qty, unit, ...(unit === 'meter' && raw !== null && !Number.isInteger(raw) ? { exact: raw } : {}), spans: [{ start: 0, end }] };
      } else if (qty <= 999 && !SPEC_UNIT_WORDS.has(w) && !/^\d/.test(w)) {
        return { qty, spans: [{ start: 0, end: lead[0].length }] };
      }
    }
  }
  // 2. Marker anywhere: «دوربین ۴ عدد داهوا», «هارد ۲ دستگاه», «۴ تا»
  const marker = new RegExp(`(?<![${L}0-9.,/])(${NUM})\\s*(عدد|دستگاه|تایی|عددی|دست|جفت|ست)(?![${L}])`, 'g');
  // «پکیج دوربین ۴ تایی» is a 4-camera kit, not four kits
  const kit = new RegExp(`(?<![${L}])(?:پکیج|پک|کیت|ست)(?![${L}])`).test(a);
  for (const m of a.matchAll(marker)) {
    if (kit && m[2] === 'تایی') continue;
    const qty = wholeQty(numValue(m[1] ?? ''));
    if (qty !== null && qty >= 1 && qty <= MAX_QTY) return { qty, spans: [{ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }] };
  }
  const taa = new RegExp(`(?<![${L}0-9.,/])(${NUM})\\s+تا(?![${L}])(?!\\s*(?:\\d|${WORD_NUM}(?![${L}])))`, 'g');
  for (const m of a.matchAll(taa)) {
    const qty = wholeQty(numValue(m[1] ?? ''));
    if (qty !== null && qty >= 1 && qty <= 999) return { qty, spans: [{ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }] };
  }
  // 3. ×4 / 4x as a separate token
  const times = /(?:^|\s)[x×*]\s*(\d{1,3})(?![\d.,/a-z])|(?<![\w.,/×*x])(\d{1,3})\s*[x×](?=\s|$)/.exec(a);
  if (times) {
    const qty = Number(times[1] ?? times[2]);
    if (qty >= 1 && qty <= 999) {
      const start = (times.index ?? 0) + (/^\s/.test(times[0]) ? 1 : 0);
      return { qty, spans: [{ start, end: (times.index ?? 0) + times[0].length }] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------

export type Preference = 'cheapest' | 'fewest_stops';

const SHOP_WORD = `(?:\\s+(?:مغازه|فروشگاه|فروشنده)(?:\\s*ها)?)?`;
const CHEAPEST_RE = new RegExp(
  `(?<![${L}])(?:ارزان(?:\\s*ترین)?|ارزون(?:\\s*ترین)?|کم\\s*هزینه(?:\\s*ترین)?|کمترین\\s+قیمت|اقتصادی(?:\\s*ترین)?)(?![${L}])`,
);
const FEWEST_RE = new RegExp(
  `(?<![${L}])(?:(?:مغازه|فروشگاه|جای)\\s+)?(?:نزدیک(?:\\s*ترین)?${SHOP_WORD}|کم\\s*توقف|کمترین\\s+(?:توقف|تعداد\\s+توقف)|یک\\s*جا|همه\\s+(?:رو\\s+|را\\s+)?از\\s+یک\\s+(?:مغازه|فروشگاه|جا))(?![${L}])`,
);

export interface PreferenceHit {
  preference: Preference;
  /** position of the match in the segment, to find the first-mentioned one across segments */
  index: number;
  spans: Span[];
}

/** All preference phrases in the segment (budget spans must be masked out by the caller first). */
export function extractPreferences(a: string): PreferenceHit[] {
  const out: PreferenceHit[] = [];
  for (const [re, preference] of [[CHEAPEST_RE, 'cheapest'], [FEWEST_RE, 'fewest_stops']] as const) {
    const g = new RegExp(re.source, 'g');
    for (const m of a.matchAll(g)) out.push({ preference, index: m.index ?? 0, spans: [{ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }] });
  }
  return out.sort((x, y) => x.index - y.index);
}
