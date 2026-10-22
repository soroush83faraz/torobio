import { normalizeFa } from '../normalize/index';

/** Attribute-extraction domains. Routing is by exact (normalised) category name. */
export type Domain =
  | 'cctv_camera'
  | 'recorder'
  | 'hdd'
  | 'adapter'
  | 'wire'
  | 'phone'
  | 'phone_accessory'
  | 'charger'
  | 'power_bank'
  | 'headphones'
  | 'lighting'
  | 'switch_socket';

const ROUTES: Array<[Domain, string[]]> = [
  ['cctv_camera', ['دوربین مدار بسته', 'دوربین امنیتی خورشیدی', 'دوربین\u200Cهای نظارتی و امنیتی', 'دوربین مخفی']],
  ['recorder', ['ضبط کننده ویدیویی دوربین\u200Cهای نظارتی و امنیتی', 'ضبط کننده تصویر']],
  ['hdd', ['هارد دیسک اینترنال', 'هارد سرور', 'حافظه SSD']],
  ['adapter', ['آداپتور برق', 'منبع تغذیه سوییچینگ', 'سایر منبع تغذیه', 'منبع تغذیه']],
  ['wire', ['سیم و کابل برق ساختمان']],
  ['phone', ['گوشی موبایل', 'گوشی شیائومی']],
  [
    'phone_accessory',
    [
      'کیف و کاور گوشی',
      'محافظ صفحه نمایش گوشی',
      'محافظ لنز دوربین گوشی',
      'قاب، شاسی و درب گوشی',
      'باتری گوشی موبایل',
      'تاچ و ال سی دی گوشی و تبلت',
      'گلس تعمیراتی گوشی و تبلت',
      'شیشه دوربین گوشی و تبلت',
    ],
  ],
  ['charger', ['شارژر گوشی', 'شارژر وایرلس و پایه شارژ', 'شارژر فندکی خودرو']],
  ['power_bank', ['پاوربانک و شارژر همراه']],
  ['headphones', ['هدفون، هدست و هندزفری']],
  ['lighting', ['پروژکتور و وال واشر', 'لامپ LED و کم مصرف', 'چراغ پنلی و سقفی', 'چراغ و پروژکتور خورشیدی']],
  ['switch_socket', ['کلید و پریز', 'کلید هوشمند', 'پریز هوشمند']],
];

const MAP = new Map<string, Domain>();
for (const [d, names] of ROUTES) for (const n of names) MAP.set(normalizeFa(n), d);

export function domainForCategory(categoryName: string | null | undefined): Domain | null {
  if (!categoryName) return null;
  return MAP.get(normalizeFa(categoryName)) ?? null;
}

/** Category names routed to each domain (for reports and synonym checks). */
export const DOMAIN_CATEGORIES: ReadonlyArray<readonly [Domain, readonly string[]]> = ROUTES;

/**
 * Categories whose products are made FOR a device of another brand (parts,
 * accessories, car parts). The brand in their titles is the device's brand, so
 * a title lexicon match is not used as products.brand there.
 */
const FOR_DEVICE_RE = /لوازم جانبی|لوازم یدکی|قطعات|قطعه|کیف و کاور|قاب|محافظ|گلس|تاچ|ال سی دی|باتری|شارژر|کابل|آداپتور|خودرو|موتور سیکلت|فیلتر|کارتریج|تونر|لنت|سپر|پایه|نگهدارنده|کاور|بند|برچسب|استیکر|یدکی|شیشه|فلت|برد|منبع تغذیه|ریموت|کنترل|جوهر|پاکت|کیسه|درب|دسته|سری|تسمه|بلبرینگ|لاستیک|چراغ خودرو|آینه|رینگ|ابزار تعمیر/;

export function titleBrandAllowed(categoryName: string | null | undefined, domain: Domain | null): boolean {
  if (domain === 'adapter' || domain === 'phone_accessory' || domain === 'charger') return false;
  if (domain) return true;
  if (!categoryName) return false;
  return !FOR_DEVICE_RE.test(normalizeFa(categoryName));
}
