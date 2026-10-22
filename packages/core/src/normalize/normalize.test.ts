import { describe, expect, it } from 'vitest';
import { buildFtsQuery, normalizeFa, normalizeModelCode, parseFaNumberPhrase, parseFaNumberWords, sanitizeDeep, sanitizeText, toFtsText, toLatinDigits, toPersianDigits, tokenizeForSearch } from './index';

describe('normalizeFa', () => {
  it('unifies Arabic letters and digits', () => {
    expect(normalizeFa('كابل مسي ٢٥')).toBe('کابل مسی 25');
    expect(normalizeFa('دوربين ۴ مگاپيكسل')).toBe('دوربین 4 مگاپیکسل');
    expect(normalizeFa('خانۀ')).toBe('خانه');
  });
  it('lower-cases Latin, collapses whitespace and strips bidi marks', () => {
    expect(normalizeFa('  Dahua‏   XVR1B04-I \n ')).toBe('dahua xvr1b04-i');
  });
  it('unifies ZWNJ variants and drops ZWNJ next to spaces', () => {
    expect(normalizeFa('دوربین‍های')).toBe('دوربین‌های');
    expect(normalizeFa('دوربین‌‌ها')).toBe('دوربین‌ها');
    expect(normalizeFa('دوربین ‌ ها')).toBe('دوربین ها');
    expect(normalizeFa('‌سلام‌')).toBe('سلام');
  });
  it('removes diacritics and tatweel but keeps آ', () => {
    expect(normalizeFa('مُحـــمّد آب')).toBe('محمد آب');
  });
  it('converts the Arabic decimal separator', () => {
    expect(normalizeFa('۱٫۵')).toBe('1.5');
  });
  it('handles null', () => {
    expect(normalizeFa(null)).toBe('');
  });
});

describe('digits', () => {
  it('converts both ways', () => {
    expect(toPersianDigits('12 ولت')).toBe('۱۲ ولت');
    expect(toPersianDigits(2026)).toBe('۲۰۲۶');
    expect(toLatinDigits('۱۲ و ٣')).toBe('12 و 3');
  });
});

describe('tokenizeForSearch', () => {
  it('splits ZWNJ and Persian-digit boundaries, keeps Latin codes whole', () => {
    expect(tokenizeForSearch('دوربین‌های ۴کانال XVR1B04-I')).toEqual(['دوربین', 'های', '4', 'کانال', 'xvr1b04', 'i']);
  });
  it('drops stop-words on request', () => {
    expect(tokenizeForSearch('قاب مناسب برای گوشی', { dropStopwords: true })).toEqual(['قاب', 'گوشی']);
  });
  it('index text equals joined tokens', () => {
    expect(toFtsText('هارد ۲ ترابایت', 'WD20PURZ')).toBe('هارد 2 ترابایت wd20purz');
  });
});

describe('buildFtsQuery', () => {
  it('quotes every token and prefixes the last', () => {
    expect(buildFtsQuery('دوربین داهوا')).toBe('"دوربین" "داهوا"*');
  });
  it('cannot inject FTS operators', () => {
    const q = buildFtsQuery('a" OR b NEAR(c) col:x *');
    expect(q).toBe('"a" "or" "b" "near" "c" "col" "x"*');
  });
  it('supports OR mode and no prefix', () => {
    expect(buildFtsQuery('قاب گلس', { mode: 'or', prefixLast: false })).toBe('"قاب" OR "گلس"');
  });
  it('returns empty for punctuation-only input', () => {
    expect(buildFtsQuery(' ؟!، ')).toBe('');
  });
});

describe('normalizeModelCode', () => {
  it('upper-cases and removes separators', () => {
    expect(normalizeModelCode('XVR1B04-I')).toBe('XVR1B04I');
    expect(normalizeModelCode('dh-hac-hdw1200clqp')).toBe('DHHACHDW1200CLQP');
    expect(normalizeModelCode('LC1D95 AM7')).toBe('LC1D95AM7');
    expect(normalizeModelCode('۱۲۳-ab')).toBe('123AB');
  });
});

describe('parseFaNumberWords', () => {
  it('parses compound numbers', () => {
    expect(parseFaNumberWords('سی و شش')).toBe(36);
    expect(parseFaNumberWords('ده')).toBe(10);
    expect(parseFaNumberWords('کانال')).toBeNull();
  });
});

