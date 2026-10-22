import type { AttrKey, AttrValue, CompatFinding, Constraint, CriticalUnknown, DerivedConstraint, ItemResolution, ProductAttrs, Requirement } from '../types/index';
import { compatCopy } from '../copy/fa';
import { changeableItems, COMPAT_RULES, type ChosenItem } from './rules';

export { changeableItems, COMPAT_RULES, MANDATORY_RULES } from './rules';
export type { ChosenItem, CompatRule } from './rules';

/**
 * Non-blocking item notes from compat relationships (item id -> Persian note). camera_adapter_current: several
 * cameras (total qty > 1) next to an adapter item whose quantity the user did not write; the note says what quantity
 * is assumed and what to check. Never a question, never a constraint.
 */
export function compatItemNotes(items: readonly Requirement[]): Map<string, string> {
  const out = new Map<string, string>();
  const cams = items.filter((i) => i.kind === 'camera').reduce((s, c) => s + c.qty, 0);
  if (cams < 2) return out;
  for (const a of items) if (a.kind === 'adapter' && !a.qtyStated) out.set(a.id, compatCopy.adapterQtyNote(cams, a.qty));
  return out;
}

/** Strip previously derived constraints (source 'compat'). */
export function stripDerived(items: readonly Requirement[]): Requirement[] {
  return items.map((i) => ({ ...i, constraints: i.constraints.filter((c) => c.source !== 'compat') }));
}

/** Constraints the rules derive for sibling items from stated requirements only. */
export function deriveConstraints(items: readonly Requirement[]): DerivedConstraint[] {
  const base = stripDerived(items);
  return COMPAT_RULES.flatMap((r) => (r.derive ? r.derive(base) : []));
}

/**
 * Returns new items with freshly derived constraints appended. Idempotent:
 * previously derived constraints are removed first, so applying twice equals applying once.
 * `extra` (the plan guard's repairs, see `compatRepairs`) is appended after the rule-derived constraints.
 */
export function applyDerivedConstraints(items: readonly Requirement[], extra: readonly DerivedConstraint[] = []): Requirement[] {
  const base = stripDerived(items);
  const derived = [...COMPAT_RULES.flatMap((r) => (r.derive ? r.derive(base) : [])), ...extra];
  return base.map((i) => {
    const add = derived.filter((d) => d.itemId === i.id).map((d) => d.constraint);
    return add.length ? { ...i, constraints: [...i.constraints, ...add] } : i;
  });
}

/** Compatibility-critical unknowns. Call on items that already carry derived constraints. */
export function criticalUnknowns(items: readonly Requirement[]): CriticalUnknown[] {
  return COMPAT_RULES.flatMap((r) => (r.critical ? r.critical(items) : []));
}

/** Evaluate the final chosen products. Items without a chosen product (attrs null) produce no finding. */
export function evaluateCompat(chosen: readonly ChosenItem[]): CompatFinding[] {
  return COMPAT_RULES.flatMap((r) => r.evaluate(chosen));
}

// ---------------------------------------------------------------------------
// Plan guard: a 'conflict' finding never stands next to an automatic pick
// ---------------------------------------------------------------------------

/**
 * An item's pick is automatic (the engine chose it by a visible rule) unless the user pinned the product or typed
 * its model code. Items without a pick are not automatic.
 */
export function isAutoPick(res: ItemResolution | undefined): boolean {
  return !!res && res.chosenProductId !== undefined && res.rule !== 'user_pinned' && res.rule !== 'model_code';
}

/** Items of a finding the guard may change (automatic picks whose linking attribute the user did not state). */
function changeable(f: CompatFinding, chosen: readonly ChosenItem[], isAuto: (itemId: string) => boolean): string[] {
  const rule = COMPAT_RULES.find((r) => r.id === f.ruleId);
  return rule ? changeableItems(rule, f, chosen, isAuto) : [];
}

/**
 * Conflict findings caused by an automatic pick (what the plan guard must remove): at least one item is picked
 * automatically and could be changed without going against what the user stated. A conflict between two things the
 * user stated or pinned (a pinned A57 case next to a phone stated as A56) is the user's call and stays visible.
 */
export function autoConflicts(findings: readonly CompatFinding[], chosen: readonly ChosenItem[], isAuto: (itemId: string) => boolean): CompatFinding[] {
  return findings.filter((f) => f.status === 'conflict' && changeable(f, chosen, isAuto).length > 0);
}

