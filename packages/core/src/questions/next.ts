/**
 * Next question for one item (B1.4). The engine asks FEW questions, and only ones that change the answer:
 *
 * Priority 1: compatibility-critical unknowns (from compat rules). Always asked, outside the per-item cap.
 * Then, at most MAX_QUESTIONS_PER_ITEM questions per item in total (every question already shown counts, compat
 * ones included; a compat question that appears later may therefore be a third one), chosen among:
 *   - facets: attributes readable on the eligible models, offering only meaningful options (each keeps at least
 *     two models and MIN_OPTION_SHARE of the pool; at least two such options, else not asked);
 *   - budget bands from the real price distribution;
 * ranked by information value = max(pool narrowing, price-spread narrowing) (see `informationValue`), biggest
 * first. A question that narrows neither the pool (< MIN_POOL_NARROWING) nor the price spread
 * (< MIN_SPREAD_NARROWING) is never asked. Key facets (KEY_FACETS: what the item must work with, e.g. analog vs IP
 * for a camera, the adapter voltage) are kept whatever their value or coverage and asked before the others; they
 * stay priority 2 because they do not block the suggestion.
 * Stopping rule (no hidden price tolerance): stop when nothing compat-critical is unknown and the eligible
 * list fits one screen (`maxListSize`), when the item had its share of questions, or when the user accepted the
 * suggestion.
 */
import {
  facetOptionLabel,
  Q_ADAPTER_FOR_CAMERAS,
  Q_RECORDER_FOR_CAMERAS,
  QUESTION_SKIP_LABEL,
  QUESTION_STOP_LABEL,
  questionAccessoryPhone,
  questionText,
  questionWhy,
} from '../copy/fa';
import { MANDATORY_RULES } from '../compat/rules';
import { evaluateCandidates, normToken } from '../requirement/evaluate';
import {
  ATTR_KEYS,
  ATTR_SCHEMA,
  type AttrKey,
  type Candidate,
  type CandidateEval,
  type Constraint,
  type CriticalUnknown,
  type ItemKind,
  type Question,
  type QuestionKey,
  type QuestionOption,
  type QuestionOutcome,
  type QuestionStopReason,
  type Requirement,
} from '../types/index';
import { budgetBands, budgetOptions } from './budget';

export interface QuestionParams {
  /** Compat-critical unknowns for the whole list (filtered to this item internally). */
  criticalUnknowns?: readonly CriticalUnknown[];
  /** One phone screen of option cards. Default 8. */
  maxListSize?: number;
  /** Minimum share of eligible candidates the offered options must cover. Default 0.5. */
  minAttrCoverage?: number;
  /** Maximum options per facet question. Default 6. */
  maxOptions?: number;
  /** Questions per item (compat-critical ones are asked beyond it). Default MAX_QUESTIONS_PER_ITEM. */
  maxQuestions?: number;
  /**
   * false = the answer would contradict something the user fixed on another item (compat `answerConflict`): the
   * option is never offered. Absent = every option is allowed.
   */
  answerAllowed?: (item: Requirement, constraint: Constraint) => boolean;
}

export const DEFAULT_MAX_LIST_SIZE = 8;
/** Questions per item; a compatibility-critical question may still come on top (then at most 3). */
export const MAX_QUESTIONS_PER_ITEM = 2;
/** Below this pool narrowing AND below MIN_SPREAD_NARROWING a question is not worth asking. */
export const MIN_POOL_NARROWING = 0.15;
export const MIN_SPREAD_NARROWING = 0.2;
/** An option is meaningful when it keeps at least 2 models and this share of the eligible pool. */
export const MIN_OPTION_SHARE = 0.02;

/**
 * The question that decides what the item must work with, per role: asked before any other facet (when not
 * stated), kept even when it narrows little. Compat rules ask the sibling version of these as priority 1.
 */
export const KEY_FACETS: Readonly<Partial<Record<ItemKind, readonly AttrKey[]>>> = {
  camera: ['camera_signal'],
  recorder: ['recorder_kind'],
  adapter: ['voltage_v'],
  wire: ['wire_section_mm2'],
};

