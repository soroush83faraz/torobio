/**
 * Templated Persian messages of the assistant (tone «تو»). Every name comes from validated data (the plan's shops
 * and malls, the user's own item texts) and every number from data fields; nothing here is model prose.
 */
import { budgetBandLabel, faCount, faNum, formatTomanCompact, isolateIfLatin, toPersianDigits } from '@app/core';
import { untrustedText } from '../llm/sanitize.js';
import type { AssistFacts } from './facts.js';

/** A data name (shop, mall, item text, brand) safe to put inside a sentence. */
export function q(name: string): string {
  return `«${isolateIfLatin(untrustedText(name, 40))}»`;
}

export const MAX_ITEMS_FA = faNum(12, 0);

export const msg = {
  cheapestAlready: 'برنامهٔ فعلی همین حالا ارزان‌ترین ترکیب با همین پوشش است.',
  cheapest(saving?: number, moreStops?: number): string {
    const tail =
      saving && saving > 0
        ? `؛ ${formatTomanCompact(saving)} ارزان‌تر${moreStops && moreStops > 0 ? ` با ${faCount(moreStops)} توقف بیشتر` : ''}`
        : '';
    return `ارزان‌ترین ترکیب با همین پوشش انتخاب شد${tail}.`;
  },
  fewestAlready(stops: number): string {
    return stops > 0 ? `برنامهٔ فعلی همین حالا کمترین توقف ممکن را دارد (${faCount(stops)} توقف).` : 'هنوز برنامه‌ای نیست که توقف‌هایش کمتر شود.';
  },
  fewest(closer: boolean, fewerStops?: number, extra?: number): string {
    const lead = closer ? 'برای نزدیک‌تر شدن خریدها، برنامه با کمترین تعداد توقف ساخته شد' : 'برنامه با کمترین تعداد توقف ساخته شد';
    const tail =
      fewerStops && fewerStops > 0
        ? `؛ ${faCount(fewerStops)} توقف کمتر${extra && extra > 0 ? ` و ${formatTomanCompact(extra)} گران‌تر` : ''}`
        : '';
    return `${lead}${tail}.`;
  },
  excludeShop: (name: string) => `مغازهٔ ${q(name)} از برنامه کنار گذاشته شد؛ برنامه دوباره حساب می‌شود.`,
  excludeShopAlready: (name: string) => `مغازهٔ ${q(name)} از قبل کنار گذاشته شده است.`,
  excludeMall: (mall: string) => `مغازه‌های ${q(mall)} از برنامه کنار گذاشته شدند؛ برنامه دوباره حساب می‌شود.`,
  mallTooBig: (mall: string) => `${q(mall)} مغازه‌های زیادی دارد؛ مغازه‌هایش را یکی‌یکی کنار بگذار.`,
  tooManyExclusions: 'تعداد مغازه‌های کنارگذاشته به سقف رسیده؛ چندتا را برگردان و دوباره امتحان کن.',
  onlyOpenNow: (hhmm: string) =>
    `فقط مغازه‌هایی که الان (ساعت ${toPersianDigits(hhmm)}) باز هستند در برنامه می‌آیند. مغازه‌هایی که ساعت کاری‌شان ثبت نشده کنار گذاشته نمی‌شوند.`,
  onlyOpenAlready: 'مغازه‌های بسته در زمانی که انتخاب کردی از قبل کنار گذاشته شده‌اند.',
  onlyOpenOff: 'فیلتر ساعت کاری برداشته شد؛ همهٔ مغازه‌ها در برنامه حساب می‌شوند.',
  onlyOpenOffAlready: 'فیلتر ساعت کاری فعال نیست؛ همهٔ مغازه‌ها در برنامه حساب می‌شوند.',
  swapBrand: (item: string, brand: string) => `برند ${q(brand)} برای ${q(item)} گذاشته شد؛ برنامه دوباره حساب می‌شود.`,
  swapBrandAlready: (item: string, brand: string) => `برند ${q(item)} همین حالا ${q(brand)} است.`,
  pickBrand: (item: string) => `کدام برند را برای ${q(item)} بگذارم؟ یکی از برندهای موجود را انتخاب کن.`,
  unknownBrand: (item: string) => `این برند بین مدل‌های ${q(item)} در این بازار پیدا نشد.`,
  relax: (item: string, label: string) => `شرط ${q(label)} از ${q(item)} برداشته شد.`,
  relaxBudget: (item: string) => `بودجهٔ ${q(item)} برداشته شد.`,
  notStated: (item: string) => `برای ${q(item)} چنین شرطی ثبت نشده است.`,
  setBudget: (item: string, min: number | undefined, max: number | undefined) => `بودجهٔ ${q(item)} ${budgetBandLabel(min, max)} تومان شد.`,
  needsAmount: 'مبلغ را هم بنویس؛ مثلاً «بودجهٔ دوربین زیر ۵ میلیون».',
  invalidBudget: 'این بازهٔ بودجه درست نیست؛ دوباره بنویس، مثلاً «بین ۲ تا ۳ میلیون».',
  added(texts: readonly string[]): string {
    if (texts.length === 1) return `${q(texts[0] ?? '')} به فهرست اضافه شد.`;
    return `${faCount(texts.length)} مورد به فهرست اضافه شد: ${texts.map(q).join('، ')}.`;
  },
  nothingParsed: 'موردی برای اضافه کردن پیدا نکردم؛ نام کالا را بنویس، مثلاً «یک آداپتور ۱۲ ولت هم اضافه کن».',
  parseUnavailable: 'اضافه کردن مورد الان ممکن نیست؛ از صفحهٔ فهرست اضافه کن.',
  tooManyItems: `حداکثر ${MAX_ITEMS_FA} مورد در یک فهرست جا می‌شود؛ اول یکی را حذف کن.`,
  removed: (item: string) => `${q(item)} از فهرست حذف شد.`,
  needsShop: 'کدام مغازه را کنار بگذارم؟ یکی را انتخاب کن.',
  noStops: 'هنوز توقفی در برنامه نیست که کنار گذاشته شود.',
  needsItem: 'منظورت کدام مورد است؟ یکی را انتخاب کن.',
  unknownItem: 'این مورد در فهرستت نیست.',
  unknownShop: 'این مغازه در برنامهٔ فعلی نیست.',
  unknownMall: 'این پاساژ در برنامهٔ فعلی نیست.',
  unsupported:
    'با این فهرست امکانش نیست؛ من فقط می‌توانم برنامه را ارزان‌تر یا کم‌توقف‌تر کنم، مغازه یا پاساژی را کنار بگذارم، فقط مغازه‌های باز را نگه دارم، برند یا بودجهٔ یک مورد را عوض کنم، شرطی را بردارم یا موردی را اضافه و حذف کنم.',
  llmUnavailable: 'الان فقط گزینه‌های آماده کار می‌کنند؛ یکی از دکمه‌های بالا را بزن یا درخواستت را ساده‌تر بنویس.',
  empty: 'یکی از گزینه‌ها را بزن یا درخواستت را بنویس.',
  noPlanYet: 'هنوز برنامه‌ای ساخته نشده؛ اول موردهای فهرست را کامل کن.',
  /** Explanation from the engine's own templated sentences. */
  explain(f: AssistFacts): string {
    if (f.stops.length === 0) return f.reason ? `${f.reason}` : this.noPlanYet;
    const parts = [f.reason, f.totalLine].filter((x): x is string => !!x && x.trim() !== '');
    return parts.map((p) => (/[.!؟?]$/.test(p) ? p : `${p}.`)).join(' ');
  },
} as const;
