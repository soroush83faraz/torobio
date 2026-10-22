import {
  CONDITION_ISSUE_TEXT,
  describeConstraintEval,
  describeModelCodeMismatch,
  describeOutOfBudget,
} from '../copy/fa';
import { deviceModelBase } from '../extract/device-models';
import type {
  AttrKey,
  AttrValue,
  Budget,
  Candidate,
  CandidateEval,
  ConditionIssue,
  CandidateFit,
  Constraint,
  ConstraintEval,
  Offer,
  ProductAttrs,
  Requirement,
} from '../types/index';

const DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/**
 * Token normalisation for comparisons only (model codes, phone-model tokens, brand names):
 * Persian/Arabic digits → Latin, upper-case, drop spaces, hyphens, underscores, dots and slashes.
 * Display text is never altered.
 */
export function normToken(s: string): string {
  let out = '';
  for (const ch of s) out += DIGITS[ch] ?? ch;
  return out.toUpperCase().replace(/[\s\-_./‌]+/g, '');
}

/**
 * Device-model keys (extract/ATTRIBUTES.md convention: lower-case Latin, single spaces, e.g. "galaxy a56 5g").
 * Comparison form: Persian digits → Latin, lower-case, whitespace collapsed.
 */
export function deviceModelKey(s: string): string {
  let out = '';
  for (const ch of s) out += DIGITS[ch] ?? ch;
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Two device-model keys name the same device. Variants are distinct ("galaxy s24" ≠ "galaxy s24 ultra").
 * A trailing network variant ("… 5g") is ignored only when exactly one side states it
 * ("galaxy a56" ~ "galaxy a56 5g", but "galaxy a56 4g" ≠ "galaxy a56 5g").
 */
export function deviceModelsMatch(a: string, b: string): boolean {
  const x = deviceModelKey(a);
  const y = deviceModelKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const bx = deviceModelBase(x);
  const by = deviceModelBase(y);
  return bx === by && (bx === x || by === y);
}

/** Attributes holding device-model keys. */
const DEVICE_MODEL_ATTRS: ReadonlySet<AttrKey> = new Set<AttrKey>(['phone_model', 'fits_models']);

function valuesEqual(a: AttrValue, b: string | number | boolean): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (Array.isArray(a)) return false;
  return normToken(String(a)) === normToken(String(b));
}

/** pass | fail | unknown for one constraint. Unknown whenever the product lacks the attribute. */
export function evaluateConstraint(c: Constraint, attrs: ProductAttrs): ConstraintEval {
  const raw = attrs[c.attr] as AttrValue | null | undefined;
  if (raw === undefined || raw === null || (typeof raw === 'number' && !Number.isFinite(raw))) {
    return { constraint: c, result: 'unknown' };
  }
  const actual = raw;
  switch (c.op) {
    case 'known':
      return { constraint: c, result: Array.isArray(actual) && actual.length === 0 ? 'unknown' : 'pass', actual };
    case 'eq':
      if (DEVICE_MODEL_ATTRS.has(c.attr) && typeof actual === 'string')
        return { constraint: c, result: deviceModelsMatch(actual, String(c.value)) ? 'pass' : 'fail', actual };
      return { constraint: c, result: valuesEqual(actual, c.value) ? 'pass' : 'fail', actual };
    case 'in':
      return { constraint: c, result: c.values.some((v) => valuesEqual(actual, v)) ? 'pass' : 'fail', actual };
    case 'gte':
    case 'lte': {
      if (typeof actual !== 'number') return { constraint: c, result: 'unknown', actual };
      const ok = c.op === 'gte' ? actual >= c.value - 1e-9 : actual <= c.value + 1e-9;
      return { constraint: c, result: ok ? 'pass' : 'fail', actual };
    }
    case 'contains': {
      const list = Array.isArray(actual) ? actual : [String(actual)];
      if (list.length === 0) return { constraint: c, result: 'unknown', actual };
      if (DEVICE_MODEL_ATTRS.has(c.attr))
        return { constraint: c, result: list.some((v) => deviceModelsMatch(v, c.value)) ? 'pass' : 'fail', actual };
      const want = normToken(c.value);
      return { constraint: c, result: list.some((v) => normToken(v) === want) ? 'pass' : 'fail', actual };
    }
  }
}

/** An offer is usable when its cleaned price is a positive finite number. */
export function isPricedOffer(o: Offer): o is Offer & { price: number } {
  return o.price !== null && Number.isFinite(o.price) && o.price > 0;
}

export function minValidPrice(offers: readonly Offer[]): number | null {
  let best: number | null = null;
  for (const o of offers) if (isPricedOffer(o) && (best === null || o.price < best)) best = o.price;
  return best;
}

