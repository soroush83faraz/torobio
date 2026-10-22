import { FA_ORDINAL_WORDS, normalizeFa, parseFaNumberWords } from '@app/core';

/**
 * Address parsing: mall (پاساژ/مجتمع/ساختمان/بازار/مرکز تجاری/سرای...), floor
 * and unit. Only what is clearly stated is returned; everything else is null.
 */

export interface ParsedAddress {
  /** mall/building name as written (prefix word included), display text */
  mallRaw: string | null;
  /** folded name used for keys (no type word, no spaces/hamza variants) */
  mallFold: string | null;
  /** canonical floor: integer as string ("-2", "-1", "0", "1", ...) or "M" (mezzanine) */
  floor: string | null;
  /** unit / shop number as written (Latin digits), e.g. "62", "A41", "39 و 40" */
  unit: string | null;
}

const TYPE_WORDS = [
  'مجتمع تجاری و اداری',
  'مجتمع تجاری اداری',
  'مجتمع اداری تجاری',
  'مجتمع تجاری',
  'مجتمع',
  'مرکز تجاری',
  'مرکز خرید',
  'پاساژ',
  'ساختمان',
  'بازارچه',
  'بازار',
  'تیمچه',
  'برج',
  'گالری',
];

const SEP_RE = /[،,؛;\n]|(?<=\S)\s[-–]\s(?=\S)/;

/** Generic address words that mean the segment is a street/location, not a mall name. */
const NOT_MALL_AFTER = /^(?:روبرو|روبروی|جنب|نبش|کنار|پشت|بعد|قبل|نرسیده|بین|داخل|پلاک|طبقه|واحد)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/;
/** Location words that cut a mall segment («پاساژ چارسو طبقه 4» written without commas). */
const CUT_RE = /\s(?:طبقه|طبقات|همکف|زیرهمکف|زیر همکف|زیرزمین|منفی|واحد|پلاک|غرفه|مغازه|شماره|ورودی|راهرو|بلوک|ط\.|کد پستی)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/;

