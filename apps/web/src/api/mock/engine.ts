/**
 * Mock engine: a miniature of the real server logic (item states, one question at a time,
 * Pareto planner over (cost, stops) at maximal coverage, three-level compatibility).
 * Everything here is replaceable by the real API; the UI only sees the shapes in ../types.
 */
import { formatTomanCompact, formatWeekday, toLatinDigits, toPersianDigits } from '../../lib/format';
import { CONDITION_ANY, isDeadEnd } from '../../lib/items';
import type {
  AssistRequest,
  AssistResponse,
  CompatLine,
  ItemResolution,
  ItemState,
  ModelOption,
  OptionsResponse,
  ParseResponse,
  PlanAlternative,
  PlanResponse,
  Question,
  Requirement,
  RequirementChip,
  RequirementState,
  ResolveResponse,
  SellerOption,
  Stop,
  StopLine,
  UnpricedItem,
  VisitTime,
} from '../types';
import {
  META,
  NEARBY_CATEGORIES,
  PRODUCTS,
  SHOPS,
  productById,
  shopById,
  type Kind,
  type MockOffer,
  type MockProduct,
  type MockShop,
} from './data';

const fa = toPersianDigits;

/* =============================== text parsing =============================== */

const normalizeFa = (s: string) =>
  s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, '‌').trim();

const KEYWORDS: { kind: Kind; words: string[]; label: string }[] = [
  { kind: 'case', words: ['قاب', 'کاور'], label: 'قاب و کاور گوشی' },
  { kind: 'glass', words: ['گلس', 'محافظ صفحه'], label: 'گلس و محافظ صفحه' },
  { kind: 'phone', words: ['گوشی', 'موبایل', 'سامسونگ', 'آیفون'], label: 'گوشی موبایل' },
  { kind: 'recorder', words: ['ضبط', 'دی وی آر', 'دی‌وی‌آر', 'ان وی آر', 'ان‌وی‌آر', 'xvr', 'nvr', 'dvr'], label: 'ضبط‌کننده' },
  { kind: 'camera', words: ['دوربین'], label: 'دوربین مداربسته' },
  { kind: 'hdd', words: ['هارد', 'حافظه'], label: 'هارد اینترنال' },
  { kind: 'adapter', words: ['آداپتور', 'آداپتر', 'منبع تغذیه'], label: 'آداپتور' },
  { kind: 'breaker', words: ['مینیاتوری', 'فیوز'], label: 'کلید مینیاتوری' },
  { kind: 'socket', words: ['پریز', 'کلید'], label: 'پریز و کلید' },
  { kind: 'wire', words: ['سیم', 'کابل'], label: 'سیم و کابل برق' },
];