/** Budget bounds are inclusive. */
export function priceWithinBudget(price: number, budget: Budget | undefined): boolean {
  if (!budget) return true;
  if (budget.min !== undefined && price < budget.min) return false;
  if (budget.max !== undefined && price > budget.max) return false;
  return true;
}

function hasBudget(b: Budget | undefined): b is Budget {
  return !!b && (b.min !== undefined || b.max !== undefined);
}

/**
 * Model-code match on normalised tokens. Also accepts a vendor prefix of at most 3 characters on either side
 * («DH-XVR1B04-I» vs «XVR1B04-I»), only when the shorter code has at least 5 characters.
 */
export function modelCodeMatches(productCodes: readonly string[], code: string): boolean {
  const want = normToken(code);
  if (!want) return false;
  return productCodes.some((pc) => {
    const have = normToken(pc);
    if (have === want) return true;
    const [short, long] = have.length < want.length ? [have, want] : [want, have];
    return short.length >= 5 && long.length - short.length <= 3 && long.endsWith(short);
  });
}

/**
 * Listing condition vs the requirement's accepted conditions (types ConditionMode). Title-stated flags only:
 * a listing without a flag is "not stated as used", which passes the default policy.
 */
export function conditionIssue(item: Requirement, cand: Candidate): ConditionIssue | undefined {
  const used = cand.listing?.condition;
  const replica = cand.listing?.replica === true;
  switch (item.condition ?? 'new') {
    case 'any':
      return replica ? 'replica' : undefined;
    case 'used':
      if (replica) return 'replica';
      return used ? undefined : 'not_used';
    case 'replica':
      return replica ? undefined : 'not_replica';
    default:
      if (replica) return 'replica';
      return used;
  }
}

export function evaluateCandidate(item: Requirement, cand: Candidate): CandidateEval {
  const evals = item.constraints.map((c) => evaluateConstraint(c, cand.attrs));
  const failed = evals.filter((e) => e.result === 'fail');
  const unknown = evals.filter((e) => e.result === 'unknown');
  const modelCodeMatch = item.modelCode ? modelCodeMatches(cand.product.modelCodes, item.modelCode) : false;
  const minPrice = minValidPrice(cand.offers);
  const pricedOfferCount = cand.offers.filter(isPricedOffer).length;
  const withinBudget = hasBudget(item.budget) && minPrice !== null ? priceWithinBudget(minPrice, item.budget) : null;

  const modelMismatch = !!item.modelCode && !modelCodeMatch;
  const condIssue = conditionIssue(item, cand);
  // plausibility issues (another kind of goods / unclear sale unit); a pinned product is taken as is
  const issues = item.pinnedProductId === cand.product.id ? [] : (cand.issues ?? []);
  const kindIssue = issues.some((i) => i.fit === 'differs');
  const unclearIssue = issues.some((i) => i.fit === 'incomplete');
  let fit: CandidateFit;
  if (failed.length > 0 || withinBudget === false || modelMismatch || condIssue || kindIssue) fit = 'differs';
  else if (unknown.length > 0 || unclearIssue) fit = 'incomplete';
  else fit = 'eligible';

  const differences: string[] = [];
  if (condIssue) differences.push(CONDITION_ISSUE_TEXT[condIssue]);
  for (const i of issues) differences.push(i.text);
  if (modelMismatch && item.modelCode) differences.push(describeModelCodeMismatch(item.modelCode));
  for (const f of failed) differences.push(describeConstraintEval(f));
  if (withinBudget === false && minPrice !== null) differences.push(describeOutOfBudget(minPrice));
  for (const u of unknown) differences.push(describeConstraintEval(u));

  const out: CandidateEval = {
    productId: cand.product.id,
    fit,
    evals,
    failed,
    unknown,
    modelCodeMatch,
    minPrice,
    pricedOfferCount,
    withinBudget,
    differences,
  };
  if (condIssue) out.conditionIssue = condIssue;
  if (issues.length) out.issues = issues.map((i) => i.code);
  return out;
}

const FIT_ORDER: Record<CandidateFit, number> = { eligible: 0, incomplete: 1, differs: 2 };

/** Stable display order: fit, priced first, cheaper first, more sellers, product id. */
export function compareEvals(a: CandidateEval, b: CandidateEval): number {
  return (
    FIT_ORDER[a.fit] - FIT_ORDER[b.fit] ||
    Number(a.minPrice === null) - Number(b.minPrice === null) ||
    (a.minPrice ?? 0) - (b.minPrice ?? 0) ||
    b.pricedOfferCount - a.pricedOfferCount ||
    a.productId - b.productId
  );
}

export function evaluateCandidates(item: Requirement, candidates: readonly Candidate[]): CandidateEval[] {
  return candidates.map((c) => evaluateCandidate(item, c)).sort(compareEvals);
}