function entropy(counts: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0) return 0;
  let h = 0;
  for (const c of counts) if (c > 0) h -= (c / n) * Math.log2(c / n);
  return h;
}

/** ln(max / min) of the prices; 0 for fewer than two distinct prices. */
function logSpread(prices: readonly number[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prices) {
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  return prices.length >= 2 && lo > 0 && hi > lo ? Math.log(hi / lo) : 0;
}

export interface InformationValue {
  /** Share of the offered options' models among the eligible ones. */
  coverage: number;
  /** Expected share of the eligible models an answer separates: (1 - Σ share²) × coverage. */
  narrowing: number;
  /** Expected narrowing of the price spread: (1 - Σ share × ln(max/min)_option / ln(max/min)_all) × coverage. */
  spread: number;
}

/**
 * Information value of a question whose options keep `groups` (count and priced members) out of `total` eligible
 * models priced `allPrices`. Answers are weighted by their option's size (a bigger option is a likelier answer).
 * Models the options do not cover lower both numbers through `coverage`: narrowing by ignorance is not information.
 */
export function informationValue(
  groups: readonly { count: number; prices: readonly number[] }[],
  total: number,
  allPrices: readonly number[],
): InformationValue {
  const known = groups.reduce((a, g) => a + g.count, 0);
  if (total <= 0 || known <= 0) return { coverage: 0, narrowing: 0, spread: 0 };
  const coverage = Math.min(1, known / total);
  const gini = 1 - groups.reduce((a, g) => a + (g.count / known) ** 2, 0);
  const s0 = logSpread(allPrices);
  // an option without two prices tells nothing about its spread: counted as the whole spread
  const after = groups.reduce((a, g) => a + (g.count / known) * (g.prices.length >= 2 ? logSpread(g.prices) : g.prices.length === 1 ? 0 : s0), 0);
  return { coverage, narrowing: gini * coverage, spread: s0 > 0 ? Math.max(0, 1 - after / s0) * coverage : 0 };
}

const minOf = (xs: readonly number[]): number | undefined => (xs.length ? Math.min(...xs) : undefined);

/** Every question already shown for the item (answered with an option or «فرقی نمی‌کند»). */
export function askedQuestions(item: Requirement): Set<QuestionKey> {
  const s = new Set<QuestionKey>(item.answeredQuestions ?? []);
  for (const k of item.skippedQuestions ?? []) s.add(k);
  for (const c of item.constraints) if (c.source === 'answer') s.add(c.attr);
  return s;
}

interface Bucket {
  key: string;
  value: string | number | boolean;
  count: number;
  /** usable prices of the bucket's members */
  prices: number[];
  /** most frequent original spelling (strings) */
  spellings: Map<string, number>;
}

/** The bucket a value falls in (strings compare normalised); null when unreadable. */
function bucketKey(v: unknown): string | null {
  if (v === undefined || v === null || Array.isArray(v)) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return typeof v === 'string' ? `s:${normToken(v)}` : `${typeof v}:${String(v)}`;
}

function bucketize(attr: AttrKey, cands: readonly Candidate[], priceOf: (c: Candidate) => number | null): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const c of cands) {
    const v = c.attrs[attr];
    const key = bucketKey(v);
    if (key === null || v === undefined || Array.isArray(v)) continue;
    let b = map.get(key);
    if (!b) {
      b = { key, value: v, count: 0, prices: [], spellings: new Map() };
      map.set(key, b);
    }
    b.count++;
    const p = priceOf(c);
    if (p !== null) b.prices.push(p);
    if (typeof v === 'string') b.spellings.set(v, (b.spellings.get(v) ?? 0) + 1);
  }
  for (const b of map.values()) {
    if (b.spellings.size) {
      b.value = [...b.spellings.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]![0];
    }
  }
  return [...map.values()];
}

function baseQuestion(item: Requirement, partial: Omit<Question, 'itemId' | 'skipLabel' | 'stopLabel'>): Question {
  return { itemId: item.id, skipLabel: QUESTION_SKIP_LABEL, stopLabel: QUESTION_STOP_LABEL, ...partial };
}