let idCounter = 0;
const newId = () => `it${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function detectKind(segment: string): { kind: Kind; label: string } | null {
  const low = segment.toLowerCase();
  for (const k of KEYWORDS) {
    if (k.words.some((w) => low.includes(w))) return { kind: k.kind, label: k.label };
  }
  return null;
}

const MODEL_RE = /[A-Za-z][A-Za-z0-9]*(?:[-\s]?[A-Za-z0-9]+)*/;

function buildRequirement(segment: string, siblings: string[]): Requirement {
  const text = normalizeFa(segment).replace(/\s+/g, ' ');
  const latin = toLatinDigits(text);
  const qtyMatch = /^(\d+)\s*(متر|عدد|تا|تایی)?\s*/.exec(latin);
  const qty = qtyMatch ? Number(qtyMatch[1]) : 1;
  const unit = qtyMatch?.[2] === 'متر' ? 'متر' : undefined;
  const found = detectKind(text);
  const chips: RequirementChip[] = [];
  const modelMatch = MODEL_RE.exec(text);
  const modelCode = modelMatch ? modelMatch[0].trim() : undefined;

  if (found?.kind === 'camera' || found?.kind === 'recorder') {
    if (text.includes('داهوا')) chips.push({ key: 'brand', label: 'داهوا' });
    if (text.includes('هایک')) chips.push({ key: 'brand', label: 'هایک‌ویژن' });
    const mp = /(\d+)\s*مگ/.exec(latin);
    if (mp) chips.push({ key: 'mp', label: `${fa(mp[1]!)} مگاپیکسل` });
    const ch = /(\d+)\s*کانال/.exec(latin);
    if (ch) chips.push({ key: 'channels', label: `${fa(ch[1]!)} کانال` });
  }
  if (found?.kind === 'hdd') {
    const tb = /(\d+)\s*ترا/.exec(latin);
    if (tb) chips.push({ key: 'capacity', label: `${fa(tb[1]!)} ترابایت` });
  }
  if (found?.kind === 'wire') {
    const g = /(\d)[.٫,](\d)/.exec(latin.replace('٫', '.'));
    if (g) chips.push({ key: 'gauge', label: `افشان ${fa(`${g[1]}٫${g[2]}`)}` });
  }
  if (found?.kind === 'breaker') {
    const a = /(\d+)\s*آمپر/.exec(latin);
    if (a) chips.push({ key: 'amp', label: `${fa(a[1]!)} آمپر` });
  }
  if (found?.kind === 'phone') {
    if (text.includes('سامسونگ')) chips.push({ key: 'brand', label: 'سامسونگ' });
  }
  const phoneText = siblings.find((s) => detectKind(s)?.kind === 'phone');
  if ((found?.kind === 'case' || found?.kind === 'glass') && phoneText) {
    const m = MODEL_RE.exec(phoneText);
    if (m) chips.push({ key: 'device', label: `برای ${m[0].trim()}`, inherited: true });
  }
  const budgetMatch = /زیر\s*(\d+)\s*میلیون/.exec(latin);
  const typedModel =
    modelCode && /\d/.test(modelCode) && (found?.kind !== 'case' && found?.kind !== 'glass') ? modelCode : undefined;
  if (typedModel && found?.kind === 'phone') chips.push({ key: 'model', label: typedModel });

  return {
    id: newId(),
    text,
    qty,
    unit,
    categoryId: found?.kind ?? null,
    categoryLabel: found?.label ?? 'نامشخص',
    chips,
    modelCode: typedModel,
    ...(budgetMatch ? { budget: { max: Number(budgetMatch[1]) * 1_000_000 } } : {}),
  };
}

export function mockParse(text: string): ParseResponse {
  const cleaned = normalizeFa(text);
  const segments = cleaned
    .split(/[،,\n؛;]|\sو\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = segments.map((s) => buildRequirement(s, segments));
  const kinds = new Set(items.map((i) => i.categoryId));
  let title = items[0]?.text ?? 'برنامهٔ تازه';
  if (kinds.has('camera') || kinds.has('recorder')) title = 'پروژهٔ دوربین مداربسته';
  else if (kinds.has('wire') || kinds.has('socket') || kinds.has('breaker')) title = 'برق‌کشی اتاق';
  else if (kinds.has('phone') || kinds.has('case') || kinds.has('glass')) title = 'گوشی و لوازم جانبی';
  else if (items.length === 1) title = items[0]!.text;
  return { title, items };
}

/* =============================== visit / hours =============================== */

const TZ = 'Asia/Tehran';

function visitDate(visit: VisitTime, now: Date): Date {
  if (visit.day === 'tomorrow') return new Date(now.getTime() + 86_400_000);
  if (visit.day === 'date' && visit.date) return new Date(`${visit.date}T09:00:00+03:30`);
  return now;
}

function jsWeekday(d: Date): number {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

function nowHour(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(d);
  const [h, m] = parts.split(':').map(Number) as [number, number];
  return h + m / 60;
}

function visitHour(visit: VisitTime, now: Date): number {
  switch (visit.window) {
    case 'morning':
      return 10;
    case 'noon':
      return 13;
    case 'evening':
      return 18;
    case 'exact': {
      const [h, m] = (visit.time ?? '12:00').split(':').map(Number) as [number, number];
      return h + (m || 0) / 60;
    }
    default:
      return visit.day === 'today' ? nowHour(now) : 12;
  }
}

export const isVisitActive = (visit: VisitTime) => !(visit.day === 'today' && visit.window === 'any');

function openStatus(shop: MockShop, visit: VisitTime, now: Date): 'open' | 'closed' | 'unknown' {
  if (!shop.hours) return 'unknown';
  const day = shop.hours[jsWeekday(visitDate(visit, now))];
  if (!day) return 'closed';
  if (visit.window === 'any' && visit.day !== 'today') return 'open';
  const h = visitHour(visit, now);
  return h >= day[0] && h < day[1] ? 'open' : 'closed';
}

const hourText = (h: number) => (Number.isInteger(h) ? fa(h) : `${fa(Math.floor(h))}:${fa(String(Math.round((h % 1) * 60)).padStart(2, '0'))}`);

function dayLabel(visit: VisitTime, now: Date): string {
  if (visit.day === 'today') return 'امروز';
  if (visit.day === 'tomorrow') return 'فردا';
  return formatWeekday(visitDate(visit, now));
}

function hoursText(shop: MockShop, visit: VisitTime, now: Date): string {
  if (!shop.hours) return 'ساعت کاری ثبت نشده';
  const d = shop.hours[jsWeekday(visitDate(visit, now))];
  const label = dayLabel(visit, now);
  if (!d) return `${label} تعطیل است`;
  return `ساعت کار ${label}: ${hourText(d[0])} تا ${hourText(d[1])}`;
}

/* =============================== item evaluation =============================== */

interface Ev {
  req: Requirement;
  res: ItemResolution;
  product?: MockProduct;
  /** Quantity bought of the sale unit. */
  lineQty: number;
  /** The product is a real pick we can plan with. */
  plannable: boolean;
}

const faN = (n: number) => fa(String(n));

function chip(req: Requirement, key: string): string | undefined {
  return req.chips?.find((c) => c.key === key)?.label;
}

function q(
  req: Requirement,
  id: string,
  kind: Question['kind'],
  prompt: string,
  options: Question['options'],
  why?: string,
): Question {
  return { id, itemId: req.id, kind, prompt, options: [...options, { id: 'any', label: 'فرقی نمی‌کند' }], why };
}

const answerOf = (state: RequirementState, req: Requirement, qid: string) => state.answers[req.id]?.[qid];

function priceStats(p?: MockProduct) {
  const prices = (p?.offers ?? []).map((o) => o.price).filter((x): x is number => x != null);
  return { low: prices.length ? Math.min(...prices) : null, count: p?.offers.length ?? 0 };
}

function lineQtyOf(req: Requirement, p: MockProduct): number {
  if (p.kind === 'wire') {
    const meters = req.unit === 'متر' ? req.qty : 100;
    return Math.ceil(meters / (p.metersPerUnit ?? 1));
  }
  return req.qty;
}

function deviceOf(req: Requirement, state: RequirementState): string | undefined {
  const c = req.chips?.find((x) => x.key === 'device');
  if (c) return /A\s?57/i.test(c.label) ? 'A57' : /A\s?56/i.test(c.label) ? 'A56' : undefined;
  const a = answerOf(state, req, 'device');
  if (a === 'a56') return 'A56';
  if (a === 'a57') return 'A57';
  return undefined;
}

function evalItem(req: Requirement, state: RequirementState): Ev {
  const kind = req.categoryId as Kind | null;
  const pinnedId = state.pins[req.id];
  const pinned = pinnedId ? productById(pinnedId) : undefined;

  const done = (
    product: MockProduct,
    st: ItemState,
    extra: Partial<ItemResolution> = {},
  ): Ev => {
    const stats = priceStats(product);
    const res: ItemResolution = {
      itemId: req.id,
      state: stats.low == null ? 'no_price' : st,
      product: { id: product.id, name: product.name, modelCode: product.modelCode },
      sellerCount: stats.count,
      unitLabel: product.unitLabel,
      unitPrice: stats.low,
      pendingQuestions: 0,
      ...extra,
    };
    if (res.state === 'no_price') {
      res.reason = 'مدل پیدا شد، اما قیمت قابل‌استفاده‌ای برای آن ثبت نشده است.';
    }
    return { req, res, product, lineQty: lineQtyOf(req, product), plannable: res.state !== 'no_price' };
  };

  const needs = (question: Question | undefined, extra: Partial<ItemResolution>, pending: number): Ev => ({
    req,
    plannable: false,
    lineQty: req.qty,
    res: { itemId: req.id, state: 'needs_info', question, pendingQuestions: pending, ...extra },
  });

  if (!kind) {
    return {
      req,
      plannable: false,
      lineQty: req.qty,
      res: {
        itemId: req.id,
        state: 'not_found',
        pendingQuestions: 0,
        reason: `«${req.text.replace(/^[\d۰-۹]+\s*/, '')}» در فهرست این بازار پیدا نشد.`,
        nearbyCategories: NEARBY_CATEGORIES,
      },
    };
  }

  const rule = 'ارزان‌ترین مطابق خواسته';
  const typed = req.modelCode
    ? PRODUCTS.find((p) => p.kind === kind && p.modelCode?.toLowerCase() === req.modelCode!.toLowerCase())
    : undefined;
  if (pinned && pinned.kind === kind) return done(pinned, 'exact');
  if (typed) return done(typed, 'exact');

  switch (kind) {
    case 'camera': {
      const hik = chip(req, 'brand') === 'هایک‌ویژن';
      const five = chip(req, 'mp')?.startsWith('۵');
      const p = productById(hik ? 'cam-hik' : five ? 'cam-1500' : 'cam-1200')!;
      return done(p, 'suggested', {
        eligibleCount: hik ? 62 : five ? 41 : 154,
        rangeLow: 1_900_000,
        rangeHigh: 8_500_000,
        rule,
      });
    }
    case 'recorder': {
      const sig = answerOf(state, req, 'signal');
      const brand = answerOf(state, req, 'brand');
      const budget = answerOf(state, req, 'budget');
      let n = 216;
      if (sig === 'analog') n = 148;
      if (sig === 'ip') n = 68;
      if (brand === 'dahua') n = Math.floor(n * 0.45);
      if (brand === 'hik') n = Math.floor(n * 0.3);
      if (budget === 'low') n = Math.floor(n * 0.5);
      if (budget === 'mid') n = Math.floor(n * 0.4);
      if (budget === 'high') n = Math.max(3, Math.floor(n * 0.1));
      n = Math.max(n, 3);
      const stats = { eligibleCount: n, rangeLow: 6_500_000, rangeHigh: 33_000_000 };

      const queue: Question[] = [];
      if (!sig)
        queue.push(
          q(
            req,
            'signal',
            'compat',
            'دوربین‌ها آنالوگ هستند یا تحت شبکه؟',
            [
              { id: 'analog', label: 'آنالوگ', hint: 'AHD / HDCVI / TVI' },
              { id: 'ip', label: 'تحت شبکه', hint: 'IP' },
              { id: 'unsure', label: 'مطمئن نیستم' },
            ],
            'اگر اشتباه باشد، ضبط‌کننده به دوربین‌ها وصل نمی‌شود.',
          ),
        );
      if (!brand)
        queue.push(
          q(req, 'brand', 'attribute', 'کدام برند؟', [
            { id: 'dahua', label: 'داهوا' },
            { id: 'hik', label: 'هایک‌ویژن' },
          ]),
        );
      if (!budget)
        queue.push(
          q(
            req,
            'budget',
            'budget',
            'بودجه‌ات تقریباً چقدر است؟',
            [
              { id: 'low', label: 'تا ۶ میلیون' },
              { id: 'mid', label: '۶ تا ۱۴ میلیون' },
              { id: 'high', label: 'بیشتر از ۱۴ میلیون' },
            ],
            'بازه‌ها از قیمت‌های واقعی همین دسته ساخته شده‌اند.',
          ),
        );
      if (queue.length && !state.settled[req.id]) {
        return needs(queue[0], stats, queue.length);
      }
      const p = productById(sig === 'ip' ? 'rec-nvr' : brand === 'hik' ? 'rec-hik' : 'rec-xvr')!;
      return done(p, 'suggested', { ...stats, rule });
    }
    case 'hdd': {
      const p = productById('hdd-4sky')!;
      return done(p, 'alternative', {
        eligibleCount: 1,
        rangeLow: 3_150_000,
        rangeHigh: 14_000_000,
        differs: '۴ ترابایت به‌جای ۲ ترابایت؛ هارد ۲ ترابایتیِ مخصوص ضبط تصویر در فهرست نبود.',
        incompleteSpecsCount: 8,
      });
    }
    case 'adapter': {
      return done(productById('ad-5a')!, 'suggested', { eligibleCount: 23, rule });
    }
    case 'wire': {
      const gaugeChip = chip(req, 'gauge');
      const gaugeAns = answerOf(state, req, 'gauge');
      const unitAns = answerOf(state, req, 'unit');
      const settled = state.settled[req.id];
      const queue: Question[] = [];
      if (!gaugeChip && !gaugeAns && !settled)
        queue.push(
          q(
            req,
            'gauge',
            'attribute',
            'چه سیمی؟',
            [
              { id: 'g15', label: 'سیم افشان ۱٫۵' },
              { id: 'g25', label: 'سیم افشان ۲٫۵' },
              { id: 'c325', label: 'کابل ۳×۲٫۵' },
              { id: 'unsure', label: 'مطمئن نیستم' },
            ],
            'ضخامت سیم به مصرف بستگی دارد.',
          ),
        );
      if (!unitAns && !settled)
        queue.push(
          q(
            req,
            'unit',
            'unit',
            'چطور می‌خری؟',
            [
              { id: 'roll', label: 'حلقهٔ ۱۰۰ متری' },
              { id: 'metre', label: 'متری' },
            ],
            'قیمت حلقه و قیمت متری با هم قابل‌مقایسه نیستند.',
          ),
        );
      const stats = { eligibleCount: 340, rangeLow: 96_000, rangeHigh: 19_000_000 };
      const cur = queue.find((x) => x.id !== 'gauge' || gaugeAns !== 'unsure') ?? queue[0];
      if (queue.length) return needs(cur, stats, queue.length);
      const g =
        gaugeAns === 'g15' ? 'wire-15' : gaugeAns === 'c325' ? 'wire-cable' : gaugeAns === 'g25' || /۲٫۵/.test(gaugeChip ?? '') ? 'wire-25' : /۱٫۵/.test(gaugeChip ?? '') ? 'wire-15' : 'wire-25';
      const p = productById(`${g}-${unitAns === 'metre' ? 'metre' : 'roll'}`)!;
      return done(p, 'suggested', { eligibleCount: 34, rule, rangeLow: undefined, rangeHigh: undefined });
    }
    case 'socket':
      return done(productById('sock-1')!, 'suggested', { eligibleCount: 48, rangeLow: 90_000, rangeHigh: 420_000, rule });
    case 'breaker':
      return done(productById('brk-16')!, 'suggested', { eligibleCount: 12, rangeLow: 160_000, rangeHigh: 480_000, rule });
    case 'phone': {
      const p = productById('phone-a56')!;
      // A request with a price ceiling for an iPhone matches nothing: the dead end with relaxations and the closest model.
      if (/آیفون/.test(req.text) && req.budget?.max && answerOf(state, req, 'condition') !== CONDITION_ANY) {
        const prices = p.offers.map((o) => o.price).filter((x): x is number => x != null);
        const closest: ModelOption = {
          productId: p.id,
          name: p.name,
          modelCode: p.modelCode,
          specs: p.specs,
          priceLow: Math.min(...prices),
          priceHigh: Math.max(...prices),
          sellerCount: p.offers.length,
          diffLabel: 'برند و مدل دیگری است؛ آیفون در این بازار نبود',
          current: false,
          fit: 'differs',
        };
        return {
          req,
          plannable: false,
          lineQty: req.qty,
          res: {
            itemId: req.id,
            state: 'alternative',
            pendingQuestions: 0,
            differs: 'موردی دقیقاً مطابق خواستهٔ تو نبود. نزدیک‌ترین‌ها را ببین.',
            noMatch: {
              reasonFa: `آیفون زیر ${formatTomanCompact(req.budget.max)} در فهرست این بازار نبود.`,
              relax: [
                { attr: 'budget', label: 'بدون سقف قیمت' },
                { attr: 'condition', label: 'کارکرده هم باشد' },
              ],
              closest: [closest],
            },
          },
        };
      }
      return done(p, req.modelCode ? 'exact' : 'suggested', req.modelCode ? {} : { eligibleCount: 9, rule });
    }
    case 'case':
    case 'glass': {
      const dev = deviceOf(req, state);
      if (!dev) {
        const question = q(
          req,
          'device',
          'compat',
          'برای کدام گوشی؟',
          [
            { id: 'a56', label: 'Galaxy A56' },
            { id: 'a57', label: 'Galaxy A57' },
          ],
          'قاب و گلس مخصوص یک مدل گوشی است.',
        );
        return needs(question, { eligibleCount: kind === 'case' ? 30 : 27 }, 1);
      }
      if (kind === 'case') {
        const p = productById(dev === 'A56' ? 'case-a56' : 'case-a57')!;
        return done(p, 'suggested', { eligibleCount: 30, rangeLow: 280_000, rangeHigh: 2_000_000, rule });
      }
      return done(productById('glass-a56')!, dev === 'A56' ? 'suggested' : 'alternative', {
        eligibleCount: 27,
        rule,
        differs: dev === 'A56' ? undefined : 'گلس این گوشی در فهرست نبود؛ نزدیک‌ترین مدل را ببین.',
      });
    }
  }
}

function evalAll(state: RequirementState): Ev[] {
  return state.requirements.map((r) => evalItem(r, state));
}

export function mockResolve(state: RequirementState): ResolveResponse {
  const evs = evalAll(state);
  const cams = evs.filter((e) => e.req.categoryId === 'camera').reduce((s, e) => s + e.req.qty, 0);
  return {
    items: evs.map((e) =>
      // the server's non-blocking adapter note (never a question): the adapter count was not written, the total current is unverified
      e.req.categoryId === 'adapter' && cams >= 2
        ? { ...e.res, compatNote: `تعداد آداپتور را ننوشتی؛ ۱ عدد برای ${faN(cams)} دوربین در نظر گرفته شد. جریان کل آداپتور تأیید نشده.` }
        : e.res,
    ),
    pendingItemCount: evs.filter((e) => e.res.state === 'needs_info').length,
  };
}

/* =============================== planning =============================== */

interface ValidOffer {
  offer: MockOffer;
  shop: MockShop;
}

function validOffers(ev: Ev, state: RequirementState, now: Date, ignoreClosed: boolean): ValidOffer[] {
  if (!ev.plannable || !ev.product) return [];
  const excl = new Set([...(state.excludedShops[ev.req.id] ?? []), ...(state.excludedShops['*'] ?? [])]);
  const active = isVisitActive(state.visit) && !ignoreClosed;
  const out = ev.product.offers
    .filter((o) => o.price != null)
    .map((o) => ({ offer: o, shop: shopById(o.shopId) }))
    .filter((v) => !excl.has(v.shop.id))
    .filter((v) => !(active && openStatus(v.shop, state.visit, now) === 'closed'));
  const pin = state.shopPins[ev.req.id];
  const pinned = pin ? out.filter((v) => v.shop.id === pin) : [];
  return pinned.length ? pinned : out;
}

interface Option {
  assign: Map<string, ValidOffer>;
  cost: number;
  shops: string[];
  covered: number;
}

function enumerateOptions(evs: Ev[], state: RequirementState, now: Date, ignoreClosed: boolean): Option[] {
  const offers = new Map(evs.map((e) => [e.req.id, validOffers(e, state, now, ignoreClosed)]));
  const shopIds = [...new Set([...offers.values()].flat().map((v) => v.shop.id))];
  const found = new Map<string, Option>();
  for (let mask = 1; mask < 1 << shopIds.length; mask++) {
    const allowed = new Set(shopIds.filter((_, i) => mask & (1 << i)));
    const assign = new Map<string, ValidOffer>();
    let cost = 0;
    for (const e of evs) {
      const cands = (offers.get(e.req.id) ?? []).filter((v) => allowed.has(v.shop.id));
      if (!cands.length) continue;
      const best = cands.reduce((a, b) => (b.offer.price! < a.offer.price! ? b : a));
      assign.set(e.req.id, best);
      cost += best.offer.price! * e.lineQty;
    }
    if (!assign.size) continue;
    const used = [...new Set([...assign.values()].map((v) => v.shop.id))].sort();
    const key = used.join(',') + '|' + [...assign.keys()].sort().join(',');
    if (!found.has(key)) found.set(key, { assign, cost, shops: used, covered: assign.size });
  }
  const all = [...found.values()];
  const maxCovered = Math.max(0, ...all.map((o) => o.covered));
  const top = all.filter((o) => o.covered === maxCovered);
  // Pareto on (cost, stops): sort by stops then cost; keep strictly improving cost.
  top.sort((a, b) => a.shops.length - b.shops.length || a.cost - b.cost);
  const pareto: Option[] = [];
  let best = Infinity;
  for (const o of top) {
    if (o.cost < best) {
      pareto.push(o);
      best = o.cost;
    }
  }
  return pareto.sort((a, b) => a.cost - b.cost || a.shops.length - b.shops.length);
}

function pickOption(options: Option[], variant: string | null): Option | undefined {
  if (!options.length) return undefined;
  if (variant === 'fewest') return [...options].sort((a, b) => a.shops.length - b.shops.length || a.cost - b.cost)[0];
  if (variant?.startsWith('stops:')) {
    const k = Number(variant.slice(6));
    return options.find((o) => o.shops.length === k) ?? options[0];
  }
  return options[0];
}

function distance(a: MockShop, b: MockShop) {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 10) * 10;
}

function orderShops(shopIds: string[], lineCount: (id: string) => number): string[] {
  const shops = shopIds.map(shopById);
  if (shops.length <= 1) return shopIds;
  const first = [...shops].sort((a, b) => lineCount(b.id) - lineCount(a.id) || a.id.localeCompare(b.id))[0]!;
  const order = [first];
  const left = shops.filter((s) => s !== first);
  while (left.length) {
    const last = order[order.length - 1]!;
    left.sort((a, b) => distance(last, a) - distance(last, b));
    order.push(left.shift()!);
  }
  return order.map((s) => s.id);
}

const itemName = (r: Requirement) => r.text;

function compatLines(evs: Ev[], state: RequirementState): CompatLine[] {
  const by = (k: Kind) => evs.find((e) => e.req.categoryId === k && e.product);
  const out: CompatLine[] = [];
  const cam = by('camera');
  const rec = by('recorder');
  const hdd = by('hdd');
  const ad = by('adapter');
  if (rec && cam) {
    const ch = rec.product!.facts?.channels ?? 0;
    const need = cam.req.qty;
    if (ch >= need) {
      out.push({
        id: 'cmp-channels',
        level: 'stated',
        text: `ضبط‌کننده ${faN(ch)} کانال برای ${faN(need)} دوربین`,
        itemIds: [rec.req.id, cam.req.id],
      });
    } else {
      out.push({
        id: 'cmp-channels',
        level: 'conflict',
        text: `ضبط‌کننده ${faN(ch)} کانال برای ${faN(need)} دوربین کافی نیست`,
        askSeller: `آیا این ضبط‌کننده ${faN(need)} دوربین را پشتیبانی می‌کند؟`,
        itemIds: [rec.req.id, cam.req.id],
      });
    }
    const sig = answerOf(state, rec.req, 'signal');
    if (sig === 'unsure' || !sig) {
      out.push({
        id: 'cmp-signal',
        level: 'unknown',
        text: 'نوع سیگنال دوربین‌ها (آنالوگ یا شبکه) مشخص نیست',
        askSeller: 'آیا این ضبط‌کننده با دوربین‌های انتخاب‌شده سازگار است؟',
        itemIds: [rec.req.id, cam.req.id],
      });
    } else if (sig === 'ip') {
      out.push({
        id: 'cmp-signal',
        level: 'assumed',
        text: 'دوربین‌های تحت شبکه به ضبط‌کنندهٔ NVR وصل می‌شوند',
        askSeller: 'آیا این NVR با دوربین‌های تحت شبکهٔ من سازگار است؟',
        itemIds: [rec.req.id, cam.req.id],
      });
    } else {
      out.push({
        id: 'cmp-signal',
        level: 'assumed',
        text: 'دوربین‌های AHD به ضبط‌کنندهٔ XVR وصل می‌شوند',
        askSeller: 'آیا این ضبط‌کننده با دوربین‌های AHD سازگار است؟',
        itemIds: [rec.req.id, cam.req.id],
      });
    }
  }
  if (hdd) {
    out.push({
      id: 'cmp-hdd',
      level: 'unknown',
      text: 'هارد مخصوص ضبط تصویر',
      askSeller: 'آیا این هارد برای ضبط دائم تصویر مناسب است؟',
      itemIds: [hdd.req.id],
    });
  }
  if (ad) {
    out.push({
      id: 'cmp-adapter',
      level: 'assumed',
      text: 'دوربین‌ها معمولاً با آداپتور ۱۲ ولت کار می‌کنند',
      askSeller: `ولتاژ و آمپر این آداپتور برای ${cam ? faN(cam.req.qty) : ''} دوربین کافی است؟`.replace('  ', ' '),
      askSellerByItem: {
        [ad.req.id]: `ولتاژ و آمپر این آداپتور برای ${cam ? faN(cam.req.qty) : ''} دوربین کافی است؟`.replace('  ', ' '),
        ...(cam ? { [cam.req.id]: 'آیا این دوربین با آداپتوری که می‌خرم (۱۲ ولت) کار می‌کند؟' } : {}),
      },
      itemIds: [ad.req.id],
    });
  }
  const phone = by('phone');
  for (const k of ['case', 'glass'] as const) {
    const acc = by(k);
    if (!acc) continue;
    const dev = acc.product!.facts?.device;
    const phoneDev = phone?.product?.facts?.device;
    const label = k === 'case' ? 'قاب' : 'گلس';
    if (phoneDev && dev && dev !== phoneDev) {
      out.push({
        id: `cmp-${k}`,
        level: 'conflict',
        text: `${label} برای Galaxy ${dev} است، نه Galaxy ${phoneDev}`,
        askSeller: `آیا این ${label} برای Galaxy ${phoneDev} مناسب است؟`,
        itemIds: [acc.req.id],
      });
    } else if (dev) {
      out.push({
        id: `cmp-${k}`,
        level: 'stated',
        text: `${label} برای Galaxy ${dev}`,
        itemIds: [acc.req.id, ...(phone ? [phone.req.id] : [])],
      });
    }
  }
  return out;
}

export function mockPlan(state: RequirementState, now: Date = new Date()): PlanResponse {
  const evs = evalAll(state);
  const options = enumerateOptions(evs, state, now, false);
  const chosen = pickOption(options, state.variant);
  const activeVariant = chosen && options.length > 1 && chosen !== options[0] ? state.variant : null;

  const missing: PlanResponse['coverage']['missing'] = [];
  const unpriced: UnpricedItem[] = [];
  for (const e of evs) {
    if (chosen?.assign.has(e.req.id)) continue;
    const name = itemName(e.req);
    if (isDeadEnd(e.res)) missing.push({ itemId: e.req.id, name, why: 'مطابق خواسته پیدا نشد' });
    else if (e.res.state === 'needs_info') missing.push({ itemId: e.req.id, name, why: 'منتظر انتخاب تو' });
    else if (e.res.state === 'not_found') missing.push({ itemId: e.req.id, name, why: 'پیدا نشد' });
    else if (e.res.state === 'no_price') {
      missing.push({ itemId: e.req.id, name, why: 'قیمت ثبت نشده' });
      unpriced.push({
        itemId: e.req.id,
        name: e.product?.name ?? name,
        sellers: (e.product?.offers ?? []).map((o) => {
          const s = shopById(o.shopId);
          return { shopName: s.name, mall: s.mall, floor: s.floor, unit: s.unit };
        }),
      });
    } else missing.push({ itemId: e.req.id, name, why: 'مغازهٔ بازی برای آن پیدا نشد' });
  }

  const lineCount = (id: string) => [...(chosen?.assign.values() ?? [])].filter((v) => v.shop.id === id).length;
  const ordered = chosen ? orderShops(chosen.shops, lineCount) : [];
  const stops: Stop[] = ordered.map((shopId, i) => {
    const shop = shopById(shopId);
    const lines: StopLine[] = evs
      .filter((e) => chosen!.assign.get(e.req.id)?.shop.id === shopId)
      .map((e) => {
        const v = chosen!.assign.get(e.req.id)!;
        const asks = compatLines(evs, state)
          .filter((c) => c.itemIds.includes(e.req.id) && c.askSeller && c.level !== 'stated')
          .map((c) => c.askSeller!);
        return {
          itemId: e.req.id,
          qty: e.lineQty,
          state: e.res.state,
          productName: e.product!.name,
          modelCode: e.product!.modelCode,
          listingTitle: v.offer.listingTitle,
          unitPrice: v.offer.price,
          unitLabel: e.product!.unitLabel,
          lineTotal: v.offer.price! * e.lineQty,
          warranty: v.offer.warranty,
          priceChangedAt: v.offer.priceChangedAt,
          shopId,
          askSeller: asks,
        };
      });
    const next = ordered[i + 1];
    return {
      id: `stop-${shopId}`,
      index: i + 1,
      mall: shop.mall,
      floor: shop.floor,
      unit: shop.unit,
      shopId,
      shopName: shop.name,
      address: shop.address,
      hoursText: hoursText(shop, state.visit, now),
      open: openStatus(shop, state.visit, now),
      distanceToNext: next ? distance(shop, shopById(next)) : undefined,
      lines,
    };
  });

  const total = chosen?.cost ?? 0;
  const covered = chosen?.covered ?? 0;
  const complete = covered === evs.length && evs.length > 0;
  const usesSuggestions = evs.some(
    (e) => chosen?.assign.has(e.req.id) && (e.res.state === 'suggested' || e.res.state === 'alternative'),
  );

  // alternatives = the other non-dominated options, with real deltas
  const alternatives: PlanAlternative[] = [];
  if (chosen) {
    for (const o of options) {
      if (o === chosen) continue;
      const dCost = o.cost - chosen.cost;
      const dStops = o.shops.length - chosen.shops.length;
      const money = formatTomanCompact(Math.abs(dCost));
      const single = o.shops.length === 1 ? ` (همه از «${shopById(o.shops[0]!).name}»)` : '';
      let label: string;
      let description: string;
      if (dStops < 0 && dCost >= 0) {
        label = 'کم‌توقف‌تر';
        description = `${faN(o.shops.length)} توقف به‌جای ${faN(chosen.shops.length)}، ${money} بیشتر${single}`;
      } else if (dStops > 0 && dCost <= 0) {
        label = 'ارزان‌تر';
        description = `${money} کمتر، اما ${faN(dStops)} توقف بیشتر`;
      } else if (dCost < 0) {
        label = 'ارزان‌تر';
        description = `${money} کمتر، با ${faN(o.shops.length)} توقف`;
      } else {
        label = 'کم‌توقف‌تر';
        description = `${faN(o.shops.length)} توقف، ${money} بیشتر${single}`;
      }
      const fewer = label === 'کم‌توقف‌تر';
      alternatives.push({
        id: `stops:${o.shops.length}`,
        // the server's distinct label: the plan's own stop count and its price delta; the bucket word moved to `kindLabel`
        label: `${faN(o.shops.length)} توقف · ${dCost < 0 ? `${money} ارزان‌تر` : dCost > 0 ? `${money} بیشتر` : 'همان قیمت'}`,
        description,
        deltaToman: dCost,
        deltaStops: dStops,
        stopCount: o.shops.length,
        kind: fewer ? 'fewer_stops' : 'cheaper',
        kindLabel: label,
      });
    }
  }
  let noAlternativesReason: string | undefined;
  if (chosen && options.length <= 1) {
    const single = evs.find((e) => chosen.assign.has(e.req.id) && validOffers(e, state, now, false).length === 1);
    noAlternativesReason = single
      ? `برای این فهرست فقط یک ترکیب ممکن است؛ چون «${itemName(single.req)}» فقط یک فروشنده دارد.`
      : 'برای این فهرست ترکیب دیگری پیدا نشد.';
  }

  let reason: string;
  if (!chosen) reason = 'هنوز موردی برای برنامه‌ریزی آماده نیست؛ سؤال‌ها را جواب بده.';
  else if (!complete)
    reason = `این برنامه فقط بخشی از فهرست را پوشش می‌دهد؛ ${faN(missing.length)} مورد هنوز قیمت یا انتخاب ندارد.`;
  else if (state.variant === 'fewest' || (activeVariant && chosen.shops.length < options[0]!.shops.length))
    reason = 'طبق خواستهٔ تو، برنامه با کمترین توقف ساخته شد.';
  else if (chosen.shops.length === 1) reason = 'همه‌چیز از یک مغازه پیدا شد.';
  else reason = "ارزان‌ترین ترکیب با همین پوشش.";

  // shops dropped because they are closed at the chosen time
  const closedNotes: PlanResponse['closedNotes'] = [];
  if (isVisitActive(state.visit)) {
    const base = pickOption(enumerateOptions(evs, state, now, true), state.variant);
    if (base) {
      const dropped = base.shops.filter(
        (id) => openStatus(shopById(id), state.visit, now) === 'closed' && !chosen?.shops.includes(id),
      );
      for (const id of dropped) {
        const diff = chosen ? chosen.cost - base.cost : 0;
        closedNotes.push({
          text: `«${shopById(id).name}» در این زمان بسته است و در برنامه نیامد.${
            diff > 0 ? ` برنامه ${formatTomanCompact(diff)} گران‌تر شد.` : ''
          }`,
        });
      }
    }
  }

  const compat = compatLines(evs, state);
  const hasConflict = compat.some((c) => c.level === 'conflict');
  const totalLine = `${complete ? `جمع ${faN(covered)} مورد` : `فقط ${faN(covered)} از ${faN(evs.length)} مورد`}: ${formatTomanCompact(total)}${hasConflict ? ' (ناسازگاری دارد)' : ''}`;

  const datasetTotalLine =
    covered > 0
      ? `${complete ? `جمع طبق فهرست برای ${faN(covered)} مورد` : `جمع طبق فهرست، فقط ${faN(covered)} از ${faN(evs.length)} مورد`}: ${formatTomanCompact(total)}${hasConflict ? ' — ناسازگاری دارد' : ''}`
      : undefined;

  return {
    title: '',
    coverage: { covered, total: evs.length, missing },
    totalToman: total,
    totalLine,
    ...(datasetTotalLine ? { datasetTotalLine } : {}),
    hasConflict,
    usesSuggestions,
    complete,
    reason,
    stopCount: stops.length,
    stops,
    unpriced,
    compat,
    alternatives,
    noAlternativesReason,
    activeVariant,
    visitActive: isVisitActive(state.visit),
    closedNotes,
  };
}

/* =============================== options sheet =============================== */

export function mockOptions(state: RequirementState, itemId: string, now: Date = new Date()): OptionsResponse {
  const ev = evalItem(state.requirements.find((r) => r.id === itemId)!, state);
  const kind = ev.req.categoryId as Kind | null;
  const cur = ev.product;
  const curLow = priceStats(cur).low ?? 0;
  const siblings = PRODUCTS.filter((p) => kind && p.kind === kind && (kind !== 'wire' || p.unitLabel === cur?.unitLabel));
  const models: ModelOption[] = siblings.map((p) => {
    const prices = p.offers.map((o) => o.price).filter((x): x is number => x != null);
    const low = prices.length ? Math.min(...prices) : 0;
    const high = prices.length ? Math.max(...prices) : 0;
    const delta = prices.length && curLow ? low - curLow : 0;
    const parts: string[] = [];
    if (p.diffNote) parts.push(p.diffNote);
    if (p.id !== cur?.id && delta) parts.push(`${formatTomanCompact(Math.abs(delta))} ${delta > 0 ? 'بیشتر' : 'کمتر'}`);
    if (!prices.length) parts.push('قیمت ثبت نشده');
    if (p.incompleteSpecs) parts.push('مشخصات کامل نیست');
    return {
      productId: p.id,
      name: p.name,
      modelCode: p.modelCode,
      specs: p.specs,
      priceLow: low,
      priceHigh: high,
      sellerCount: p.offers.length,
      diffLabel: p.id === cur?.id ? undefined : parts.join('، ') || undefined,
      current: p.id === cur?.id,
      conflict: p.conflictReason,
    };
  });
  models.sort((a, b) => Number(b.current) - Number(a.current) || a.priceLow - b.priceLow);

  const plan = mockPlan(state, now);
  const stopShops = plan.stops.map((s) => shopById(s.shopId));
  const chosenShop = plan.stops.find((s) => s.lines.some((l) => l.itemId === itemId))?.shopId;
  const sellers: SellerOption[] = (cur?.offers ?? [])
    .map((o) => {
      const shop = shopById(o.shopId);
      const others = stopShops.filter((s) => s.id !== shop.id);
      const nearest = others.length ? Math.min(...others.map((s) => distance(shop, s))) : undefined;
      return {
        shopId: shop.id,
        shopName: shop.name,
        mall: shop.mall,
        floor: shop.floor,
        unit: shop.unit,
        listingTitle: o.listingTitle,
        price: o.price,
        warranty: o.warranty,
        hoursText: hoursText(shop, state.visit, now),
        open: openStatus(shop, state.visit, now),
        distanceNote: nearest != null ? `حدود ${fa(nearest)} متر تا نزدیک‌ترین توقف برنامه` : undefined,
        current: shop.id === chosenShop,
      } satisfies SellerOption;
    })
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  // one seller whose own listing says «های کپی»: set aside by the server's condition rule (adapters only, to keep the rest of the mock stable)
  if (kind === 'adapter' && cur) {
    const spare = SHOPS.find((s) => !cur.offers.some((o) => o.shopId === s.id));
    if (spare) {
      sellers.unshift({
        shopId: spare.id,
        shopName: spare.name,
        mall: spare.mall,
        floor: spare.floor,
        unit: spare.unit,
        listingTitle: `${cur.name} های کپی`,
        price: Math.max(1, Math.round(curLow / 2)),
        warranty: 'بدون گارانتی',
        hoursText: hoursText(spare, state.visit, now),
        open: openStatus(spare, state.visit, now),
        current: false,
        productId: cur.id,
        flags: ['replica'],
        flagLabels: ['کپی'],
        flagReason: 'در عنوان آگهی فروشنده: های کپی',
        conditionExcluded: true,
      });
    }
  }
  return { models, sellers, onlyOneSeller: sellers.length === 1 };
}

/* =============================== assistant =============================== */

export function mockAssist(req: AssistRequest, now: Date = new Date()): AssistResponse {
  const text = normalizeFa(req.text ?? '');
  const chip = req.chip ?? (text.includes('ارزان') ? 'cheaper' : /نزدیک|توقف/.test(text) ? 'fewer_stops' : undefined);
  const plan = mockPlan(req.state, now);
  switch (chip) {
    case 'cheaper':
      return { message: 'ارزان‌ترین ترکیب با همین پوشش انتخاب شد.', action: { type: 'set_variant', value: null }, supported: true };
    case 'closer':
    case 'fewer_stops':
      if (plan.alternatives.length === 0)
        return {
          message: `با این فهرست امکانش نیست؛ ${plan.noAlternativesReason ?? 'ترکیب دیگری وجود ندارد'} نزدیک‌ترین کار همین برنامهٔ فعلی است.`,
          action: { type: 'none' },
          supported: false,
        };
      return { message: 'برنامه با کمترین توقف ساخته شد.', action: { type: 'set_variant', value: 'fewest' }, supported: true };
    case 'only_open':
      return isVisitActive(req.state.visit)
        ? { message: 'مغازه‌های بسته در زمانی که انتخاب کردی از قبل کنار گذاشته شده‌اند.', action: { type: 'none' }, supported: true }
        : { message: 'برای دیدن مغازه‌های باز، اول «کی می‌روی؟» را مشخص کن.', action: { type: 'none' }, supported: false };
    case 'without_shop': {
      const first = plan.stops[0];
      if (!first) return { message: 'هنوز توقفی در برنامه نیست.', action: { type: 'none' }, supported: false };
      return {
        message: `مغازهٔ «${first.shopName}» از برنامه کنار گذاشته شد.`,
        action: { type: 'exclude_shop', shopId: first.shopId },
        supported: true,
      };
    }
    default:
      if (text.includes('سیم') || text.includes('چه سیمی')) {
        return {
          message: 'در عنوان آگهی‌ها، سیم افشان ۱٫۵ بیشتر برای روشنایی و ۲٫۵ برای پریز آمده است؛ این فقط از روی عنوان‌هاست و جای مشورت با برق‌کار را نمی‌گیرد.',
          action: { type: 'none' },
          supported: true,
        };
      }
      return {
        message: 'با این فهرست امکانش نیست؛ چون این نسخه فقط «ارزان‌تر» یا «کم‌توقف‌تر» را می‌فهمد. یکی از گزینه‌های بالا را بزن.',
        action: { type: 'none' },
        supported: false,
      };
  }
}

export function mockMeta() {
  return { ...META };
}
