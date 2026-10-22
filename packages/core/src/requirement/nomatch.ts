/**
 * «No eligible product» summary (wire: ItemResolution.noMatch). When an item has candidates but none meets every
 * stated requirement, say WHY in one data-grounded Persian sentence, which stated conditions the user could lift
 * (ranked by how many products each one alone would let through), and which products come closest.
 * Never picks anything: the item stays without a product until the user relaxes or picks one.
 */
import { ATTR_LABEL, CONDITION_MODE_LABEL, constraintText, noMatchCopy } from '../copy/fa';
import type { AttrKey, CandidateEval, Constraint, ItemResolution, Requirement } from '../types/index';

/** What keeps one candidate out of the eligible set. */
export type NoMatchCause =
  | 'budget'
  | 'condition'
  | 'model'
  | 'kind'
  | 'unit'
  | `attr:${AttrKey}`
  | `compat:${AttrKey}`
  | `unknown:${AttrKey}`;

export interface NoMatchSummary {
  reasonFa: string;
  /** `attr`: an AttrKey the user stated, 'budget' or 'condition' (the relax_constraint vocabulary). */
  relax: { attr: string; label: string }[];
  /** Nearest non-eligible products, nearest first. */
  closestIds: number[];
}

const isStated = (c: Constraint) => c.source === 'user' || c.source === 'answer';

export function noMatchCauses(item: Requirement, e: CandidateEval): Set<NoMatchCause> {
  const out = new Set<NoMatchCause>();
  if (e.withinBudget === false) out.add('budget');
  if (e.conditionIssue) out.add('condition');
  if (item.modelCode && !e.modelCodeMatch) out.add('model');
  if (e.issues?.includes('other_kind')) out.add('kind');
  if (e.issues?.includes('unit_unclear')) out.add('unit');
  for (const f of e.failed) out.add(isStated(f.constraint) ? `attr:${f.constraint.attr}` : `compat:${f.constraint.attr}`);
  for (const u of e.unknown) out.add(`unknown:${u.constraint.attr}`);
  return out;
}

/** Tie-break order between causes that let the same number of products through. */
function causeRank(c: NoMatchCause): number {
  if (c === 'budget') return 0;
  if (c === 'condition') return 1;
  if (c.startsWith('attr:')) return 2;
  if (c.startsWith('unknown:')) return 3;
  if (c.startsWith('compat:')) return 4;
  if (c === 'model') return 5;
  if (c === 'unit') return 6;
  return 7;
}

function constraintOn(item: Requirement, attr: string, stated: boolean): Constraint | undefined {
  return item.constraints.find((c) => c.attr === attr && isStated(c) === stated);
}

/**
 * Summary for an item without any eligible product, or null when it does not apply (something is eligible, the
 * user pinned / typed the product, or there are no candidates at all).
 */
