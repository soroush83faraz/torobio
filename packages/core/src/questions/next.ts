/**
 * Next question for one item (B1.4).
 * Priority 1: compatibility-critical unknowns (from compat rules).
 * Priority 2: the discriminating attribute with the highest information value (entropy × coverage) among
 *             attributes readable for most of the eligible candidates.
 * Priority 3: budget bands from the real price distribution.
 * Stopping rule (no hidden price tolerance): stop when nothing compat-critical is unknown and the eligible
 * list fits one screen (`maxListSize`), or when the user accepted the suggestion.
 */
import {
  facetOptionLabel,
  Q_ADAPTER_FOR_CAMERAS,
  Q_RECORDER_FOR_CAMERAS,
  QUESTION_SKIP_LABEL,
  QUESTION_STOP_LABEL,
  questionAccessoryPhone,
  questionText,
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
  type ProductAttrs,
  type Question,
  type QuestionOption,
  type QuestionOutcome,
  type Requirement,
} from '../types/index';
import { budgetOptions } from './budget';

export interface QuestionParams {
  /** Compat-critical unknowns for the whole list (filtered to this item internally). */
  criticalUnknowns?: readonly CriticalUnknown[];
  /** One phone screen of option cards. Default 8. */
  maxListSize?: number;
  /** Minimum share of eligible candidates on which an attribute must be readable. Default 0.5. */
  minAttrCoverage?: number;
  /** Maximum options per facet question. Default 6. */
  maxOptions?: number;
  /**
   * false = the answer would contradict something the user fixed on another item (compat `answerConflict`): the
   * option is never offered. Absent = every option is allowed.
   */
  answerAllowed?: (item: Requirement, constraint: Constraint) => boolean;
}

export const DEFAULT_MAX_LIST_SIZE = 8;

function entropy(counts: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0) return 0;
  let h = 0;
  for (const c of counts) if (c > 0) h -= (c / n) * Math.log2(c / n);
  return h;
}

interface Bucket {
  key: string;
  value: string | number | boolean;
  count: number;
  /** most frequent original spelling (strings) */
  spellings: Map<string, number>;
}

function bucketize(attr: AttrKey, attrsList: readonly ProductAttrs[]): { buckets: Bucket[]; known: number } {
  const map = new Map<string, Bucket>();
  let known = 0;
  for (const a of attrsList) {
    const v = a[attr];
    if (v === undefined || v === null || Array.isArray(v)) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    known++;
    const key = typeof v === 'string' ? `s:${normToken(v)}` : `${typeof v}:${String(v)}`;
    let b = map.get(key);
    if (!b) {
      b = { key, value: v, count: 0, spellings: new Map() };
      map.set(key, b);
    }
    b.count++;
    if (typeof v === 'string') b.spellings.set(v, (b.spellings.get(v) ?? 0) + 1);
  }
  for (const b of map.values()) {
    if (b.spellings.size) {
      b.value = [...b.spellings.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]![0];
    }
  }
  return { buckets: [...map.values()], known };
}

function baseQuestion(item: Requirement, partial: Omit<Question, 'itemId' | 'skipLabel' | 'stopLabel'>): Question {
  return { itemId: item.id, skipLabel: QUESTION_SKIP_LABEL, stopLabel: QUESTION_STOP_LABEL, ...partial };
}

