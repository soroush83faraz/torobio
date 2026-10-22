/**
 * Deterministic Persian request parser (no LLM): text -> typed Requirement items.
 *
 * Pipeline per request: split into segments -> per segment cut out budget / preference / quantity phrases
 * (on the length-preserving aligned string) -> model code -> category vote (synonyms + FTS) -> domain
 * extractors (reused from @app/core, mapped to the engine's closed schema in attr-map.ts) -> kind, brand,
 * notes, confidence -> context linking across items (accessories inherit the phone model).
 */
import {
  extractCondition,
  extractDeviceModels,
  extractModelCodes,
  extractReplica,
  prepTitle,
  extractProduct,
  screenInchOf,
  FA_STOPWORDS,
  brandByKey,
  findBrandsInTokens,
  modelCodeKeys,
  sanitizeText,
  toPersianDigits,
  tokenizeForSearch,
  type Budget,
  type Constraint,
} from '@app/core';
import type { Db } from '../db.js';
import { mapExtractedAttrs } from './attr-map.js';
import { extractBudget, perUnit } from './budget.js';
import { wordsToDigits } from './numwords.js';
import { voteCategories } from './category.js';
import { kindForCategory } from './kind.js';
import { getLexicon, matchSynonyms, type Lexicon } from './lexicon.js';
import { extractPreferences, extractQuantity, type Preference } from './phrases.js';
import { splitSegments } from './split.js';
import { FA_LETTERS, QTY_MARKER_WORDS, SPEC_UNIT_WORDS, align, cutSpans, trimConnectors, type Span } from './text.js';
import {
  MAX_ITEMS,
  MAX_QTY,
  MAX_TEXT_CHARS,
  type CategoryCandidate,
  type NoteCode,
  type ParseNote,
  type ParsedItem,
  type ParseResult,
} from './types.js';

export const NOTE_FA: Record<NoteCode, string> = {
  not_in_catalog: 'این مورد در فهرست این بازار پیدا نشد؛ در لیست می‌ماند و بقیهٔ موردها ادامه پیدا می‌کنند.',
  catalog_unavailable: 'داده‌های بازار در دسترس نیست؛ دسته‌بندی این مورد مشخص نشد.',
  unparsed_fragment: 'بخشی از این مورد را متوجه نشدم؛ فقط در جست‌وجوی متن استفاده می‌شود.',
  ambiguous_category: 'این مورد می‌تواند در بیش از یک دسته باشد.',
  unknown_model_code: 'این کد مدل در فهرست پیدا نشد.',
  inherited_model: 'مدل گوشی از مورد گوشی همین درخواست گرفته شد؛ می‌توانید آن را ویرایش کنید.',
  qty_in_meters: 'مقدار بر حسب متر نوشته شده؛ واحد فروش (متری یا حلقه) را مشخص کنید.',
  unassigned_budget: 'این بودجه به یک مورد مشخص نسبت داده نشد؛ برای هر مورد جداگانه بنویسید.',
  conflicting_preferences: 'هم «ارزان» و هم «کم‌توقف» نوشته شده؛ اولین مورد در نظر گرفته شد.',
  too_many_items: `حداکثر ${toPersianDigits(MAX_ITEMS)} مورد در هر درخواست پشتیبانی می‌شود؛ بقیه نادیده گرفته شد.`,
};

function note(code: NoteCode, extra: { fragment?: string; itemId?: string } = {}): ParseNote {
  return { code, messageFa: NOTE_FA[code], ...extra };
}

/** Words that are understood as qualifiers / domain adjectives and so are not reported as "unparsed". */
const KNOWN_WORDS: ReadonlySet<string> = new Set([
  'آنالوگ', 'دیجیتال', 'شبکه', 'تحت', 'بولت', 'دام', 'بنفش', 'سورویلنس', 'اینترنال', 'اکسترنال', 'افشان', 'مفتولی',
  'ساختمانی', 'مدل', 'نوع', 'برند', 'اصلی', 'مناسب', 'گوشی', 'موبایل', 'مگ', 'پیکسل', 'ظرفیت', 'حجم', 'رشته', 'هسته',
  'سیمکارتی', 'خورشیدی', 'بیسیم', 'ip', 'ahd', 'tvi', 'cvi', 'xvr', 'dvr', 'nvr', 'hdd', 'ssd', 'cctv', 'led', 'برای', 'مخصوص',
  'بلوتوث', 'بی', 'سیم', 'باسیم', 'نمره', 'سایز', 'آیفون', 'گلکسی', 'گالکسی', 'ردمی', 'پوکو', 'نوت', 'پرو', 'مکس', 'پلاس',
  'الترا', 'لایت', 'مینی', 'شیائومی', 'سامسونگ', 'اپل',
  'متر', 'متری', 'حلقه', 'کلاف', 'رول', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'های', 'ها', 'ی',
  // listing condition words (they set `condition`, never narrow the search)
  'استوک', 'کارکرده', 'کار', 'کرده', 'دست', 'دوم', 'ریفربیش', 'ریفر', 'کپی', 'آکبند', 'اکبند', 'نو', 'فرقی', 'نمی‌کند', 'نمیکند',
]);

