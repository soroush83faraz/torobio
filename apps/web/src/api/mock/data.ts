/**
 * Mock market data (Persian). Shop names are fictional by design; this mirrors the
 * dataset note in the about-data sheet. Prices are whole toman. No phone numbers.
 */

export interface MockShop {
  id: string;
  name: string;
  mall: string;
  floor?: string;
  unit?: string;
  address: string;
  /** Opening hours by JS weekday (0 = Sunday ... 6 = Saturday). null = no hours recorded. */
  hours: Record<number, [number, number] | null> | null;
  /** Planar coordinates in metres, used for straight-line distances only. */
  x: number;
  y: number;
}

const hoursOf = (h: [number, number], fri: [number, number] | null): Record<number, [number, number] | null> => ({
  0: h,
  1: h,
  2: h,
  3: h,
  4: h,
  5: fri,
  6: h,
});

export const SHOPS: MockShop[] = [
  {
    id: 's1',
    name: 'فرورا رویس',
    mall: 'پاساژ علاءالدین',
    floor: 'طبقهٔ ۶',
    unit: 'واحد ۶۲۲',
    address: 'خیابان شیخ‌هادی، پاساژ علاءالدین، طبقهٔ ششم، واحد ۶۲۲',
    hours: hoursOf([10, 19], null),
    x: 0,
    y: 0,
  },
  {
    id: 's2',
    name: 'آریا نگین',
    mall: 'پاساژ چارسو',
    floor: 'طبقهٔ ۲',
    unit: 'واحد ۲۱۴',
    address: 'خیابان فردوسی، پاساژ چارسو، طبقهٔ دوم، واحد ۲۱۴',
    hours: hoursOf([9.5, 20], [16, 20]),
    x: 90,
    y: 10,
  },
  {
    id: 's3',
    name: 'پارس سیگنال',
    mall: 'پاساژ اتحادیه',
    floor: 'طبقهٔ ۱',
    unit: 'واحد ۱۱',
    address: 'خیابان فردوسی، پاساژ اتحادیه، طبقهٔ اول، واحد ۱۱',
    hours: null,
    x: 220,
    y: -60,
  },
  {
    id: 's4',
    name: 'مهرداد الکتریک',
    mall: 'خیابان شیخ‌هادی',
    address: 'خیابان شیخ‌هادی، پلاک ۴۲',
    hours: hoursOf([9, 18], null),
    x: -150,
    y: 120,
  },
  {
    id: 's5',
    name: 'نواندیش موبایل',
    mall: 'پاساژ بهارستان',
    floor: 'طبقهٔ ۳',
    unit: 'واحد ۳۱۲',
    address: 'میدان بهارستان، پاساژ بهارستان، طبقهٔ سوم، واحد ۳۱۲',
    hours: hoursOf([10, 21], [16, 21]),
    x: 380,
    y: 220,
  },
  {
    id: 's6',
    name: 'کیان لوازم',
    mall: 'پاساژ علاءالدین',
    floor: 'طبقهٔ ۳',
    unit: 'واحد ۳۰۵',
    address: 'خیابان شیخ‌هادی، پاساژ علاءالدین، طبقهٔ سوم، واحد ۳۰۵',
    hours: hoursOf([10, 19], null),
    x: 6,
    y: 4,
  },
];

export const shopById = (id: string): MockShop => SHOPS.find((s) => s.id === id)!;

export type Kind =
  | 'camera'
  | 'recorder'
  | 'hdd'
  | 'adapter'
  | 'wire'
  | 'socket'
  | 'breaker'
  | 'phone'
  | 'case'
  | 'glass';

export interface MockOffer {
  shopId: string;
  /** Per sale unit; null = found but no usable price. */
  price: number | null;
  listingTitle: string;
  warranty: string;
  priceChangedAt: string;
}

export interface MockProduct {
  id: string;
  kind: Kind;
  name: string;
  modelCode?: string;
  brand: string;
  specs: string[];
  /** What differs from a plain requirement of this kind, for the options list. */
  diffNote?: string;
  unitLabel?: string;
  /** For wire: metres per sale unit (100 = roll, 1 = metre). */
  metersPerUnit?: number;
  offers: MockOffer[];
  /** Compat facts the rules table reads. */
  facts?: {
    channels?: number;
    recorderKind?: 'XVR' | 'NVR';
    signal?: 'AHD' | 'IP';
    device?: string;
    surveillance?: boolean;
  };
  /** Excluded by default because the listing states a conflicting device. */
  conflictReason?: string;
  /** Sample of how many specs could not be read (never auto-picked). */
  incompleteSpecs?: boolean;
}

