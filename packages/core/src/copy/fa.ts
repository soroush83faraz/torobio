/**
 * Every user-facing string the engine produces lives here (Persian, tone «تو»).
 * Numbers in sentences always come from data fields passed in as parameters.
 * Latin runs (model codes, AHD, NVR…) are wrapped in Unicode bidi isolates (LRI…PDI)
 * so they never reorder inside RTL text.
 */
import { brandByKey } from '../extract/brands';
import { toPersianDigits } from '../normalize/index';
import type {
  AttrKey,
  AttrValue,
  CompatStatus,
  Constraint,
  ConstraintEval,
  ItemKind,
  ItemState,
  MissingReason,
  NeedsInfoReason,
  OpenStatus,
  AssignmentRule,
  PickRule,
  QuestionKey,
} from '../types/index';

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

const LRI = '⁦';
const PDI = '⁩';

/** Bidi-isolate a left-to-right run. */
export function ltr(s: string): string {
  return `${LRI}${s}${PDI}`;
}

const LATIN = /[A-Za-z]/;
/** Isolate only when the text contains Latin letters. */
export function isolateIfLatin(s: string): string {
  return LATIN.test(s) ? ltr(s) : s;
}

const nfCache = new Map<number, Intl.NumberFormat>();
/** Persian digits with «٬» grouping and «٫» decimal. */
export function faNum(n: number, maxFractionDigits = 1): string {
  let nf = nfCache.get(maxFractionDigits);
  if (!nf) {
    nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: maxFractionDigits });
    nfCache.set(maxFractionDigits, nf);
  }
  return nf.format(n);
}

/** «یک» for 1, Persian digits otherwise (used for counts of stops/items in prose). */
export function faCount(n: number): string {
  return n === 1 ? 'یک' : faNum(n, 0);
}

