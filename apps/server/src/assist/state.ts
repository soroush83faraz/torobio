/**
 * Pure helpers over the wire RequirementState used by the assistant (no I/O).
 *
 * Two item shapes are accepted everywhere (as the plan route does): a /api/parse item verbatim (`constraints`,
 * authoritative, no chips) and the UI's chip form (`chips`). Reads and edits follow the shape the item has, so an
 * edited parser item stays a parser item.
 *
 * Text rewriting matters because a changed brand / spec must not keep showing the old words on the item card (and,
 * for chip-form items, the engine narrows candidates by the words of the text that no chip covers). Replacing a
 * brand rewrites the brand mention in `text` and `rawText`; relaxing a constraint removes the constraint's own
 * words when they appear there as one run.
 */
import { Api, brandByKey, budgetBandLabel, CONDITION_MODE_LABEL, constraintText, findBrandsInTokens, tokenizeForSearch } from '@app/core';
import type { RelaxableAttr } from './types.js';

type State = Api.RequirementState;
type Req = Api.Requirement;
type Stated = Api.StatedConstraintDto;

export interface StatedAttr {
  attr: RelaxableAttr;
  /** Persian display label (the engine's constraint text, or the chip label of a chip-form item). */
  label: string;
  /** 'chip': stated on the item itself (parser constraint / chip); 'answer': a decoded question answer; 'budget'. */
  origin: 'chip' | 'answer' | 'budget';
  /** The stated number of an exact numeric constraint («۲ ترابایت» -> 2); absent for ranges / non-numbers. */
  value?: number;
}

/** Persian display name of a brand key ('dahua' -> «داهوا», 'fa:نوید' -> «نوید»). */
export function brandLabel(key: string): string {
  return brandByKey(key)?.display ?? (key.startsWith('fa:') ? key.slice(3) : key);
}

/**
 * A /api/parse item carries `constraints` (authoritative, no chips); the UI's chip form carries `chips`. The engine
 * adapter makes the same distinction (adapter/engine.ts isParserItem), so both are read exactly as the plan does.
 */
export const isParserItem = (r: Req): boolean => r.constraints !== undefined;

interface StatedEntry {
  constraint: Stated;
  /** Chip label (chip-form items only). */
  label?: string;
}

/** The constraints the user stated on the item itself (parser: `constraints` minus compat copies; chips: non-inherited). */
function statedOf(req: Req): StatedEntry[] {
  if (isParserItem(req)) return (req.constraints ?? []).filter((c) => c.source !== 'compat').map((constraint) => ({ constraint }));
  return req.chips.filter((c) => !c.inherited && c.constraint).map((c) => ({ constraint: c.constraint as Stated, label: c.label }));
}

/**
 * Attributes the server re-derives itself, so they are not the user's statement and cannot be relaxed: the phone
 * model a case / protector inherited from the request's phone item (compat rule `phone_accessory_fit`).
 */
function derivedAttrs(req: Req, state: State): Set<string> {
  const out = new Set<string>();
  for (const h of req.inherited ?? []) {
    if (h.attr !== 'fits_models') continue;
    const from = state.requirements.find((r) => r.id === h.fromItemId);
    if (from && (from.kind === undefined || from.kind === 'phone') && statedOf(from).some((e) => e.constraint.attr === 'phone_model')) out.add(h.attr);
  }
  return out;
}

function conditionLabel(mode: string): string {
  return (CONDITION_MODE_LABEL as Record<string, string>)[mode] ?? mode;
}

