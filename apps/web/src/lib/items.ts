/**
 * Display helpers for stored requirements. Parser items are kept verbatim; chips are a VIEW over
 * `inherited` + `constraints` (never stored back as chips).
 */
import type { ItemResolution, MissingKind, PlanResponse, Requirement } from '../api/types';
import { t } from '../copy/fa';

export interface ItemChip {
  key: string;
  label: string;
}

/** «galaxy a56 5g» -> «Galaxy A56 5G» (model keys are stored lower-case). */
function titleCaseModel(v: string): string {
  return v
    .split(/\s+/)
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function fallbackLabel(req: Requirement, attr: string): string {
  const c = req.constraints?.find((x) => x.attr === attr);
  const v = c && 'value' in c ? String(c.value) : c && 'values' in c ? c.values.join('، ') : '';
  if (attr === 'fits_models' || attr === 'phone_model') return `مناسب ${titleCaseModel(v)}`.trim();
  return v ? titleCaseModel(v) : attr;
}

/**
 * Chips shown on an item card: constraints taken over from another item (the user may detach them).
 * The label comes from the server's derived chip when it sent one, else from the stored constraint.
 */
export function inheritedChips(req: Requirement, res?: ItemResolution): ItemChip[] {
  if (req.inherited?.length) {
    return req.inherited.map((i) => ({
      key: i.attr,
      label: res?.derivedChips?.find((d) => d.key === `derived:${i.attr}`)?.label ?? fallbackLabel(req, i.attr),
    }));
  }
  return (req.chips ?? []).filter((c) => c.inherited).map((c) => ({ key: c.key, label: c.label }));
}

/** The requirement without the inherited constraint / legacy chip `key` (detach). */
export function detachInherited(req: Requirement, key: string): Requirement {
  const next: Requirement = { ...req };
  if (req.inherited?.some((i) => i.attr === key)) {
    next.inherited = req.inherited.filter((i) => i.attr !== key);
    if (next.constraints) next.constraints = next.constraints.filter((c) => c.attr !== key);
  }
  if (req.chips) next.chips = req.chips.filter((c) => c.key !== key);
  return next;
}

/**
 * /api/parse numbers its items i1, i2... on every call. Items added to an existing plan get fresh ids
 * (and every reference to them is rewritten), so they never collide with what is already there.
 */
export function reidItems(items: Requirement[], taken: ReadonlySet<string>): Requirement[] {
  const used = new Set(taken);
  let n = 0;
  for (const id of taken) {
    const m = /^i(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  const map = new Map<string, string>();
  for (const it of items) {
    let next: string;
    do next = `i${++n}`;
    while (used.has(next));
    used.add(next);
    map.set(it.id, next);
  }
  return items.map((it) => ({
    ...it,
    id: map.get(it.id)!,
    ...(it.inherited ? { inherited: it.inherited.map((x) => ({ ...x, fromItemId: map.get(x.fromItemId) ?? x.fromItemId })) } : {}),
    ...(it.notes ? { notes: it.notes.map((x) => (x.itemId ? { ...x, itemId: map.get(x.itemId) ?? x.itemId } : x)) } : {}),
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Dead ends and relaxing a stated requirement
 * ---------------------------------------------------------------------------------------------- */

/** The «condition» answer that accepts used / refurbished / copy listings too (core: encodeConditionOptionId('any')). */
export const CONDITION_ANY = 'c~eq~condition~"any"';

/**
 * Nothing matched what the user stated: the server's `noMatch`, or (older server / mock) the state «جایگزین» with no
 * product to show. Such an item must never render as a bare badge.
 */
export function isDeadEnd(res: Pick<ItemResolution, 'state' | 'product' | 'noMatch'>): boolean {
  return !!res.noMatch || (res.state === 'alternative' && !res.product);
}

/**
 * The requirement without the stated constraint `attr` (the client side of «relax»). `budget` removes the price band;
 * any other attribute removes the parser constraint / legacy chip / inherited marker of that key. `condition` is NOT
 * handled here: it is an answer (CONDITION_ANY), set by the store.
 */
export function relaxRequirement(req: Requirement, attr: string): Requirement {
  const next: Requirement = { ...req };
  if (attr === 'budget') {
    delete next.budget;
    return next;
  }
  if (next.constraints) next.constraints = next.constraints.filter((c) => c.attr !== attr);
  if (next.inherited) next.inherited = next.inherited.filter((i) => i.attr !== attr);
  if (next.chips) next.chips = next.chips.filter((c) => c.key !== attr && c.constraint?.attr !== attr);
  return next;
}

export type MissingGroup = { kind: MissingKind; names: string[] };

const MISSING_ORDER: MissingKind[] = ['not_found', 'needs_info', 'no_price'];

/**
 * The items missing from a plan's total, grouped by WHY: «پیدا نشد» (nothing matched), «منتظر انتخاب» (a question or a
 * pick is open) and «بدون قیمت» (found, no usable price). Uses `coverage.missing[].kind` when the server sends it,
 * otherwise the per-item state in `plan.items`; an entry with neither falls under «منتظر انتخاب».
 */
export function missingGroups(plan: Pick<PlanResponse, 'coverage' | 'items'>): MissingGroup[] {
  const state = new Map((plan.items ?? []).map((i) => [i.itemId, i]));
  const by = new Map<MissingKind, string[]>();
  for (const m of plan.coverage.missing) {
    const res = state.get(m.itemId);
    let kind: MissingKind = m.kind ?? 'needs_info';
    if (!m.kind && res) {
      if (res.state === 'not_found' || isDeadEnd(res)) kind = 'not_found';
      else if (res.state === 'no_price') kind = 'no_price';
      else kind = 'needs_info';
    }
    by.set(kind, [...(by.get(kind) ?? []), m.name]);
  }
  return MISSING_ORDER.filter((k) => by.has(k)).map((k) => ({ kind: k, names: by.get(k)! }));
}

/**
 * The amber marker a plan carries next to its total: the server's own `totalMarker`, else (older server / mock) the one
 * its flags imply. A plan with a marker is never shown with the green «all ready» look.
 */
export function planMarker(plan: Pick<PlanResponse, 'hasConflict' | 'compatUnverified' | 'totalMarker'> | null | undefined): string | undefined {
  if (!plan) return undefined;
  if (plan.totalMarker) return plan.totalMarker;
  if (plan.hasConflict) return t.total.conflict;
  if (plan.compatUnverified) return t.total.unverified;
  return undefined;
}
