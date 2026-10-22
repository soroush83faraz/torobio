import { answerConflict, applyDerivedConstraints, criticalUnknowns, statedConflicts, type CompatScope } from '../compat/index';
import { nextQuestion, type QuestionParams } from '../questions/next';
import type { Candidate, CompatFinding, CriticalUnknown, DerivedConstraint, ItemResolution, ProductAttrs, QuestionOutcome, Requirement } from '../types/index';
import { classifyItem } from './classify';
import { evaluateCandidates } from './evaluate';

export interface ItemResult {
  resolution: ItemResolution;
  question: QuestionOutcome;
}

/** Resolve one item: evaluate every candidate, find the next question, classify. */
export function resolveItem(
  item: Requirement,
  candidates: readonly Candidate[],
  params: QuestionParams = {},
): ItemResult {
  const evals = evaluateCandidates(item, candidates);
  const question = nextQuestion(item, candidates, params, evals);
  return { resolution: classifyItem(item, evals, question), question };
}

export interface ListResult {
  /** Items with compat-derived constraints applied (what was actually evaluated). */
  items: Requirement[];
  critical: CriticalUnknown[];
  results: ItemResult[];
  /**
   * Conflicts between two things the user fixed themselves (stated or pinned on both sides, for every value they
   * allow). No pick can remove them and no question deepens them; the item cards say so.
   */
  statedConflicts: CompatFinding[];
}

/** The list as the user fixed it (stated constraints + attributes of pinned products), for compat checks of answers. */
export function compatScope(items: readonly Requirement[], candidatesByItem: Readonly<Record<string, readonly Candidate[]>>): CompatScope {
  const pinned = new Map<string, ProductAttrs>();
  for (const it of items) {
    if (it.pinnedProductId === undefined) continue;
    const c = (candidatesByItem[it.id] ?? []).find((x) => x.product.id === it.pinnedProductId);
    if (c) pinned.set(it.id, c.attrs);
  }
  return { items, pinned };
}

/**
 * Resolve a whole list: derive sibling constraints from stated requirements, find compat-critical unknowns,
 * then resolve each item. `candidatesByItem` is keyed by requirement id; a missing key = no candidates.
 * `extra`: constraints added by the plan's compatibility guard (compat `compatRepairs`), applied after derivation.
 * Questions never offer an answer that contradicts what the user fixed on another item (compat `answerConflict`).
 */
export function resolveItems(
  items: readonly Requirement[],
  candidatesByItem: Readonly<Record<string, readonly Candidate[]>>,
  params: Omit<QuestionParams, 'criticalUnknowns'> = {},
  extra: readonly DerivedConstraint[] = [],
): ListResult {
  const derived = applyDerivedConstraints(items, extra);
  const critical = criticalUnknowns(derived);
  const scope = compatScope(derived, candidatesByItem);
  const answerAllowed = params.answerAllowed ?? ((item: Requirement, c) => answerConflict(scope, item.id, c) === null);
  const results = derived.map((it) =>
    resolveItem(it, candidatesByItem[it.id] ?? [], { ...params, criticalUnknowns: critical, answerAllowed }),
  );
  return { items: derived, critical, results, statedConflicts: statedConflicts(scope) };
}
