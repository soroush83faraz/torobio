/**
 * Extension hook for a later LLM refinement of the deterministic parse (PLAN B3.6). NO LLM CALLS HERE.
 *
 * Contract
 *  - The route always computes the deterministic parse first.
 *  - If `AppContext.parseRefiner` is set, it is called with a deep copy of the draft items and a context that
 *    carries the category shortlist the refiner must choose from and an AbortSignal.
 *  - The refiner's result is used ONLY if it resolves within `timeoutMs` (default: config.llmTimeoutMs = 3000 ms)
 *    AND validates (zod shape + closed ATTR_SCHEMA values + categories from the supplied shortlist + sane limits).
 *  - In every other case (timeout, throw, invalid) the deterministic result is returned. A late refiner result is
 *    discarded for good: the response is only ever sent once, so the UI never jumps.
 */
import { ATTR_SCHEMA, type AttrKey, type Budget } from '@app/core';
import { z } from 'zod';
import { MAX_ITEMS, MAX_QTY, type CategoryCandidate, type ParsedItem, type ParseResult } from './types.js';
import { titleOf } from './parse.js';

export interface RefineContext {
  /** The user's text (untrusted: a refiner must treat it as data, never as instructions). */
  text: string;
  /** Aborted when the timeout fires; stop work and drop the result. */
  signal: AbortSignal;
  timeoutMs: number;
  /** Per deterministic item: the category candidates the refiner may choose from. */
  shortlist: Record<string, CategoryCandidate[]>;
  /** Union of all shortlisted category ids: the ONLY ids a refined item may carry. */
  allowedCategoryIds: number[];
}

export type ParseRefiner = (items: ParsedItem[], ctx: RefineContext) => Promise<ParsedItem[]>;

// --- validation -----------------------------------------------------------------------------------------------

function validValue(attr: AttrKey, v: unknown): boolean {
  const spec = ATTR_SCHEMA[attr];
  switch (spec.kind) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'enum':
      return typeof v === 'string' && !!spec.values?.includes(v);
    case 'string':
      return typeof v === 'string' && v.length > 0 && v.length <= 80;
    case 'string_list':
      return Array.isArray(v) && v.every((x) => typeof x === 'string');
  }
}

const attrKey = z.string().refine((k): k is AttrKey => k in ATTR_SCHEMA, 'unknown attribute');
const scalar = z.union([z.string().max(80), z.number().finite(), z.boolean()]);

const constraintSchema = z
  .discriminatedUnion('op', [
    z.object({ attr: attrKey, op: z.literal('eq'), value: scalar, source: z.literal('user') }),
    z.object({ attr: attrKey, op: z.literal('in'), values: z.array(z.union([z.string().max(80), z.number().finite()])).min(1).max(8), source: z.literal('user') }),
    z.object({ attr: attrKey, op: z.enum(['gte', 'lte']), value: z.number().finite(), source: z.literal('user') }),
    z.object({ attr: attrKey, op: z.literal('contains'), value: z.string().min(1).max(80), source: z.literal('user') }),
    z.object({ attr: attrKey, op: z.literal('known'), source: z.literal('user') }),
  ])
  .refine((c) => {
    const spec = ATTR_SCHEMA[c.attr as AttrKey];
    if (!spec) return false;
    if (c.op === 'eq') return validValue(c.attr as AttrKey, c.value);
    if (c.op === 'in') return spec.kind === 'enum' ? c.values.every((v) => validValue(c.attr as AttrKey, v)) : spec.kind === 'number' || spec.kind === 'string';
    if (c.op === 'gte' || c.op === 'lte') return spec.kind === 'number';
    if (c.op === 'contains') return spec.kind === 'string_list';
    return true;
  }, 'constraint does not match the closed schema');

const money = z.number().int().min(0).max(1e10);
const budgetSchema = z
  .object({ min: money.optional(), max: money.optional() })
  .refine((b) => b.min === undefined || b.max === undefined || b.min <= b.max, 'min > max');

