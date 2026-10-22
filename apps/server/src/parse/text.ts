/**
 * Low-level text helpers for the parser.
 *
 * `align(raw)` is a LENGTH-PRESERVING light normalisation (digits -> Latin, Arabic letters -> Persian,
 * ZWNJ -> space, Latin lower-case). Because it never changes the length, a span found on the aligned string
 * is the same span in the user's original text, so phrases (quantity, budget, preference) can be cut out of
 * the text exactly as typed. The full `normalizeFa` (not length-preserving) is used for lookups.
 */

export const FA_LETTERS = '\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF';
/** Not preceded / followed by a Persian letter or a digit. */
export const LB = `(?<![${FA_LETTERS}0-9])`;
export const RB = `(?![${FA_LETTERS}0-9])`;

export function align(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍  ]/g, ' ')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export interface Span {
  start: number;
  end: number;
}

/** `raw` without the given spans, whitespace collapsed. */
export function cutSpans(raw: string, spans: Span[]): string {
  if (spans.length === 0) return raw.replace(/\s+/g, ' ').trim();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const s of sorted) {
    if (s.start < pos) continue; // overlapping span already removed
    out += raw.slice(pos, s.start) + ' ';
    pos = s.end;
  }
  out += raw.slice(pos);
  return out.replace(/\s+/g, ' ').trim();
}

/** Remove leading/trailing connector words and punctuation left over after cutting phrases out. */
export function trimConnectors(s: string): string {
  let out = s;
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/^[\s\-–—_/\\|:.,،؛;؟?!+*×()«»"'`]+/, '')
      .replace(/[\s\-–—_/\\|:.,،؛;؟?!+*×()«»"'`]+$/, '')
      .replace(new RegExp(`^(?:و|با|را|هم|برای|جهت|همچنین|لطفا|لطفاً|میخوام|می‌خوام|میخواهم|می‌خواهم|نیاز دارم|احتیاج دارم)${RB}\\s*`), '')
      .replace(new RegExp(`\\s*${LB}(?:و|با|را|هم|برای|که|از|به|تا|در)$`), '')
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Persian number words usable as quantities (1-20 plus compounds like «بیست و چهار» via parseFaNumberWords). */
export const QTY_WORDS = [
  'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'شیش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده',
  'چهارده', 'پانزده', 'پونزده', 'شانزده', 'شونزده', 'هفده', 'هجده', 'نوزده', 'بیست',
] as const;

/** Words that make a preceding number a SPEC (not a quantity): «۲ ترابایت», «۴ کانال», «۱۲ ولت»... */
export const SPEC_UNIT_WORDS: ReadonlySet<string> = new Set([
  'ترابایت', 'ترا', 'تیبی', 'گیگ', 'گیگابایت', 'گیگی', 'مگ', 'مگابایت', 'مگا', 'مگاپیکسل', 'مگاپیکسلی', 'پیکسل',
  'کانال', 'کاناله', 'کانالی', 'ولت', 'ولتی', 'آمپر', 'آمپری', 'وات', 'واتی', 'میلی', 'میلیمتر', 'میلیمتری',
  'سانت', 'سانتی', 'متری', 'اینچ', 'اینچی', 'هسته', 'هسته‌ای', 'رشته', 'رشته‌ای', 'رم', 'حافظه', 'درجه', 'مگاهرتز',
  'هرتز', 'کیلو', 'کیلوگرم', 'کیلویی', 'گرم', 'لیتر', 'میلیون', 'میلیونی', 'هزار', 'هزارتومان', 'تومان', 'تومن', 'ریال', 'میلیارد', 'در', 'ضرب',
  'mp', 'tb', 'gb', 'mb', 'ch', 'v', 'a', 'w', 'mm', 'k', 'x', 'ghz', 'mah', 'میلی‌آمپر', 'میلی‌متر',
]);

/** Words that make a preceding number a piece count: «۴ عدد», «۲ دستگاه», «۴ تا». */
export const QTY_MARKER_WORDS: ReadonlySet<string> = new Set(['عدد', 'تا', 'تایی', 'دستگاه', 'عددی', 'دست', 'جفت', 'ست', 'بسته', 'تکه', 'قطعه']);