export function noMatchSummary(
  item: Requirement,
  res: ItemResolution,
  maxClosest = 3,
  /** Display label of a stated constraint (default: core constraintText); the server passes Persian brand / model names. */
  labelOf: (c: Constraint) => string = constraintText,
): NoMatchSummary | null {
  if (res.counts.eligible > 0) return null;
  if (res.state !== 'alternative' && res.state !== 'needs_info') return null;
  if (res.rule === 'user_pinned' || res.rule === 'model_code') return null;
  const evals = res.evaluations.filter((e) => e.fit !== 'eligible');
  if (evals.length === 0) return null;

  const causes = new Map(evals.map((e) => [e.productId, noMatchCauses(item, e)]));
  const unlock = new Map<NoMatchCause, number>();
  const freq = new Map<NoMatchCause, number>();
  for (const e of evals) {
    const cs = causes.get(e.productId)!;
    for (const c of cs) freq.set(c, (freq.get(c) ?? 0) + 1);
    if (cs.size === 1) {
      const only = [...cs][0]!;
      unlock.set(only, (unlock.get(only) ?? 0) + 1);
    }
  }
  // causes that alone hold products back come first; among those the budget, then the listing condition, then a
  // stated spec («A56 under 50 M» is about the budget, not about dropping the model), then by products let through
  const byStrength = (a: NoMatchCause, b: NoMatchCause) =>
    Number((unlock.get(b) ?? 0) > 0) - Number((unlock.get(a) ?? 0) > 0) ||
    causeRank(a) - causeRank(b) ||
    (unlock.get(b) ?? 0) - (unlock.get(a) ?? 0) ||
    (freq.get(b) ?? 0) - (freq.get(a) ?? 0) ||
    (a < b ? -1 : 1);
  const ranked = [...freq.keys()].sort(byStrength);
  // another kind of goods is the reason only when nothing else holds products back
  const primary = ranked.find((c) => c !== 'kind') ?? ranked[0];

  const n = (c: NoMatchCause) => unlock.get(c) ?? 0;
  let reasonFa = noMatchCopy.generic(evals.length);
  if (primary === 'budget') {
    const only = evals.filter((e) => causes.get(e.productId)!.size === 1 && causes.get(e.productId)!.has('budget') && e.minPrice !== null);
    const pool = only.length ? only : evals.filter((e) => e.withinBudget === false && !e.issues?.includes('other_kind') && e.minPrice !== null);
    const cheapest = pool.length ? Math.min(...pool.map((e) => e.minPrice!)) : null;
    reasonFa = noMatchCopy.budget(item.budget?.min, item.budget?.max, cheapest);
  } else if (primary === 'condition') {
    const mode = item.condition ?? 'new';
    const k = n('condition') || (freq.get('condition') ?? 0);
    reasonFa = mode === 'used' ? noMatchCopy.conditionUsed(k) : mode === 'replica' ? noMatchCopy.conditionReplica(k) : noMatchCopy.conditionNew(k);
  } else if (primary && (primary.startsWith('attr:') || primary.startsWith('compat:'))) {
    const attr = primary.slice(primary.indexOf(':') + 1);
    const c = constraintOn(item, attr, primary.startsWith('attr:'));
    const label = c ? labelOf(c) : ATTR_LABEL[attr as AttrKey];
    reasonFa = n(primary) > 0 ? noMatchCopy.attr(label, n(primary)) : noMatchCopy.attrNone(label);
  } else if (primary && primary.startsWith('unknown:')) {
    const attr = primary.slice('unknown:'.length) as AttrKey;
    reasonFa = noMatchCopy.unknown(ATTR_LABEL[attr], n(primary) || (freq.get(primary) ?? 0));
  } else if (primary === 'model' && item.modelCode) {
    reasonFa = noMatchCopy.model(item.modelCode);
  } else if (primary === 'unit') {
    reasonFa = noMatchCopy.unit();
  } else if (primary === 'kind') {
    reasonFa = noMatchCopy.kind();
  }

  // what the user can lift: only what they stated (budget, a non-default condition, a stated attribute)
  const relaxable = ranked.filter((c) => {
    if (c === 'budget') return !!item.budget && (item.budget.min !== undefined || item.budget.max !== undefined);
    if (c === 'condition') return !!item.condition && item.condition !== 'new';
    return c.startsWith('attr:');
  });
  const helpful = relaxable.filter((c) => n(c) > 0);
  const relax = (helpful.length ? helpful : relaxable.slice(0, 2)).slice(0, 3).map((c) => {
    if (c === 'budget') return { attr: 'budget', label: noMatchCopy.relaxBudget };
    if (c === 'condition') return { attr: 'condition', label: noMatchCopy.relaxStated(CONDITION_MODE_LABEL[item.condition ?? 'new']) };
    const attr = c.slice('attr:'.length);
    const con = constraintOn(item, attr, true);
    return { attr, label: noMatchCopy.relaxStated(con ? labelOf(con) : ATTR_LABEL[attr as AttrKey]) };
  });

  // nearest: held back only by the primary cause first (the A56s over the budget, not other phones under it), then
  // fewest / lightest reasons (another kind of goods is far away), fewest unknowns, priced, cheaper
  const onlyPrimary = (e: CandidateEval) => {
    const cs = causes.get(e.productId)!;
    return cs.size === 1 && primary !== undefined && cs.has(primary) ? 0 : 1;
  };
  const distance = (e: CandidateEval) => {
    let d = 0;
    for (const c of causes.get(e.productId)!) d += c === 'kind' ? 100 : causeRank(c) <= 1 || c.startsWith('unknown:') ? 1 : 2;
    return d;
  };
  const closestIds = [...evals]
    .sort(
      (a, b) =>
        onlyPrimary(a) - onlyPrimary(b) ||
        distance(a) - distance(b) ||
        a.unknown.length - b.unknown.length ||
        Number(a.minPrice === null) - Number(b.minPrice === null) ||
        (a.minPrice ?? 0) - (b.minPrice ?? 0) ||
        a.productId - b.productId,
    )
    .slice(0, maxClosest)
    .map((e) => e.productId);

  return { reasonFa, relax, closestIds };
}
