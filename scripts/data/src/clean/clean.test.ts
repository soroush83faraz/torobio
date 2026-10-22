import { describe, expect, it } from 'vitest';
import { foldMallName, parseAddress, parseFloor } from './address';
import { parseHours, type HoursStats } from './hours';
import { canonicalMallFold, resolveMalls } from './malls';
import { cleanPrice, monthsFromText, normalizeWarranty } from './offer';

describe('price', () => {
  it('applies the hygiene thresholds', () => {
    expect(cleanPrice(null)).toEqual({ price: null, flag: 'missing' });
    expect(cleanPrice('null')).toEqual({ price: null, flag: 'missing' });
    expect(cleanPrice('111')).toEqual({ price: null, flag: 'placeholder' });
    expect(cleanPrice('9999')).toEqual({ price: null, flag: 'placeholder' });
    expect(cleanPrice('10000')).toEqual({ price: 10000, flag: null });
    expect(cleanPrice('1000000000000')).toEqual({ price: 1e12, flag: null });
    expect(cleanPrice('700000000000000000')).toEqual({ price: null, flag: 'outlier' });
    expect(cleanPrice('2550000.0')).toEqual({ price: 2550000, flag: null });
  });
});

describe('hours', () => {
  const day = (status: string, shifts: Array<[string, string]>) => ({ status, shifts: shifts.map(([s, e]) => ({ start_time: s, end_time: e })) });
  it('drops the 00:00-00:00 sentinel and keeps closed days as []', () => {
    const stats: HoursStats = { sentinelsDropped: 0, midnightFixed: 0, overnight: 0, declaredEmpty: 0, placeholderFriday: 0 };
    const h = parseHours(
      {
        sat: day('declared', [['09:00:00', '18:00:00'], ['00:00:00', '00:00:00']]),
        fri: day('closed', [['00:00:00', '00:00:00']]),
        mon: day('unsupported', [['08:00:00', '08:00:00']]),
      },
      stats,
    );
    expect(h).toEqual({ sat: [[540, 1080]], fri: [] });
    expect(stats.sentinelsDropped).toBe(1);
  });
  it('end 00:00 after a start = midnight, 23:59 = 24h, overnight shifts', () => {
    expect(parseHours({ sat: day('declared', [['10:00:00', '00:00:00']]) })).toEqual({ sat: [[600, 1440]] });
    expect(parseHours({ sat: day('declared', [['00:00:00', '23:59:00']]) })).toEqual({ sat: [[0, 1440]] });
    expect(parseHours({ sat: day('declared', [['18:00:00', '02:00:00']]) })).toEqual({ sat: [[1080, 1560]] });
  });
  it('two real shifts are kept and merged when overlapping', () => {
    expect(parseHours({ sun: day('declared', [['09:00:00', '13:00:00'], ['16:00:00', '20:00:00']]) })).toEqual({ sun: [[540, 780], [960, 1200]] });
    expect(parseHours({ sun: day('declared', [['09:00:00', '13:00:00'], ['12:00:00', '20:00:00']]) })).toEqual({ sun: [[540, 1200]] });
  });
  it('a Friday of 00:00-23:59 next to normal weekdays is a placeholder and becomes unknown', () => {
    const stats: HoursStats = { sentinelsDropped: 0, midnightFixed: 0, overnight: 0, declaredEmpty: 0, placeholderFriday: 0 };
    const h = parseHours(
      { sat: day('declared', [['09:00:00', '18:00:00']]), thu: day('declared', [['09:00:00', '14:00:00']]), fri: day('declared', [['00:00:00', '23:59:00']]) },
      stats,
    );
    expect(h).toEqual({ sat: [[540, 1080]], thu: [[540, 840]] });
    expect(stats.placeholderFriday).toBe(1);
  });
  it('a Friday of 00:00-23:59 is kept when the shop is declared round-the-clock on other days, or has no other day', () => {
    const all = (['sat', 'sun', 'mon', 'fri'] as const).reduce((o, d) => ({ ...o, [d]: day('declared', [['00:00:00', '23:59:00']]) }), {});
    expect(parseHours(all)).toEqual({ sat: [[0, 1440]], sun: [[0, 1440]], mon: [[0, 1440]], fri: [[0, 1440]] });
    expect(parseHours({ fri: day('declared', [['00:00:00', '23:59:00']]) })).toEqual({ fri: [[0, 1440]] });
    // a closed other day is not "normal hours": still no evidence
    expect(parseHours({ sat: day('closed', []), fri: day('declared', [['00:00:00', '23:59:00']]) })).toEqual({ sat: [], fri: [[0, 1440]] });
  });
  it('missing hours are null, never closed', () => {
    expect(parseHours(null)).toBeNull();
    expect(parseHours({})).toBeNull();
    expect(parseHours({ sat: day('unsupported', [['10:00:00', '10:00:00']]) })).toBeNull();
    expect(parseHours({ sat: day('declared', [['00:00:00', '00:00:00']]) })).toBeNull();
  });
});