function constraintKey(d: DerivedConstraint): string {
  const c = d.constraint;
  const v = c.op === 'in' ? JSON.stringify([...c.values].map(String).sort()) : c.op === 'known' ? '' : JSON.stringify(c.value);
  return `${d.itemId}|${c.attr}|${c.op}|${v}`;
}

/** Same item, attribute, operator and value(s). */
export function sameDerived(a: DerivedConstraint, b: DerivedConstraint): boolean {
  return constraintKey(a) === constraintKey(b);
}

/**
 * Plan guard step 1 (replace): constraints that make each automatic-pick conflict impossible on the next pass,
 * from the rule's `repair`, applied only to changeable items. Deduplicated, and without those already in
 * `existing`. Empty = nothing left to repair.
 */
export function compatRepairs(
  findings: readonly CompatFinding[],
  chosen: readonly ChosenItem[],
  isAuto: (itemId: string) => boolean,
  existing: readonly DerivedConstraint[] = [],
): DerivedConstraint[] {
  const seen = new Set(existing.map(constraintKey));
  const out: DerivedConstraint[] = [];
  for (const f of autoConflicts(findings, chosen, isAuto)) {
    const rule = COMPAT_RULES.find((r) => r.id === f.ruleId);
    const can = new Set(changeable(f, chosen, isAuto));
    for (const d of rule?.repair?.(f, chosen, (id) => can.has(id)) ?? []) {
      const k = constraintKey(d);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}

/**
 * Plan guard step 2 (drop): the automatically picked item to take out of the plan for a conflict that repairs
 * could not remove: the rule's dependent side when it is changeable, else the first changeable item.
 */
export function conflictCulprit(f: CompatFinding, chosen: readonly ChosenItem[], isAuto: (itemId: string) => boolean): string | undefined {
  const rule = COMPAT_RULES.find((r) => r.id === f.ruleId);
  const can = changeable(f, chosen, isAuto);
  const dep = f.itemIds[rule?.dependentIndex ?? 0];
  if (dep !== undefined && can.includes(dep)) return dep;
  return can[0];
}

/** True when the constraint is one the plan guard added (matched against the guard's repairs). */
export function isGuardConstraint(itemId: string, c: Constraint, repairs: readonly DerivedConstraint[]): boolean {
  return repairs.some((r) => sameDerived(r, { itemId, constraint: c }));
}

// ---------------------------------------------------------------------------
// What the user fixed: questions never offer an answer that contradicts it (PLAN B1.2 / B1.4)
// ---------------------------------------------------------------------------

/**
 * The list as the user fixed it: requirements (with what they stated) and the attributes of the products they
 * pinned. Used to keep question options from contradicting a sibling the user already decided.
 */
export interface CompatScope {
  items: readonly Requirement[];
  /** item id -> attributes of the product the user pinned for it. */
  pinned: ReadonlyMap<string, ProductAttrs>;
}

/** Attributes that link an item kind to a compat rule (rule `linkAttr`): only these can make a pairing conflict. */
function linkAttrsOf(kind: Requirement['kind']): Set<AttrKey> {
  const out = new Set<AttrKey>();
  if (!kind) return out;
  for (const r of COMPAT_RULES) {
    const a = r.linkAttr?.[kind];
    if (a) out.add(a);
  }
  return out;
}

/** Rules that relate two item kinds (both kinds appear in the rule). */
function sharesRule(a: Requirement['kind'], b: Requirement['kind']): boolean {
  if (!a || !b) return false;
  return COMPAT_RULES.some((r) => r.kinds.includes(a) && r.kinds.includes(b));
}

const MAX_COMBOS = 16;

/** The values a constraint allows for an attribute (as product attribute values), or null when it is not a closed set. */
function allowedValues(c: Constraint): AttrValue[] | null {
  if (c.op === 'eq') return [c.value as AttrValue];
  if (c.op === 'in') return [...c.values] as AttrValue[];
  if (c.op === 'contains') return [[c.value]];
  return null;
}

/** Every attribute combination a set of per-attribute allowed values spans (capped). */
function combos(perAttr: ReadonlyMap<AttrKey, AttrValue[]>): ProductAttrs[] {
  let out: ProductAttrs[] = [{}];
  for (const [attr, values] of perAttr) {
    const next: ProductAttrs[] = [];
    for (const base of out) for (const v of values) if (next.length < MAX_COMBOS) next.push({ ...base, [attr]: v } as ProductAttrs);
    out = next;
  }
  return out;
}

/**
 * What the user fixed for an item, as product attribute sets: the pinned product's attributes, else every combination
 * of the values their stated constraints (typed or answered: eq / in / contains) allow on the item's compat-linking
 * attributes. null when nothing compat-relevant is fixed.
 */
export function fixedAttrSets(item: Requirement, pinned?: ProductAttrs): ProductAttrs[] | null {
  if (pinned) return [pinned];
  const link = linkAttrsOf(item.kind);
  const per = new Map<AttrKey, AttrValue[]>();
  for (const c of item.constraints) {
    if ((c.source !== 'user' && c.source !== 'answer') || !link.has(c.attr)) continue;
    const vals = allowedValues(c);
    if (vals && !per.has(c.attr)) per.set(c.attr, vals);
  }
  return per.size ? combos(per) : null;
}

function chosenWith(scope: CompatScope, set: ReadonlyMap<string, ProductAttrs>, answered?: { itemId: string; c: Constraint }): ChosenItem[] {
  // siblings nobody fixed take part with empty attributes (their quantities still count, e.g. cameras for channels);
  // the item being asked carries the answer as a stated constraint (a voltage the user chooses is never a conflict)
  return scope.items.map((item) => ({
    item: answered && item.id === answered.itemId ? { ...item, constraints: [...item.constraints, { ...answered.c, source: 'answer' } as Constraint] } : item,
    attrs: set.get(item.id) ?? {},
  }));
}

/**
 * A conflict the given answer would create against what the user fixed (stated / pinned) on the list, or null.
 * Conservative: the answer is offered only when EVERY value it allows is compatible with EVERY value each fixed
 * sibling allows (a recorder answered «آنالوگ» = XVR or DVR rules out IP cameras, since a DVR takes no IP camera).
 * Only the item's compat-linking attributes are judged; any other answer never conflicts.
 */
export function answerConflict(scope: CompatScope, itemId: string, c: Constraint): CompatFinding | null {
  const item = scope.items.find((i) => i.id === itemId);
  if (!item || !linkAttrsOf(item.kind).has(c.attr)) return null;
  const xs = allowedValues(c);
  if (!xs) return null;
  const siblings: (string | null)[] = [null];
  const fixed = new Map<string, ProductAttrs[]>();
  for (const s of scope.items) {
    if (s.id === itemId || !sharesRule(item.kind, s.kind)) continue;
    const sets = fixedAttrSets(s, scope.pinned.get(s.id));
    if (sets) {
      fixed.set(s.id, sets);
      siblings.push(s.id);
    }
  }
  for (const x of xs) {
    const xAttrs = { [c.attr]: x } as ProductAttrs;
    for (const sid of siblings) {
      for (const ys of sid ? fixed.get(sid)! : [null]) {
        const set = new Map<string, ProductAttrs>([[itemId, xAttrs]]);
        if (sid && ys) set.set(sid, ys);
        const hit = evaluateCompat(chosenWith(scope, set, { itemId, c })).find(
          (f) => f.status === 'conflict' && f.itemIds.includes(itemId) && (!sid || f.itemIds.includes(sid)),
        );
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * Conflicts between two things the user fixed themselves (stated or pinned on both sides), for every value they
 * allow: e.g. «دوربین تحت شبکه» typed next to «دی وی آر». Nothing the engine picks can remove them; the item cards
 * say so and no question is asked that would deepen them.
 */
export function statedConflicts(scope: CompatScope): CompatFinding[] {
  const fixed = scope.items
    .map((i) => ({ item: i, sets: fixedAttrSets(i, scope.pinned.get(i.id)) }))
    .filter((x): x is { item: Requirement; sets: ProductAttrs[] } => x.sets !== null);
  const out: CompatFinding[] = [];
  for (let a = 0; a < fixed.length; a++) {
    for (let b = a + 1; b < fixed.length; b++) {
      const A = fixed[a]!;
      const B = fixed[b]!;
      if (!sharesRule(A.item.kind, B.item.kind)) continue;
      let first: CompatFinding | null = null;
      let all = true;
      for (const xa of A.sets) {
        for (const xb of B.sets) {
          const f = evaluateCompat(chosenWith(scope, new Map([[A.item.id, xa], [B.item.id, xb]]))).find(
            (x) => x.status === 'conflict' && x.itemIds.includes(A.item.id) && x.itemIds.includes(B.item.id),
          );
          if (!f) all = false;
          else first ??= f;
        }
      }
      if (all && first) out.push(first);
    }
  }
  return out;
}
