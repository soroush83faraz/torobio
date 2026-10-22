/**
 * Persian strings of the API layer (tone «تو»). Everything sentence-like the engine produces comes from
 * copy/fa.ts; this file holds only what the DTO mapping adds (sale units, hours, warranty, missing reasons,
 * question notes). Numbers always come from data passed in as parameters.
 */
import { CONDITION_FLAG_LABEL, CONDITION_UNKNOWN_NOTE, faNum, formatMeters, formatTomanCompact, isolateIfLatin, joinFa } from '../copy/fa';
import type { MissingReason, Weekday, WeeklyHours } from '../types/index';

export const WEEKDAY_FA: Readonly<Record<Weekday, string>> = {
  sat: 'شنبه',
  sun: 'یکشنبه',
  mon: 'دوشنبه',
  tue: 'سه‌شنبه',
  wed: 'چهارشنبه',
  thu: 'پنجشنبه',
  fri: 'جمعه',
};

/** «۹», «۹:۳۰», «۲۴». */
export function clockFa(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return m === 0 ? faNum(h, 0) : `${faNum(h, 0)}:${faNum(m, 0).padStart(2, '۰')}`;
}

/** Display form of a device-model key: 'galaxy a56 5g' -> 'Galaxy A56 5G', 'iphone 15 pro' -> 'iPhone 15 Pro'. */
export function displayDeviceModel(key: string): string {
  return key
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === 'iphone' ? 'iPhone' : /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export const apiCopy = {
  /** Sale unit on an item / stop line. */
  saleUnitLabel: { roll: 'حلقهٔ ۱۰۰ متری', meter: 'قیمت هر متر' } as const,
  /** Sale-unit question options. */
  saleUnitOption: { roll: 'حلقهٔ ۱۰۰ متری', meter: 'متری (برش به اندازه)' } as const,

  questionWhy: {
    camera_recorder_signal: 'اگر اشتباه باشد، ضبط‌کننده به دوربین‌ها وصل نمی‌شود.',
    camera_adapter_12v:
      'ولتاژ نادرست دوربین را روشن نمی‌کند یا به آن آسیب می‌زند. ۱۲ ولت فرض عمومی است، نه اطلاعات آگهی؛ «فرقی نمی‌کند» این فرض را برمی‌دارد.',
    phone_accessory_fit: 'قاب و گلس مخصوص یک مدل گوشی است.',
    wire_sale_unit: 'قیمت حلقه و قیمت متری با هم مقایسه یا جمع نمی‌شوند؛ باید یکی را انتخاب کنی.',
    budget: 'بازه‌ها از قیمت‌های واقعی همین مدل‌ها ساخته شده‌اند.',
  } as const,
  optionCount: (n: number) => `${faNum(n, 0)} مدل`,
  /** Seller count of a product: priced sellers, else the sellers that list it without a usable price. */
  sellerCount: (n: number, priced: boolean) => (priced ? `${faNum(n, 0)} فروشنده با قیمت` : `${faNum(n, 0)} فروشنده، بدون قیمت`),
  /** Options-list pool: the card's eligible count and the whole pool the list is drawn from. */
  optionsPool: (eligible: number, total: number) =>
    eligible === total ? `${faNum(total, 0)} مدل مطابق خواسته` : `${faNum(eligible, 0)} مدل مطابق خواسته از ${faNum(total, 0)} مدل بررسی‌شده`,

  notFound: (text: string) => `«${text}» در فهرست این بازار پیدا نشد.`,

  missingWhy: {
    needs_info: 'منتظر انتخاب تو',
    not_found: 'پیدا نشد',
    price_unknown: 'قیمت ثبت نشده',
    no_choice: 'مدل مطابق خواسته پیدا نشد؛ از گزینه‌ها یکی را انتخاب کن',
    closed: 'فروشنده‌هایش در این زمان بسته‌اند',
    excluded: 'فروشنده‌هایش کنار گذاشته شده‌اند',
    no_offer: 'فروشنده‌ای با قیمت ندارد',
    stop_limit: 'در این برنامه جا نشد',
  } as Readonly<Record<MissingReason, string>>,

  altCheaper: 'ارزان‌تر',
  altFewerStops: 'کم‌توقف‌تر',

  closedNote: (shopName: string, extraCost: number) =>
    `«${isolateIfLatin(shopName)}» در این زمان بسته است و در برنامه نیامد.${extraCost > 0 ? ` برنامه ${formatTomanCompact(extraCost)} گران‌تر شد.` : ''}`,

  hoursUnknown: 'ساعت کاری ثبت نشده',
  today: 'امروز',
  /** Opening hours of one day: «ساعت کار شنبه: ۱۰ تا ۱۹ و ۱۷ تا ۲۱» / «جمعه تعطیل است». */
  hoursText(hours: WeeklyHours | null, day: Weekday, dayLabel: string): string {
    if (!hours) return this.hoursUnknown;
    const shifts = hours[day];
    if (!Array.isArray(shifts)) return `ساعت کار ${dayLabel} ثبت نشده`;
    if (shifts.length === 0) return `${dayLabel} تعطیل است`;
    const parts = shifts.filter(([s, e]) => s !== e).map(([s, e]) => `${clockFa(s)} تا ${clockFa(e > 1440 ? e - 1440 : e)}`);
    return parts.length ? `ساعت کار ${dayLabel}: ${parts.join(' و ')}` : `ساعت کار ${dayLabel} ثبت نشده`;
  },

  warranty(code: string | null | undefined, months: number | null | undefined): string {
    const base: Record<string, string> = {
      on_site_test: 'تست در محل',
      company: 'گارانتی شرکتی',
      authenticity: 'ضمانت اصالت کالا',
      none: 'بدون گارانتی',
      other: 'گارانتی (طبق توضیح فروشنده)',
    };
    const label = code ? base[code] ?? 'گارانتی (طبق توضیح فروشنده)' : 'گارانتی ثبت نشده';
    return months && months > 0 && code !== 'none' ? `${label} · ${faNum(months, 0)} ماه` : label;
  },

  distanceToPlan: (m: number) => `${formatMeters(m)} تا نزدیک‌ترین توقف برنامه (خط مستقیم)`,
  priceDelta: (delta: number) =>
    delta > 0 ? `${formatTomanCompact(delta)} بیشتر` : delta < 0 ? `${formatTomanCompact(-delta)} ارزان‌تر` : 'همان قیمت',
  noPrice: 'قیمت ثبت نشده',
  /** Listing condition flags: one source of truth in copy/fa.ts (CONDITION_FLAG_LABEL). */
  conditionUsed: CONDITION_FLAG_LABEL.used,
  conditionRefurbished: CONDITION_FLAG_LABEL.refurbished,
  replica: CONDITION_FLAG_LABEL.replica,
  conditionUnknownNote: CONDITION_UNKNOWN_NOTE,
  /** A value read from the seller's spec block, not the listing title. */
  specSourced: (v: string) => `${v} (طبق مشخصات فروشنده)`,
  floorLabel(floor: string | null | undefined): string | undefined {
    if (!floor) return undefined;
    if (floor === '0') return 'همکف';
    if (floor === 'M') return 'نیم‌طبقه';
    if (/^-\d+$/.test(floor)) return `طبقهٔ منفی ${faNum(Number(floor.slice(1)), 0)}`;
    if (/^\d+$/.test(floor)) return `طبقهٔ ${faNum(Number(floor), 0)}`;
    return undefined;
  },
  unitLabel(unit: string | null | undefined): string | undefined {
    if (!unit) return undefined;
    return `واحد ${/^\d+$/.test(unit) ? faNum(Number(unit), 0).replace(/٬/g, '') : isolateIfLatin(unit)}`;
  },
  joinFa,
} as const;