/** Cheapest usable price among `cands` (per unit), undefined when none is priced. */
function cheapest(cands: readonly Candidate[], priceOf: (c: Candidate) => number | null): number | undefined {
  return minOf(cands.map(priceOf).filter((p): p is number => p !== null));
}

function withMinPrice(o: QuestionOption, min: number | undefined): QuestionOption {
  return min !== undefined ? { ...o, minPrice: min } : o;
}

function compatQuestion(
  item: Requirement,
  cu: CriticalUnknown,
  pool: readonly Candidate[],
  maxOptions: number,
  priceOf: (c: Candidate) => number | null,
  candidates: readonly Candidate[] = pool,
): Question | null {
  if (cu.ruleId === 'camera_adapter_12v') {
    // the voltages on offer, judged without the 12 V assumption itself (it is what the question confirms or lifts)
    const open: Requirement = { ...item, constraints: item.constraints.filter((c) => !(c.attr === 'voltage_v' && c.source === 'compat')) };
    const byId = new Map(candidates.map((c) => [c.product.id, c]));
    const openEvals = evaluateCandidates(open, candidates);
    const vpool = openEvals
      .filter((e) => e.fit !== 'differs')
      .map((e) => byId.get(e.productId)!)
      .filter(Boolean);
    // the main evaluation fails every other voltage on the assumption: hint prices come from the open one
    const openPrice = new Map(openEvals.filter((e) => e.fit === 'eligible').map((e) => [e.productId, e.minPrice]));
    const vPrice = (c: Candidate): number | null => openPrice.get(c.product.id) ?? null;
    const groups = new Map<number, Candidate[]>();
    for (const c of vpool) {
      const v = c.attrs.voltage_v;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const g = groups.get(v);
      if (g) g.push(c);
      else groups.set(v, [c]);
    }
    if (groups.size === 0) return null;
    const twelve = [...groups.keys()].find((v) => Math.abs(v - 12) < 1e-9);
    const others = [...groups.entries()]
      .filter(([v]) => v !== twelve)
      .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
      .slice(0, Math.max(0, maxOptions - (twelve !== undefined ? 1 : 0)))
      .sort((a, b) => a[0] - b[0]);
    const options: QuestionOption[] = [];
    if (twelve !== undefined)
      options.push(
        withMinPrice(
          {
            id: `voltage_v:${twelve}`,
            label: Q_ADAPTER_FOR_CAMERAS.option12,
            count: groups.get(twelve)!.length,
            apply: { constraint: { attr: 'voltage_v', op: 'eq', value: twelve, source: 'answer' } },
          },
          cheapest(groups.get(twelve)!, vPrice),
        ),
      );
    for (const [v, cs] of others)
      options.push(
        withMinPrice(
          {
            id: `voltage_v:${v}`,
            label: facetOptionLabel('voltage_v', v),
            count: cs.length,
            apply: { constraint: { attr: 'voltage_v', op: 'eq', value: v, source: 'answer' } },
          },
          cheapest(cs, vPrice),
        ),
      );
    return baseQuestion(item, {
      key: 'voltage_v',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: Q_ADAPTER_FOR_CAMERAS.text,
      unknownCount: vpool.length - [...groups.values()].reduce((a, b) => a + b.length, 0),
      options,
    });
  }
  if (cu.ruleId === 'camera_recorder_signal') {
    const analog = pool.filter((c) => c.attrs.recorder_kind === 'xvr' || c.attrs.recorder_kind === 'dvr');
    const ip = pool.filter((c) => c.attrs.recorder_kind === 'nvr');
    const unknown = pool.filter((c) => !c.attrs.recorder_kind).length;
    const options: QuestionOption[] = [
      withMinPrice(
        {
          id: 'recorder_kind:analog',
          label: Q_RECORDER_FOR_CAMERAS.analog,
          count: analog.length,
          apply: { constraint: { attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'answer' } },
        },
        cheapest(analog, priceOf),
      ),
      withMinPrice(
        {
          id: 'recorder_kind:ip',
          label: Q_RECORDER_FOR_CAMERAS.ip,
          count: ip.length,
          apply: { constraint: { attr: 'recorder_kind', op: 'in', values: ['nvr'], source: 'answer' } },
        },
        cheapest(ip, priceOf),
      ),
    ].filter((o) => o.count > 0); // an option that keeps nothing is never offered
    if (!options.length) return null;
    return baseQuestion(item, {
      key: 'recorder_kind',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: Q_RECORDER_FOR_CAMERAS.text,
      unknownCount: unknown,
      options,
    });
  }
  if (cu.ruleId === 'wire_sale_unit') {
    const of = (u: string) => pool.filter((c) => c.attrs.sale_unit === u);
    const units = (ATTR_SCHEMA.sale_unit.values ?? []).filter((u) => of(u).length > 0);
    return baseQuestion(item, {
      key: 'sale_unit',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: questionText('sale_unit'),
      unknownCount: pool.filter((c) => !c.attrs.sale_unit).length,
      options: units.map((u) =>
        withMinPrice(
          {
            id: `sale_unit:${u}`,
            label: facetOptionLabel('sale_unit', u),
            count: of(u).length,
            apply: { constraint: { attr: 'sale_unit', op: 'eq', value: u, source: 'answer' } },
          },
          cheapest(of(u), priceOf),
        ),
      ),
    });
  }
  if (cu.ruleId === 'phone_accessory_fit') {
    const groups = new Map<string, { label: string; members: Candidate[] }>();
    let unknown = 0;
    for (const c of pool) {
      const list = c.attrs.fits_models ?? [];
      if (list.length === 0) unknown++;
      const seen = new Set<string>();
      for (const m of list) {
        const k = normToken(m);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const e = groups.get(k) ?? { label: m, members: [] };
        e.members.push(c);
        groups.set(k, e);
      }
    }
    const top = [...groups.entries()]
      .sort((a, b) => b[1].members.length - a[1].members.length || (a[0] < b[0] ? -1 : 1))
      .slice(0, maxOptions);
    const options: QuestionOption[] = top.map(([k, e]) =>
      withMinPrice(
        {
          id: `fits_models:${k}`,
          label: facetOptionLabel('fits_models', [e.label]),
          count: e.members.length,
          apply: { constraint: { attr: 'fits_models', op: 'contains', value: e.label, source: 'answer' } },
        },
        cheapest(e.members, priceOf),
      ),
    );
    return baseQuestion(item, {
      key: 'fits_models',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: questionAccessoryPhone(item.kind),
      unknownCount: unknown,
      options,
    });
  }
  return null;
}

