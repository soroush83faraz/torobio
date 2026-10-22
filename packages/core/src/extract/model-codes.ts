import { normalizeModelCode, toLatinDigits } from '../normalize/index';

/**
 * Tokens that look like letter+digit codes but are units or technology names,
 * not product model codes.
 */
const UNIT_SEG = /^(?:\d+(?:[.,]\d+)?(?:mp|mpx|v|vac|vdc|a|ma|mah|w|kw|kva|va|tb|gb|mb|kb|mm|cm|m|km|k|p|g|ch|hz|khz|mhz|ghz|kg|gr|x|in|inch|db|fps|l|lit|mil|ml|nm|ah|pin|port|rpm|s|th|nd|rd|st|bit|w\+|tbw)|\d+(?:[.,]\d+)?[x*]\d+(?:[.,]\d+)?(?:mm|cm|m)?|(?:ip|ik)\d{2}|h\.?26[45]\+?|usb\d(?:\.\d)?|cat\d[a-z]?|rj\d{2}|ddr\d|lpddr\d[a-z]?|m\.?2|pcie\d?|sata\d?|wifi\d|wi-fi\d|bt\d(?:\.\d)?|lte|[2345]g|1080[pi]?|720p|4k|8k|2k|3k|5k|uhs\d|u\d|v\d{2}|a\d|c\d{1,2}|x\d{1,2}|e\d{2})$/i;

/** Latin runs that may be model codes: letters/digits joined by - / . _ */
const CANDIDATE_RE = /[A-Za-z0-9][A-Za-z0-9\-_/.+]*[A-Za-z0-9+]|[A-Za-z0-9]/g;

/** Vendor prefixes that sellers often drop (Dahua «DH-»/«DHI-»). */
const DROPPABLE_PREFIX = /^(?:DHI|DH)(?=[A-Z])/;

function isCodeSegmented(raw: string): boolean {
  const segs = raw.split(/[-_/.]/).filter(Boolean);
  if (segs.length === 0) return false;
  // every segment is a unit/tech token -> not a model code (e.g. «12V-2A», «2.8-12mm»)
  if (segs.every((s) => UNIT_SEG.test(s) || /^\d+$/.test(s))) return false;
  return true;
}

export interface ModelCode {
  /** normalised primary code (A-Z0-9 only) */
  code: string;
  /** alternative normalised forms sellers also use (no vendor prefix, main segment) */
  variants: string[];
  /** original text as found */
  raw: string;
}

/**
 * Extract letter+digit model codes (XVR1B04-I, DH-HAC-HDW1200CLQP, LC1D95AM7,
 * DS-2CD1021G0-I, WD10PURZ, ST2000VX015, SM-A566) from a title.
 * A code must contain a Latin letter and a digit, be 4-30 characters after
 * normalisation, and not consist only of unit/technology tokens.
 */
export function extractModelCodes(title: string | null | undefined): ModelCode[] {
  if (!title) return [];
  const text = toLatinDigits(title);
  const out: ModelCode[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CANDIDATE_RE)) {
    let raw = m[0];
    // a code is never only lower-case letters followed by digits glued to Persian text
    raw = raw.replace(/^[-_/.]+|[-_/.]+$/g, '');
    if (!/[A-Za-z]/.test(raw) || !/[0-9]/.test(raw)) continue;
    const code = normalizeModelCode(raw);
    if (code.length < 4 || code.length > 30) continue;
    if (!isCodeSegmented(raw)) continue;
    // pure "<number><unit>" or "<unit><number>" glued, e.g. 5MP, MP5
    if (UNIT_SEG.test(raw)) continue;
    // a word followed by a year (e.g. «Pro2024») is still a code; plain words without digits are excluded above
    if (seen.has(code)) continue;
    seen.add(code);
    const variants = new Set<string>();
    const noPrefix = code.replace(DROPPABLE_PREFIX, '');
    if (noPrefix !== code && noPrefix.length >= 4) variants.add(noPrefix);
    const segs = raw.split(/[-_/.]/).filter(Boolean);
    if (segs.length > 1) {
      const main = segs.find((s) => /[A-Za-z]/.test(s) && /[0-9]/.test(s) && !UNIT_SEG.test(s));
      if (main) {
        const mainNorm = normalizeModelCode(main);
        if (mainNorm.length >= 5 && mainNorm !== code) variants.add(mainNorm);
      }
    }
    out.push({ code, variants: [...variants].filter((v) => v !== code), raw });
  }
  return out;
}

/** Flat list: primary codes first, then variants, de-duplicated. */
export function modelCodeKeys(codes: ModelCode[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) if (!seen.has(c.code)) { seen.add(c.code); out.push(c.code); }
  for (const c of codes) for (const v of c.variants) if (!seen.has(v)) { seen.add(v); out.push(v); }
  return out;
}