/**
 * Accepted listing conditions stated in the item text: used words («استوک», «کارکرده», «دست دوم»…) -> 'used',
 * copy words («کپی», «طرح اصلی»…, only in domains where the extractor reads replicas) -> 'replica', both or
 * «نو یا کارکرده» / «فرقی نمی‌کند نو یا…» -> 'any'. Nothing stated -> undefined (= 'new', the default).
 */
export function conditionOf(text: string, domain: string | null | undefined): ParsedItem['condition'] {
  const t = prepTitle(text);
  const used = extractCondition(t) !== null || /(?:^|\s)(?:استوک|کارکرده|دست دوم)(?:\s|$)/.test(t);
  const replica = extractReplica(t, domain ?? null);
  const either = /(?:^|\s)نو\s+(?:یا|و)\s+(?:استوک|کارکرده|دست دوم)|(?:استوک|کارکرده|دست دوم)\s+(?:یا|و)\s+نو(?:\s|$)/.test(t);
  if (either || (used && replica)) return 'any';
  if (used) return 'used';
  if (replica) return 'replica';
  return undefined;
}

/** Request filler at the start of a segment (positions are on the aligned string, where ZWNJ is a space). */
const LEADING_FILLER = new RegExp(
  `^\\s*(?:(?:لطفا|لطفاً|همچنین|ممنون|سلام)\\s+|(?:می\\s*خوام|می\\s*خواهم|نیاز\\s+دارم|احتیاج\\s+دارم|لازم\\s+دارم|میخوام|میخواهم)(?![${FA_LETTERS}])\\s*)+`,
);

const NUMERIC_TOKEN = /^\d+(?:\.\d+)?[a-z]*$/;
const lower = (s: string) => s.toLowerCase();

interface SegmentOut {
  item?: ParsedItem;
  /** A segment that is only a budget phrase («بودجه ۸ میلیون»). */
  budgetOnly?: { budget: Budget; total: boolean; raw: string };
  prefs: { preference: Preference; segIndex: number; index: number }[];
}

/** Words after which a destination / purpose follows («سیم برق برای اتاق»): that tail does not identify the item. */
const PURPOSE_WORDS: ReadonlySet<string> = new Set(['برای', 'مخصوص', 'جهت', 'واسه', 'مناسب']);
/** English function words / FTS-operator look-alikes that carry no product meaning (also injection noise). */
const EN_STOPWORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'not', 'near', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'for', 'with', 'you', 'now', 'say', 'all', 'set', 'me',
]);

/**
 * Tokens that identify the item for the FTS vote: no numbers, unit words, quantity markers, stopwords. After a
 * purpose word only tokens that name a thing (`keep`: synonym / brand tokens) or carry digits are kept, so
 * «سیم برق برای اتاق» searches «سیم برق» and reports «اتاق» as unparsed.
 */