describe('parseFaNumberPhrase', () => {
  it('reads tens, hundreds and the «و» compounds in descending order', () => {
    expect(parseFaNumberPhrase('پنجاه')).toBe(50);
    expect(parseFaNumberPhrase('بیست و پنج')).toBe(25);
    expect(parseFaNumberPhrase('صد و بیست و پنج')).toBe(125);
    expect(parseFaNumberPhrase('دویست')).toBe(200);
    expect(parseFaNumberPhrase('سیصد و پنجاه')).toBe(350);
  });
  it('reads «نیم» as one half', () => {
    expect(parseFaNumberPhrase('دو و نیم')).toBe(2.5);
    expect(parseFaNumberPhrase('یک و نیم')).toBe(1.5);
    expect(parseFaNumberPhrase('بیست و دو و نیم')).toBe(22.5);
    expect(parseFaNumberPhrase('نیم')).toBe(0.5);
    expect(parseFaNumberPhrase('دو  و  نیم')).toBe(2.5);
  });
  it('reads simple fractions', () => {
    expect(parseFaNumberPhrase('سه چهارم')).toBe(0.75);
    expect(parseFaNumberPhrase('یک دوم')).toBe(0.5);
    expect(parseFaNumberPhrase('چهار دوم')).toBeNull();
  });
  it('rejects anything that is not a well-formed number phrase', () => {
    for (const bad of ['', 'دوربین', 'دو و سه', 'پنج و بیست', 'نیم و دو', 'دو و', 'و دو', 'دو سه']) {
      expect(parseFaNumberPhrase(bad), bad).toBeNull();
    }
  });
  it('is spelling tolerant (Arabic yeh, ZWNJ)', () => {
    expect(parseFaNumberPhrase('دو و نيم')).toBe(2.5);
    expect(parseFaNumberPhrase('پنجاه')).toBe(50);
  });
});

describe('sanitizeText', () => {
  const RLO = String.fromCodePoint(0x202e);
  const LRI = String.fromCodePoint(0x2066);
  const PDI = String.fromCodePoint(0x2069);
  const LRM = String.fromCodePoint(0x200e);
  const ZWSP = String.fromCodePoint(0x200b);
  const ZWNJ_ = String.fromCodePoint(0x200c);
  const ZWJ = String.fromCodePoint(0x200d);
  it('removes bidi overrides, isolates and direction marks', () => {
    expect(sanitizeText(`دوربین ${RLO}داهوا`)).toBe('دوربین داهوا');
    expect(sanitizeText(`${LRI}سیم${PDI} برق${LRM}`)).toBe('سیم برق');
    expect(sanitizeText(`a${String.fromCodePoint(0x202a)}b${String.fromCodePoint(0x202b)}c${String.fromCodePoint(0x202c)}d${String.fromCodePoint(0x202d)}e`)).toBe('abcde');
  });
  it('removes control characters (as a space), BOM, zero-width space, soft hyphen and tag characters', () => {
    expect(sanitizeText(`هارد${String.fromCodePoint(0)}دوربین`)).toBe('هارد دوربین');
    expect(sanitizeText(`${String.fromCodePoint(0xfeff)}هارد${ZWSP}${String.fromCodePoint(0xad)}`)).toBe('هارد');
    expect(sanitizeText(`x${String.fromCodePoint(0xe0041)}y`)).toBe('xy');
    expect(sanitizeText(`x${String.fromCodePoint(0xd800)}y`)).toBe('xy');
  });
  it('keeps ZWNJ and ZWJ between letters, collapses runs and drops them at edges and next to spaces', () => {
    expect(sanitizeText(`می${ZWNJ_}خواهم`)).toBe(`می${ZWNJ_}خواهم`);
    expect(sanitizeText(`می${ZWNJ_}${ZWNJ_}خواهم`)).toBe(`می${ZWNJ_}خواهم`);
    expect(sanitizeText(`${ZWNJ_}سیم${ZWJ}`)).toBe('سیم');
    expect(sanitizeText(`سیم ${ZWNJ_} برق`)).toBe('سیم برق');
  });
  it('turns NBSP, tabs and line separators into spaces, keeps newlines unless asked', () => {
    expect(sanitizeText('a\u00a0b\tc\u2028d')).toBe('a b c d');
    expect(sanitizeText('a\r\nb')).toBe('a\nb');
    expect(sanitizeText('a\nb', { multiline: false })).toBe('a b');
  });
  it('is idempotent, leaves letters and digits alone, handles null', () => {
    const s = `سیم ${RLO}۲٫۵ می${ZWNJ_}خوام`;
    expect(sanitizeText(sanitizeText(s))).toBe(sanitizeText(s));
    expect(sanitizeText('۲٫۵ و ٣ ي')).toBe('۲٫۵ و ٣ ي');
    expect(sanitizeText(null)).toBe('');
  });
  it('sanitizeDeep cleans nested strings and passes other values through', () => {
    const v = { a: `x${RLO}y`, b: [`${RLO}z`, 3, null, { c: `q${RLO}` }], n: 1, t: true };
    expect(sanitizeDeep(v)).toEqual({ a: 'xy', b: ['z', 3, null, { c: 'q' }], n: 1, t: true });
  });
  it('normalizeFa drops the same characters (search side)', () => {
    expect(normalizeFa(`دوربین ${RLO}داهوا${String.fromCodePoint(0xfeff)}`)).toBe('دوربین داهوا');
  });
});