/** Fold a mall name for keys: remove type word, spaces, ZWNJ, hamza forms; Latin digits. */
export function foldMallName(name: string): string {
  let s = normalizeFa(name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of TYPE_WORDS) {
      if (s.startsWith(`${w} `)) {
        s = s.slice(w.length + 1);
        changed = true;
      }
    }
  }
  // trailing number words: «علاالدین دو» == «علاالدین 2»
  const NUMW: Record<string, number> = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5 };
  s = s.replace(/\s(یک|دو|سه|چهار|پنج)$/, (_m, w: string) => ` ${NUMW[w]}`);
  return s
    .replace(/[\u200C\s\-_.()«»"']/g, '')
    .replace(/[ءئأإؤ]/g, '')
    .replace(/آ/g, 'ا');
}

function parseFloorValue(raw: string): string | null {
  const s = normalizeFa(raw).replace(/^[:\s-]+/, '').trim();
  if (/^(?:همکف|هم کف)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(s)) return '0';
  if (/^(?:زیر ?همکف|زیر ?هم کف|زیرزمین|زیر زمین)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(s)) return '-1';
  if (/^(?:نیم ?طبقه|بالای همکف|میان ?طبقه|نیمطبقه)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(s)) return 'M';
  let m = s.match(/^منفی\s*(\d{1,2}|[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF]+)/);
  if (m) {
    const v = /^\d+$/.test(m[1] as string) ? Number(m[1]) : parseFaNumberWords(m[1] as string);
    return v != null && v >= 1 && v <= 6 ? String(-v) : null;
  }
  m = s.match(/^-\s?(\d)(?!\d)/) ?? s.match(/^(\d)\s?-(?!\d)/);
  if (m) return String(-Number(m[1]));
  m = s.match(/^(\d{1,2})(?![\d./])/);
  if (m) {
    const v = Number(m[1]);
    return v <= 40 ? String(v) : null;
  }
  m = s.match(/^([\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF]+)/);
  if (m) {
    const w = m[1] as string;
    const ord = FA_ORDINAL_WORDS[w];
    if (ord != null) return String(ord);
    const card = parseFaNumberWords(w);
    if (card != null && card <= 40) return String(card);
  }
  return null;
}

export function parseFloor(addr: string): string | null {
  const a = normalizeFa(addr).replace(/\u200C/g, ' ');
  const vals = new Set<string>();
  for (const m of a.matchAll(/(?<![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])طبقه(?:\s*ی|\s*:)?\s*([^،,]{1,20})/g)) {
    const v = parseFloorValue(m[1] as string);
    if (v != null) vals.add(v);
  }
  // «همکف» / «زیرهمکف» / «منفی ۱» without the word طبقه
  if (vals.size === 0) {
    for (const m of a.matchAll(/(?:^|[،,]\s*)((?:زیر ?)?همکف|زیرزمین|زیر زمین|منفی\s*[^\s،,]+)(?=\s*(?:[،,]|$|\d))/g)) {
      const v = parseFloorValue(m[1] as string);
      if (v != null) vals.add(v);
    }
  }
  return vals.size === 1 ? ([...vals][0] as string) : null;
}

export function parseUnit(addr: string, hasPlace: boolean): string | null {
  const a = normalizeFa(addr).replace(/\u200C/g, ' ');
  const pick = (re: RegExp): string | null => {
    const ms = [...a.matchAll(re)].map((m) => (m[1] as string).trim().replace(/\s+/g, ' ').toUpperCase());
    const u = [...new Set(ms)];
    return u.length === 1 ? (u[0] as string) : null;
  };
  const unitRe = /(?<![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])(?:واحد|غرفه|مغازه)\s*:?\s*(?:شماره\s*)?([a-z]?\d{1,5}(?:\s*[/.-]\s*\d{1,4})?(?:\s*و\s*\d{1,5})?[a-z]?)(?![\d\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g;
  const u = pick(unitRe);
  if (u) return u;
  const bare = a.match(/(?:^|[،,]\s*)(?:(?:زیر ?)?همکف|زیرزمین|زیر زمین)\s+([a-z]?\d{1,5}[a-z]?)(?=\s*(?:[،,]|$))/);
  if (bare) return (bare[1] as string).toUpperCase();
  if (!hasPlace) return null;
  // inside a mall/floor, «پلاک ۴۵» / «شماره ۳۹» is the shop number
  const plRe = /(?<![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])(?:پلاک|شماره)\s*:?\s*([a-z]?\d{1,5}(?:\s*[/.-]\s*\d{1,4})?(?:\s*و\s*\d{1,5})?[a-z]?)(?![\d\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g;
  // only plaques that appear after the mall/floor mention
  const idx = a.search(/پاساژ|مجتمع|ساختمان|بازار|مرکز تجار|مرکز خرید|سرای|طبقه|همکف/);
  if (idx < 0) return null;
  const tail = a.slice(idx);
  const ms = [...tail.matchAll(plRe)].map((m) => (m[1] as string).trim().replace(/\s+/g, ' ').toUpperCase());
  const uu = [...new Set(ms)];
  return uu.length === 1 ? (uu[0] as string) : null;
}

export function parseMall(addr: string): { raw: string; fold: string } | null {
  const a = normalizeFa(addr);
  const segs = a.split(SEP_RE).map((s) => s.trim()).filter(Boolean);
  const found: Array<{ raw: string; fold: string; inside?: boolean }> = [];
  for (const seg0 of segs) {
    // the type word may be preceded by a location word: «جنب پاساژ X» is NOT this shop's mall
    const seg1 = seg0.replace(/(?<=(?:^|\s)پاساژ)(?=[\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/, ' ');
    const m = seg1.match(new RegExp(`(?:^|\\s)(${TYPE_WORDS.join('|')})\\s+(\\S.*)$`));
    if (!m) continue;
    const pre = seg1.slice(0, m.index ?? 0).trim();
    const hasDetail = CUT_RE.test((m[2] as string) ?? '');
    if (pre && /(?:^|\s)(?:روبرو|روبروی|روبه رو|روبه روی|رو به رو|رو به روی|روبرو ی|جنب|نبش|کنار|پشت|بعد از|قبل از|نرسیده به|بین|انتهای|ابتدای|مقابل|نزدیک|سمت|حد فاصل)$/.test(pre)) continue;
    if (pre && !/(?:^|\s)(?:داخل|درون|در)$/.test(pre)) {
      // «خیابان X پاساژ Y» : only accept when the prefix is a plain street phrase
      if (!/^(?:خیابان|خ\.|کوچه|تقاطع|چهارراه|میدان)\s/.test(pre) && pre.split(/\s+/).length > 3 && !hasDetail) continue;
    }
    let rest = (m[2] as string).trim();
    if (NOT_MALL_AFTER.test(rest)) continue;
    const cut = rest.search(CUT_RE);
    if (cut > 0) rest = rest.slice(0, cut).trim();
    rest = rest.replace(/[)(\]\[]+$/g, '').trim();
    const raw = `${m[1]} ${rest}`.trim();
    const fold = foldMallName(raw);
    if (fold.length < 2 || /^\d+$/.test(fold) && fold.length < 2) continue;
    found.push({ raw, fold, inside: /(?:^|\s)(?:داخل|درون)$/.test(pre) });
  }
  if (found.length === 0) return null;
  // «داخل پاساژ X» is explicit about the shop's own mall
  const inside = found.find((f) => f.inside);
  if (inside) return { raw: inside.raw, fold: inside.fold };
  // «بازار» alone is a whole district; prefer a more specific mall segment
  const specific = found.filter((f) => !/^بازار(?:بزرگ|تهران|بزرگتهران)?$/.test(f.fold));
  const pick = specific[0] ?? null;
  if (!pick) return null;
  if (/^بازار(?:بزرگ|تهران|بزرگتهران)?$/.test(pick.fold)) return null;
  return pick;
}

export function parseAddress(address: string | null | undefined): ParsedAddress {
  if (!address) return { mallRaw: null, mallFold: null, floor: null, unit: null };
  const mall = parseMall(address);
  const floor = parseFloor(address);
  // without a parsed mall, «پلاک» is the building's street number, not the shop's unit
  const unit = parseUnit(address, mall != null);
  return { mallRaw: mall?.raw ?? null, mallFold: mall?.fold ?? null, floor, unit };
}
