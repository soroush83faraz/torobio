/**
 * Deterministic keyword fallback: the assistant works with no LLM at all.
 *
 * The five chip phrases («ارزان‌تر»، «نزدیک‌تر به هم»، «کمتر توقف»، «فقط مغازه‌های باز»، «بدون این مغازه») and their
 * common variants map straight to an action; when nothing but filler words surrounds the phrase the match is
 * `exact` and is applied without asking the LLM. Other intents (exclude a named shop / mall, add / remove an item,
 * budget, swap / relax a brand or spec, explain) are recognised conservatively, only when the target is
 * unambiguous; they are `exact: false`, so an available LLM gets the first word and this match is the fallback.
 *
 * Matching runs on search tokens (normalizeFa + tokenizeForSearch): Persian/Arabic letter variants, digits,
 * ZWNJ, punctuation and bidi controls are already folded.
 */
import { ATTR_LABEL, findBrandsInTokens, FA_STOPWORDS, tokenizeForSearch, type AttrKey } from '@app/core';
import { untrustedText } from '../llm/sanitize.js';
import { extractBudget, perUnit } from '../parse/budget.js';
import { align, QTY_MARKER_WORDS, SPEC_UNIT_WORDS } from '../parse/text.js';
import type { AssistFacts, FactItem, FactStop } from './facts.js';
import { msg } from './messages.js';
import { brandLabel, brandRanges } from './state.js';
import type { AssistAction, AssistChoice, AssistContext, RelaxableAttr } from './types.js';

export type KeywordIntent =
  | 'cheaper'
  | 'fewer_stops'
  /** «نزدیک‌تر»: the fewest-stops plan, said in its own words. */
  | 'closer'
  | 'only_open'
  | 'only_open_off'
  | 'without_shop'
  | 'exclude_named'
  | 'add_item'
  | 'set_budget'
  | 'relax'
  | 'swap_brand'
  | 'remove_item'
  | 'explain';

export type KeywordMatch =
  | { kind: 'action'; intent: KeywordIntent; action: AssistAction; exact: boolean }
  /** Understood, but the target is missing or ambiguous: answer with a templated message (and choices). */
  | { kind: 'clarify'; intent: KeywordIntent; messageFa: string; choices: AssistChoice[]; exact: boolean };

type Toks = readonly string[];
const T = (s: string) => tokenizeForSearch(s);