interface Scored {
  question: Question;
  /** max(narrowing, spread) */
  value: number;
  /** a KEY_FACETS attribute: asked first */
  key: boolean;
  /** tie-break: schema order, budget last */
  order: number;
}

/** Facet questions worth asking on the eligible pool (unranked), and whether any was dropped as low-value. */
function facetQuestions(
  item: Requirement,
  eligible: readonly Candidate[],
  priceOf: (c: Candidate) => number | null,
  minCoverage: number,
  maxOptions: number,
  allowed: (c: Constraint) => boolean,
  exclude: ReadonlySet<QuestionKey>,
): { scored: Scored[]; lowValue: boolean } {
  const n = eligible.length;
  const allPrices = eligible.map(priceOf).filter((p): p is number => p !== null);
  const keyAttrs = new Set(item.kind ? (KEY_FACETS[item.kind] ?? []) : []);
  const minCount = Math.max(2, Math.ceil(MIN_OPTION_SHARE * n));
  const scored: Scored[] = [];
  let lowValue = false;
  ATTR_KEYS.forEach((attr, order) => {
    const spec = ATTR_SCHEMA[attr];
    if (!spec.askable || spec.kind === 'string_list' || exclude.has(attr)) return;
    // values that would contradict what the user fixed elsewhere are not offered (nor counted as a split);
    // options that keep (almost) nothing are not offered either
    const isNum = spec.kind === 'number';
    const buckets = bucketize(attr, eligible, priceOf);
    const ok = (b: Bucket) => allowed({ attr, op: 'eq', value: b.value, source: 'answer' });
    let chosen = buckets
      .filter((b) => b.count >= minCount && ok(b))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
      .slice(0, maxOptions);
    if (chosen.length < 2) return;
    // models whose value contradicts a sibling (an IP camera next to a stated DVR) are no real choice: they do not
    // count against the options' coverage
    const ruledOut = buckets.filter((b) => !ok(b));
    const pool = n - ruledOut.reduce((a, b) => a + b.count, 0);
    const out = new Set(ruledOut.map((b) => b.key));
    const poolPrices = out.size
      ? eligible
          .filter((c) => !out.has(bucketKey(c.attrs[attr]) ?? ''))
          .map(priceOf)
          .filter((p): p is number => p !== null)
      : allPrices;
    const iv = informationValue(chosen, pool, poolPrices);
    // a key question is asked even when many listings do not state it (half the cameras do not say analog or IP):
    // the answer is what keeps an unreadable, possibly incompatible listing from being the suggestion
    const key = keyAttrs.has(attr);
    if (!key && iv.coverage < minCoverage) return;
    if (!key && iv.narrowing < MIN_POOL_NARROWING && iv.spread < MIN_SPREAD_NARROWING) {
      lowValue = true;
      return;
    }
    if (isNum) chosen = chosen.sort((a, b) => Number(a.value) - Number(b.value));
    const options: QuestionOption[] = chosen.map((b) =>
      withMinPrice(
        { id: `${attr}:${b.key}`, label: facetOptionLabel(attr, b.value), count: b.count, apply: { constraint: { attr, op: 'eq', value: b.value, source: 'answer' } } },
        minOf(b.prices),
      ),
    );
    const known = chosen.reduce((a, b) => a + b.count, 0);
    const value = Math.max(iv.narrowing, iv.spread);
    const q = baseQuestion(item, {
      key: attr,
      priority: 2,
      source: 'facet',
      text: questionText(attr),
      options,
      unknownCount: n - known,
      score: { entropy: entropy(chosen.map((b) => b.count)), coverage: iv.coverage, value, narrowing: iv.narrowing, spread: iv.spread },
    });
    const why = questionWhy(attr);
    if (why) q.why = why;
    scored.push({ question: q, value, key, order });
  });
  return { scored, lowValue };
}