function ftsContentTokens(tokens: string[], keep: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const cut = tokens.findIndex((t) => PURPOSE_WORDS.has(t));
  tokens.forEach((t, i) => {
    if (NUMERIC_TOKEN.test(t) || SPEC_UNIT_WORDS.has(t) || QTY_MARKER_WORDS.has(t) || FA_STOPWORDS.has(t) || EN_STOPWORDS.has(t)) return;
    if (t.length < 2 || seen.has(t)) return;
    if (cut >= 0 && i > cut && !keep.has(t) && !/\d/.test(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}

/**
 * Brand named in the item as the stable brand KEY (attrs.brand_key, e.g. 'dahua'): exactly one distinct strong
 * lexicon hit. Brand constraints carry the key, never the Persian display name, because the adapter (and the
 * engine) match products on brand_key; the display name is only for labels.
 */
function brandOf(tokens: string[]): string | null {
  const hits = findBrandsInTokens(tokens).filter((h) => !h.weak);
  const keys = new Set(hits.map((h) => h.key));
  return keys.size === 1 ? (hits[0]?.key ?? null) : null;
}

interface Extracted {
  constraints: Constraint[];
  ignored: string[];
  brandFromExtractor: string | null;
}

/** Run the domain extractors (reused from core) for the item's leading category and map to engine constraints. */
function extractConstraints(cleaned: string, categoryName: string, hasModelCode: boolean): Extracted {
  const r = extractProduct({ title: cleaned, categoryName, useSpecs: false });
  const attrs: Record<string, unknown> = { ...r.attrs };
  const src = (r.attrs._src ?? {}) as Record<string, string>;
  const drop = new Set<string>();
  // Values decoded from a typed model code are redundant with the code (and may be wrong): the code pins them.
  if (hasModelCode) for (const [k, s] of Object.entries(src)) if (s === 'model_code') drop.add(k);
  // The wire extractor infers cores = 1 for any title starting with «سیم»; the user did not say that.
  if (r.domain === 'wire' && attrs.cores !== undefined) {
    const a = align(cleaned);
    const explicit = /\d\s*(?:\*|×|x|در|ضرب)\s*\d|رشته|هسته|تک\s*سیم/.test(a);
    if (!explicit) drop.add('cores');
    else {
      const m = /(\d+|یک|دو|سه|چهار|پنج)\s*(?:رشته|هسته)/.exec(a);
      const words: Record<string, number> = { یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5 };
      const v = m ? (words[m[1] as string] ?? Number(m[1])) : NaN;
      if (Number.isFinite(v) && v >= 1 && v <= 5) attrs.cores = v;
    }
  }
  const { constraints, ignored } = mapExtractedAttrs(attrs, drop);
  const bk = r.brand && typeof r.attrs.brand_key === 'string' ? r.attrs.brand_key : null;
  return { constraints, ignored, brandFromExtractor: bk };
}

function dedupe(cs: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  return cs.filter((c) => (seen.has(c.attr) ? false : (seen.add(c.attr), true)));
}

function processSegment(raw: string, segIndex: number, db: Db, lex: Lexicon): SegmentOut {
  const a = align(raw);
  const mask = (s: string, spans: Span[]) => {
    let out = s;
    for (const sp of spans) out = out.slice(0, sp.start) + ' '.repeat(sp.end - sp.start) + out.slice(sp.end);
    return out;
  };
  const budgetHit = extractBudget(a);
  const spans: Span[] = [...(budgetHit?.spans ?? [])];
  let masked = mask(a, spans);
  const prefHits = extractPreferences(masked);
  for (const p of prefHits) spans.push(...p.spans);
  masked = mask(masked, spans);
  // «میخوام ۵۰ متر سیم»: leading filler words do not hide the leading quantity
  const filler = LEADING_FILLER.exec(masked);
  const qtyHit = extractQuantity(filler ? mask(masked, [{ start: 0, end: filler[0].length }]) : masked);
  if (qtyHit) spans.push(...qtyHit.spans);

  const prefs = prefHits.map((p) => ({ preference: p.preference, segIndex, index: p.index }));
  const cleaned = trimConnectors(cutSpans(raw, spans));
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    return { prefs, ...(budgetHit ? { budgetOnly: { budget: budgetHit.budget, total: budgetHit.total, raw } } : {}) };
  }

  const tokens = tokenizeForSearch(wordsToDigits(cleaned));
  const codes = extractModelCodes(cleaned);
  const modelCode = codes[0]?.code;
  const codeKeys = modelCodeKeys(codes).map(lower);
  const notes: ParseNote[] = [];

  const memo = new Map<number, Extracted>();
  const extractFor = (catId: number): Extracted => {
    let e = memo.get(catId);
    if (!e) {
      const cat = lex.categories.get(catId);
      // wire sections are often spelled out: «سیم افشان دو و نیم» -> 2.5 (the extractors read digits)
      e = cat?.domain ? extractConstraints(wordsToDigits(cleaned, { small: cat.domain === 'wire' }), cat.name, !!modelCode) : { constraints: [], ignored: [], brandFromExtractor: null };
      memo.set(catId, e);
    }
    return e;
  };

  // Tokens that name a thing: synonym terms and brands.
  const syn = matchSynonyms(lex, tokens);
  const named = new Set<string>();
  const brandTokens = new Set<string>();
  tokens.forEach((t, i) => syn.consumed[i] && named.add(t));
  for (const h of findBrandsInTokens(tokens, { includeNonTitle: true })) {
    for (const al of brandByKey(h.key)?.aliasTokens ?? []) {
      if (al.every((t, j) => tokens[h.tokenIndex + j] === t)) al.forEach((t) => (named.add(t), brandTokens.add(t)));
    }
    named.add(tokens[h.tokenIndex] as string);
    brandTokens.add(tokens[h.tokenIndex] as string);
  }
  const contentTokens = ftsContentTokens(tokens, named);
  // «آیفون ۱۵ پرو مکس» / «ایفون ۱۳»: a device model with no noun at all is a phone.
  const extraSyn = new Map<number, number>();
  if (syn.cats.size === 0 && lex.phoneCategoryId !== null && extractDeviceModels(cleaned).length === 1) extraSyn.set(lex.phoneCategoryId, 0.8);

  const vote = lex.available
    ? voteCategories(db, lex, { tokens: contentTokens, codeKeys, allTokens: tokens, extraSyn, brandTokens }, (id) => extractFor(id).constraints)
    : null;
  const lead = vote?.accepted[0];
  const leadCat = lead ? lex.categories.get(lead.id) : undefined;

  let constraints: Constraint[] = [];
  let ignored: string[] = [];
  let kind: ParsedItem['kind'] = 'other';
  let domain: string | undefined;
  if (leadCat) {
    const ex = extractFor(leadCat.id);
    constraints = [...ex.constraints];
    ignored = ex.ignored;
    const k = kindForCategory(leadCat.name, leadCat.domain);
    kind = k.kind;
    domain = k.domain ?? leadCat.domain ?? undefined;

    // Device models for phones / accessories: «A56» alone needs a family context (Samsung A-series by default).
    if (leadCat.domain === 'phone' || leadCat.domain === 'phone_accessory') {
      const attr = leadCat.domain === 'phone' ? 'phone_model' : 'fits_models';
      if (!constraints.some((c) => c.attr === attr)) {
        for (const fam of [null, 'samsung', 'xiaomi', 'apple'] as const) {
          const models = extractDeviceModels(cleaned, fam);
          if (models.length === 1 && models[0]) {
            constraints.push(attr === 'phone_model' ? { attr, op: 'eq', value: models[0], source: 'user' } : { attr, op: 'contains', value: models[0], source: 'user' });
            break;
          }
        }
      }
    }
    // «۲ حلقه سیم» states the sale unit.
    if (qtyHit?.unit === 'roll' && leadCat.domain === 'wire' && !constraints.some((c) => c.attr === 'sale_unit')) {
      constraints.push({ attr: 'sale_unit', op: 'eq', value: 'roll', source: 'user' });
    }
    // Brand: for accessories a known device model is the real constraint (the dataset uses the device brand there).
    const hasDevice = constraints.some((c) => c.attr === 'fits_models' || c.attr === 'phone_model');
    const brand = brandOf(tokens) ?? (modelCode ? null : ex.brandFromExtractor);
    if (brand && !(leadCat.domain === 'phone_accessory' && hasDevice)) constraints.push({ attr: 'brand', op: 'eq', value: brand, source: 'user' });
  } else if (vote) {
    notes.push(note('not_in_catalog'));
  } else {
    notes.push(note('catalog_unavailable'));
  }
  // «پاوربانک ۲۰۰۰۰»: in the power-bank domain a bare number of 1,000–100,000 is the capacity in mAh (how capacities
  // are written in this market); only when it is the single bare number of the item.
  if (leadCat?.domain === 'power_bank' && !constraints.some((c) => c.attr === 'capacity_mah')) {
    const bare = [...prepTitle(cleaned).matchAll(/(?<![\d.,/])(\d{4,6})(?![\d.,/]|\s*(?:وات|w\b|ولت|آمپر|امپر|تومان|ریال))/g)].map((m) => Number(m[1]));
    if (bare.length === 1 && bare[0]! >= 1000 && bare[0]! <= 100_000) constraints.push({ attr: 'capacity_mah', op: 'eq', value: bare[0]!, source: 'user' });
  }
  // A stated screen size («تلویزیون ۵۵ اینچ») applies to any category; listings are read the same way (adapter/rows.ts).
  if (leadCat && !constraints.some((c) => c.attr === 'screen_inch')) {
    const inch = screenInchOf(prepTitle(cleaned));
    if (inch !== null) constraints.push({ attr: 'screen_inch', op: 'eq', value: inch, source: 'user' });
  }
  constraints = dedupe(constraints);

  // «سیم برق ۲/۵ افشان ۵۰ متر»: a trailing «N متر» on a wire item (no other quantity, not «حلقه/کلاف N متری»)
  // is the length the user needs (qty in metres), not a roll-length requirement.
  let tailMetres: number | null = null;
  if (!qtyHit && leadCat?.domain === 'wire') {
    const a2 = align(wordsToDigits(cleaned));
    const m = new RegExp(`(?<![${FA_LETTERS}a-z0-9.,/])(\\d{1,4})\\s*متر(?![${FA_LETTERS}])`).exec(a2);
    if (m && !/(?:حلقه|کلاف|رول)\s*$/.test(a2.slice(0, m.index))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= MAX_QTY) {
        tailMetres = n;
        constraints = constraints.filter((c) => c.attr !== 'length_m');
      }
    }
  }

  if (vote && modelCode && vote.codeHitCount === 0) notes.push(note('unknown_model_code'));
  if (qtyHit?.unit === 'meter' || tailMetres !== null) notes.push(note('qty_in_meters'));

  // Ambiguity: the runner-up lives in another extraction domain and scores close to the leader.
  const second = vote?.accepted[1];
  if (lead && second && second.score >= 0.8 * lead.score && lex.categories.get(second.id)?.domain !== leadCat?.domain) {
    notes.push(note('ambiguous_category'));
  }

  // Unparsed leftovers: words that are neither names of the matched categories, brands, specs, codes nor stopwords.
  const known = new Set<string>(named);
  for (const c of vote?.candidates ?? []) for (const t of tokenizeForSearch(c.name)) known.add(t);
  for (const c of codes) for (const t of tokenizeForSearch(c.raw)) known.add(t);
  const leftovers = ftsContentTokens(tokens, new Set(tokens)).filter((t) => !known.has(t) && !KNOWN_WORDS.has(t) && !/^[a-z0-9]+$/.test(t));
  if (leftovers.length > 0 && lead) notes.push(note('unparsed_fragment', { fragment: leftovers.join(' ') }));
  if (leftovers.length > 0 && !lead && !(vote && notes.some((n) => n.code === 'not_in_catalog'))) notes.push(note('unparsed_fragment', { fragment: leftovers.join(' ') }));

  const qty = qtyHit?.qty ?? tailMetres ?? 1;
  const budget = budgetHit ? (budgetHit.total ? perUnit(budgetHit.budget, qty) : budgetHit.budget) : undefined;
  const nSpec = constraints.filter((c) => c.attr !== 'brand').length;
  const ambiguous = notes.some((n) => n.code === 'ambiguous_category');
  const confidence = lead
    ? Math.min(0.98, Math.max(0.05, 0.25 + 0.55 * lead.score + 0.1 * Math.min(1, nSpec / 2) + (modelCode && vote && vote.codeHitCount > 0 ? 0.1 : 0) - (leftovers.length > 0 ? 0.1 : 0) - (ambiguous ? 0.1 : 0)))
    : 0.15;

  const condition = conditionOf(cleaned, leadCat?.domain);
  const item: ParsedItem = {
    id: '',
    text: cleaned,
    ...(condition ? { condition } : {}),
    qty,
    ...(qtyHit || tailMetres !== null ? { qtyStated: true } : {}),
    ...(qtyHit?.exact !== undefined ? { qtyExact: qtyHit.exact } : {}),
    categoryIds: vote?.accepted.map((c) => c.id) ?? [],
    kind,
    constraints,
    ...(modelCode ? { modelCode } : {}),
    ...(budget ? { budget } : {}),
    rawText: raw,
    confidence: Math.round(confidence * 100) / 100,
    categoryCandidates: (vote?.candidates ?? []) as CategoryCandidate[],
    notes,
    ...(domain ? { domain } : {}),
    ...(qtyHit?.unit === 'meter' || tailMetres !== null ? { unit: 'متر' } : qtyHit?.unit === 'roll' ? { unit: 'حلقه' } : {}),
    ...(ignored.length ? { ignoredAttrs: ignored } : {}),
  };
  return { item, prefs };
}

/** A case / screen protector without a phone model inherits it from the phone item of the same request. */
function linkContext(items: ParsedItem[]): void {
  items.forEach((it, idx) => {
    if ((it.kind !== 'phone_case' && it.kind !== 'screen_protector') || it.modelCode) return;
    if (it.constraints.some((c) => c.attr === 'fits_models')) return;
    // Sources: a phone item with a model, else a sibling accessory that states its own model («قاب و گلس آیفون ۱۳»).
    const sourcesOf = (pick: (p: ParsedItem) => string | undefined) =>
      items.map((p, i) => ({ p, i, model: p === it ? undefined : pick(p) })).filter((s): s is { p: ParsedItem; i: number; model: string } => !!s.model);
    const statedModel = (p: ParsedItem, attr: string, kinds: ParsedItem['kind'][]): string | undefined => {
      if (!kinds.includes(p.kind)) return undefined;
      const c = p.constraints.find((x) => x.attr === attr && !p.inherited?.some((h) => h.attr === attr));
      return c && 'value' in c && typeof c.value === 'string' ? c.value : undefined;
    };
    let sources = sourcesOf((p) => statedModel(p, 'phone_model', ['phone']));
    if (sources.length === 0) sources = sourcesOf((p) => statedModel(p, 'fits_models', ['phone_case', 'screen_protector']));
    if (sources.length === 0) return;
    const preceding = sources.filter(({ i }) => i < idx);
    const pickSrc = preceding.length ? preceding[preceding.length - 1] : sources[0];
    if (!pickSrc) return;
    it.constraints.push({ attr: 'fits_models', op: 'contains', value: pickSrc.model, source: 'user' });
    it.inherited = [{ attr: 'fits_models', fromItemId: pickSrc.p.id }];
    it.notes.push(note('inherited_model', { itemId: it.id }));
    it.confidence = Math.min(0.98, Math.round((it.confidence + 0.05) * 100) / 100);
    // The inherited model replaces a brand-only guess made from the accessory words.
    it.constraints = it.constraints.filter((c) => c.attr !== 'brand');
  });
}

export function titleOf(items: ParsedItem[]): string {
  if (items.length === 0) return 'درخواست من';
  const clip = (s: string) => (s.length > 28 ? s.slice(0, 27).trimEnd() + '…' : s);
  const head = items.slice(0, 3).map((i) => clip(i.text)).join('، ');
  return items.length > 3 ? `${head} و ${toPersianDigits(items.length - 3)} مورد دیگر` : head;
}

export function parseRequest(textIn: string, db: Db): ParseResult {
  // Defensive clamp (the route already rejects longer input). Bidi overrides / isolates and control characters
  // are removed here, at the parse boundary, so no item text, title or share link can carry them.
  const text = sanitizeText(textIn).slice(0, MAX_TEXT_CHARS);
  const lex = getLexicon(db);
  const segments = splitSegments(text, lex);

  const items: ParsedItem[] = [];
  const globalNotes: ParseNote[] = [];
  const prefs: { preference: Preference; segIndex: number; index: number }[] = [];
  const budgetOnly: NonNullable<SegmentOut['budgetOnly']>[] = [];
  let overflow = false;

  segments.forEach((seg, segIndex) => {
    const out = processSegment(seg, segIndex, db, lex);
    prefs.push(...out.prefs);
    if (out.budgetOnly) budgetOnly.push(out.budgetOnly);
    if (out.item) {
      if (items.length >= MAX_ITEMS) overflow = true;
      else items.push(out.item);
    }
  });
  items.forEach((it, i) => {
    it.id = `i${i + 1}`;
    for (const n of it.notes) n.itemId = it.id;
  });
  if (overflow) globalNotes.push(note('too_many_items'));

  let totalBudget: Budget | undefined;
  for (const b of budgetOnly) {
    const only = items.length === 1 ? items[0] : undefined;
    if (only && !only.budget) only.budget = b.total ? perUnit(b.budget, only.qty) : b.budget;
    else {
      totalBudget ??= b.budget;
      globalNotes.push(note('unassigned_budget', { fragment: b.raw.trim() }));
    }
  }

  const sortedPrefs = [...prefs].sort((x, y) => x.segIndex - y.segIndex || x.index - y.index);
  const preference = sortedPrefs[0]?.preference;
  if (preference && sortedPrefs.some((p) => p.preference !== preference)) globalNotes.push(note('conflicting_preferences'));

  linkContext(items);

  const itemNotes = items.flatMap((it) => it.notes.filter((n) => n.code === 'unparsed_fragment'));
  return {
    title: titleOf(items),
    items,
    ...(preference ? { preference } : {}),
    ...(totalBudget ? { totalBudget } : {}),
    notes: [...globalNotes, ...itemNotes],
    source: 'deterministic',
  };
}