const KINDS = ['camera', 'recorder', 'hdd', 'adapter', 'phone', 'phone_case', 'screen_protector', 'other'] as const;

function itemSchema(allowed: ReadonlySet<number>) {
  return z.object({
    id: z.string().min(1).max(40),
    text: z.string().min(1).max(300),
    qty: z.number().int().min(1).max(MAX_QTY),
    qtyStated: z.boolean().optional(),
    categoryIds: z.array(z.number().int().refine((id) => allowed.has(id), 'category not in shortlist')).max(3),
    kind: z.enum(KINDS).optional(),
    constraints: z.array(constraintSchema).max(12),
    modelCode: z.string().regex(/^[A-Z0-9]{4,30}$/).optional(),
    budget: budgetSchema.optional(),
    rawText: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
    categoryCandidates: z.array(z.object({ id: z.number().int(), name: z.string(), score: z.number() })).max(3).optional(),
    notes: z.array(z.object({ code: z.string(), messageFa: z.string().max(300), fragment: z.string().max(300).optional(), itemId: z.string().optional() })).max(10).optional(),
    inherited: z.array(z.object({ attr: attrKey, fromItemId: z.string() })).optional(),
    domain: z.string().max(40).optional(),
    unit: z.string().max(20).optional(),
  });
}

export function validateRefined(output: unknown, allowedCategoryIds: readonly number[]): ParsedItem[] | null {
  const schema = z.array(itemSchema(new Set(allowedCategoryIds))).min(1).max(MAX_ITEMS);
  let r: ReturnType<typeof schema.safeParse>;
  try {
    r = schema.safeParse(output);
  } catch {
    return null; // hostile / malformed output must never take the request down
  }
  if (!r.success) return null;
  const ids = new Set(r.data.map((i) => i.id));
  if (ids.size !== r.data.length) return null;
  return r.data.map((i) => ({
    ...i,
    kind: i.kind ?? 'other',
    rawText: i.rawText ?? i.text,
    confidence: i.confidence ?? 0.5,
    categoryCandidates: (i.categoryCandidates ?? []) as CategoryCandidate[],
    notes: (i.notes ?? []) as ParsedItem['notes'],
    constraints: i.constraints as ParsedItem['constraints'],
    ...(i.budget ? { budget: i.budget as Budget } : {}),
  })) as ParsedItem[];
}

// --- the race ---------------------------------------------------------------------------------------------------

export type RefineOutcome = 'refined' | 'timeout' | 'invalid' | 'error';

export async function refineWithTimeout(opts: {
  refiner: ParseRefiner;
  draft: ParseResult;
  text: string;
  timeoutMs: number;
}): Promise<{ result: ParseResult; outcome: RefineOutcome }> {
  const { refiner, draft, text, timeoutMs } = opts;
  const shortlist: Record<string, CategoryCandidate[]> = {};
  const allowed = new Set<number>();
  for (const it of draft.items) {
    shortlist[it.id] = it.categoryCandidates.map((c) => ({ ...c }));
    for (const c of it.categoryCandidates) allowed.add(c.id);
  }
  const ac = new AbortController();
  const ctx: RefineContext = { text, signal: ac.signal, timeoutMs, shortlist, allowedCategoryIds: [...allowed] };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  // The refiner works on a deep copy: a late mutation can never reach the deterministic result we return.
  const work: Promise<{ ok: true; value: unknown } | { ok: false }> = (async () => {
    try {
      return { ok: true as const, value: await refiner(structuredClone(draft.items), ctx) };
    } catch {
      return { ok: false as const };
    }
  })();

  const winner = await Promise.race([work, timeout]);
  clearTimeout(timer);
  if (winner === 'timeout') {
    ac.abort();
    return { result: draft, outcome: 'timeout' };
  }
  if (!winner.ok) return { result: draft, outcome: 'error' };
  const items = validateRefined(winner.value, ctx.allowedCategoryIds);
  if (!items) return { result: draft, outcome: 'invalid' };
  return { result: { ...draft, items, title: titleOf(items), source: 'refined' }, outcome: 'refined' };
}