/** The budget-band question on the eligible pool, or null (fewer than two bands, or not worth asking). */
function budgetQuestion(item: Requirement, eligibleCount: number, prices: readonly number[]): { scored: Scored | null; lowValue: boolean } {
  const bands = budgetBands(prices);
  if (bands.length < 2) return { scored: null, lowValue: false };
  const inBand = (p: number, b: (typeof bands)[number]) => (b.budget.min === undefined || p >= b.budget.min) && (b.budget.max === undefined || p <= b.budget.max);
  const groups = bands.map((b) => ({ count: b.count, prices: prices.filter((p) => inBand(p, b)) }));
  const iv = informationValue(groups, eligibleCount, prices);
  if (iv.narrowing < MIN_POOL_NARROWING && iv.spread < MIN_SPREAD_NARROWING) return { scored: null, lowValue: true };
  const value = Math.max(iv.narrowing, iv.spread);
  const q = baseQuestion(item, {
    key: 'budget',
    priority: 3,
    source: 'budget',
    text: questionText('budget'),
    options: budgetOptions(prices),
    unknownCount: eligibleCount - prices.length,
    score: { entropy: entropy(groups.map((g) => g.count)), coverage: iv.coverage, value, narrowing: iv.narrowing, spread: iv.spread },
  });
  const lo = minOf(prices);
  const why = questionWhy('budget', lo !== undefined ? { min: lo, max: Math.max(...prices) } : undefined);
  if (why) q.why = why;
  return { scored: { question: q, value, key: false, order: ATTR_KEYS.length }, lowValue: false };
}

/**
 * The next question for `item`, or none with the reason questioning stopped.
 * `evals` may be passed when already computed for the same item and candidates.
 */
