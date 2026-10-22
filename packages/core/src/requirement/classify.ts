/**
 * Item-state classifier (B1.1).
 *
 * - exact_model ONLY for a model-code match or a user-pinned product.
 * - suggested: every stated constraint passes (and inside the budget); picked by the visible rule
 *   «cheapest eligible» (within budget when one is set). Never labelled exact.
 * - alternative: differs on a stated constraint / budget / model code, or specs incomplete. Products with an
 *   unknown on a needed attribute are never auto-picked; a differing product is auto-picked only when the
 *   user relaxed (preference.allowAlternatives) and it has no unknowns.
 * - needs_info: a compat-critical unknown is open, or the requirement is loose (no stated spec, budget or code)
 *   while a discriminating question exists and the eligible list does not fit one screen.
 * - not_found: no candidates (or the pinned product is gone).
 * - price_unknown: found, but no usable price.
 */
import { INCOMPLETE_SPECS_LABEL, ITEM_STATE_LABEL, itemDetail } from '../copy/fa';
import type {
  CandidateEval,
  ItemResolution,
  ItemState,
  NeedsInfoReason,
  PickRule,
  QuestionOutcome,
  Requirement,
} from '../types/index';
import { compareEvals } from './evaluate';

export { INCOMPLETE_SPECS_LABEL };

function hasStatedSpec(item: Requirement): boolean {
  return (
    item.constraints.some((c) => c.source === 'user' || c.source === 'answer') ||
    !!item.modelCode ||
    (!!item.budget && (item.budget.min !== undefined || item.budget.max !== undefined))
  );
}

/** A wire item whose sale unit (roll / metre) the user has not fixed: its candidates' prices are in mixed units. */
export function saleUnitOpen(item: Requirement): boolean {
  if (item.kind !== 'wire') return false;
  return !item.constraints.some(
    (c) => c.attr === 'sale_unit' && c.source !== 'compat' && (c.op === 'eq' || (c.op === 'in' && c.values.length === 1)),
  );
}

function hasBudget(item: Requirement): boolean {
  return !!item.budget && (item.budget.min !== undefined || item.budget.max !== undefined);
}

/** Cheapest priced, then more priced offers (plan feasibility), then product id. */
function pickCheapest(evals: readonly CandidateEval[]): CandidateEval | undefined {
  return [...evals]
    .filter((e) => e.minPrice !== null)
    .sort(
      (a, b) => a.minPrice! - b.minPrice! || b.pricedOfferCount - a.pricedOfferCount || a.productId - b.productId,
    )[0];
}

function pickClosestAlternative(evals: readonly CandidateEval[]): CandidateEval | undefined {
  return [...evals]
    // a listing whose condition does not fit (used / replica…) is never picked automatically, not even as «جایگزین»
    // nor a listing that names another kind of goods or whose sale unit is unclear
    .filter((e) => e.fit === 'differs' && e.unknown.length === 0 && e.minPrice !== null && !e.conditionIssue && !e.issues?.length)
    .sort(
      (a, b) =>
        a.failed.length + Number(a.withinBudget === false) - (b.failed.length + Number(b.withinBudget === false)) ||
        a.minPrice! - b.minPrice! ||
        a.productId - b.productId,
    )[0];
}