/** What the user stated for an item: its constraints (incl. the listing condition), decoded answers, and its budget. */
export function statedAttrs(req: Req, state: State): StatedAttr[] {
  const out: StatedAttr[] = [];
  const push = (attr: RelaxableAttr, label: string, origin: StatedAttr['origin'], value?: number) => {
    if (!out.some((s) => s.attr === attr)) out.push({ attr, label, origin, ...(value !== undefined ? { value } : {}) });
  };
  const numeric = (c: { op: string; value?: unknown }): number | undefined => (c.op === 'eq' && typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : undefined);
  const derived = isParserItem(req) ? derivedAttrs(req, state) : new Set<string>();
  for (const { constraint, label } of statedOf(req)) {
    if (Api.isConditionConstraint(constraint)) {
      if (constraint.value !== 'new') push(Api.CONDITION_ATTR, conditionLabel(constraint.value), 'chip');
      continue;
    }
    if (derived.has(constraint.attr)) continue;
    const c = Api.toEngineConstraint(constraint, 'user');
    if (!c) continue;
    const brand = c.attr === 'brand' && c.op === 'eq' && typeof c.value === 'string' ? brandLabel(c.value) : undefined;
    push(c.attr, brand ?? (label || constraintText(c)), 'chip', numeric(c));
  }
  if (req.condition && req.condition !== 'new') push(Api.CONDITION_ATTR, conditionLabel(req.condition), 'chip');
  for (const optionId of Object.values(state.answers[req.id] ?? {})) {
    const d = Api.decodeOptionId(optionId);
    if (!d || d.kind === 'skip') continue;
    if (d.kind === 'condition') {
      if (d.condition !== 'new') push(Api.CONDITION_ATTR, conditionLabel(d.condition), 'answer');
    } else if (d.kind === 'budget') push('budget', budgetBandLabel(d.budget.min, d.budget.max), 'answer');
    else if (d.constraint.attr === 'brand' && d.constraint.op === 'eq' && typeof d.constraint.value === 'string') push('brand', brandLabel(d.constraint.value), 'answer');
    else push(d.constraint.attr, constraintText(d.constraint), 'answer', numeric(d.constraint));
  }
  const b = req.budget;
  if (b && (b.min !== undefined || b.max !== undefined)) push('budget', budgetBandLabel(b.min, b.max), 'budget');
  return out;
}

const brandKeyOf = (c: Stated): string | undefined =>
  !Api.isConditionConstraint(c) && c.attr === 'brand' && c.op === 'eq' && typeof c.value === 'string' ? c.value : undefined;

/** The brand key the user stated for an item (parser constraint / chip, or answer), if any. */
export function currentBrand(req: Req, state: State): string | undefined {
  for (const { constraint } of statedOf(req)) {
    const k = brandKeyOf(constraint);
    if (k) return k;
  }
  for (const optionId of Object.values(state.answers[req.id] ?? {})) {
    const d = Api.decodeOptionId(optionId);
    if (d?.kind === 'constraint' && d.constraint.attr === 'brand' && d.constraint.op === 'eq' && typeof d.constraint.value === 'string') return d.constraint.value;
  }
  return undefined;
}

/** Words of a parser item's `unparsed_fragment` notes: the only words that narrow its candidate pool (as the plan does). */
export function parserNarrowTerms(req: Req): string[] {
  const out: string[] = [];
  for (const n of req.notes ?? []) {
    if (n.code !== 'unparsed_fragment' || !n.fragment) continue;
    for (const t of tokenizeForSearch(n.fragment, { dropStopwords: true })) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Remove the item's own stated constraints on `attr` (parser constraints or chips) and its inherited record for it. */
export function removeStatedAttr(req: Req, attr: string): Stated[] {
  const removed: Stated[] = [];
  const hit = (c: Stated | undefined): c is Stated => !!c && c.attr === attr && c.source !== 'compat';
  if (isParserItem(req)) {
    req.constraints = (req.constraints ?? []).filter((c) => {
      if (!hit(c)) return true;
      removed.push(c);
      return false;
    });
  } else {
    req.chips = req.chips.filter((ch) => {
      if (ch.inherited || !hit(ch.constraint)) return true;
      removed.push(ch.constraint);
      return false;
    });
  }
  if (req.inherited) {
    const rest = req.inherited.filter((h) => h.attr !== attr);
    if (rest.length) req.inherited = rest;
    else delete req.inherited;
  }
  return removed;
}

/** Add a stated constraint to an item in the shape it uses (parser `constraints`, or a chip). */
export function addStated(req: Req, constraint: Stated, label: string): void {
  if (isParserItem(req)) req.constraints = [...(req.constraints ?? []), constraint];
  else {
    const { source: _source, ...bare } = constraint; // chips never carried a provenance
    req.chips = [{ key: constraint.attr, label, constraint: bare as Stated }, ...req.chips].slice(0, Api.API_LIMITS.maxChips);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// text rewriting (word-aligned: only whole whitespace-separated words are removed)
// ---------------------------------------------------------------------------------------------------------------

interface Word {
  raw: string;
  toks: string[];
}

function words(text: string): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, toks: tokenizeForSearch(raw) }));
}

type Range = readonly [number, number];