export function nextQuestion(
  item: Requirement,
  candidates: readonly Candidate[],
  params: QuestionParams = {},
  evals?: readonly CandidateEval[],
): QuestionOutcome {
  const maxListSize = params.maxListSize ?? DEFAULT_MAX_LIST_SIZE;
  const minCoverage = params.minAttrCoverage ?? 0.5;
  const maxOptions = params.maxOptions ?? 6;
  const maxQuestions = params.maxQuestions ?? MAX_QUESTIONS_PER_ITEM;
  const ev = evals ?? evaluateCandidates(item, candidates);
  const byId = new Map(candidates.map((c) => [c.product.id, c]));
  // prices of eligible models only: an incomplete listing (e.g. an unclear sale unit) never sets an option's «از …»
  const priceById = new Map(ev.filter((e) => e.fit === 'eligible').map((e) => [e.productId, e.minPrice]));
  const priceOf = (c: Candidate): number | null => priceById.get(c.product.id) ?? null;
  const eligible = ev.filter((e) => e.fit === 'eligible').map((e) => byId.get(e.productId)!).filter(Boolean);
  const eligibleCount = eligible.length;
  const stop = (stopReason: QuestionStopReason): QuestionOutcome => ({ question: null, stopReason, eligibleCount });

  if (item.pinnedProductId !== undefined || ev.some((e) => e.modelCodeMatch)) return stop('pinned');
  if (candidates.length === 0) return stop('no_candidates');
  // questions split the candidates that do not already fail a stated constraint
  const pool = ev.filter((e) => e.fit !== 'differs').map((e) => byId.get(e.productId)!).filter(Boolean);
  const allowed = (c: Constraint) => params.answerAllowed?.(item, c) ?? true;
  /** A compat question without the options that contradict a sibling; null when none is left. */
  const allowedOnly = (q: Question | null): Question | null => {
    if (!q || !params.answerAllowed) return q;
    const options = q.options.filter((o) => !o.apply.constraint || allowed(o.apply.constraint));
    return options.length ? { ...q, options } : null;
  };
  // mandatory unknowns (unit guard) are asked even after «کافیه، پیشنهاد بده» / «فرقی نمی‌کند»
  const mine = (params.criticalUnknowns ?? []).filter((c) => c.itemId === item.id);
  for (const cu of mine.filter((c) => MANDATORY_RULES.has(c.ruleId))) {
    const q = allowedOnly(compatQuestion(item, cu, pool, maxOptions, priceOf));
    if (q && q.options.length > 0) return { question: q, eligibleCount };
  }
  if (item.preference?.acceptSuggestion) return stop('accepted_default');

  const skipped = new Set(item.skippedQuestions ?? []);
  // compatibility-critical questions are unavoidable: asked whatever the cap
  for (const cu of mine.filter((c) => !MANDATORY_RULES.has(c.ruleId) && !skipped.has(c.attr))) {
    const q = allowedOnly(compatQuestion(item, cu, pool, maxOptions, priceOf, candidates));
    if (q) return { question: q, eligibleCount };
  }

  if (eligibleCount <= maxListSize) return stop('fits_one_screen');
  const asked = askedQuestions(item);
  if (asked.size >= maxQuestions) return stop('question_cap');

  // never ask what the user stated (or a rule derived), skipped or already answered
  const exclude = new Set<QuestionKey>([...item.constraints.map((c) => c.attr), ...asked]);
  const facets = facetQuestions(item, eligible, priceOf, minCoverage, maxOptions, allowed, exclude);
  const ranked = [...facets.scored];
  let lowValue = facets.lowValue;
  const hasBudget = !!item.budget && (item.budget.min !== undefined || item.budget.max !== undefined);
  if (!hasBudget && !asked.has('budget')) {
    const prices = ev.filter((e) => e.fit === 'eligible' && e.minPrice !== null).map((e) => e.minPrice!);
    const b = budgetQuestion(item, eligibleCount, prices);
    if (b.scored) ranked.push(b.scored);
    lowValue ||= b.lowValue;
  }
  ranked.sort((a, b) => Number(b.key) - Number(a.key) || b.value - a.value || a.order - b.order);
  const best = ranked[0];
  if (best) return { question: best.question, eligibleCount };
  return stop(lowValue ? 'low_value' : 'no_discriminating_question');
}