const W18 = 'گارانتی ۱۸ ماهه شرکتی';
const W12 = 'گارانتی ۱۲ ماهه';
const W0 = 'بدون گارانتی';
const WS = 'گارانتی سلامت فیزیکی';
const D1 = '2026-10-12';
const D2 = '2026-10-10';
const D3 = '2026-10-04';

export const PRODUCTS: MockProduct[] = [
  // ---- cameras
  {
    id: 'cam-1200',
    kind: 'camera',
    name: 'دوربین مداربسته داهوا مدل HAC-HDW1200CLQP',
    modelCode: 'HAC-HDW1200CLQP',
    brand: 'داهوا',
    specs: ['۲ مگاپیکسل', 'دام', 'AHD'],
    facts: { signal: 'AHD' },
    offers: [
      { shopId: 's1', price: 3_200_000, listingTitle: 'دوربین دام ۲ مگاپیکسل داهوا HDW1200CLQP اصلی', warranty: W18, priceChangedAt: D1 },
      { shopId: 's3', price: 3_320_000, listingTitle: 'دوربین مداربسته داهوا ۲ مگ مدل HDW1200', warranty: W0, priceChangedAt: D3 },
      { shopId: 's2', price: 3_450_000, listingTitle: 'دوربین داهوا ۲ مگاپیکسل HAC-HDW1200CLQP', warranty: W18, priceChangedAt: D1 },
    ],
  },
  {
    id: 'cam-1500',
    kind: 'camera',
    name: 'دوربین مداربسته داهوا مدل HAC-HDW1500TLMQ',
    modelCode: 'HAC-HDW1500TLMQ',
    brand: 'داهوا',
    specs: ['۵ مگاپیکسل', 'دام', 'AHD'],
    diffNote: '۵ مگاپیکسل',
    facts: { signal: 'AHD' },
    offers: [
      { shopId: 's1', price: 4_400_000, listingTitle: 'دوربین ۵ مگاپیکسل داهوا HDW1500TLMQ', warranty: W18, priceChangedAt: D1 },
      { shopId: 's2', price: 4_600_000, listingTitle: 'دوربین داهوا ۵ مگ HAC-HDW1500TLMQ', warranty: W18, priceChangedAt: D2 },
    ],
  },
  {
    id: 'cam-hik',
    kind: 'camera',
    name: 'دوربین مداربسته هایک‌ویژن مدل DS-2CE56D0T-IRPF',
    modelCode: 'DS-2CE56D0T-IRPF',
    brand: 'هایک‌ویژن',
    specs: ['۲ مگاپیکسل', 'بولت', 'TVI'],
    diffNote: 'برند دیگر',
    facts: { signal: 'AHD' },
    offers: [
      { shopId: 's3', price: 2_900_000, listingTitle: 'دوربین هایک ویژن ۲ مگ DS-2CE56D0T', warranty: W12, priceChangedAt: D1 },
      { shopId: 's2', price: 3_050_000, listingTitle: 'دوربین بولت هایک‌ویژن ۲ مگاپیکسل', warranty: W18, priceChangedAt: D1 },
    ],
  },
  // ---- recorders
  {
    id: 'rec-xvr',
    kind: 'recorder',
    name: 'ضبط‌کننده ۴ کانال داهوا مدل XVR1B04-I',
    modelCode: 'XVR1B04-I',
    brand: 'داهوا',
    specs: ['۴ کانال', 'XVR', 'پنج‌کاره'],
    facts: { channels: 4, recorderKind: 'XVR' },
    offers: [
      { shopId: 's3', price: 5_100_000, listingTitle: 'دی وی آر ۴ کانال داهوا XVR1B04-I', warranty: W18, priceChangedAt: D1 },
      { shopId: 's2', price: 5_900_000, listingTitle: 'ضبط کننده داهوا ۴ کانال XVR1B04-I اصلی', warranty: W18, priceChangedAt: D1 },
    ],
  },
  {
    id: 'rec-hik',
    kind: 'recorder',
    name: 'ضبط‌کننده ۴ کانال هایک‌ویژن مدل DS-7204HQHI-K1',
    modelCode: 'DS-7204HQHI-K1',
    brand: 'هایک‌ویژن',
    specs: ['۴ کانال', 'XVR', 'توربو'],
    diffNote: 'برند هایک‌ویژن',
    facts: { channels: 4, recorderKind: 'XVR' },
    offers: [
      { shopId: 's3', price: 6_500_000, listingTitle: 'دی وی آر هایک ویژن ۴ کانال DS-7204HQHI-K1', warranty: W12, priceChangedAt: D2 },
      { shopId: 's2', price: 6_800_000, listingTitle: 'ضبط‌کننده هایک‌ویژن ۴ کانال توربو', warranty: W18, priceChangedAt: D1 },
    ],
  },
  {
    id: 'rec-nvr',
    kind: 'recorder',
    name: 'ضبط‌کننده شبکه ۴ کانال داهوا مدل NVR2104HS-S3',
    modelCode: 'NVR2104HS-S3',
    brand: 'داهوا',
    specs: ['۴ کانال', 'NVR', 'تحت شبکه'],
    facts: { channels: 4, recorderKind: 'NVR' },
    offers: [
      { shopId: 's1', price: 7_200_000, listingTitle: 'ان وی آر ۴ کانال داهوا NVR2104HS-S3', warranty: W18, priceChangedAt: D1 },
      { shopId: 's2', price: 7_450_000, listingTitle: 'NVR داهوا چهار کانال تحت شبکه', warranty: W18, priceChangedAt: D2 },
    ],
  },
  // ---- hard drives
  {
    id: 'hdd-4sky',
    kind: 'hdd',
    name: 'هارد سیگیت اسکای‌هاوک ۴ ترابایت مدل ST4000VX016',
    modelCode: 'ST4000VX016',
    brand: 'سیگیت',
    specs: ['۴ ترابایت', 'اسکای‌هاوک'],
    diffNote: '۴ ترابایت به‌جای ۲',
    facts: {},
    offers: [
      { shopId: 's2', price: 6_350_000, listingTitle: 'هارد اینترنال سیگیت ۴ ترابایت Skyhawk', warranty: W18, priceChangedAt: D1 },
      { shopId: 's3', price: 6_700_000, listingTitle: 'هارد ۴ ترابایت سیگیت ST4000VX016', warranty: W12, priceChangedAt: D2 },
    ],
  },
  {
    id: 'hdd-2blue',
    kind: 'hdd',
    name: 'هارد وسترن دیجیتال ۲ ترابایت مدل WD20EZBX',
    modelCode: 'WD20EZBX',
    brand: 'وسترن دیجیتال',
    specs: ['۲ ترابایت', 'کاربری عمومی'],
    diffNote: 'مخصوص ضبط تصویر نیست',
    incompleteSpecs: true,
    facts: {},
    offers: [
      { shopId: 's4', price: 3_150_000, listingTitle: 'هارد اینترنال وسترن ۲ ترابایت آبی', warranty: W12, priceChangedAt: D1 },
      { shopId: 's6', price: 3_250_000, listingTitle: 'هارد ۲ ترابایت WD Blue', warranty: W12, priceChangedAt: D3 },
    ],
  },
  // ---- adapters
  {
    id: 'ad-5a',
    kind: 'adapter',
    name: 'آداپتور ۱۲ ولت ۵ آمپر چندخروجی دوربین مداربسته',
    brand: 'متفرقه',
    specs: ['۱۲ ولت', '۵ آمپر'],
    facts: {},
    offers: [
      { shopId: 's1', price: null, listingTitle: 'آداپتور ۱۲ ولت ۵ آمپر ۸ خروجی', warranty: W0, priceChangedAt: D1 },
      { shopId: 's3', price: null, listingTitle: 'منبع تغذیه دوربین ۱۲ ولت ۵ آمپر', warranty: W0, priceChangedAt: D2 },
    ],
  },
  {
    id: 'ad-2a',
    kind: 'adapter',
    name: 'آداپتور ۱۲ ولت ۲ آمپر تک‌خروجی',
    brand: 'متفرقه',
    specs: ['۱۲ ولت', '۲ آمپر'],
    diffNote: '۲ آمپر',
    facts: {},
    offers: [{ shopId: 's4', price: 280_000, listingTitle: 'آداپتور ۱۲ ولت ۲ آمپر', warranty: W0, priceChangedAt: D1 }],
  },
  // ---- wire (roll / metre are separate sale units; never compared with each other)
  {
    id: 'wire-25-roll',
    kind: 'wire',
    name: 'سیم افشان ۲٫۵ حلقهٔ ۱۰۰ متری',
    brand: 'متفرقه',
    specs: ['افشان ۲٫۵', 'حلقهٔ ۱۰۰ متری'],
    unitLabel: 'حلقهٔ ۱۰۰ متری',
    metersPerUnit: 100,
    offers: [
      { shopId: 's4', price: 1_650_000, listingTitle: 'سیم افشان ۲٫۵ نمره، حلقهٔ ۱۰۰ متری', warranty: W0, priceChangedAt: D1 },
      { shopId: 's6', price: 1_720_000, listingTitle: 'سیم برق افشان ۲٫۵ ۱۰۰ متری', warranty: W0, priceChangedAt: D2 },
    ],
  },
  {
    id: 'wire-25-metre',
    kind: 'wire',
    name: 'سیم افشان ۲٫۵ به‌صورت متری',
    brand: 'متفرقه',
    specs: ['افشان ۲٫۵', 'متری'],
    unitLabel: 'قیمت هر متر',
    metersPerUnit: 1,
    offers: [
      { shopId: 's4', price: 19_500, listingTitle: 'سیم افشان ۲٫۵ متری', warranty: W0, priceChangedAt: D1 },
      { shopId: 's6', price: 20_000, listingTitle: 'سیم افشان ۲٫۵ فروش متری', warranty: W0, priceChangedAt: D1 },
    ],
  },
  {
    id: 'wire-15-roll',
    kind: 'wire',
    name: 'سیم افشان ۱٫۵ حلقهٔ ۱۰۰ متری',
    brand: 'متفرقه',
    specs: ['افشان ۱٫۵', 'حلقهٔ ۱۰۰ متری'],
    unitLabel: 'حلقهٔ ۱۰۰ متری',
    metersPerUnit: 100,
    offers: [{ shopId: 's4', price: 1_050_000, listingTitle: 'سیم افشان ۱٫۵ نمره، حلقهٔ ۱۰۰ متری', warranty: W0, priceChangedAt: D1 }],
  },
  {
    id: 'wire-15-metre',
    kind: 'wire',
    name: 'سیم افشان ۱٫۵ به‌صورت متری',
    brand: 'متفرقه',
    specs: ['افشان ۱٫۵', 'متری'],
    unitLabel: 'قیمت هر متر',
    metersPerUnit: 1,
    offers: [{ shopId: 's4', price: 12_500, listingTitle: 'سیم افشان ۱٫۵ متری', warranty: W0, priceChangedAt: D1 }],
  },
  {
    id: 'wire-cable-roll',
    kind: 'wire',
    name: 'کابل برق ۳×۲٫۵ حلقهٔ ۱۰۰ متری',
    brand: 'متفرقه',
    specs: ['۳×۲٫۵', 'حلقهٔ ۱۰۰ متری'],
    unitLabel: 'حلقهٔ ۱۰۰ متری',
    metersPerUnit: 100,
    offers: [{ shopId: 's4', price: 5_900_000, listingTitle: 'کابل افشان ۳×۲٫۵ حلقه ۱۰۰ متر', warranty: W0, priceChangedAt: D2 }],
  },
  {
    id: 'wire-cable-metre',
    kind: 'wire',
    name: 'کابل برق ۳×۲٫۵ به‌صورت متری',
    brand: 'متفرقه',
    specs: ['۳×۲٫۵', 'متری'],
    unitLabel: 'قیمت هر متر',
    metersPerUnit: 1,
    offers: [{ shopId: 's4', price: 62_000, listingTitle: 'کابل ۳×۲٫۵ متری', warranty: W0, priceChangedAt: D2 }],
  },
  // ---- sockets and breakers
  {
    id: 'sock-1',
    kind: 'socket',
    name: 'پریز ارت‌دار توکار سفید',
    brand: 'متفرقه',
    specs: ['ارت‌دار', 'توکار'],
    offers: [
      { shopId: 's4', price: 128_000, listingTitle: 'پریز برق ارت دار توکار', warranty: W0, priceChangedAt: D1 },
      { shopId: 's6', price: 135_000, listingTitle: 'پریز ارتی سفید توکار', warranty: W0, priceChangedAt: D1 },
    ],
  },
  {
    id: 'brk-16',
    kind: 'breaker',
    name: 'کلید مینیاتوری تک‌پل ۱۶ آمپر',
    brand: 'متفرقه',
    specs: ['۱۶ آمپر', 'تک‌پل'],
    offers: [
      { shopId: 's6', price: 195_000, listingTitle: 'فیوز مینیاتوری ۱۶ آمپر تک پل', warranty: WS, priceChangedAt: D2 },
      { shopId: 's4', price: 210_000, listingTitle: 'کلید مینیاتوری ۱ پل ۱۶A', warranty: WS, priceChangedAt: D1 },
    ],
  },
  // ---- phone and accessories
  {
    id: 'phone-a56',
    kind: 'phone',
    name: 'گوشی سامسونگ Galaxy A56 ظرفیت ۲۵۶ گیگابایت',
    modelCode: 'Galaxy A56',
    brand: 'سامسونگ',
    specs: ['۲۵۶ گیگابایت', 'دو سیم‌کارت'],
    facts: { device: 'A56' },
    offers: [
      { shopId: 's5', price: 19_900_000, listingTitle: 'سامسونگ Galaxy A56 دو سیم کارت ۲۵۶ گیگ', warranty: W18, priceChangedAt: D1 },
    ],
  },
  {
    id: 'case-a56',
    kind: 'case',
    name: 'قاب سیلیکونی مخصوص Galaxy A56',
    brand: 'متفرقه',
    specs: ['سیلیکونی'],
    facts: { device: 'A56' },
    offers: [
      { shopId: 's6', price: 290_000, listingTitle: 'قاب سیلیکونی سامسونگ A56', warranty: W0, priceChangedAt: D1 },
      { shopId: 's5', price: 320_000, listingTitle: 'کاور سیلیکونی گلکسی A56', warranty: W0, priceChangedAt: D2 },
    ],
  },
  {
    id: 'case-a56-armor',
    kind: 'case',
    name: 'قاب ضدضربه Galaxy A56',
    brand: 'متفرقه',
    specs: ['ضدضربه'],
    diffNote: 'ضدضربه',
    facts: { device: 'A56' },
    offers: [{ shopId: 's5', price: 540_000, listingTitle: 'قاب ضد ضربه آرمور سامسونگ A56', warranty: W0, priceChangedAt: D1 }],
  },
  {
    id: 'case-a57',
    kind: 'case',
    name: 'قاب سیلیکونی مخصوص Galaxy A57',
    brand: 'متفرقه',
    specs: ['سیلیکونی'],
    facts: { device: 'A57' },
    conflictReason: 'روی آگهی برای Galaxy A57 نوشته شده، نه Galaxy A56.',
    offers: [{ shopId: 's6', price: 250_000, listingTitle: 'قاب سیلیکونی سامسونگ A57', warranty: W0, priceChangedAt: D1 }],
  },
  {
    id: 'glass-a56',
    kind: 'glass',
    name: 'گلس شیشه‌ای محافظ صفحه Galaxy A56',
    brand: 'متفرقه',
    specs: ['شیشه‌ای', 'شفاف'],
    facts: { device: 'A56' },
    offers: [
      { shopId: 's6', price: 150_000, listingTitle: 'گلس شیشه ای سامسونگ A56', warranty: W0, priceChangedAt: D1 },
      { shopId: 's5', price: 180_000, listingTitle: 'محافظ صفحه گلس گلکسی A56', warranty: W0, priceChangedAt: D1 },
    ],
  },
];

export const productById = (id: string): MockProduct | undefined => PRODUCTS.find((p) => p.id === id);

export const NEARBY_CATEGORIES = ['موبایل', 'لوازم جانبی موبایل', 'دوربین مداربسته', 'برق و روشنایی'];

export const META = {
  snapshotDate: '2026-10-13',
  shopCount: 3792,
  shopsTotal: 6476,
  productCount: 225903,
  areas: ['فردوسی', 'شیخ‌هادی', 'بهارستان'],
  dataVersion: 'mock-1',
  categories: [
    'دوربین مداربسته',
    'ضبط‌کننده',
    'هارد',
    'آداپتور',
    'سیم برق',
    'پریز',
    'کلید مینیاتوری',
    'گوشی',
    'قاب گوشی',
    'گلس',
  ],
};