/** Remove every word whose tokens all lie inside one of `ranges`; `insert` replaces the first removed word. */
function rewrite(ws: Word[], ranges: readonly Range[], insert?: string): { text: string; removed: boolean } {
  let ti = 0;
  const keep: string[] = [];
  let removed = false;
  let inserted = false;
  for (const w of ws) {
    const start = ti;
    const end = ti + w.toks.length;
    ti = end;
    if (w.toks.length > 0 && ranges.some(([a, b]) => start >= a && end <= b)) {
      removed = true;
      if (insert && !inserted) {
        keep.push(insert);
        inserted = true;
      }
      continue;
    }
    keep.push(w.raw);
  }
  if (insert && !inserted) keep.push(insert);
  return { text: keep.join(' ').replace(/\s+/g, ' ').trim(), removed };
}

/**
 * Token ranges of lexicon brand mentions: every title-matchable brand, or only `onlyKey` (then also brands whose
 * name is an ordinary word, e.g. «کن», «پارس», which are never matched in free text otherwise).
 */
export function brandRanges(toks: readonly string[], onlyKey?: string): Range[] {
  const out: Range[] = [];
  for (const h of findBrandsInTokens([...toks], { includeNonTitle: onlyKey !== undefined })) {
    if (onlyKey && h.key !== onlyKey) continue;
    let len = 1;
    for (const al of brandByKey(h.key)?.aliasTokens ?? []) {
      if (al.length > len && al.every((t, j) => toks[h.tokenIndex + j] === t)) len = al.length;
    }
    out.push([h.tokenIndex, h.tokenIndex + len]);
  }
  return out;
}

/** Text without brand mentions (all brands, or only `onlyKey`). */
export function stripBrandMentions(text: string, onlyKey?: string): string {
  const ws = words(text);
  return rewrite(ws, brandRanges(ws.flatMap((w) => w.toks), onlyKey)).text;
}

/** Text with every brand mention (and `oldKey`'s) replaced by `label` (appended when the text names no brand). */
export function replaceBrandMention(text: string, label: string, oldKey?: string): string {
  const ws = words(text);
  const toks = ws.flatMap((w) => w.toks);
  return rewrite(ws, [...brandRanges(toks), ...(oldKey ? brandRanges(toks, oldKey) : [])], label).text;
}

/** Text without the first run of words that spells `label` (unchanged when the label's words are not there). */
export function removeLabelWords(text: string, label: string): string {
  const target = tokenizeForSearch(label);
  if (target.length === 0) return text;
  const ws = words(text);
  const toks = ws.flatMap((w) => w.toks);
  for (let i = 0; i + target.length <= toks.length; i++) {
    if (target.every((t, j) => toks[i + j] === t)) return rewrite(ws, [[i, i + target.length]]).text || text;
  }
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// state edits
// ---------------------------------------------------------------------------------------------------------------

export function cloneState(s: State): State {
  return structuredClone(s);
}

export function findItem(s: State, itemId: string): Req | undefined {
  return s.requirements.find((r) => r.id === itemId);
}

/** `n` new item ids that collide with nothing in the state («a1», «a2»…). */
export function freshItemIds(s: State, n: number): string[] {
  const used = new Set(s.requirements.map((r) => r.id));
  const out: string[] = [];
  for (let k = 1; out.length < n; k++) {
    const id = `a${k}`;
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Remove an item and every per-item record that refers to it (including other items' inherited records). */
export function dropItem(s: State, itemId: string): void {
  s.requirements = s.requirements.filter((r) => r.id !== itemId);
  for (const r of s.requirements) {
    if (!r.inherited) continue;
    const rest = r.inherited.filter((h) => h.fromItemId !== itemId);
    if (rest.length) r.inherited = rest;
    else delete r.inherited;
  }
  delete s.answers[itemId];
  delete s.settled[itemId];
  delete s.pins[itemId];
  delete s.shopPins[itemId];
  delete s.excludedShops[itemId];
}

/** Structural equality of two states (key order independent). */
export function sameState(a: State, b: State): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * The state as a client sends and stores it. The route validates the request with zod, which fills defaults
 * (`chips: []`, `categoryId: null`, `categoryLabel: ''`); a parser item never had them, so they are removed again and
 * `newState.requirements[i]` stays a verbatim /api/parse item. Every other state field is the client's own shape.
 */
export function toClientState(s: State): State {
  return {
    ...s,
    requirements: s.requirements.map((r) => {
      if (!isParserItem(r)) return r;
      const { chips, categoryId, categoryLabel, ...rest } = r;
      return {
        ...rest,
        ...(chips && chips.length ? { chips } : {}),
        ...(categoryId != null ? { categoryId } : {}),
        ...(categoryLabel ? { categoryLabel } : {}),
      } as Req;
    }),
  };
}
