/**
 * Stateless question answers.
 *
 * A question option id fully encodes what the option applies, so the server needs no session to turn
 * `answers[itemId][questionId] = optionId` back into a constraint or budget:
 *   c~<op>~<attr>~<json payload>    constraint, e.g. c~eq~resolution_mp~2 · c~in~recorder_kind~["xvr","dvr"]
 *   c~eq~condition~"any"            accepted listing conditions (pseudo-attribute, see dto CONDITION_ATTR)
 *   b~<min>~<max>                   budget band (either bound may be empty)
 *   any | unsure                    «فرقی نمی‌کند» (skip this question)
 * Decoding validates against the closed ATTR_SCHEMA; anything else decodes to null and is ignored.
 */
import { ATTR_SCHEMA, CONDITION_MODES, type AttrKey, type Budget, type ConditionMode, type Constraint, type QuestionOption } from '../types/index';
import { CONDITION_ATTR, type ConditionConstraintDto, type ConstraintDto, type StatedConstraintDto } from './dto';

export const SKIP_OPTION_ID = 'any';
const SKIP_IDS = new Set([SKIP_OPTION_ID, 'unsure']);

export type DecodedAnswer =
  | { kind: 'skip' }
  | { kind: 'constraint'; constraint: Constraint }
  | { kind: 'budget'; budget: Budget }
  | { kind: 'condition'; condition: ConditionMode };

export function isConditionConstraint(c: StatedConstraintDto): c is ConditionConstraintDto {
  return (c as { attr: string }).attr === CONDITION_ATTR;
}

/** Encode a condition answer option id. */
export function encodeConditionOptionId(mode: ConditionMode): string {
  return `c~eq~${CONDITION_ATTR}~${JSON.stringify(mode)}`;
}

const MAX_STR = 80;
const MAX_NUM = 1e12;

function okNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_NUM;
}
function okString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_STR;
}

/** Value allowed for `attr` (enum membership, number/string/boolean kind). */
function valueFits(attr: AttrKey, v: unknown): v is string | number | boolean {
  const spec = ATTR_SCHEMA[attr];
  switch (spec.kind) {
    case 'number':
      return okNumber(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'enum':
      return okString(v) && (spec.values ?? []).includes(v);
    case 'string':
    case 'string_list':
      return okString(v);
  }
}

/**
 * Validate a stated constraint against the closed schema and stamp its source.
 * Returns null when the operator does not fit the attribute kind or a value is out of the schema.
 */
export function toEngineConstraint(dto: ConstraintDto, source: 'user' | 'answer'): Constraint | null {
  const attr = dto.attr;
  const spec = ATTR_SCHEMA[attr];
  if (!spec) return null;
  switch (dto.op) {
    case 'known':
      return { attr, op: 'known', source };
    case 'eq':
      if (spec.kind === 'string_list') return null;
      return valueFits(attr, dto.value) ? { attr, op: 'eq', value: dto.value, source } : null;
    case 'in': {
      if (spec.kind === 'string_list' || spec.kind === 'boolean') return null;
      const values = dto.values.filter((v) => valueFits(attr, v)) as (string | number)[];
      return values.length === dto.values.length && values.length > 0 ? { attr, op: 'in', values, source } : null;
    }
    case 'gte':
    case 'lte':
      return spec.kind === 'number' && okNumber(dto.value) ? { attr, op: dto.op, value: dto.value, source } : null;
    case 'contains':
      return spec.kind === 'string_list' && okString(dto.value) ? { attr, op: 'contains', value: dto.value, source } : null;
  }
}

/** Encode what an engine question option applies into a stateless option id. */
export function encodeOptionId(apply: QuestionOption['apply']): string | null {
  if (apply.budget) {
    const b = apply.budget;
    return `b~${b.min ?? ''}~${b.max ?? ''}`;
  }
  const c = apply.constraint;
  if (!c) return null;
  switch (c.op) {
    case 'eq':
    case 'gte':
    case 'lte':
    case 'contains':
      return `c~${c.op}~${c.attr}~${JSON.stringify(c.value)}`;
    case 'in':
      return `c~in~${c.attr}~${JSON.stringify(c.values)}`;
    case 'known':
      return `c~known~${c.attr}~null`;
  }
}

/** Decode an option id from the client. Never throws; unknown or invalid ids decode to null. */
export function decodeOptionId(optionId: string): DecodedAnswer | null {
  if (typeof optionId !== 'string' || optionId.length > 200) return null;
  if (SKIP_IDS.has(optionId)) return { kind: 'skip' };
  const parts = optionId.split('~');
  if (parts[0] === 'b' && parts.length === 3) {
    const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : /^\d{1,13}$/.test(s) ? Number(s) : NaN);
    const min = num(parts[1]);
    const max = num(parts[2]);
    if (Number.isNaN(min) || Number.isNaN(max)) return null;
    if (min === undefined && max === undefined) return null;
    if (min !== undefined && max !== undefined && min > max) return null;
    const budget: Budget = {};
    if (min !== undefined) budget.min = min;
    if (max !== undefined) budget.max = max;
    return { kind: 'budget', budget };
  }
  if (parts[0] !== 'c' || parts.length < 4) return null;
  const op = parts[1];
  if (parts[2] === CONDITION_ATTR) {
    if (op !== 'eq') return null;
    let v: unknown;
    try {
      v = JSON.parse(parts.slice(3).join('~'));
    } catch {
      return null;
    }
    return typeof v === 'string' && (CONDITION_MODES as readonly string[]).includes(v) ? { kind: 'condition', condition: v as ConditionMode } : null;
  }
  const attr = parts[2] as AttrKey;
  if (!(attr in ATTR_SCHEMA)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(parts.slice(3).join('~'));
  } catch {
    return null;
  }
  let dto: ConstraintDto;
  switch (op) {
    case 'eq':
    case 'gte':
    case 'lte':
    case 'contains':
      dto = { attr, op, value: payload } as ConstraintDto;
      break;
    case 'in':
      if (!Array.isArray(payload)) return null;
      dto = { attr, op: 'in', values: payload } as ConstraintDto;
      break;
    case 'known':
      dto = { attr, op: 'known' };
      break;
    default:
      return null;
  }
  const constraint = toEngineConstraint(dto, 'answer');
  return constraint ? { kind: 'constraint', constraint } : null;
}