export function classifyItem(
  item: Requirement,
  evalsIn: readonly CandidateEval[],
  question: QuestionOutcome | null,
): ItemResolution {
  const evals = [...evalsIn].sort(compareEvals);
  const eligible = evals.filter((e) => e.fit === 'eligible');
  const incomplete = evals.filter((e) => e.fit === 'incomplete');
  const differs = evals.filter((e) => e.fit === 'differs');
  const eligiblePriced = eligible.filter((e) => e.minPrice !== null);
  const counts = {
    candidates: evals.length,
    eligible: eligible.length,
    eligiblePriced: eligiblePriced.length,
    incomplete: incomplete.length,
    differs: differs.length,
  };
  const priceRange = eligiblePriced.length
    ? { min: Math.min(...eligiblePriced.map((e) => e.minPrice!)), max: Math.max(...eligiblePriced.map((e) => e.minPrice!)) }
    : undefined;
  const suggestRule: PickRule = hasBudget(item) ? 'cheapest_eligible_within_budget' : 'cheapest_eligible';

  let state: ItemState;
  let chosen: CandidateEval | undefined;
  let rule: PickRule | undefined;
  let needsInfoReason: NeedsInfoReason | undefined;
  let notFoundReason: ItemResolution['notFoundReason'];
  let fallback: { productId: number; rule: PickRule } | undefined;

  // a model-code match whose listing condition does not fit is not «مدل مشخص»; it stays listed as «جایگزین»
  const modelMatches = item.modelCode ? evals.filter((e) => e.modelCodeMatch && !e.conditionIssue) : [];

  if (item.pinnedProductId !== undefined) {
    chosen = evals.find((e) => e.productId === item.pinnedProductId);
    if (!chosen) {
      state = 'not_found';
      notFoundReason = 'pinned_missing';
    } else {
      state = chosen.minPrice !== null ? 'exact_model' : 'price_unknown';
      rule = 'user_pinned';
    }
  } else if (modelMatches.length > 0) {
    const priced = pickCheapest(modelMatches);
    chosen = priced ?? [...modelMatches].sort((a, b) => a.productId - b.productId)[0];
    state = priced ? 'exact_model' : 'price_unknown';
    rule = 'model_code';
  } else if (evals.length === 0) {
    state = 'not_found';
    notFoundReason = 'no_candidates';
  } else {
    const q = question?.question ?? null;
    const cheapest = pickCheapest(eligible);
    if (q && q.priority === 1) {
      state = 'needs_info';
      needsInfoReason = 'compat_critical';
    } else if (q && eligible.length > 0 && !hasStatedSpec(item)) {
      state = 'needs_info';
      needsInfoReason = 'loose_requirement';
    } else if (cheapest) {
      state = 'suggested';
      chosen = cheapest;
      rule = suggestRule;
    } else if (eligible.length > 0) {
      state = 'price_unknown';
      chosen = eligible[0];
      rule = 'no_price';
    } else {
      state = 'alternative';
      if (item.preference?.allowAlternatives) {
        chosen = pickClosestAlternative(evals);
        if (chosen) rule = 'closest_alternative';
      }
    }
    if (state === 'needs_info' && cheapest) fallback = { productId: cheapest.productId, rule: suggestRule };
  }

  const res: ItemResolution = {
    itemId: item.id,
    state,
    counts,
    eligibleIds: eligible.map((e) => e.productId),
    incompleteIds: incomplete.map((e) => e.productId),
    differsIds: differs.map((e) => e.productId),
    evaluations: evals,
    label: ITEM_STATE_LABEL[state],
    detail: '',
  };
  if (chosen) res.chosenProductId = chosen.productId;
  if (rule) res.rule = rule;
  if (fallback) res.fallbackPick = fallback;
  if (needsInfoReason) res.needsInfoReason = needsInfoReason;
  if (notFoundReason) res.notFoundReason = notFoundReason;
  if (priceRange) res.priceRange = priceRange;
  const conditionExcluded = evals.filter(
    (e) => (e.conditionIssue === 'used' || e.conditionIssue === 'refurbished' || e.conditionIssue === 'replica') && !e.issues?.length && e.failed.length === 0 && e.unknown.length === 0 && e.withinBudget !== false && (!item.modelCode || e.modelCodeMatch),
  ).length;
  if (conditionExcluded > 0) res.conditionExcludedCount = conditionExcluded;

  const detailParams: Parameters<typeof itemDetail>[0] = {
    state,
    eligibleCount: eligible.length,
    candidateCount: evals.length,
    hasChoice: !!chosen,
    differences: chosen?.differences ?? [],
  };
  if (rule) detailParams.rule = rule;
  if (item.modelCode) detailParams.modelCode = item.modelCode;
  // unit guard: before a wire's sale unit is chosen, roll and per-metre prices are mixed, so no range is stated
  if (priceRange && !saleUnitOpen(item)) detailParams.priceRange = priceRange;
  if (needsInfoReason) detailParams.needsInfoReason = needsInfoReason;
  if (notFoundReason) detailParams.notFoundReason = notFoundReason;
  res.detail = itemDetail(detailParams);
  return res;
}