function compatQuestion(
  item: Requirement,
  cu: CriticalUnknown,
  pool: readonly Candidate[],
  maxOptions: number,
  candidates: readonly Candidate[] = pool,
): Question | null {
  if (cu.ruleId === 'camera_adapter_12v') {
    // the voltages on offer, judged without the 12 V assumption itself (it is what the question confirms or lifts)
    const open: Requirement = { ...item, constraints: item.constraints.filter((c) => !(c.attr === 'voltage_v' && c.source === 'compat')) };
    const byId = new Map(candidates.map((c) => [c.product.id, c]));
    const vpool = evaluateCandidates(open, candidates)
      .filter((e) => e.fit !== 'differs')
      .map((e) => byId.get(e.productId)!)
      .filter(Boolean);
    const counts = new Map<number, number>();
    for (const c of vpool) {
      const v = c.attrs.voltage_v;
      if (typeof v === 'number' && Number.isFinite(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    const twelve = [...counts.keys()].find((v) => Math.abs(v - 12) < 1e-9);
    const others = [...counts.entries()]
      .filter(([v]) => v !== twelve)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, Math.max(0, maxOptions - (twelve !== undefined ? 1 : 0)))
      .sort((a, b) => a[0] - b[0]);
    const options: QuestionOption[] = [];
    if (twelve !== undefined)
      options.push({
        id: `voltage_v:${twelve}`,
        label: Q_ADAPTER_FOR_CAMERAS.option12,
        count: counts.get(twelve)!,
        apply: { constraint: { attr: 'voltage_v', op: 'eq', value: twelve, source: 'answer' } },
      });
    for (const [v, n] of others)
      options.push({
        id: `voltage_v:${v}`,
        label: facetOptionLabel('voltage_v', v),
        count: n,
        apply: { constraint: { attr: 'voltage_v', op: 'eq', value: v, source: 'answer' } },
      });
    return baseQuestion(item, {
      key: 'voltage_v',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: Q_ADAPTER_FOR_CAMERAS.text,
      unknownCount: vpool.length - [...counts.values()].reduce((a, b) => a + b, 0),
      options,
    });
  }
  if (cu.ruleId === 'camera_recorder_signal') {
    const analog = pool.filter((c) => c.attrs.recorder_kind === 'xvr' || c.attrs.recorder_kind === 'dvr').length;
    const ip = pool.filter((c) => c.attrs.recorder_kind === 'nvr').length;
    const unknown = pool.filter((c) => !c.attrs.recorder_kind).length;
    return baseQuestion(item, {
      key: 'recorder_kind',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: Q_RECORDER_FOR_CAMERAS.text,
      unknownCount: unknown,
      options: [
        {
          id: 'recorder_kind:analog',
          label: Q_RECORDER_FOR_CAMERAS.analog,
          count: analog,
          apply: { constraint: { attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'answer' } },
        },
        {
          id: 'recorder_kind:ip',
          label: Q_RECORDER_FOR_CAMERAS.ip,
          count: ip,
          apply: { constraint: { attr: 'recorder_kind', op: 'in', values: ['nvr'], source: 'answer' } },
        },
      ],
    });
  }
  if (cu.ruleId === 'wire_sale_unit') {
    const count = (u: string) => pool.filter((c) => c.attrs.sale_unit === u).length;
    const units = (ATTR_SCHEMA.sale_unit.values ?? []).filter((u) => count(u) > 0);
    return baseQuestion(item, {
      key: 'sale_unit',
      priority: 1,
      source: 'compat',
      ruleId: cu.ruleId,
      text: questionText('sale_unit'),
      unknownCount: pool.filter((c) => !c.attrs.sale_unit).length,
      options: units.map((u) => ({
        id: `sale_unit:${u}`,
        label: facetOptionLabel('sale_unit', u),
        count: count(u),
        apply: { constraint: { attr: 'sale_unit', op: 'eq', value: u, source: 'answer' } },
      })),
    });
  }
  if (cu.ruleId === 'phone_accessory_fit') {
    const counts = new Map<string, { label: string; count: number }>();
    let unknown = 0;
    for (const c of pool) {
      const list = c.attrs.fits_models ?? [];
      if (list.length === 0) unknown++;
      const seen = new Set<string>();
      for (const m of list) {
        const k = normToken(m);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const e = counts.get(k) ?? { label: m, count: 0 };
        e.count++;
        counts.set(k, e);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
      .slice(0, maxOptions);
    const options: QuestionOption[] = top.map(([k, e]) => ({
      id: `fits_models:${k}`,
      label: facetOptionLabel('fits_models', [e.label]),
      count: e.count,
      apply: { constraint: { attr: 'fits_models', op: 'contains', value: e.label, source: 'answer' } },
    }));
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

function facetQuestion(
  item: Requirement,
  eligible: readonly Candidate[],
  minCoverage: number,
  maxOptions: number,
  allowed: (c: Constraint) => boolean = () => true,
): Question | null {
  const constrained = new Set(item.constraints.map((c) => c.attr));
  const skipped = new Set(item.skippedQuestions ?? []);
  let best: { attr: AttrKey; buckets: Bucket[]; known: number; h: number; cov: number; value: number } | null = null;
  const attrsList = eligible.map((c) => c.attrs);
  for (const attr of ATTR_KEYS) {
    const spec = ATTR_SCHEMA[attr];
    if (!spec.askable || spec.kind === 'string_list') continue;
    if (constrained.has(attr) || skipped.has(attr)) continue;
    const all = bucketize(attr, attrsList);
    // values that would contradict what the user fixed elsewhere are not offered (nor counted as a split)
    const buckets = all.buckets.filter((b) => allowed({ attr, op: 'eq', value: b.value, source: 'answer' }));
    const known = buckets.length === all.buckets.length ? all.known : buckets.reduce((n, b) => n + b.count, 0);
    if (buckets.length < 2) continue;
    const cov = known / eligible.length;
    if (cov < minCoverage) continue;
    const h = entropy(buckets.map((b) => b.count));
    const value = h * cov;
    if (!best || value > best.value + 1e-12) best = { attr, buckets, known, h, cov, value };
  }
  if (!best) return null;
  const attr = best.attr;
  const isNum = ATTR_SCHEMA[attr].kind === 'number';
  let chosen = [...best.buckets].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1)).slice(0, maxOptions);
  if (isNum) chosen = chosen.sort((a, b) => Number(a.value) - Number(b.value));
  const options: QuestionOption[] = chosen.map((b) => ({
    id: `${attr}:${b.key}`,
    label: facetOptionLabel(attr, b.value),
    count: b.count,
    apply: { constraint: { attr, op: 'eq', value: b.value, source: 'answer' } },
  }));
  return baseQuestion(item, {
    key: attr,
    priority: 2,
    source: 'facet',
    text: questionText(attr),
    options,
    unknownCount: eligible.length - best.known,
    score: { entropy: best.h, coverage: best.cov, value: best.value },
  });
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
  const ev = evals ?? evaluateCandidates(item, candidates);
  const byId = new Map(candidates.map((c) => [c.product.id, c]));
  const eligible = ev.filter((e) => e.fit === 'eligible').map((e) => byId.get(e.productId)!).filter(Boolean);
  const eligibleCount = eligible.length;

  if (item.pinnedProductId !== undefined || ev.some((e) => e.modelCodeMatch)) {
    return { question: null, stopReason: 'pinned', eligibleCount };
  }
  if (candidates.length === 0) return { question: null, stopReason: 'no_candidates', eligibleCount };
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
    const q = allowedOnly(compatQuestion(item, cu, pool, maxOptions));
    if (q && q.options.length > 0) return { question: q, eligibleCount };
  }
  if (item.preference?.acceptSuggestion) return { question: null, stopReason: 'accepted_default', eligibleCount };

  const skipped = new Set(item.skippedQuestions ?? []);
  const critical = mine.filter((c) => !MANDATORY_RULES.has(c.ruleId) && !skipped.has(c.attr));
  if (critical.length > 0) {
    for (const cu of critical) {
      const q = allowedOnly(compatQuestion(item, cu, pool, maxOptions, candidates));
      if (q) return { question: q, eligibleCount };
    }
  }

  if (eligibleCount <= maxListSize) return { question: null, stopReason: 'fits_one_screen', eligibleCount };

  const facet = facetQuestion(item, eligible, minCoverage, maxOptions, allowed);
  if (facet) return { question: facet, eligibleCount };

  const hasBudget = !!item.budget && (item.budget.min !== undefined || item.budget.max !== undefined);
  if (!hasBudget && !skipped.has('budget')) {
    const prices = ev.filter((e) => e.fit === 'eligible' && e.minPrice !== null).map((e) => e.minPrice!);
    const options = budgetOptions(prices);
    if (options.length >= 2) {
      return {
        question: baseQuestion(item, {
          key: 'budget',
          priority: 3,
          source: 'budget',
          text: questionText('budget'),
          options,
          unknownCount: eligibleCount - prices.length,
        }),
        eligibleCount,
      };
    }
  }
  return { question: null, stopReason: 'no_discriminating_question', eligibleCount };
}