function findSeq(toks: Toks, seq: Toks, from = 0): number {
  if (seq.length === 0) return -1;
  outer: for (let i = from; i + seq.length <= toks.length; i++) {
    for (let j = 0; j < seq.length; j++) if (toks[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

type Span = [number, number];

/** Earliest (then longest) occurrence of any phrase. */
function findAny(toks: Toks, phrases: readonly Toks[]): Span | null {
  let best: Span | null = null;
  for (const seq of phrases) {
    const i = findSeq(toks, seq);
    if (i < 0) continue;
    const span: Span = [i, i + seq.length];
    if (!best || span[0] < best[0] || (span[0] === best[0] && span[1] > best[1])) best = span;
  }
  return best;
}

const P = (...phrases: string[]): Toks[] => phrases.map(T).filter((t) => t.length > 0);

// --- vocabularies (search-token phrases) ------------------------------------------------------------------------

const CHEAP_PHRASES = P('کم هزینه', 'کمترین قیمت', 'قیمت کمتر', 'قیمت پایین', 'قیمت پایین تر', 'اقتصادی', 'اقتصادی تر', 'پول کمتر', 'هزینه کمتر');
const CHEAP_STEM = /^(?:ارزان|ارزون)/;
const FEW_PHRASES = P(
  'کمتر توقف', 'کم توقف', 'توقف کمتر', 'توقف کم', 'کمترین توقف', 'کمترین تعداد توقف', 'یک جا', 'یکجا', 'همه از یک',
  'جای کمتر', 'جاهای کمتر', 'مغازه کمتر', 'مغازه های کمتر', 'پاساژ کمتر', 'کمتر بگردم', 'راه کمتر', 'کمتر راه',
);
const NEAR_STEM = /^نزدیک/;
const OPEN_PHRASES = P(
  'فقط مغازه های باز', 'مغازه های باز', 'مغازه ها باز', 'فقط باز', 'باز باشن', 'باز باشند', 'باز باشد', 'باز باشه',
  'باز هستن', 'باز هستند', 'بازن', 'الان باز', 'هنوز باز', 'بسته نباشن', 'بسته نباشند', 'بسته نباشه', 'بسته ها نه',
  'بسته ها رو حذف', 'بسته ها را حذف', 'بسته ها رو نشون نده', 'فقط بازها',
);
const OPEN_OFF_PHRASES = P(
  'ساعت مهم نیست', 'ساعت کاری مهم نیست', 'ساعت فرقی نمی کنه', 'ساعت فرقی نمیکنه', 'ساعت کاری فرقی نمی کنه',
  'بسته ها هم', 'مغازه های بسته هم', 'بسته هم باشه', 'فیلتر ساعت رو بردار', 'فیلتر ساعت را بردار',
);
const WITHOUT_SHOP_PHRASES = P(
  'بدون این مغازه', 'بدون این فروشگاه', 'بدون این فروشنده', 'بدون اون مغازه', 'بدون آن مغازه',
  'این مغازه نه', 'این مغازه رو نه', 'این مغازه را نه', 'این مغازه رو حذف', 'این مغازه را حذف', 'این مغازه رو کنار',
  'این مغازه را کنار', 'این مغازه رو نمی خوام', 'این مغازه رو نمیخوام', 'این مغازه را نمی خواهم', 'غیر از این مغازه',
  'به جز این مغازه', 'بجز این مغازه', 'یه مغازه دیگه', 'یک مغازه دیگر', 'مغازه دیگه', 'مغازه دیگر', 'فروشنده دیگه',
  'فروشنده دیگر', 'اون مغازه نه', 'آن مغازه نه',
);
const EXCLUDE_TRIGGERS = P('بدون', 'به جز', 'بجز', 'غیر از', 'حذف', 'حذفش', 'کنار', 'نه', 'نمی خوام', 'نمیخوام', 'نمی خواهم', 'نخر', 'نخرم', 'نرم', 'نباشه', 'نباشد');
const ADD_PHRASES = P(
  'اضافه کن', 'اضافه بکن', 'اضافه کنید', 'اضافه بشه', 'اضافه شود', 'اضافه کنم', 'اضافش کن', 'اضافه اش کن', 'اضافه شه',
  'هم بذار', 'هم بزار', 'هم بگذار', 'هم بخر', 'هم لازم', 'هم لازمه', 'هم میخوام', 'هم می خوام', 'هم می خواهم',
);
const RELAX_TRIGGERS = P(
  'مهم نیست', 'فرقی نمی کنه', 'فرقی نمیکنه', 'فرق نمی کنه', 'فرق نمیکنه', 'فرقی نداره', 'فرق نداره', 'فرقی نمی کند',
  'بردار', 'برداشته', 'برش دار', 'حذف', 'نباشه', 'نمی خواد', 'نمیخواد', 'شرط', 'محدودیت',
);
const SWAP_TRIGGERS = P('جای', 'بجای', 'بجاش', 'جاش', 'عوض', 'جایگزین', 'تغییر', 'بذار', 'بزار', 'بگذار', 'بشه', 'باشه', 'باشد', 'میخوام', 'می خوام', 'بخر', 'برند', 'مارک', 'کن', 'بده');
const BRAND_WORDS = new Set(T('برند مارک'));
const CHANGE_PHRASES = P('عوض', 'تغییر', 'جایگزین', 'دیگه', 'دیگر', 'عوضش', 'بدل');
const REMOVE_TRIGGERS = P(
  'حذف', 'حذفش', 'پاک', 'پاکش', 'از فهرست', 'از لیست', 'نمی خوام', 'نمیخوام', 'نمی خواهم', 'لازم ندارم', 'نیاز ندارم',
  'بیخیال', 'بی خیال', 'لازم نیست',
);
const BUDGET_TRIGGERS = P('بودجه', 'قیمت', 'زیر', 'حداکثر', 'تا', 'کمتر از', 'حدود', 'نهایتا', 'سقف', 'نزدیک', 'بین', 'حداقل', 'بالای');
const NEGATIONS = new Set(['نه', 'نمی', 'نمیخوام', 'نمیخواهم', 'نخوام', 'نکن', 'نباشه', 'نباشد', 'نشه']);
const EXPLAIN_FIRST = new Set(['چرا', 'چطور', 'چطوری', 'چگونه', 'توضیح', 'یعنی', 'دلیل', 'چه']);

/** Words that carry no intent (politeness, light verbs, "the plan", suffixes split off by ZWNJ). */
const FILLERS = new Set(
  [
    'کن', 'بکن', 'کنید', 'بکنید', 'کنی', 'کنم', 'بشه', 'بشود', 'شود', 'شه', 'باشه', 'باشد', 'باشن', 'باشند', 'لطفا', 'لطف',
    'برنامه', 'برنامم', 'رو', 'را', 'یه', 'یک', 'کمی', 'یکم', 'خیلی', 'تر', 'ترین', 'ترش', 'به', 'هم', 'و', 'ها', 'های', 'مغازه',
    'فقط', 'بده', 'بذار', 'بزار', 'بگذار', 'نشون', 'نشان', 'حالا', 'الان', 'میخوام', 'می', 'خوام', 'خواهم', 'میخواهم', 'میشه',
    'ممنون', 'مرسی', 'دیگه', 'دیگر', 'اینو', 'این', 'از', 'با', 'لطفاً', 'برام', 'بهم', 'ام', 'م', 'اش', 'شو', 'شون', 'رو',
  ].flatMap((w) => T(w)),
);

const MALL_GENERIC = new Set(['پاساژ', 'مجتمع', 'بازار', 'تجاری', 'مرکز', 'مال', 'سرای', 'سرا', 'ساختمان', 'برج', 'تیمچه', 'راسته']);
const SHOP_GENERIC = new Set(['فروشگاه', 'مغازه', 'فروشنده']);

/** Extra words that name an attribute (besides its ATTR_LABEL). */
const ATTR_WORDS: Partial<Record<RelaxableAttr, readonly string[]>> = {
  brand: ['برند', 'مارک'],
  budget: ['بودجه', 'قیمت', 'سقف قیمت'],
  resolution_mp: ['مگاپیکسل', 'وضوح', 'کیفیت تصویر', 'رزولوشن'],
  channels: ['کانال'],
  capacity_tb: ['ترابایت', 'ظرفیت', 'حجم'],
  voltage_v: ['ولت', 'ولتاژ'],
  current_a: ['آمپر', 'جریان'],
  camera_signal: ['آنالوگ', 'تحت شبکه', 'نوع دوربین'],
  recorder_kind: ['نوع ضبط کننده'],
  storage_gb: ['حافظه'],
  ram_gb: ['رم'],
  wire_section_mm2: ['سطح مقطع', 'سایز سیم', 'نمره'],
  sale_unit: ['واحد فروش'],
  condition: ['استوک', 'کارکرده', 'دست دوم', 'کپی', 'وضعیت آگهی'],
};

const MONEY_TOKENS = new Set(['میلیون', 'هزار', 'تومان', 'تومن', 'میلیارد', 'ریال']);

/**
 * Per-unit budget the user's OWN words state (deterministic budget extractor; never numbers from the LLM).
 * «ارزان‌تر از ۵ میلیون»: the extractor reads «از ۵ میلیون» as a lower bound; after «ارزان / کمتر» it is an upper one.
 */
export function budgetFromText(rawText: string, qty: number): { min?: number; max?: number } | null {
  const hit = extractBudget(align(rawText));
  if (!hit) return null;
  let budget = hit.total ? perUnit(hit.budget, qty) : hit.budget;
  const toks = T(rawText);
  if (toks.some((t) => CHEAP_STEM.test(t) || t === 'کمتر') && budget.min !== undefined && budget.max === undefined) budget = { max: budget.min };
  if (budget.min === undefined && budget.max === undefined) return null;
  return budget;
}

// --- helpers ------------------------------------------------------------------------------------------------------

/** Tokens outside `spans` that are not fillers. */
function residual(toks: Toks, spans: readonly Span[], extraIgnore: ReadonlySet<string> = new Set()): string[] {
  return toks.filter((t, i) => !spans.some(([a, b]) => i >= a && i < b) && !FILLERS.has(t) && !extraIgnore.has(t));
}

function hasNegation(tokens: readonly string[]): boolean {
  return tokens.some((t) => NEGATIONS.has(t));
}

const isNumberTok = (t: string) => /^\d+$/.test(t);

/** Tokens of an item text that can identify it (no numbers, units, stopwords, fillers, brand words). */
function identifyingTokens(text: string): string[] {
  const toks = T(text);
  const brand = brandRanges(toks);
  return toks.filter(
    (t, i) =>
      t.length >= 2 &&
      !isNumberTok(t) &&
      !FA_STOPWORDS.has(t) &&
      !FILLERS.has(t) &&
      !SPEC_UNIT_WORDS.has(t) &&
      !QTY_MARKER_WORDS.has(t) &&
      !brand.some(([a, b]) => i >= a && i < b),
  );
}

/** Items the text names (best score only). */
function mentionedItems(toks: Toks, items: readonly FactItem[]): FactItem[] {
  const set = new Set(toks);
  let best = 0;
  let out: FactItem[] = [];
  for (const it of items) {
    const score = [...new Set(identifyingTokens(it.text))].filter((t) => set.has(t)).length;
    if (score === 0) continue;
    if (score > best) {
      best = score;
      out = [it];
    } else if (score === best) out.push(it);
  }
  return out;
}

function contextItem(ctx: AssistContext, items: readonly FactItem[]): FactItem | undefined {
  return ctx.itemId ? items.find((i) => i.id === ctx.itemId) : undefined;
}

function contextShop(ctx: AssistContext, stops: readonly FactStop[]): FactStop | undefined {
  return ctx.shopId ? stops.find((s) => s.shopId === ctx.shopId) : undefined;
}

/** «بدون این مغازه» follow-ups: one per shop of the plan (labels are cleaned data names). */
export function shopChoices(stops: readonly FactStop[]): AssistChoice[] {
  return stops.map((s) => ({
    label: untrustedText(s.mallName ? `${s.shopName} · ${s.mallName}` : s.shopName, 80),
    request: { chip: 'without_shop' as const, context: { shopId: s.shopId } },
  }));
}

/** Which brands an item could be switched to: its real facets, the current brand left out. */
function brandChoices(item: FactItem, facts: AssistFacts): AssistChoice[] {
  return facts
    .brandsFor(item.id)
    .filter((b) => b.key !== item.brand)
    .slice(0, MAX_BRAND_CHOICES)
    .map((b) => ({ label: untrustedText(b.label, 40), request: { text: `برند ${untrustedText(b.label, 40)}`, context: { itemId: item.id } } }));
}

const MAX_BRAND_CHOICES = 8;

/** The facet brand whose name the text spells (longest name first); a brand the item already has is skipped. */
function facetBrandIn(toks: Toks, item: FactItem, facts: AssistFacts): { key: string; span: Span } | null {
  let best: { key: string; span: Span } | null = null;
  for (const b of facts.brandsFor(item.id)) {
    if (b.key === item.brand) continue;
    const name = T(b.label);
    const i = findSeq(toks, name);
    if (i < 0) continue;
    if (!best || name.length > best.span[1] - best.span[0]) best = { key: b.key, span: [i, i + name.length] };
  }
  return best;
}

function itemChoices(items: readonly FactItem[], text: string): AssistChoice[] {
  return items.map((i) => ({ label: untrustedText(i.text, 80), request: { text, context: { itemId: i.id } } }));
}

function clarify(intent: KeywordIntent, messageFa: string, choices: AssistChoice[] = [], exact = false): KeywordMatch {
  return { kind: 'clarify', intent, messageFa, choices, exact };
}

function act(intent: KeywordIntent, action: AssistAction, exact: boolean): KeywordMatch {
  return { kind: 'action', intent, action, exact };
}

/** Pick one item: the context item, else the single item the text names, else the only item. */
function targetItem(toks: Toks, ctx: AssistContext, items: readonly FactItem[], pool: readonly FactItem[] = items): FactItem | FactItem[] {
  const c = contextItem(ctx, pool);
  if (c) return c;
  const named = mentionedItems(toks, pool);
  if (named.length === 1) return named[0]!;
  if (pool.length === 1) return pool[0]!;
  return named.length > 1 ? named : [...pool];
}

// --- the matcher -----------------------------------------------------------------------------------------------------

export function matchKeywords(rawText: string, facts: AssistFacts, ctx: AssistContext = {}): KeywordMatch | null {
  const toks = T(rawText);
  if (toks.length === 0) return null;
  const items = facts.items;

  // 1. explanation questions
  if (EXPLAIN_FIRST.has(toks[0]!) || toks.includes('چرا') || findSeq(toks, T('توضیح بده')) >= 0) {
    return act('explain', { type: 'explain' }, false);
  }

  // 2. «بدون این مغازه»
  const ws = findAny(toks, WITHOUT_SHOP_PHRASES);
  if (ws) {
    const exact = residual(toks, [ws]).length === 0;
    const shop = contextShop(ctx, facts.stops) ?? (facts.stops.length === 1 ? facts.stops[0] : undefined);
    if (shop) return act('without_shop', { type: 'exclude_shop', shopId: shop.shopId }, exact);
    if (facts.stops.length === 0) return clarify('without_shop', msg.noStops, [], exact);
    return clarify('without_shop', msg.needsShop, shopChoices(facts.stops), exact);
  }

  // 3. a named shop / mall of the plan + an exclusion word. A one-word name («بزرگ») only counts next to its
  //    generic word («پاساژ بزرگ»), so ordinary words never exclude a mall by accident.
  if (findAny(toks, EXCLUDE_TRIGGERS)) {
    const saysMall = toks.some((t) => MALL_GENERIC.has(t));
    const saysShop = toks.some((t) => SHOP_GENERIC.has(t));
    const shops = facts.stops.filter((s) => {
      const name = T(s.shopName).filter((t) => !SHOP_GENERIC.has(t));
      return name.length > 0 && (name.length > 1 || saysShop) && findSeq(toks, name) >= 0;
    });
    const malls = new Map<string, FactStop>();
    for (const s of facts.stops) {
      if (!s.mallKey || !s.mallName) continue;
      const name = T(s.mallName).filter((t) => !MALL_GENERIC.has(t));
      if (name.length > 0 && (name.length > 1 || saysMall) && findSeq(toks, name) >= 0 && !malls.has(s.mallKey)) malls.set(s.mallKey, s);
    }
    // a name can fit both a shop and its mall («الف»): «پاساژ / مجتمع ...» means the mall, «مغازه / فروشگاه ...» the shop
    const mallKey = malls.size === 1 ? [...malls.keys()][0] : undefined;
    if (mallKey && (shops.length === 0 || (saysMall && !saysShop))) return act('exclude_named', { type: 'exclude_mall', mallKey }, false);
    if (shops.length === 1) return act('exclude_named', { type: 'exclude_shop', shopId: shops[0]!.shopId }, false);
    if (shops.length > 1) return clarify('exclude_named', msg.needsShop, shopChoices(shops));
  }

  // 4. add an item
  if (findAny(toks, ADD_PHRASES)) {
    const strip = new Set([
      ...T('اضافه اضافش اش کن بکن کنید کنم بشه شه شود هم لطفا یه بذار بزار بگذار بخر لازم لازمه دارم میخوام می خوام خواهم به فهرست لیست رو را برام'),
    ]);
    const keep = rawText
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => {
        const wt = T(w);
        return wt.length > 0 && !wt.every((t) => strip.has(t));
      });
    const text = keep.join(' ').trim();
    if (!text) return clarify('add_item', msg.nothingParsed);
    return act('add_item', { type: 'add_item', text }, false);
  }

  // 5. a budget for an item
  const hit = extractBudget(align(rawText));
  const budgetWords = findAny(toks, BUDGET_TRIGGERS) || toks.some((t) => CHEAP_STEM.test(t));
  if (hit && (budgetWords || residual(toks, []).every((t) => isNumberTok(t) || MONEY_TOKENS.has(t)))) {
    const target = targetItem(toks, ctx, items);
    if (Array.isArray(target)) {
      return target.length ? clarify('set_budget', msg.needsItem, itemChoices(target, rawText)) : null;
    }
    const budget = budgetFromText(rawText, target.qty);
    if (!budget) return clarify('set_budget', msg.needsAmount);
    return act('set_budget', { type: 'set_budget', itemId: target.id, ...budget }, false);
  }

  // 6. relax a stated spec / brand / budget («برند مهم نیست», «۲ مگاپیکسل رو بردار»)
  if (findAny(toks, RELAX_TRIGGERS)) {
    const pairs: { item: FactItem; attr: RelaxableAttr }[] = [];
    for (const it of items) {
      for (const st of it.stated) {
        const words = [ATTR_LABEL[st.attr as AttrKey] ?? '', ...(ATTR_WORDS[st.attr] ?? []), st.label]
          .concat(st.attr === 'brand' && it.brand ? [brandLabel(it.brand)] : [])
          .map(T)
          .filter((w) => w.length > 0 && !w.every(isNumberTok));
        if (words.some((w) => findSeq(toks, w) >= 0)) pairs.push({ item: it, attr: st.attr });
      }
    }
    if (pairs.length > 0) {
      const inCtx = ctx.itemId ? pairs.filter((p) => p.item.id === ctx.itemId) : [];
      const named = mentionedItems(toks, [...new Set(pairs.map((p) => p.item))]);
      const pick = inCtx.length === 1 ? inCtx : pairs.length === 1 ? pairs : named.length === 1 ? pairs.filter((p) => p.item.id === named[0]!.id) : pairs;
      if (pick.length === 1) return act('relax', { type: 'relax_constraint', itemId: pick[0]!.item.id, attr: pick[0]!.attr }, false);
      const choiceItems = [...new Set(pick.map((p) => p.item))];
      return clarify('relax', msg.needsItem, itemChoices(choiceItems, rawText));
    }
  }

  // 7c. «بدون داهوا» when the item's stated brand is the unwanted one: offer the other brands it really has
  const without = T('بدون');
  const withoutAt = findSeq(toks, without);
  if (withoutAt >= 0) {
    const named = new Set(findBrandsInTokens([...toks]).map((h) => h.key));
    const owners = items.filter((i) => i.brand !== undefined && named.has(i.brand));
    const target = owners.length === 0 ? [] : targetItem(toks, ctx, items, owners);
    if (!Array.isArray(target)) {
      const spans: Span[] = [[withoutAt, withoutAt + without.length], ...brandRanges(toks).map((r): Span => [r[0], r[1]])];
      return clarify('swap_brand', msg.pickBrand(target.text), brandChoices(target, facts), residual(toks, spans, BRAND_WORDS).length === 0);
    }
    if (target.length > 1) return clarify('swap_brand', msg.needsItem, itemChoices(target, rawText));
  }

  // 7a. a brand the context item really offers («برند هایک ویژن»), including brands the lexicon does not know
  const swapCtx = contextItem(ctx, items);
  if (swapCtx && findAny(toks, SWAP_TRIGGERS)) {
    const hit = facetBrandIn(toks, swapCtx, facts);
    if (hit) {
      return act('swap_brand', { type: 'swap_brand', itemId: swapCtx.id, brand: hit.key }, residual(toks, [hit.span], BRAND_WORDS).length === 0);
    }
  }

  // 7b. «برند را عوض کن» with no brand named: offer the brands the item really has
  if (toks.some((t) => BRAND_WORDS.has(t)) && findBrandsInTokens([...toks]).length === 0) {
    const change = findAny(toks, CHANGE_PHRASES);
    if (change) {
      const exact = residual(toks, [change], BRAND_WORDS).length === 0;
      const withBrand = items.filter((i) => i.brand !== undefined);
      const pool = (withBrand.length ? withBrand : items).filter((i) => facts.brandsFor(i.id).some((b) => b.key !== i.brand));
      const target = pool.length === 0 ? [] : targetItem(toks, ctx, items, pool);
      if (!Array.isArray(target)) {
        return clarify('swap_brand', msg.pickBrand(target.text), brandChoices(target, facts), exact);
      }
      if (target.length > 0) return clarify('swap_brand', msg.needsItem, itemChoices(target, rawText), exact);
      const named = swapCtx ?? mentionedItems(toks, items)[0] ?? items[0];
      return clarify('swap_brand', msg.unknownBrand(named?.text ?? ''), [], exact);
    }
  }

  // 7. swap a brand («به‌جای داهوا هایک‌ویژن بذار»); brands that are also ordinary words («کن») are not matched
  const brandHits = findBrandsInTokens([...toks]);
  if (brandHits.length > 0 && findAny(toks, SWAP_TRIGGERS)) {
    const jay = toks.findIndex((t) => t === 'جای' || t === 'بجای');
    const after = jay >= 0 ? brandHits.filter((h) => h.tokenIndex > jay) : [];
    const oldKey = after[0]?.key;
    const keys = [...new Set(brandHits.map((h) => h.key))];
    const newKey = jay >= 0 ? keys.find((k) => k !== oldKey) : keys[keys.length - 1];
    if (newKey) {
      const ctxItem = contextItem(ctx, items);
      let pool = ctxItem ? [ctxItem] : items.filter((i) => facts.brandsFor(i.id).some((b) => b.key === newKey));
      if (!ctxItem && oldKey) {
        const withOld = pool.filter((i) => i.brand === oldKey || brandRanges(T(i.text), oldKey).length > 0);
        if (withOld.length) pool = withOld;
      }
      if (!ctxItem && pool.length > 1) {
        const named = mentionedItems(toks, pool);
        if (named.length === 1) pool = named;
      }
      if (pool.length === 1) return act('swap_brand', { type: 'swap_brand', itemId: pool[0]!.id, brand: newKey }, false);
      if (pool.length > 1) return clarify('swap_brand', msg.needsItem, itemChoices(pool, rawText));
      return clarify('swap_brand', msg.unknownBrand(items[0]?.text ?? ''));
    }
  }

  // 8. remove an item
  if (findAny(toks, REMOVE_TRIGGERS)) {
    const named = mentionedItems(toks, items);
    const ctxItem = contextItem(ctx, items);
    if (ctxItem && (named.length === 0 || named.includes(ctxItem))) return act('remove_item', { type: 'remove_item', itemId: ctxItem.id }, false);
    if (named.length === 1) return act('remove_item', { type: 'remove_item', itemId: named[0]!.id }, false);
    if (named.length > 1) return clarify('remove_item', msg.needsItem, itemChoices(named, rawText));
  }

  // 9-11. the chip phrases
  const offSpan = findAny(toks, OPEN_OFF_PHRASES);
  if (offSpan) return act('only_open_off', { type: 'only_open', value: false }, residual(toks, [offSpan]).length === 0);

  const openSpan = findAny(toks, OPEN_PHRASES);
  if (openSpan) {
    const rest = residual(toks, [openSpan]);
    if (!hasNegation(rest)) return act('only_open', { type: 'only_open', value: true }, rest.length === 0);
  }

  const cheapIdx = toks.findIndex((t) => CHEAP_STEM.test(t));
  const cheapPhrase = findAny(toks, CHEAP_PHRASES);
  const cheapSpan: Span | null =
    cheapIdx >= 0 && (!cheapPhrase || cheapIdx <= cheapPhrase[0]) ? [cheapIdx, cheapIdx + 1] : cheapPhrase;
  const nearIdx = toks.findIndex((t, i) => NEAR_STEM.test(t) && !isNumberTok(toks[i + 1] ?? '') && !(toks[i + 1] === 'به' && isNumberTok(toks[i + 2] ?? '')));
  const fewPhrase = findAny(toks, FEW_PHRASES);
  const fromNear = nearIdx >= 0 && (!fewPhrase || nearIdx <= fewPhrase[0]);
  const fewSpan: Span | null = fromNear ? [nearIdx, nearIdx + 1] : fewPhrase;
  const first = cheapSpan && (!fewSpan || cheapSpan[0] <= fewSpan[0]) ? 'cheap' : fewSpan ? 'few' : null;
  if (first) {
    const spans = [cheapSpan, fewSpan].filter((s): s is Span => !!s);
    const rest = residual(toks, spans);
    if (hasNegation(rest)) return null;
    const exact = rest.length === 0 && spans.length === 1;
    if (first === 'cheap') return act('cheaper', { type: 'set_preference', preference: 'cheapest' }, exact);
    return act(fromNear ? 'closer' : 'fewer_stops', { type: 'set_preference', preference: 'fewest_stops' }, exact);
  }
  return null;
}