describe('warranty', () => {
  it('maps providers and descriptions to codes', () => {
    expect(normalizeWarranty({ provider: 'تست و تحویل در حضور مشتری', description: null, period_months: null }).code).toBe('on_site_test');
    expect(normalizeWarranty({ provider: 'شرکتی', description: null, period_months: 18 })).toEqual({ code: 'company', text: 'شرکتی', months: 18 });
    expect(normalizeWarranty({ provider: 'بدون گارانتی', description: null, period_months: null }).code).toBe('none');
    expect(normalizeWarranty({ provider: null, description: 'گارانتی اصالت و سلامت فیزیکی کالا', period_months: null }).code).toBe('authenticity');
    expect(normalizeWarranty({ provider: null, description: '7 روز مهلت تست و 6 ماه گارانتی', period_months: null })).toMatchObject({ code: 'company', months: 6 });
    expect(normalizeWarranty({ provider: null, description: '2 سال', period_months: null })).toMatchObject({ code: 'company', months: 24 });
    expect(normalizeWarranty({ provider: null, description: 'ضمانت بازگشت کالا', period_months: null }).code).toBe('other');
    expect(normalizeWarranty({ provider: null, description: 'None', period_months: null }).code).toBeNull();
    expect(normalizeWarranty(null).code).toBeNull();
  });
  it('months only when unambiguous', () => {
    expect(monthsFromText('دارای 2 سال گارانتی و 10 سال خدمات پس از فروش')).toBeNull();
    expect(monthsFromText('گارانتی 18 ماهه شرکتی')).toBe(18);
  });
});

describe('address', () => {
  it('parses mall, floor and unit from real addresses', () => {
    expect(parseAddress('خیابان جمهوری اسلامی، پل حافظ، پاساژ چارسو، طبقه 4، واحد 62')).toEqual({ mallRaw: 'پاساژ چارسو', mallFold: 'چارسو', floor: '4', unit: '62' });
    expect(parseAddress('خیابان ملت٬ کوچه ی کاوه٬ پاساژ کیان٬ طبقه ی سوم ٬ واحد 302')).toMatchObject({ mallFold: 'کیان', floor: '3', unit: '302' });
    expect(parseAddress('خیابان جمهوری، بعد از پل حافظ، پاساژ نادری، طبقه منفی 1 ، پلاک 19')).toMatchObject({ mallFold: 'نادری', floor: '-1', unit: '19' });
    expect(parseAddress('جمهوری اسلامی، تقاطع حافظ پاساژ چارسو، پلاک A41، طبقه زیرهمکف، واحد 41')).toMatchObject({ mallFold: 'چارسو', floor: '-1', unit: '41' });
    expect(parseAddress('جمهوری اسلامی، پاساژ علاالدین، طبقه همکف، پلاک 65')).toMatchObject({ mallFold: 'علاالدین', floor: '0', unit: '65' });
    expect(parseAddress('میدان فردوسی، مجتمع تجارت جهانی فردوسی، طبقه 3، واحد 3112')).toMatchObject({ mallFold: 'تجارتجهانیفردوسی', floor: '3', unit: '3112' });
  });
  it('a mall mentioned only as a landmark is not the shop mall; street plaque is not a unit', () => {
    const a = parseAddress('خیابان جمهوری، بعد از شیخ هادی، روبروی ساختمان آلمینیوم، پلاک 655');
    expect(a.mallFold).toBeNull();
    expect(a.unit).toBeNull();
  });
  it('floor words', () => {
    expect(parseFloor('پاساژ خانقاه، طبقه منفی یک، پلاک 7')).toBe('-1');
    expect(parseFloor('پاساژ بزرگمهر، همکف، واحد 17')).toBe('0');
    expect(parseFloor('ساختمان آلومینیوم، طبقه 10، واحد 1020')).toBe('10');
    expect(parseFloor('بدون طبقه')).toBeNull();
  });
  it('mall spelling variants fold to one key', () => {
    const k = (s: string) => canonicalMallFold(foldMallName(s));
    expect(k('پاساژ علاءالدین')).toBe('علاالدین');
    expect(k('پاساژ علائدین')).toBe('علاالدین');
    expect(k('مجتمع تجاری علاالدین')).toBe('علاالدین');
    expect(k('پاساژ علاءالدین 2')).toBe('علاالدین2');
    expect(k('پاساژ علاالدین دو')).toBe('علاالدین2');
    expect(k('پاساژ علائدین 2')).toBe('علاالدین2');
    expect(k('ساختمان آلمینیوم')).toBe('الومینیوم');
    expect(k('پاساژ چهارسو')).toBe('چارسو');
  });
  it('same name far apart => separate buildings; isolated outlier => no key', () => {
    const m = (id: string, lat: number, lon: number) => ({ id, fold: 'نور', raw: 'پاساژ نور', lat, lon });
    const r = resolveMalls([m('a', 35.69, 51.42), m('b', 35.6901, 51.4201), m('c', 35.6902, 51.42), m('d', 35.80, 51.43), m('e', 35.8001, 51.4301), m('f', 35.8, 51.4302), m('g', 35.75, 51.3)]);
    expect(r.assign.get('a')?.mallKey).toBe('m:نور');
    expect(r.assign.get('d')?.mallKey).toBe('m:نور#2');
    expect(r.assign.has('g')).toBe(false);
  });
});