/** Compact amount without the currency word: «۳٫۲ میلیون», «۸۰۰ هزار». */
export function formatAmountShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${faNum(a / 1e9)} میلیارد`;
  if (a >= 1e6) return `${faNum(a / 1e6)} میلیون`;
  if (a >= 1e3) return `${faNum(Math.round(a / 1e3), 0)} هزار`;
  return faNum(a, 0);
}

/** «۳٫۲ میلیون تومان». */
export function formatTomanCompact(n: number): string {
  return `${formatAmountShort(n)} تومان`;
}

/** «۳٬۲۰۰٬۰۰۰ تومان». */
export function formatTomanExact(n: number): string {
  return `${faNum(n, 0)} تومان`;
}

/** Straight-line distance, rounded to 10 m: «حدود ۹۰ متر», «حدود ۱٫۲ کیلومتر». */
export function formatMeters(m: number): string {
  if (m >= 1000) return `حدود ${faNum(Math.round(m / 100) / 10)} کیلومتر`;
  const r = Math.max(10, Math.round(m / 10) * 10);
  return `حدود ${faNum(r, 0)} متر`;
}

export function joinFa(parts: readonly string[]): string {
  return parts.join('، ');
}

function joinOr(parts: readonly string[]): string {
  return parts.join(' یا ');
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export const ATTR_LABEL: Readonly<Record<AttrKey, string>> = {
  brand: 'برند',
  resolution_mp: 'وضوح تصویر',
  camera_signal: 'نوع دوربین',
  camera_form: 'شکل بدنه',
  lens_mm: 'لنز',
  recorder_kind: 'نوع ضبط‌کننده',
  channels: 'تعداد کانال',
  capacity_tb: 'ظرفیت',
  hdd_surveillance: 'مخصوص ضبط تصویر',
  voltage_v: 'ولتاژ',
  current_a: 'جریان',
  fits_models: 'مدل گوشی سازگار',
  phone_model: 'مدل گوشی',
  storage_gb: 'حافظهٔ داخلی',
  ram_gb: 'رم',
  wire_section_mm2: 'سطح مقطع',
  wire_cores: 'تعداد رشته',
  length_m: 'طول',
  sale_unit: 'واحد فروش',
  power_w: 'توان',
  capacity_mah: 'ظرفیت باتری',
  wire_strand: 'نوع سیم (افشان یا مفتولی)',
  screen_inch: 'اندازهٔ صفحه',
};

const SIGNAL_LABEL: Record<string, string> = {
  ahd: ltr('AHD'),
  hdcvi: ltr('HDCVI'),
  tvi: ltr('TVI'),
  analog: 'آنالوگ',
  ip: `تحت شبکه (${ltr('IP')})`,
};
const RECORDER_LABEL: Record<string, string> = { xvr: ltr('XVR'), dvr: ltr('DVR'), nvr: ltr('NVR') };
const FORM_LABEL: Record<string, string> = {
  bullet: 'بولت',
  dome: 'دام',
  turret: 'تورت',
  ptz: `چرخان (${ltr('PTZ')})`,
};
const SALE_UNIT_LABEL: Record<string, string> = { meter: 'متری', roll: 'حلقه‌ای', piece: 'عددی' };

/** Display a single attribute value with its unit. */
export function formatAttrValue(attr: AttrKey, value: AttrValue): string {
  if (Array.isArray(value)) return joinFa(value.map((v) => isolateIfLatin(v)));
  switch (attr) {
    case 'resolution_mp':
      return `${faNum(Number(value))} مگاپیکسل`;
    case 'channels':
      return `${faNum(Number(value), 0)} کانال`;
    case 'capacity_tb': {
      const tb = Number(value);
      return tb < 1 ? `${faNum(Math.round(tb * 1000), 0)} گیگابایت` : `${faNum(tb)} ترابایت`;
    }
    case 'voltage_v':
      return `${faNum(Number(value))} ولت`;
    case 'current_a':
      return `${faNum(Number(value))} آمپر`;
    case 'storage_gb':
    case 'ram_gb':
      return `${faNum(Number(value), 0)} گیگابایت`;
    case 'wire_section_mm2':
      return `${faNum(Number(value))} میلی‌متر مربع`;
    case 'wire_cores':
      return `${faNum(Number(value), 0)} رشته`;
    case 'length_m':
      return `${faNum(Number(value))} متر`;
    case 'power_w':
      return `${faNum(Number(value))} وات`;
    case 'capacity_mah':
      return `${faNum(Number(value), 0)} میلی‌آمپر ساعت`;
    case 'screen_inch':
      return `${faNum(Number(value))} اینچ`;
    case 'wire_strand':
      return value === 'flexible' ? 'افشان' : value === 'solid' ? 'مفتولی' : String(value);
    case 'lens_mm':
      return `${faNum(Number(value))} میلی‌متر`;
    case 'camera_signal':
      return SIGNAL_LABEL[String(value)] ?? isolateIfLatin(String(value));
    case 'recorder_kind':
      return RECORDER_LABEL[String(value)] ?? isolateIfLatin(String(value));
    case 'camera_form':
      return FORM_LABEL[String(value)] ?? isolateIfLatin(String(value));
    case 'sale_unit':
      return SALE_UNIT_LABEL[String(value)] ?? String(value);
    case 'hdd_surveillance':
      return value ? 'مخصوص ضبط تصویر' : 'غیر مخصوص ضبط تصویر';
    case 'brand': {
      // brand constraints carry the stable key ('asus', 'fa:<name>'): show the Persian display name
      const v = String(value);
      return brandByKey(v)?.display ?? (v.startsWith('fa:') ? v.slice(3) : isolateIfLatin(v));
    }
    default:
      return typeof value === 'number' ? faNum(value) : isolateIfLatin(String(value));
  }
}

function wantedText(c: Constraint): string {
  switch (c.op) {
    case 'eq':
      return formatAttrValue(c.attr, c.value);
    case 'in':
      return joinOr(c.values.map((v) => formatAttrValue(c.attr, v)));
    case 'gte':
      return `دست‌کم ${formatAttrValue(c.attr, c.value)}`;
    case 'lte':
      return `حداکثر ${formatAttrValue(c.attr, c.value)}`;
    case 'contains':
      return isolateIfLatin(c.value);
    case 'known':
      return `${ATTR_LABEL[c.attr]} مشخص باشد`;
  }
}

/** Persian chip text for a constraint («۴ کانال»، «دست‌کم ۴ کانال»). */
export function constraintText(c: Constraint): string {
  return wantedText(c);
}

/** Chip text for a constraint inherited from a sibling item. */
export function inheritedConstraintText(c: Constraint, fromItemLabel: string): string {
  return `${wantedText(c)} (از «${fromItemLabel}»)`;
}

/** Chip text for a constraint that only encodes a general assumption (never verified), e.g. the 12 V camera adapter. */
export function assumedConstraintText(c: Constraint, fromItemLabel: string | undefined): string {
  return fromItemLabel
    ? `${wantedText(c)} (فرض عمومی برای «${fromItemLabel}»؛ تأیید نشده)`
    : `${wantedText(c)} (فرض عمومی؛ تأیید نشده)`;
}

/**
 * Chip text for a constraint the plan's compatibility guard added because the product picked for a sibling item
 * would otherwise conflict with this item's pick.
 */
export function guardConstraintText(c: Constraint, fromItemLabel: string | undefined): string {
  return fromItemLabel ? `${wantedText(c)} (برای جور شدن با «${fromItemLabel}» در برنامه)` : `${wantedText(c)} (برای جور شدن با بقیهٔ برنامه)`;
}

const COMPAT_SUFFIX = ' (برای سازگاری با بقیهٔ فهرست)';
/** Suffix of a difference caused by the assumed 12 V camera-adapter rule (a general assumption, not a fact). */
const ASSUMED_12V_SUFFIX = ' (فرض عمومی: دوربین‌ها معمولاً ۱۲ ولت می‌خواهند؛ تأیید نشده)';

/** One sentence per failing / unknown constraint. */
export function describeConstraintEval(ev: ConstraintEval): string {
  const c = ev.constraint;
  const label = ATTR_LABEL[c.attr];
  const suffix = c.source !== 'compat' ? '' : c.ruleId === 'camera_adapter_12v' ? ASSUMED_12V_SUFFIX : COMPAT_SUFFIX;
  if (ev.result === 'unknown') return `${label} در آگهی مشخص نیست${suffix}`;
  if (ev.result === 'pass') return `${label}: ${wantedText(c)}`;
  const actual = ev.actual === undefined ? '' : formatAttrValue(c.attr, ev.actual);
  switch (c.op) {
    case 'contains':
      return `برای ${actual} است، نه ${wantedText(c)}${suffix}`;
    case 'gte':
    case 'lte':
      return `${label}: ${actual}؛ ${wantedText(c)} لازم است${suffix}`;
    default:
      return `${label}: ${actual} به‌جای ${wantedText(c)}${suffix}`;
  }
}

export function describeOutOfBudget(minPrice: number): string {
  return `بیرون از بودجه: از ${formatTomanCompact(minPrice)}`;
}

export function describeModelCodeMismatch(code: string): string {
  return `مدلش ${ltr(code)} نیست`;
}

export const INCOMPLETE_SPECS_LABEL = 'مشخصات کامل نیست';

// ---------------------------------------------------------------------------
// Listing plausibility (requirement/plausibility.ts): the listing is another kind of goods, or its price
// contradicts its sale unit. One sentence each; every word in quotes is read from the data.
// ---------------------------------------------------------------------------

export const plausibilityCopy = {
  /** The title starts with a noun that names goods of another category (accessory / part). */
  foreignHead: (head: string, homeCategory: string, requested: string | null) =>
    `عنوان آگهی با «${head}» شروع می‌شود که بیشتر نام کالاهای دستهٔ «${homeCategory}» است${requested ? `، نه «${requested}»` : ''}؛ به نظر کالای دیگری است`,
  /** A mixed category: the title names a sibling product type. */
  siblingHead: (head: string, requested: string) => `این آگهی «${head}» است، نه «${requested}»`,
  /** Every price of a roll listing looks like a per-metre price, or the reverse. */
  unitUnclear: (stated: 'roll' | 'meter') =>
    stated === 'roll'
      ? 'آگهی «حلقهٔ ۱۰۰ متری» است ولی قیمتش به قیمت یک متر از همین سیم می‌خورد؛ واحد فروش روشن نیست'
      : 'آگهی «متری» است ولی قیمتش به قیمت یک حلقهٔ ۱۰۰ متری از همین سیم می‌خورد؛ واحد فروش روشن نیست',
  /** The marketplace blanked the title: the goods cannot be identified. */
  blankedTitle: 'عنوان این آگهی حذف شده است؛ معلوم نیست چه کالایی است',
  /** One seller's price contradicts the listing's unit (that price is left out of totals). */
  offerUnitMismatch: 'قیمت این فروشنده با واحد فروش آگهی جور نیست؛ در جمع حساب نمی‌شود',
} as const;

// ---------------------------------------------------------------------------
// Listing condition (used / refurbished / replica), read from the listing title only
// ---------------------------------------------------------------------------

/** Short flag shown on a flagged listing (options list, stop line). */
export const CONDITION_FLAG_LABEL = {
  used: 'کارکرده (استوک)',
  refurbished: 'ریفربیش',
  replica: 'کپی یا طرح',
} as const;

/** Why a listing differs because of its condition (one sentence, «طبق عنوان آگهی»). */
export const CONDITION_ISSUE_TEXT = {
  used: 'کارکرده (استوک) طبق عنوان آگهی؛ خودکار انتخاب نمی‌شود',
  refurbished: 'ریفربیش طبق عنوان آگهی؛ خودکار انتخاب نمی‌شود',
  replica: 'کپی یا طرح طبق عنوان آگهی؛ خودکار انتخاب نمی‌شود',
  not_used: 'در عنوان آگهی کارکرده یا استوک بودن نوشته نشده',
  not_replica: 'در عنوان آگهی کپی یا طرح بودن نوشته نشده',
} as const;

/**
 * Why a seller's offer is set aside / flagged: the words of that seller's own listing title,
 * e.g. «در عنوان آگهی فروشنده: های کپی». Without words: the flag label.
 */
export function offerFlagReason(evidence: readonly string[] | undefined, flags: ReadonlyArray<keyof typeof CONDITION_FLAG_LABEL> = []): string {
  const words = (evidence ?? []).filter((w) => w.trim() !== '');
  const what = words.length ? words.join('، ') : flags.map((f) => CONDITION_FLAG_LABEL[f]).join('، ');
  return `در عنوان آگهی فروشنده: ${what}`;
}

/** CONDITION_ISSUE_TEXT when the condition is stated only by the sellers' own listing titles (not the product title). */
export function offerConditionIssueText(issue: 'used' | 'refurbished' | 'replica', evidence?: readonly string[]): string {
  const words = (evidence ?? []).filter((w) => w.trim() !== '');
  return `${CONDITION_FLAG_LABEL[issue]} طبق عنوان آگهی فروشنده${words.length ? ` («${words.join('، ')}»)` : ''}؛ خودکار انتخاب نمی‌شود`;
}

/** Condition the user asked for (chip label). 'new' is the default and has no chip. */
export const CONDITION_MODE_LABEL = {
  new: 'فقط نو',
  any: 'نو یا کارکرده',
  used: 'کارکرده (استوک)',
  replica: 'کپی یا طرح',
} as const;

/** Note on an item when flagged listings were kept out of the automatic pick. */
export function conditionExcludedNote(n: number): string {
  return `${faNum(n, 0)} آگهی کارکرده، ریفربیش یا کپی خودکار انتخاب نشد؛ در گزینه‌ها با برچسب دیده می‌شوند.`;
}

/** What «condition unknown» means (about-data copy). */
export const CONDITION_UNKNOWN_NOTE = 'نو بودن یعنی در عنوان آگهی کارکرده، استوک، ریفربیش یا کپی بودن نوشته نشده است.';

// ---------------------------------------------------------------------------
// Item states
// ---------------------------------------------------------------------------

export const ITEM_STATE_LABEL: Readonly<Record<ItemState, string>> = {
  exact_model: 'مدل مشخص',
  suggested: 'پیشنهاد',
  alternative: 'جایگزین',
  needs_info: 'نیاز به اطلاعات',
  not_found: 'پیدا نشد',
  price_unknown: 'قیمت ثبت نشده',
};

export const PICK_RULE_TEXT: Readonly<Record<PickRule, string>> = {
  model_code: 'همان کد مدلی که نوشتی',
  user_pinned: 'انتخاب خودت',
  cheapest_eligible: 'ارزان‌ترین مطابق خواسته',
  cheapest_eligible_within_budget: 'ارزان‌ترین مطابق خواسته در محدودهٔ بودجه',
  closest_alternative: 'نزدیک‌ترین به خواسته‌ات',
  no_price: 'قیمتی ثبت نشده است',
};

/**
 * Pick rule of a product the plan actually buys. 'cheapest_eligible_at_stop': the plan buys another eligible model
 * than the overall cheapest because it is the cheapest one at a stop the plan uses (fewer stops / cheaper total).
 */
export const ASSIGNMENT_RULE_TEXT: Readonly<Record<AssignmentRule, string>> = {
  ...PICK_RULE_TEXT,
  cheapest_eligible_at_stop: 'ارزان‌ترین مطابق خواسته در توقف‌های همین برنامه',
};

/** Secondary line of a suggested item: «یکی از ۱۵۴ مدل مطابق خواسته · <rule>». */
export function suggestedDetail(eligibleCount: number, ruleText: string): string {
  return eligibleCount === 1 ? `تنها مدل مطابق خواسته · ${ruleText}` : `یکی از ${faNum(eligibleCount, 0)} مدل مطابق خواسته · ${ruleText}`;
}

export interface ItemDetailParams {
  state: ItemState;
  rule?: PickRule;
  eligibleCount: number;
  candidateCount: number;
  modelCode?: string;
  priceRange?: { min: number; max: number };
  differences?: string[];
  hasChoice: boolean;
  needsInfoReason?: NeedsInfoReason;
  notFoundReason?: 'no_candidates' | 'pinned_missing';
}

/** Secondary line of an item card. */
export function itemDetail(p: ItemDetailParams): string {
  switch (p.state) {
    case 'exact_model':
      return p.rule === 'model_code' && p.modelCode
        ? `همان کد مدلی که نوشتی: ${ltr(p.modelCode)}`
        : 'مدلی که خودت انتخاب کردی';
    case 'suggested':
      return suggestedDetail(p.eligibleCount, PICK_RULE_TEXT[p.rule ?? 'cheapest_eligible']);
    case 'alternative':
      if (p.hasChoice && p.differences && p.differences.length > 0) return `فرقش: ${joinFa(p.differences)}`;
      return 'موردی دقیقاً مطابق خواستهٔ تو نبود. نزدیک‌ترین‌ها را ببین.';
    case 'needs_info': {
      const n = p.eligibleCount > 0 ? p.eligibleCount : p.candidateCount;
      const range =
        p.priceRange && p.priceRange.max > p.priceRange.min
          ? `، از ${formatAmountShort(p.priceRange.min)} تا ${formatTomanCompact(p.priceRange.max)}`
          : p.priceRange
            ? `، ${formatTomanCompact(p.priceRange.min)}`
            : '';
      const why =
        p.needsInfoReason === 'compat_critical'
          ? 'یک نکتهٔ سازگاری را باید بدانیم'
          : 'خواسته کلی است و مدل‌ها خیلی با هم فرق دارند';
      return `${faNum(n, 0)} مدل${range} · ${why}`;
    }
    case 'not_found':
      return p.notFoundReason === 'pinned_missing'
        ? 'مدلی که انتخاب کرده بودی در فهرست این بازار نیست.'
        : 'موردی در فهرست این بازار پیدا نشد.';
    case 'price_unknown':
      return 'پیدا شد، اما قیمت قابل استفاده‌ای برایش ثبت نشده است.';
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const QUESTION_SKIP_LABEL = 'فرقی نمی‌کند';
export const QUESTION_STOP_LABEL = 'کافیه، پیشنهاد بده';

const QUESTION_TEXT: Partial<Record<QuestionKey, string>> = {
  brand: 'برند خاصی مدنظرت است؟',
  resolution_mp: 'دوربین چند مگاپیکسل باشد؟',
  camera_signal: 'دوربین آنالوگ باشد یا تحت شبکه؟',
  camera_form: 'دوربین چه شکلی باشد؟',
  recorder_kind: 'چه نوع ضبط‌کننده‌ای می‌خواهی؟',
  channels: 'ضبط‌کننده چند کاناله باشد؟',
  capacity_tb: 'هارد چه ظرفیتی داشته باشد؟',
  voltage_v: 'آداپتور چند ولت باشد؟',
  current_a: 'آداپتور چند آمپر باشد؟',
  phone_model: 'کدام مدل گوشی را می‌خواهی؟',
  storage_gb: 'حافظهٔ داخلی چقدر باشد؟',
  ram_gb: 'رم چقدر باشد؟',
  wire_section_mm2: 'چه سیمی؟ سطح مقطعش چقدر باشد؟',
  wire_cores: 'چند رشته باشد؟',
  sale_unit: 'چطور می‌خری؟',
  power_w: 'چند وات باشد؟',
  capacity_mah: 'ظرفیت باتری چقدر باشد؟',
  wire_strand: 'افشان باشد یا مفتولی؟',
  screen_inch: 'صفحه چند اینچ باشد؟',
  budget: 'بودجه‌ات برای هر عدد چقدر است؟',
};

export function questionText(key: QuestionKey): string {
  return QUESTION_TEXT[key] ?? `${ATTR_LABEL[key as AttrKey]} چه باشد؟`;
}

/** One line «چرا می‌پرسم» per facet question: what the answer changes for the buyer. */
const QUESTION_WHY: Partial<Record<QuestionKey, string>> = {
  brand: 'برند هم کیفیت و گارانتی را عوض می‌کند و هم قیمت را.',
  resolution_mp: 'مگاپیکسل بیشتر یعنی تصویر واضح‌تر و قیمت بالاتر.',
  camera_signal: `نوع دوربین تعیین می‌کند چه ضبط‌کننده‌ای لازم داری: آنالوگ با ${ltr('XVR/DVR')}، تحت شبکه با ${ltr('NVR')}.`,
  camera_form: 'شکل دوربین به جای نصبش بستگی دارد: بیرون ساختمان یا سقف داخل.',
  recorder_kind: 'ضبط‌کننده باید با نوع دوربین‌ها جور باشد.',
  channels: 'تعداد کانال یعنی چند دوربین را می‌شود به آن وصل کرد.',
  capacity_tb: 'ظرفیت بیشتر یعنی تصویر و فایل بیشتر، و قیمت بالاتر.',
  voltage_v: 'ولتاژ آداپتور باید با دستگاه یکی باشد؛ ولتاژ اشتباه به دستگاه آسیب می‌زند.',
  current_a: 'آمپر آداپتور باید به اندازهٔ مصرف دستگاه یا بیشتر باشد.',
  phone_model: 'قیمت و مشخصات هر مدل گوشی خیلی با هم فرق دارد.',
  storage_gb: 'حافظهٔ بیشتر یعنی جای بیشتر برای عکس و برنامه، و قیمت بالاتر.',
  ram_gb: 'رم بیشتر یعنی اجرای روان‌تر برنامه‌ها، و قیمت بالاتر.',
  wire_section_mm2: 'سطح مقطع به مصرف بستگی دارد؛ سیم نازک‌تر از لازم داغ می‌کند.',
  wire_cores: 'تعداد رشته به نوع سیم‌کشی بستگی دارد و قیمت را عوض می‌کند.',
};

/** «چرا می‌پرسم» of a facet question; the budget line quotes the real price spread of the eligible models. */
export function questionWhy(key: QuestionKey, priceRange?: { min: number; max: number }): string | undefined {
  if (key === 'budget') {
    return priceRange && priceRange.max > priceRange.min
      ? `قیمت این مدل‌ها ${budgetBandLabel(priceRange.min, priceRange.max)} تومان است؛ بازه‌ها از همین قیمت‌ها ساخته شده‌اند.`
      : 'بازه‌ها از قیمت‌های واقعی همین مدل‌ها ساخته شده‌اند.';
  }
  return QUESTION_WHY[key];
}

/** Consequence hint under a question option: «۱۸۷ مدل · از ۱٫۲ میلیون» (the price only when one is known). */
export function questionOptionHint(count: number, minPrice?: number): string {
  const models = `${faNum(count, 0)} مدل`;
  return minPrice !== undefined && minPrice > 0 ? `${models} · از ${formatAmountShort(minPrice)}` : models;
}

export const SALE_UNIT_OPTION_LABEL: Readonly<Record<string, string>> = {
  meter: 'متری',
  roll: 'حلقه‌ای (رول)',
  piece: 'عددی',
};

export function facetOptionLabel(attr: AttrKey, value: AttrValue): string {
  if (attr === 'sale_unit') return SALE_UNIT_OPTION_LABEL[String(value)] ?? String(value);
  return formatAttrValue(attr, value);
}

/** Compat-critical question: camera signal decides the recorder kind. */
export const Q_RECORDER_FOR_CAMERAS = {
  text: 'دوربین‌هایی که به این ضبط‌کننده وصل می‌کنی آنالوگ‌اند یا تحت شبکه؟ ضبط‌کننده باید با نوع دوربین جور باشد.',
  analog: `آنالوگ (${ltr('AHD/HDCVI/TVI')}) · ضبط‌کنندهٔ ${ltr('XVR/DVR')}`,
  ip: `تحت شبکه (${ltr('IP')}) · ضبط‌کنندهٔ ${ltr('NVR')}`,
} as const;

/**
 * Compat-critical question: the adapter voltage for the cameras in the list. 12 V is a general assumption (never
 * verified); «فرقی نمی‌کند» lifts the assumption (any listing-stated voltage), «کافیه، پیشنهاد بده» keeps it.
 */
export const Q_ADAPTER_FOR_CAMERAS = {
  text: 'دوربین‌ها معمولاً با آداپتور ۱۲ ولت کار می‌کنند (فرض عمومی؛ تأیید نشده). آداپتور چند ولت باشد؟',
  option12: '۱۲ ولت (معمول برای دوربین)',
} as const;

export function accessoryNoun(kind: ItemKind | undefined): string {
  return kind === 'screen_protector' ? 'گلس' : 'کاور';
}

export function questionAccessoryPhone(kind: ItemKind | undefined): string {
  return `${accessoryNoun(kind)} را برای کدام گوشی می‌خواهی؟`;
}

export function budgetBandLabel(min: number | undefined, max: number | undefined): string {
  if (min === undefined && max !== undefined) return `تا ${formatAmountShort(max)}`;
  if (min !== undefined && max === undefined) return `بیشتر از ${formatAmountShort(min)}`;
  if (min !== undefined && max !== undefined) {
    const a = formatAmountShort(min);
    const b = formatAmountShort(max);
    const unit = (s: string) => s.split(' ').slice(1).join(' ');
    // «۸ تا ۱۵ میلیون» when both share the unit
    return unit(a) && unit(a) === unit(b) ? `${a.split(' ')[0]} تا ${b}` : `${a} تا ${b}`;
  }
  return QUESTION_SKIP_LABEL;
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

export const COMPAT_STATUS_LABEL: Readonly<Record<CompatStatus, string>> = {
  listing_stated: 'طبق عنوان آگهی',
  assumed: 'فرض عمومی؛ تأیید نشده',
  unknown: 'نامشخص',
  conflict: 'ناسازگار',
};

/** Status label of a finding whose general assumption the user lifted (e.g. an adapter voltage other than 12 V). */
export const COMPAT_LIFTED_LABEL = 'فرض عمومی کنار گذاشته شد؛ تأیید نشده';

export const ASK_SELLER_PREFIX = 'از فروشنده بپرس';

const sig = (s: string) => formatAttrValue('camera_signal', s);
const kindLabel = (k: string) => formatAttrValue('recorder_kind', k);

/** Roles of a CCTV list whose sellers get «از فروشنده بپرس» lines. */
export type CompatRole = 'camera' | 'recorder' | 'hdd' | 'adapter';
export const COMPAT_ROLES: readonly CompatRole[] = ['camera', 'recorder', 'hdd', 'adapter'];
/** The item being bought at this seller («این …»). */
const ROLE_THIS: Readonly<Record<CompatRole, string>> = { camera: 'این دوربین', recorder: 'این ضبط‌کننده', hdd: 'این هارد', adapter: 'این آداپتور' };
/** The other item of the pair, bought elsewhere in the list («… که می‌خرم»). */
const ROLE_OTHER: Readonly<Record<CompatRole, string>> = { camera: 'دوربین‌هایی', recorder: 'ضبط‌کننده‌ای', hdd: 'هاردی', adapter: 'آداپتوری' };

/**
 * «از فروشنده بپرس» phrased for the item bought at THIS seller (`buying`) about the other item of the pair:
 * «آیا این دوربین با ضبط‌کننده‌ای که می‌خرم (DVR) سازگار است؟». `otherDesc` = what is known of the other item
 * (its kind / signal / voltage, else the user's own words); omitted when nothing is known.
 */
export function askCompatWith(buying: CompatRole, other: CompatRole, otherDesc?: string): string {
  const d = otherDesc?.trim();
  return `آیا ${ROLE_THIS[buying]} با ${ROLE_OTHER[other]} که می‌خرم${d ? ` (${d})` : ''} سازگار است؟`;
}

export const compatCopy = {
  channelsOk: (ch: number, q: number) => `ضبط‌کنندهٔ ${faNum(ch, 0)} کاناله برای ${faNum(q, 0)} دوربین`,
  channelsTooFew: (ch: number, q: number) =>
    `ضبط‌کنندهٔ ${faNum(ch, 0)} کاناله برای ${faNum(q, 0)} دوربین کافی نیست`,
  channelsTooFewAsk: (q: number) => `ضبط‌کننده‌ای با دست‌کم ${faNum(q, 0)} کانال دارید؟`,
  channelsUnknown: (q: number) =>
    `تعداد کانال ضبط‌کننده در آگهی نیامده است؛ برای ${faNum(q, 0)} دوربین دست‌کم ${faNum(q, 0)} کانال لازم است`,
  channelsUnknownAsk: (q: number) => `این ضبط‌کننده چند کانال دارد؟ برای ${faNum(q, 0)} دوربین کافی است؟`,

  signalAssumed: (s: string, k: string) => `دوربین‌های ${sig(s)} به ضبط‌کنندهٔ ${kindLabel(k)} وصل می‌شوند`,
  signalIpOnXvr: () =>
    `دوربین ${ltr('IP')} معمولاً به ${ltr('NVR')} وصل می‌شود؛ بعضی ضبط‌کننده‌های ${ltr('XVR')} هم دوربین ${ltr('IP')} می‌پذیرند`,
  signalConflict: (s: string, k: string) =>
    `طبق قاعدهٔ عمومی، دوربین ${sig(s)} به ضبط‌کنندهٔ ${kindLabel(k)} وصل نمی‌شود`,
  signalAsk: (s: string) => `آیا این ضبط‌کننده با دوربین‌های ${sig(s)} سازگار است؟`,
  signalCameraUnknown: (k: string) =>
    `نوع دوربین در آگهی مشخص نیست؛ معلوم نیست با ضبط‌کنندهٔ ${kindLabel(k)} جور باشد`,
  signalCameraUnknownAsk: (k: string) => `آیا این دوربین با ضبط‌کنندهٔ ${kindLabel(k)} سازگار است؟`,
  signalRecorderUnknown: (s: string) => `نوع ضبط‌کننده در آگهی مشخص نیست؛ دوربین‌ها ${sig(s)} هستند`,
  signalBothUnknown: () => 'نوع دوربین و نوع ضبط‌کننده در آگهی‌ها مشخص نیست',
  signalBothUnknownAsk: () => 'این ضبط‌کننده با این دوربین‌ها سازگار است؟',
  /** Short descriptors of the other item in a per-seller question (askCompatWith). */
  recorderKindDesc: (k: string) => kindLabel(k),
  cameraSignalDesc: (s: string) => sig(s),
  voltageDesc: (v: number) => `${faNum(v)} ولت`,

  hddInternal: (hasHddItem: boolean) =>
    hasHddItem
      ? `ضبط‌کننده برای ذخیرهٔ تصویر به هارد ${ltr('SATA')} داخلی نیاز دارد`
      : `ضبط‌کننده برای ذخیرهٔ تصویر به هارد ${ltr('SATA')} داخلی نیاز دارد؛ هارد در فهرستت نیست`,
  hddInternalAsk: () => `هارد ${ltr('SATA')} روی این ضبط‌کننده نصب می‌شود؟ تا چند ترابایت؟`,

  hddSurveillanceStated: () => 'هارد مخصوص ضبط تصویر',
  hddSurveillanceUnknown: () => 'مخصوص ضبط تصویر بودن هارد در آگهی نیامده است',
  hddSurveillanceAsk: () => 'این هارد مخصوص ضبط تصویر (سورویلنس) است؟',

  adapter12Assumed: () => 'دوربین‌ها معمولاً با آداپتور ۱۲ ولت کار می‌کنند؛ این آداپتور ۱۲ ولت است',
  adapterUnknown: () => 'ولتاژ آداپتور در آگهی نیامده است؛ دوربین‌ها معمولاً ۱۲ ولت می‌خواهند',
  adapterConflict: (v: number) => `این آداپتور ${faNum(v)} ولت است؛ دوربین‌ها معمولاً ۱۲ ولت می‌خواهند`,
  adapterAsk: () => 'این آداپتور برای این دوربین‌ها مناسب است؟',
  /** The user chose this voltage themselves (answer / typed): not a conflict with a fact, only with our assumption. */
  adapterUserVoltage: (v: number) =>
    `آداپتور ${faNum(v)} ولت را خودت خواستی؛ طبق فرض عمومی دوربین‌ها معمولاً ۱۲ ولت می‌خواهند؛ ولتاژ دوربین‌ها را چک کن`,
  /** The user lifted the 12 V assumption («فرقی نمی‌کند» on the voltage question). */
  adapterRelaxed: (v: number) =>
    `این آداپتور ${faNum(v)} ولت است؛ ولتاژ را آزاد گذاشتی، ولی دوربین‌ها معمولاً ۱۲ ولت می‌خواهند (فرض عمومی)`,
  /**
   * Adapter current for several cameras (camera_adapter_current, never verified: no listing states a camera's current).
   * `adapters` = adapter units in the list; `amps` = the adapter listing's current when it states one (never invented).
   */
  adapterCurrent: (cams: number, adapters: number, amps?: number) => {
    const known = amps !== undefined ? `؛ آگهی این آداپتور ${faNum(amps)} آمپر نوشته (${faNum(adapters, 0)} عدد)` : '';
    return adapters >= cams
      ? `برای ${faNum(cams, 0)} دوربین ${faNum(adapters, 0)} آداپتور در فهرست است؛ جریان هر آداپتور باید برای دوربینش کافی باشد${known}؛ تأیید نشده`
      : `برای ${faNum(cams, 0)} دوربین، جریان کل آداپتور (یا تعداد آداپتورها) باید کافی باشد${known}؛ تأیید نشده`;
  },
  adapterCurrentAsk: (cams: number) => `جمع جریان مورد نیاز ${faNum(cams, 0)} دوربین چقدر است و این آداپتور کافی است؟`,
  /** The same relationship asked at a camera's seller. */
  cameraCurrentAsk: (cams: number) => `هر دوربین چند آمپر جریان می‌کشد؟ (برای انتخاب آداپتور ${faNum(cams, 0)} دوربین)`,
  /**
   * Adapter item note: the user did not write how many adapters while there are several cameras. Not a blocking
   * question; the plan buys the quantity shown.
   */
  adapterQtyNote: (cams: number, adapters: number) =>
    `تعداد آداپتور را ننوشتی؛ ${faNum(adapters, 0)} عدد برای ${faNum(cams, 0)} دوربین در نظر گرفته شد. یک آداپتور پرقدرت یا یک آداپتور برای هر دوربین؟ جریان کافی را از فروشنده بپرس.`,
  /** A conflict line that comes from what the user chose themselves (typed, answered or pinned on both sides). */
  fromUserChoice: (sentence: string) => `${sentence} (از انتخاب‌های خودت)`,
  /**
   * Item note: two things the user fixed contradict each other under a rule. Nothing is changed on their behalf and no
   * question deepens it.
   */
  statedConflict: (sentence: string, otherLabel: string) =>
    `با «${otherLabel}» که خودت خواستی جور نیست: ${sentence}. سؤالی که این ناسازگاری را بیشتر کند نمی‌پرسیم؛ اگر اشتباه است، یکی از این دو را عوض کن.`,
  /** A pick was set aside by the plan's compatibility guard and nothing compatible was left. */
  guardDropped: (sentence: string) => `${sentence}؛ مدلی که با بقیهٔ فهرست جور باشد پیدا نشد. از گزینه‌ها یکی را انتخاب کن.`,

  accessoryFits: (kind: ItemKind | undefined, model: string) => `${accessoryNoun(kind)} برای ${isolateIfLatin(model)}`,
  accessoryConflict: (kind: ItemKind | undefined, listed: string[], model: string) =>
    `این ${accessoryNoun(kind)} برای ${joinFa(listed.map(isolateIfLatin))} است، نه ${isolateIfLatin(model)}`,
  accessoryNoModelInListing: (kind: ItemKind | undefined) =>
    `مدل گوشی در آگهی ${accessoryNoun(kind)} نیامده است`,
  accessoryPhoneUnknown: (kind: ItemKind | undefined) =>
    `معلوم نیست ${accessoryNoun(kind)} برای کدام گوشی است`,
  accessoryAsk: (kind: ItemKind | undefined, model: string) =>
    `این ${accessoryNoun(kind)} به گوشی ${isolateIfLatin(model)} می‌خورد؟`,
  accessoryAskGeneric: (kind: ItemKind | undefined) => `این ${accessoryNoun(kind)} به کدام گوشی می‌خورد؟`,
} as const;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const OPEN_STATUS_LABEL: Readonly<Record<OpenStatus, string>> = {
  open: 'در این زمان باز است',
  closed: 'در این زمان بسته است',
  unknown: 'ساعت کاری ثبت نشده',
};

export const PLAN_ORDER_NOTE = 'ترتیب پیشنهادی بر اساس نزدیکی است، نه مسیر پیاده.';
export const SUGGESTION_NOTE = 'با مدل‌های پیشنهادی';
export const PARTIAL_LABEL = 'ناقص';

export function distanceToNextText(m: number): string {
  return `${formatMeters(m)} تا توقف بعدی (خط مستقیم)`;
}

/** How a missing item is reported on the total's coverage line. */
export type MissingGroup = 'not_found' | 'waiting' | 'no_price' | 'closed' | 'excluded' | 'stop_limit';
export const MISSING_GROUP: Readonly<Record<MissingReason, MissingGroup>> = {
  not_found: 'not_found',
  needs_info: 'waiting',
  no_choice: 'waiting',
  price_unknown: 'no_price',
  no_offer: 'no_price',
  closed: 'closed',
  excluded: 'excluded',
  stop_limit: 'stop_limit',
};
export const MISSING_GROUP_LABEL: Readonly<Record<MissingGroup, string>> = {
  not_found: 'پیدا نشد',
  waiting: 'منتظر انتخاب',
  no_price: 'قیمت ثبت نشده',
  closed: 'فروشنده‌ها در این زمان بسته‌اند',
  excluded: 'فروشنده‌ها کنار گذاشته شده‌اند',
  stop_limit: 'در این برنامه جا نشد',
};
export const MISSING_GROUP_ORDER: readonly MissingGroup[] = ['not_found', 'waiting', 'no_price', 'closed', 'excluded', 'stop_limit'];

// ---------------------------------------------------------------------------
// No eligible product (requirement/nomatch.ts): why, what to relax. Every number comes from the data.
// ---------------------------------------------------------------------------

/** «۵۰ میلیون» for a max-only budget, else the band label («۸ تا ۱۵ میلیون»، «بیشتر از ۸ میلیون»). */
function budgetText(min: number | undefined, max: number | undefined): string {
  return min === undefined && max !== undefined ? formatAmountShort(max) : budgetBandLabel(min, max);
}

export const noMatchCopy = {
  budget: (min: number | undefined, max: number | undefined, cheapest: number | null) =>
    cheapest !== null
      ? `هیچ مدلی با بودجهٔ ${budgetText(min, max)} پیدا نشد؛ ارزان‌ترین مدل ${formatTomanCompact(cheapest)} است`
      : `هیچ مدلی با بودجهٔ ${budgetText(min, max)} پیدا نشد`,
  /** The user asked for used / stock listings; only listings not stated as used match the rest. */
  conditionUsed: (n: number) => `هیچ آگهی کارکرده یا استوکی پیدا نشد؛ ${faNum(n, 0)} مدل نو مطابق بقیهٔ خواسته‌ات هست`,
  conditionReplica: (n: number) => `هیچ آگهی کپی یا طرحی پیدا نشد؛ ${faNum(n, 0)} مدل دیگر مطابق بقیهٔ خواسته‌ات هست`,
  /** Default policy (new only): the only matching listings are used / refurbished / copies. */
  conditionNew: (n: number) => `فقط آگهی کارکرده، ریفربیش یا کپی پیدا شد (${faNum(n, 0)} مدل)؛ خودکار انتخاب نمی‌شوند`,
  attr: (label: string, n: number) => `هیچ مدلی با «${label}» پیدا نشد؛ ${faNum(n, 0)} مدل فقط در همین شرط فرق دارد`,
  attrNone: (label: string) => `هیچ مدلی با «${label}» پیدا نشد`,
  unknown: (attrLabel: string, n: number) =>
    `${faNum(n, 0)} مدل پیدا شد ولی ${attrLabel} در آگهی‌شان مشخص نیست؛ خودکار انتخاب نمی‌شوند`,
  model: (code: string) => `مدلی با کد ${ltr(code)} پیدا نشد`,
  kind: () => 'آگهی‌های پیدا‌شده به نظر کالای دیگری‌اند؛ مدل مطابق خواسته‌ات پیدا نشد',
  unit: () => 'واحد فروش آگهی‌های مطابق روشن نیست؛ خودکار انتخاب نمی‌شوند',
  generic: (n: number) => `هیچ مدلی دقیقاً مطابق خواسته‌ات پیدا نشد؛ ${faNum(n, 0)} مدل نزدیک را ببین`,
  relaxBudget: 'بودجه را بردار',
  relaxStated: (label: string) => `شرط «${label}» را بردار`,
} as const;

export const planCopy = {
  totalComplete: (n: number, total: number) => `جمع ${faNum(n, 0)} مورد: ${formatTomanCompact(total)}`,
  totalPartial: (covered: number, n: number, total: number) =>
    `فقط ${faNum(covered, 0)} از ${faNum(n, 0)} مورد: ${formatTomanCompact(total)}`,
  /** @deprecated one undifferentiated line; use `missingLines` (one group per reason). */
  missingLine: (labels: string[]) => `بدون قیمت یا انتخاب: ${joinFa(labels)}`,
  /**
   * Items left out of the total, grouped by why: «پیدا نشد: …» · «منتظر انتخاب: …» · «قیمت ثبت نشده: …» (then
   * closed / excluded sellers and the stop limit). Groups keep the order of MISSING_GROUP_ORDER; empty groups are omitted.
   */
  missingLines: (entries: readonly { label: string; reason: MissingReason }[]): string => {
    const groups = new Map<MissingGroup, string[]>();
    for (const e of entries) {
      const g = MISSING_GROUP[e.reason];
      const l = groups.get(g) ?? [];
      if (!l.includes(e.label)) l.push(e.label);
      groups.set(g, l);
    }
    return MISSING_GROUP_ORDER.filter((g) => groups.has(g))
      .map((g) => `${MISSING_GROUP_LABEL[g]}: ${joinFa(groups.get(g)!)}`)
      .join(' · ');
  },

  /** Marker on the total line of a plan that holds a compat conflict (never a «normal» complete plan). */
  markerConflict: 'ناسازگاری دارد',
  /** Marker when the user lifted a general compat assumption (e.g. a non-12 V adapter next to cameras). */
  markerUnverified: 'بدون تأیید سازگاری',
  /**
   * The market view's total by the listed prices, worded once: «جمع طبق فهرست برای ۴ مورد: ۲۰٫۳ میلیون تومان»,
   * «جمع طبق فهرست، فقط ۳ از ۵ مورد: …», plus « — <marker>». Replaces «جمع طبق فهرست · جمع ۴ مورد: …».
   */
  datasetTotal: (covered: number, n: number, total: number, marker?: string): string => {
    const head = covered >= n ? `جمع طبق فهرست برای ${faNum(n, 0)} مورد` : `جمع طبق فهرست، فقط ${faNum(covered, 0)} از ${faNum(n, 0)} مورد`;
    const line = `${head}: ${formatTomanCompact(total)}`;
    return marker ? `${line} — ${marker}` : line;
  },
  /** «جمع ۴ مورد: ۵ میلیون تومان — ناسازگاری دارد». */
  withMarker: (line: string, marker: string) => `${line} — ${marker}`,
  /** Reason of a flagged plan: no superlative («ارزان‌ترین…» / «کم‌توقف‌ترین…»), the marker instead. */
  flagged: (n: number, k: number, marker: string) => `ترکیب برای هر ${faNum(n, 0)} مورد، با ${faCount(k)} توقف؛ ${marker}: بخش سازگاری را ببین.`,

  defaultCheapest: (n: number, k: number) => `ارزان‌ترین ترکیب برای هر ${faNum(n, 0)} مورد، با ${faCount(k)} توقف.`,
  defaultFewestStops: (n: number, k: number) => `کم‌توقف‌ترین ترکیب برای هر ${faNum(n, 0)} مورد: ${faCount(k)} توقف.`,
  defaultCompact: (n: number, spread: number) =>
    spread > 0
      ? `نزدیک‌ترین ترکیب به هم برای هر ${faNum(n, 0)} مورد؛ بیشترین فاصلهٔ هوایی بین توقف‌ها ${formatMeters(spread)}.`
      : `نزدیک‌ترین ترکیب به هم برای هر ${faNum(n, 0)} مورد: همه در یک جا.`,
  /** Partial plans never use a superlative. */
  partial: (covered: number, n: number, k: number) =>
    `برنامه ناقص است: ${faNum(covered, 0)} از ${faNum(n, 0)} مورد پوشش دارد، با ${faCount(k)} توقف.`,
  spread: (spread: number) => `همه در فاصلهٔ هوایی ${formatMeters(spread)}`,
  singleShop: (shopName: string) => `همه‌چیز از یک مغازه: ${isolateIfLatin(shopName)}`,
  onlyOneBecauseSingleSource: (itemLabel: string) =>
    `ترکیب دیگری با هزینه یا توقف کمتر نیست؛ چون «${itemLabel}» فقط در یک جا پیدا شد.`,
  onlyOne: () => 'ترکیب دیگری با هزینه یا تعداد توقف کمتر وجود ندارد.',
  nothingPlannable: () => 'هنوز هیچ موردی قیمت و فروشنده ندارد؛ برنامه‌ای ساخته نشد.',
  closedExcluded: (n: number) => `${faNum(n, 0)} مغازه در زمانی که انتخاب کردی بسته است و کنار گذاشته شد.`,
  /**
   * Label of one alternative plan: its own stop count and its price delta vs the shown plan, so every
   * non-dominated alternative reads differently («۱ توقف · ۴٫۷ میلیون تومان بیشتر», «۲ توقف · ۱٫۸ میلیون تومان بیشتر»).
   */
  altLabel: (stopCount: number, cost: number): string => {
    const money = cost > 0 ? `${formatTomanCompact(cost)} بیشتر` : cost < 0 ? `${formatTomanCompact(-cost)} ارزان‌تر` : 'همان قیمت';
    return `${faNum(stopCount, 0)} توقف · ${money}`;
  },
  /** Delta of an alternative vs the default plan. */
  delta: (cost: number, stops: number): string => {
    const parts: string[] = [];
    if (cost > 0) parts.push(`${formatTomanCompact(cost)} بیشتر`);
    else if (cost < 0) parts.push(`${formatTomanCompact(-cost)} ارزان‌تر`);
    else parts.push('همان قیمت');
    if (stops > 0) parts.push(`${faCount(stops)} توقف بیشتر`);
    else if (stops < 0) parts.push(`${faCount(-stops)} توقف کمتر`);
    return parts.join('، ');
  },
} as const;

// ---------------------------------------------------------------------------
// Places («کجا بروم»: buildings ranked for the whole list)
// ---------------------------------------------------------------------------

/** A mall / building name inside a sentence: Persian digits («پاساژ علاالدین ۲»), Latin names isolated. */
export function placeNameFa(name: string): string {
  return LATIN.test(name) ? ltr(name) : toPersianDigits(name);
}

export const placesCopy = {
  /** One building has every item that is available anywhere. */
  allIn: (n: number, name: string, total: number) =>
    `${n === 2 ? 'هر دو مورد' : `همهٔ ${faNum(n, 0)} مورد`} در ${placeNameFa(name)} هست (جمع ${formatTomanCompact(total)}).`,
  /** The best building has several items, not all. */
  mostIn: (covered: number, n: number, name: string) =>
    `${faNum(covered, 0)} از ${faNum(n, 0)} مورد در ${placeNameFa(name)} هست؛ بقیه را باید از جای دیگری بخری.`,
  /** A one-item list: where it is cheapest. */
  single: (places: number, name: string) =>
    places > 1 ? `این مورد در ${faNum(places, 0)} جا پیدا شد؛ ارزان‌ترین در ${placeNameFa(name)}.` : `این مورد فقط در ${placeNameFa(name)} پیدا شد.`,
  /** No building has two items of the list. */
  scattered: () => 'هیچ جایی بیش از یک مورد از فهرست را ندارد؛ باید از چند جا بخری.',
  /** Nothing of the list has a price and a seller yet. */
  nothing: () => 'هنوز هیچ موردی قیمت و فروشنده ندارد؛ جایی برای پیشنهاد نیست.',
} as const;
