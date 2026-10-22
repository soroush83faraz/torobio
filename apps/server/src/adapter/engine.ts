/**
 * Engine adapter: wire RequirementState -> engine requirements -> core resolve / plan / compat -> wire DTOs.
 *
 * Stateless: every call rebuilds the engine requirements from the client state. Stated constraints come
 * from chips (non-inherited) and decoded answers; compat-derived constraints are recomputed by core
 * (resolveItems strips and re-derives them). Persian text comes from core copy (copy/fa.ts, api/copy.ts);
 * every number in a sentence is a data value.
 */
import {
  Api,
  ASSIGNMENT_RULE_TEXT,
  assumedConstraintText,
  COMPAT_LIFTED_LABEL,
  suggestedDetail,
  ATTR_KEYS,
  autoConflicts,
  brandByKey,
  buildPlanItems,
  chosenItemsForCompat,
  compatCopy,
  compatRepairs,
  conflictCulprit,
  describeConstraintEval,
  guardConstraintText,
  isAutoPick,
  isGuardConstraint,
  ITEM_STATE_LABEL,
  noMatchSummary,
  type ChosenItem,
  type DerivedConstraint,
  type ItemResolution,
  COMPAT_STATUS_LABEL,
  CONDITION_FLAG_LABEL,
  CONDITION_MODE_LABEL,
  conditionExcludedNote,
  constraintText,
  tokenizeForSearch,
  type ConditionMode,
  evaluateCompat,
  extractModelCodes,
  formatAttrValue,
  haversineM,
  hasCoords,
  inheritedConstraintText,
  INCOMPLETE_SPECS_LABEL,
  isPricedOffer,
  MAX_PLAN_ITEMS,
  openStatusAt,
  PICK_RULE_TEXT,
  planCopy,
  planRun,
  plausibilityCopy,
  resolveItems,
  subkindWords,
  withKindIssues,
  type KindContext,
  type AttrKey,
  type AttrValue,
  type CandidateEval,
  type CompatFinding,
  type Constraint,
  type ItemKind,
  type ItemResult,
  type ListResult,
  type MissingReason,
  type OpenStatus,
  type Plan,
  type PlanItemInput,
  type PlanResult,
  type ProductAttrs,
  type QuestionKey,
  type Requirement,
  type Shop,
  type Visit,
  type Weekday,
} from '@app/core';
import type { MarketCandidate } from './rows.js';
import type { Catalog } from '../retrieval/catalog.js';
import { retrieve, type RetrieveResult } from '../retrieval/retrieve.js';
import { notFoundSuggestions } from '../retrieval/notfound.js';

type WireState = Api.RequirementState;
type WireReq = Api.Requirement;

// ---------------------------------------------------------------------------
// state -> engine requirements
// ---------------------------------------------------------------------------

const QUESTION_KEYS = new Set<string>([...ATTR_KEYS, 'budget']);
const isQuestionKey = (k: string): k is QuestionKey => QUESTION_KEYS.has(k);

function validBudget(b: Api.Requirement['budget']): { min?: number; max?: number } | undefined {
  if (!b) return undefined;
  if (b.min === undefined && b.max === undefined) return undefined;
  if (b.min !== undefined && b.max !== undefined && b.min > b.max) return undefined;
  const out: { min?: number; max?: number } = {};
  if (b.min !== undefined) out.min = b.min;
  if (b.max !== undefined) out.max = b.max;
  return out;
}

/** A /api/parse item (it carries `constraints`); chip-form items do not. */
export const isParserItem = (dto: WireReq): boolean => dto.constraints !== undefined;

/** The single device model stated (not inherited) by the request's phone items, if exactly one. */
function statedPhoneModelIds(state: WireState): { model: string | null; ids: Set<string> } {
  const byModel = new Map<string, Set<string>>();
  for (const r of state.requirements) {
    if (r.kind !== undefined && r.kind !== 'phone') continue;
    const inheritedAttrs = new Set((r.inherited ?? []).map((h) => h.attr));
    const stated = isParserItem(r) ? (r.constraints ?? []) : r.chips.filter((c) => !c.inherited).map((c) => c.constraint);
    for (const c of stated) {
      if (!c || Api.isConditionConstraint(c) || c.attr !== 'phone_model' || c.op !== 'eq' || inheritedAttrs.has('phone_model')) continue;
      const key = String(c.value).toLowerCase();
      byModel.set(key, (byModel.get(key) ?? new Set()).add(r.id));
    }
  }
  if (byModel.size !== 1) return { model: null, ids: new Set() };
  const [model, ids] = [...byModel.entries()][0]!;
  return { model, ids };
}

/**
 * Parser constraints the server re-derives itself: a phone model a case / protector inherited from the request's
 * phone item is the compat rule `phone_accessory_fit` (it follows the phone if the user changes it). An inherited
 * constraint whose source is not such a phone item (e.g. a sibling accessory) stays a stated constraint.
 */
function rederivedAttrs(dto: WireReq, state: WireState): Set<string> {
  const out = new Set<string>();
  if (!dto.inherited?.length) return out;
  const phones = statedPhoneModelIds(state);
  for (const h of dto.inherited) if (h.attr === 'fits_models' && phones.ids.has(h.fromItemId)) out.add(h.attr);
  return out;
}

/** Engine requirement (without kind / categories, which retrieval decides). */
export function toEngineRequirement(dto: WireReq, state: WireState): Requirement {
  const constraints: Constraint[] = [];
  let condition: ConditionMode | undefined = dto.condition;
  const parser = isParserItem(dto);
  // parser items: `constraints` is authoritative (chips are display only); chip-form items: chip constraints.
  // Inherited chips / compat constraints are display copies of derived constraints: re-derived every call.
  const skipAttrs = parser ? rederivedAttrs(dto, state) : new Set<string>();
  const stated: Api.StatedConstraintDto[] = parser
    ? (dto.constraints ?? []).filter((c) => c.source !== 'compat' && !skipAttrs.has(c.attr))
    : dto.chips.filter((ch) => !ch.inherited && ch.constraint).map((ch) => ch.constraint!);
  for (const sc of stated) {
    if (Api.isConditionConstraint(sc)) {
      condition = sc.value;
      continue;
    }
    const c = Api.toEngineConstraint(sc, sc.source === 'answer' ? 'answer' : 'user');
    if (c) constraints.push(c);
  }
  const skipped: QuestionKey[] = [];
  let budget = validBudget(dto.budget);
  for (const [qid, optionId] of Object.entries(state.answers[dto.id] ?? {})) {
    const d = Api.decodeOptionId(optionId);
    if (!d) continue;
    if (d.kind === 'skip') {
      if (isQuestionKey(qid)) skipped.push(qid);
    } else if (d.kind === 'constraint') constraints.push(d.constraint);
    else if (d.kind === 'condition') condition = d.condition;
    else budget = validBudget(d.budget) ?? budget;
  }
  const req: Requirement = {
    id: dto.id,
    text: dto.text,
    qty: dto.qty,
    // a parser item says qtyStated only when the user wrote the quantity
    qtyStated: dto.qtyStated ?? !parser,
    categoryIds: [],
    constraints,
  };
  if (condition && condition !== 'new') req.condition = condition;
  if (budget) req.budget = budget;
  const code = dto.modelCode?.trim();
  if (code) req.modelCode = code;
  const pin = state.pins[dto.id];
  if (pin && /^\d{1,12}$/.test(pin)) req.pinnedProductId = Number(pin);
  if (state.settled[dto.id]) req.preference = { acceptSuggestion: true };
  if (skipped.length) req.skippedQuestions = skipped;
  return req;
}

/** Search words of a parser item's `unparsed_fragment` notes (what the parser did not turn into a constraint). */
function parserNarrowTerms(dto: WireReq): string[] {
  const out: string[] = [];
  for (const n of dto.notes ?? []) {
    if (n.code !== 'unparsed_fragment' || !n.fragment) continue;
    for (const t of tokenizeForSearch(n.fragment, { dropStopwords: true })) if (!out.includes(t)) out.push(t);
  }
  return out;
}

function wireCategoryIds(dto: WireReq): number[] {
  if (dto.categoryIds && dto.categoryIds.length) return dto.categoryIds;
  return dto.categoryId && /^\d{1,9}$/.test(dto.categoryId) ? [Number(dto.categoryId)] : [];
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

export interface ResolvedItem {
  dto: WireReq;
  /** Engine requirement as evaluated (with derived constraints). */
  item: Requirement;
  retrieval: RetrieveResult;
  cands: MarketCandidate[];
  byId: Map<number, MarketCandidate>;
  result: ItemResult;
}

export interface ResolvedState {
  items: ResolvedItem[];
  list: ListResult;
  candidatesByItem: Record<string, MarketCandidate[]>;
  /** Retrieval results per item (reused when the plan guard re-resolves). */
  prepared: PreparedItem[];
  /** Constraints the plan's compatibility guard added (core `compatRepairs`); empty before planning. */
  repairs: DerivedConstraint[];
  /** Items whose automatic pick the guard took out (item id -> Persian conflict sentence). */
  dropped: Map<string, string>;
}

interface PreparedItem {
  dto: WireReq;
  req: Requirement;
  retrieval: RetrieveResult;
}

/** What the item text names, for the title-head rules (core requirement/plausibility.ts). */
export function kindContext(catalog: Catalog, text: string, categoryIds: readonly number[]): KindContext {
  const cats = catalog.categories();
  const ids = new Set(categoryIds);
  const vocabulary = new Set<string>();
  for (const id of ids) {
    const name = cats.get(id)?.name;
    for (const t of tokenizeForSearch(name ?? '')) vocabulary.add(t);
    for (const w of subkindWords(name)) vocabulary.add(w);
  }
  for (const s of catalog.synonyms()) if (ids.has(s.categoryId)) for (const t of s.tokens) vocabulary.add(t);
  const words = tokenizeForSearch(text, { dropStopwords: true }).filter((t) => !/\d/.test(t));
  const requested = words.find((t) => vocabulary.has(t)) ?? words[0] ?? null;
  return {
    requestTokens: new Set(tokenizeForSearch(text)),
    requested,
    categoryIds: ids,
    vocabulary,
    categoryName: (id) => cats.get(id)?.name,
    stats: catalog.headStats(),
  };
}

export function resolveState(catalog: Catalog, state: WireState): ResolvedState {
  const cats = catalog.categories();
  const prepared = state.requirements.map((dto) => {
    const req = toEngineRequirement(dto, state);
    const retrieval = retrieve(catalog, {
      text: dto.text,
      categoryIds: wireCategoryIds(dto),
      modelCode: req.modelCode,
      pinnedProductId: req.pinnedProductId,
      coveredTexts: [...dto.chips.map((c) => c.label), dto.unit ?? '', dto.categoryLabel],
      qty: dto.qty,
      // parser items: only the words the parser could not place narrow the search (its unparsed fragments)
      ...(isParserItem(dto) ? { narrowTerms: parserNarrowTerms(dto) } : {}),
      // a parser item without categories was judged absent («not_in_catalog»): terminal «پیدا نشد», never a
      // raw-text search; it becomes a normal item only when the user picks a category (categoryIds set)
      noVote: isParserItem(dto) && wireCategoryIds(dto).length === 0,
    });
    // plausibility: listings whose title names another kind of goods are not the requested thing (core rule 1-2)
    if (retrieval.categoryIds.length && retrieval.candidates.length) retrieval.candidates = withKindIssues(retrieval.candidates, kindContext(catalog, dto.text, retrieval.categoryIds));
    const kind: ItemKind = retrieval.categoryIds.length
      ? Api.kindForCategoryNames(retrieval.categoryIds.map((id) => cats.get(id)?.name))
      : (dto.kind ?? 'other');
    req.kind = kind;
    req.categoryIds = retrieval.categoryIds;
    return { dto, req, retrieval };
  });
  return resolvePrepared(prepared, [], new Map());
}

/**
 * Resolve prepared items with the guard's repair constraints and dropped picks. A dropped item keeps its
 * evaluations but loses its pick: it becomes «نیاز به اطلاعات» with the conflict sentence (never counted).
 */
function resolvePrepared(prepared: PreparedItem[], repairs: DerivedConstraint[], dropped: Map<string, string>): ResolvedState {
  const candidatesByItem: Record<string, MarketCandidate[]> = {};
  for (const p of prepared) candidatesByItem[p.req.id] = p.retrieval.candidates;
  const list = resolveItems(
    prepared.map((p) => p.req),
    candidatesByItem,
    {},
    repairs,
  );
  if (dropped.size) {
    list.results = list.results.map((r) => {
      const why = dropped.get(r.resolution.itemId);
      return why !== undefined ? { ...r, resolution: withoutPick(r.resolution, why) } : r;
    });
  }
  const items = prepared.map((p, i) => {
    const cands = p.retrieval.candidates;
    return {
      dto: p.dto,
      item: list.items[i]!,
      retrieval: p.retrieval,
      cands,
      byId: new Map(cands.map((c) => [c.product.id, c])),
      result: list.results[i]!,
    };
  });
  return { items, list, candidatesByItem, prepared, repairs, dropped };
}

/** The resolution without its automatic pick: needs the user's choice, with the conflict as the reason. */
function withoutPick(res: ItemResolution, conflictSentence: string): ItemResolution {
  const out: ItemResolution = {
    ...res,
    state: 'needs_info',
    needsInfoReason: 'compat_critical',
    label: ITEM_STATE_LABEL.needs_info,
    detail: compatCopy.guardDropped(conflictSentence),
  };
  delete out.chosenProductId;
  delete out.rule;
  delete out.fallbackPick;
  return out;
}

// ---------------------------------------------------------------------------
// helpers shared by the DTO mappers
// ---------------------------------------------------------------------------

const WIRE_STATE: Readonly<Record<string, Api.ItemState>> = {
  exact_model: 'exact',
  suggested: 'suggested',
  alternative: 'alternative',
  needs_info: 'needs_info',
  not_found: 'not_found',
  price_unknown: 'no_price',
};
export const toWireState = (s: string): Api.ItemState => WIRE_STATE[s] ?? 'not_found';

/** First model code as written in the title (display form). */
export function displayModelCode(title: string): string | undefined {
  return extractModelCodes(title)[0]?.raw;
}

export function productRef(c: MarketCandidate): Api.ProductRef {
  const ref: Api.ProductRef = { id: String(c.product.id), name: c.product.title };
  const code = displayModelCode(c.product.title);
  if (code) ref.modelCode = code;
  return ref;
}

/** Sellers of a product: shops with a usable price; when it has none, the shops that list it (labelled so). */
function sellerInfo(c: MarketCandidate): { count: number; label: string } {
  const priced = new Set(c.offers.filter(isPricedOffer).map((o) => o.shopId)).size;
  if (priced > 0) return { count: priced, label: Api.apiCopy.sellerCount(priced, true) };
  const listed = new Set(c.offers.map((o) => o.shopId)).size;
  return { count: listed, label: Api.apiCopy.sellerCount(listed, false) };
}

/** The sale unit fixed for a wire item: a stated constraint, else the pinned product's listing. */
export function itemSaleUnit(ri: ResolvedItem): Api.SaleUnitDto | undefined {
  if (ri.item.kind !== 'wire') return undefined;
  for (const c of ri.item.constraints) {
    if (c.attr !== 'sale_unit' || c.source === 'compat') continue;
    if (c.op === 'eq' && (c.value === 'roll' || c.value === 'meter')) return c.value;
    if (c.op === 'in' && c.values.length === 1 && (c.values[0] === 'roll' || c.values[0] === 'meter')) return c.values[0];
  }
  const pinned = ri.item.pinnedProductId !== undefined ? ri.byId.get(ri.item.pinnedProductId) : undefined;
  const u = pinned?.attrs.sale_unit;
  return u === 'roll' || u === 'meter' ? u : undefined;
}

function saleUnitOf(c: MarketCandidate | undefined): Api.SaleUnitDto | undefined {
  const u = c?.attrs.sale_unit;
  return u === 'roll' || u === 'meter' ? u : undefined;
}

const METRE_UNITS = new Set(['متر', 'متری', 'm', 'meter', 'metre']);
const ROLL_UNITS = new Set(['حلقه', 'کلاف', 'رول', 'roll']);

/**
 * Number of sale units to buy. A wire quantity in metres becomes whole 100 m rolls for a roll listing
 * (rounded up) and metres for a per-metre listing; a quantity in rolls becomes 100 m per roll when
 * bought by the metre. Everything else is a piece count.
 */
export function saleQty(dto: WireReq, unit: Api.SaleUnitDto | undefined): number {
  const u = (dto.unit ?? '').trim().toLowerCase();
  if (unit === 'roll' && METRE_UNITS.has(u)) return Math.max(1, Math.ceil(dto.qty / 100));
  if (unit === 'meter' && ROLL_UNITS.has(u)) return dto.qty * 100;
  return dto.qty;
}

function brandLabels(cands: readonly MarketCandidate[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const c of cands) {
    const key = c.attrs.brand;
    if (!key || !c.brandDisplay) continue;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(c.brandDisplay, (m.get(c.brandDisplay) ?? 0) + 1);
    counts.set(key, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0]);
  return out;
}

/** Display of one attribute value (Persian brand names, readable device models). */
function attrDisplay(attr: AttrKey, value: AttrValue, brands: Map<string, string>): string {
  if (attr === 'brand' && typeof value === 'string')
    return brands.get(value) ?? brandByKey(value)?.display ?? (value.startsWith('fa:') ? value.slice(3) : value);
  if (attr === 'phone_model' && typeof value === 'string') return Api.displayDeviceModel(value);
  if (attr === 'fits_models' && Array.isArray(value)) return Api.apiCopy.joinFa(value.map(Api.displayDeviceModel));
  if (attr === 'sale_unit' && (value === 'roll' || value === 'meter')) return Api.apiCopy.saleUnitLabel[value];
  return formatAttrValue(attr, value);
}

// ---------------------------------------------------------------------------
// item resolution DTO
// ---------------------------------------------------------------------------

function questionDto(ri: ResolvedItem, brands: Map<string, string>): Api.Question | undefined {
  const q = ri.result.question.question;
  if (!q) return undefined;
  const mandatory = q.ruleId === 'wire_sale_unit';
  const options: Api.QuestionOption[] = [];
  for (const o of q.options) {
    const id = Api.encodeOptionId(o.apply);
    if (!id) continue;
    let label = o.label;
    const c = o.apply.constraint;
    // the adapter-voltage question keeps core's labels (the 12 V option says it is the usual camera voltage)
    if (c && q.ruleId !== 'camera_adapter_12v' && (c.op === 'eq' || c.op === 'contains')) {
      if (c.attr === 'sale_unit' && (c.value === 'roll' || c.value === 'meter')) label = Api.apiCopy.saleUnitOption[c.value];
      else label = attrDisplay(c.attr, c.attr === 'fits_models' ? [String(c.value)] : c.value, brands);
    }
    options.push({ id, label, hint: Api.apiCopy.optionCount(o.count) });
  }
  if (!mandatory) options.push({ id: Api.SKIP_OPTION_ID, label: q.skipLabel });
  const kind: Api.Question['kind'] =
    q.key === 'sale_unit' ? 'unit' : q.source === 'compat' ? 'compat' : q.source === 'budget' ? 'budget' : 'attribute';
  const dto: Api.Question = { id: q.key, itemId: ri.item.id, kind, prompt: q.text, options, skippable: !mandatory };
  const why =
    q.ruleId && q.ruleId in Api.apiCopy.questionWhy
      ? Api.apiCopy.questionWhy[q.ruleId as keyof typeof Api.apiCopy.questionWhy]
      : q.source === 'budget'
        ? Api.apiCopy.questionWhy.budget
        : undefined;
  if (why) dto.why = why;
  return dto;
}

function derivedChips(
  ri: ResolvedItem,
  labelOf: (itemId: string) => string | undefined,
  brands: Map<string, string>,
  repairs: readonly DerivedConstraint[],
): Api.RequirementChip[] {
  return ri.item.constraints
    .filter((c) => c.source === 'compat' && c.op !== 'known')
    .map((c) => {
      const from = c.fromItemId ? labelOf(c.fromItemId) : undefined;
      let text = from ? inheritedConstraintText(c, from) : constraintText(c);
      if (c.op === 'contains' && c.attr === 'fits_models') {
        const v = attrDisplay('fits_models', [c.value], brands);
        text = from ? `${v} (از «${from}»)` : v;
      }
      // a guard repair follows another item's pick; the 12 V adapter rule is a general assumption: both say so
      if (isGuardConstraint(ri.item.id, c, repairs)) text = guardConstraintText(c, from);
      else if (c.ruleId === 'camera_adapter_12v') text = assumedConstraintText(c, from);
      const chip: Api.RequirementChip = { key: `derived:${c.attr}`, label: text, inherited: true };
      const dto = toConstraintDto(c);
      if (dto) chip.constraint = dto;
      return chip;
    });
}

function toConstraintDto(c: Constraint): Api.ConstraintDto | null {
  switch (c.op) {
    case 'eq':
      return { attr: c.attr, op: 'eq', value: c.value };
    case 'in':
      return { attr: c.attr, op: 'in', values: [...c.values] };
    case 'gte':
    case 'lte':
      return { attr: c.attr, op: c.op, value: c.value };
    case 'contains':
      return { attr: c.attr, op: 'contains', value: c.value };
    case 'known':
      return { attr: c.attr, op: 'known' };
  }
}

export function resolutionDto(catalog: Catalog, rs: ResolvedState, ri: ResolvedItem): Api.ItemResolution {
  const res = ri.result.resolution;
  const state = toWireState(res.state);
  const brands = brandLabels(ri.cands);
  const out: Api.ItemResolution = {
    itemId: ri.item.id,
    state,
    pendingQuestions: ri.result.question.question ? 1 : 0,
    label: res.label,
    detail: res.detail,
    categoryIds: ri.retrieval.categoryIds,
    kind: (ri.item.kind ?? 'other') as Api.ItemResolution['kind'],
    candidateCount: res.counts.candidates,
  };
  if (ri.retrieval.narrowedBy.length) out.searchTerms = ri.retrieval.narrowedBy;
  const chosen = res.chosenProductId !== undefined ? ri.byId.get(res.chosenProductId) : undefined;
  if (chosen) {
    out.product = productRef(chosen);
    const sellers = sellerInfo(chosen);
    out.sellerCount = sellers.count;
    out.sellerCountLabel = sellers.label;
    const ev = res.evaluations.find((e) => e.productId === chosen.product.id);
    out.unitPrice = ev?.minPrice ?? null;
  }
  if (res.counts.eligible > 0 || state === 'needs_info') out.eligibleCount = res.counts.eligible;
  const unit = itemSaleUnit(ri) ?? (state === 'exact' || state === 'no_price' ? saleUnitOf(chosen) : undefined);
  // unit guard: a price range across sale units is meaningless, so it is only given once the unit is fixed
  const unitFixed = ri.item.kind !== 'wire' || unit !== undefined;
  if (res.priceRange && unitFixed) {
    out.rangeLow = res.priceRange.min;
    out.rangeHigh = res.priceRange.max;
  }
  if (ri.item.kind === 'wire' && unit) {
    out.saleUnit = unit;
    out.unitLabel = Api.apiCopy.saleUnitLabel[unit];
  }
  if (res.rule) out.rule = PICK_RULE_TEXT[res.rule];
  if (state === 'alternative') out.differs = res.detail;
  if (state === 'needs_info' || state === 'no_price') out.reason = res.detail;
  if (state === 'not_found') {
    if (res.notFoundReason === 'no_candidates') {
      out.reason = Api.apiCopy.notFound(ri.dto.text);
      // real categories with evidence (else the biggest ones, labelled as such); picking one makes it a normal item
      const near = notFoundSuggestions(catalog, ri.dto.text);
      out.nearbyCategories = near.categories;
      out.nearbyCategoryIds = near.categoryIds;
      out.nearbyKind = near.kind;
      out.nearbyLabelFa = near.labelFa;
    } else out.reason = res.detail;
  }
  // two things the user fixed contradict each other: say so (nothing is changed for them, no question deepens it)
  const stated = rs.list.statedConflicts.find((f) => f.itemIds.includes(ri.item.id));
  if (stated) {
    const other = stated.itemIds.find((id) => id !== ri.item.id);
    out.conflictNote = compatCopy.statedConflict(stated.sentence, rs.items.find((x) => x.item.id === other)?.dto.text ?? '');
  }
  if (res.counts.incomplete > 0) out.incompleteSpecsCount = res.counts.incomplete;
  const q = questionDto(ri, brands);
  if (q) out.question = q;
  const labelOf = (id: string) => rs.items.find((x) => x.item.id === id)?.dto.text;
  const chips = derivedChips(ri, labelOf, brands, rs.repairs);
  if (chips.length) out.derivedChips = chips;
  out.chips = [...statedChips(ri, brands), ...chips];
  const firstCat = ri.retrieval.categoryIds[0];
  const catName = firstCat !== undefined ? catalog.categories().get(firstCat)?.name : undefined;
  if (catName) out.categoryLabel = catName;
  out.condition = ri.item.condition ?? 'new';
  if (res.conditionExcludedCount) {
    out.conditionExcludedCount = res.conditionExcludedCount;
    out.conditionNote = conditionExcludedNote(res.conditionExcludedCount);
  }
  const pf = chosen ? conditionFlags(chosen) : [];
  if (pf.length) out.productFlags = pf;
  // nothing eligible: say why, what can be lifted, and the nearest products (never picked on the user's behalf)
  const nm = chosen ? null : noMatchSummary(ri.item, res, 3, (c) => statedLabel(c, brands));
  if (nm) {
    const evById = new Map(res.evaluations.map((e) => [e.productId, e]));
    out.noMatch = {
      reasonFa: nm.reasonFa,
      relax: nm.relax,
      closest: nm.closestIds.map((id) => modelOptionDto(ri, evById.get(id)!, { brands })),
    };
    if (out.reason === undefined) out.reason = nm.reasonFa;
  }
  return out;
}

/** Listing condition flags of a candidate (title-stated). */
export function conditionFlags(c: MarketCandidate): Api.ConditionFlag[] {
  const out: Api.ConditionFlag[] = [];
  if (c.listing?.condition) out.push(c.listing.condition);
  if (c.listing?.replica) out.push('replica');
  return out;
}
const flagLabels = (f: readonly Api.ConditionFlag[]) => f.map((x) => CONDITION_FLAG_LABEL[x]);

/** Display label of a stated constraint (Persian brand names, readable device models). */
function statedLabel(c: Constraint, brands: Map<string, string>): string {
  if (c.op === 'eq' && typeof c.value !== 'boolean') return attrDisplay(c.attr, c.value, brands);
  if (c.op === 'contains' && c.attr === 'fits_models') return attrDisplay('fits_models', [c.value], brands);
  return constraintText(c);
}

/** Chips of what the user stated (constraints evaluated this call, minus compat-derived ones) plus the condition mode. */
function statedChips(ri: ResolvedItem, brands: Map<string, string>): Api.RequirementChip[] {
  const out: Api.RequirementChip[] = [];
  for (const c of ri.item.constraints) {
    if (c.source === 'compat') continue;
    const dto = toConstraintDto(c);
    const chip: Api.RequirementChip = { key: c.attr, label: statedLabel(c, brands) };
    if (dto) chip.constraint = dto;
    out.push(chip);
  }
  const mode: ConditionMode = ri.item.condition ?? 'new';
  if (mode !== 'new') out.push({ key: Api.CONDITION_ATTR, label: CONDITION_MODE_LABEL[mode], constraint: { attr: Api.CONDITION_ATTR, op: 'eq', value: mode } });
  return out;
}

/**
 * Item cards for a plan: every assigned item shows the product the plan actually buys (product, state, rule,
 * unit price = the price on its stop line, sellers). The planner may buy another eligible model than the overall
 * cheapest when it is the cheapest at a stop the plan uses (fewer stops / cheaper total); the card then says so.
 * Items without an assignment keep their resolution.
 */
export function planItemDtos(catalog: Catalog, rs: ResolvedState, plan: Plan | null): Api.ItemResolution[] {
  return rs.items.map((ri) => {
    const out = resolutionDto(catalog, rs, ri);
    const a = plan?.assignments.find((x) => x.itemId === ri.item.id);
    const cand = a ? ri.byId.get(a.productId) : undefined;
    if (!a || !cand) return out;
    out.product = productRef(cand);
    const sellers = sellerInfo(cand);
    out.sellerCount = sellers.count;
    out.sellerCountLabel = sellers.label;
    out.unitPrice = a.unitPrice;
    out.state = toWireState(a.state);
    const rule = a.rule ?? ri.result.resolution.rule;
    if (rule) out.rule = ASSIGNMENT_RULE_TEXT[rule];
    if (a.state === 'suggested' && rule) out.detail = suggestedDetail(ri.result.resolution.counts.eligible, ASSIGNMENT_RULE_TEXT[rule]);
    const pf = conditionFlags(cand);
    if (pf.length) out.productFlags = pf;
    else delete out.productFlags;
    return out;
  });
}

/** /api/resolve: the same item cards as /api/plan for the same state (the selected plan's products). */
export function resolveResponse(catalog: Catalog, rs: ResolvedState, plan: Plan | null = null): Api.ResolveResponse {
  const items = planItemDtos(catalog, rs, plan);
  return { items, pendingItemCount: items.filter((i) => i.state === 'needs_info').length };
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export interface PlanContext {
  now: Date;
  visit: Visit | undefined;
  visitActive: boolean;
  /** Day shown in hours texts (the visit day, else today). */
  displayDay: Weekday;
  dayLabel: string;
  /** Status shown on cards: at the visit time, else right now (display only, never a filter). */
  displayVisit: Visit;
}

export function planContext(state: WireState, now: Date): PlanContext {
  const visitActive = Api.isVisitActive(state.visit);
  const visit = Api.toEngineVisit(state.visit, now);
  const today = Api.tehranWeekday(now);
  const displayDay = visit?.day ?? today;
  const dayLabel = state.visit.day === 'today' || !visit ? Api.apiCopy.today : Api.WEEKDAY_FA[displayDay];
  const displayVisit: Visit = visit ?? { day: today, minute: Api.tehranMinute(now) };
  return { now, visit, visitActive, displayDay, dayLabel, displayVisit };
}

export interface PlannedState {
  rs: ResolvedState;
  ctx: PlanContext;
  result: PlanResult;
  selected: Plan | null;
  /** Plan inputs as given to the planner (qty in sale units, exclusions applied). */
  inputs: PlanItemInput[];
  overflowIds: Set<string>;
  compat: CompatFinding[];
  /** Products the compat findings were evaluated on (the selected plan's assignments, else the item cards' picks). */
  chosen: ChosenItem[];
  shops: Map<string, Shop>;
  /** Non-selected plans whose picks would hold an automatic-pick conflict (never offered as alternatives). */
  conflictingPlans?: Set<Plan>;
}

function planInputs(rs: ResolvedState, state: WireState): { inputs: PlanItemInput[]; overflow: Set<string> } {
  const base = buildPlanItems(
    rs.list.items,
    rs.items.map((ri) => ri.result.resolution),
    rs.candidatesByItem,
  );
  let plannable = 0;
  const overflow = new Set<string>();
  const inputs = base.map((pi, i) => {
    const ri = rs.items[i]!;
    const excluded = new Set(state.excludedShops[pi.itemId] ?? []);
    let offers = pi.offers.filter((o) => !excluded.has(o.shopId));
    const pinShop = state.shopPins[pi.itemId];
    if (pinShop) {
      const atPin = offers.filter((o) => o.shopId === pinShop);
      if (atPin.length) offers = atPin;
    }
    const qty = ri.item.kind === 'wire' ? saleQty(ri.dto, itemSaleUnit(ri) ?? saleUnitOf(ri.byId.get(pi.chosenProductId ?? -1))) : pi.qty;
    const hasPriced = offers.some((o) => o.price !== null) && pi.state !== 'needs_info' && pi.state !== 'not_found';
    if (hasPriced) {
      plannable++;
      if (plannable > MAX_PLAN_ITEMS) {
        overflow.add(pi.itemId);
        offers = [];
      }
    }
    return { ...pi, qty, offers };
  });
  return { inputs, overflow };
}

/**
 * The plan the variant asks for. `active` is the variant when it moved the plan away from the cheapest
 * plan at maximal coverage (the default without a stated preference), else null.
 */
function selectPlan(result: PlanResult, variant: string | null): { selected: Plan | null; active: string | null } {
  const cheapest = [...result.plans].sort((a, b) => a.totals.total - b.totals.total || a.stopCount - b.stopCount)[0] ?? null;
  if (!cheapest || !variant) return { selected: cheapest, active: null };
  let selected: Plan | undefined;
  if (variant === 'fewest') selected = [...result.plans].sort((a, b) => a.stopCount - b.stopCount || a.totals.total - b.totals.total)[0];
  const m = /^stops:(\d{1,2})$/.exec(variant);
  if (m) selected = result.plans.find((x) => x.stopCount === Number(m[1]));
  if (!selected) return { selected: cheapest, active: null };
  return { selected, active: selected === cheapest ? null : variant };
}

/** Rounds in which the compatibility guard may add repair constraints before it drops picks instead. */
const MAX_REPAIR_ROUNDS = 3;

const autoOf = (rs: ResolvedState) => {
  const byId = new Map(rs.items.map((ri) => [ri.item.id, ri.result.resolution]));
  return (itemId: string) => isAutoPick(byId.get(itemId));
};

/** Compat findings of one plan (its assignments, else each item card's pick). */
function planFindings(rs: ResolvedState, plan: Plan | null): { chosen: ChosenItem[]; compat: CompatFinding[] } {
  const chosen = chosenItemsForCompat(
    rs.list.items,
    rs.items.map((ri) => ri.result.resolution),
    rs.candidatesByItem,
    plan,
  );
  return { chosen, compat: evaluateCompat(chosen) };
}

function runPlan(rs: ResolvedState, state: WireState, ctx: PlanContext, shopsById: Map<string, Shop>) {
  const { inputs, overflow } = planInputs(rs, state);
  const shopIds = new Set(inputs.flatMap((i) => i.offers.map((o) => o.shopId)));
  const shops = [...shopIds].map((id) => shopsById.get(id)).filter((s): s is Shop => !!s);
  const exclusions = { shopIds: state.excludedShops['*'] ?? [] };
  // an explicit variant wins; otherwise the parser's request-level preference («کم‌توقف») picks the fewest stops
  const variant = state.variant ?? (state.preference === 'fewest_stops' ? 'fewest' : null);
  const preference = variant === 'fewest' ? 'fewest_stops' : 'cheapest';
  const input = { items: inputs, shops, exclusions, preference } as const;
  const result = planRun(ctx.visit ? { ...input, visit: ctx.visit } : input);
  const { selected, active } = selectPlan(result, variant);
  return { inputs, overflow, result, selected, active, ...planFindings(rs, selected) };
}

/**
 * Plan with the compatibility guard (PLAN B1.2): a 'conflict' finding never stands next to an automatic pick.
 * 1. replace: the rule's repair constraints (e.g. «XVR / DVR» for a recorder next to an HDCVI camera) are added and
 *    the list re-resolved, so the conflicting products become «جایگزین» with the reason and the next eligible
 *    product is picked (at most MAX_REPAIR_ROUNDS rounds);
 * 2. drop: a conflict the repairs could not remove takes the automatic pick out (the item needs the user's choice
 *    and is not counted), so a conflict never coexists with a complete total.
 * A conflict between products the user pinned or typed stays visible as such (their choice is never overridden).
 */
export function planState(catalog: Catalog, state: WireState, now: Date, rsIn?: ResolvedState): PlannedState & { activeVariant: string | null } {
  let rs = rsIn ?? resolveState(catalog, state);
  const ctx = planContext(state, now);
  const shopsById = catalog.shops();
  let run = runPlan(rs, state, ctx, shopsById);
  const maxRounds = MAX_REPAIR_ROUNDS + rs.items.length + 1;
  for (let round = 0; round < maxRounds; round++) {
    const isAuto = autoOf(rs);
    const conflicts = autoConflicts(run.compat, run.chosen, isAuto);
    if (conflicts.length === 0) break;
    const repairs = round < MAX_REPAIR_ROUNDS ? compatRepairs(run.compat, run.chosen, isAuto, rs.repairs) : [];
    if (repairs.length) {
      rs = resolvePrepared(rs.prepared, [...rs.repairs, ...repairs], rs.dropped);
    } else {
      const dropped = new Map(rs.dropped);
      for (const f of conflicts) {
        const culprit = conflictCulprit(f, run.chosen, isAuto);
        if (culprit !== undefined && !dropped.has(culprit)) dropped.set(culprit, f.sentence);
      }
      rs = resolvePrepared(rs.prepared, rs.repairs, dropped);
    }
    run = runPlan(rs, state, ctx, shopsById);
  }
  // non-selected plans are offered as alternatives only when they hold no automatic-pick conflict either
  const isAuto = autoOf(rs);
  const conflictingPlans = new Set(
    run.result.plans.filter((p) => {
      if (p === run.selected) return false;
      const pf = planFindings(rs, p);
      return autoConflicts(pf.compat, pf.chosen, isAuto).length > 0;
    }),
  );
  return {
    rs,
    ctx,
    result: run.result,
    selected: run.selected,
    inputs: run.inputs,
    overflowIds: run.overflow,
    compat: run.compat,
    chosen: run.chosen,
    shops: shopsById,
    activeVariant: run.active,
    conflictingPlans,
  };
}

const LEVEL: Readonly<Record<CompatFinding['status'], Api.CompatLevel>> = {
  listing_stated: 'stated',
  assumed: 'assumed',
  unknown: 'unknown',
  conflict: 'conflict',
};

/**
 * Compat lines of a plan. A 'conflict' the engine's picks did not cause (the guard leaves only those: every side
 * the user stated, answered or pinned) says it comes from the user's own choices; a finding whose general
 * assumption the user lifted says so in its status label.
 */
export function compatLines(findings: readonly CompatFinding[], autoConflicting: readonly CompatFinding[] = []): Api.CompatLine[] {
  return findings.map((f) => {
    const fromUser = f.status === 'conflict' && !autoConflicting.includes(f);
    const line: Api.CompatLine = {
      id: `${f.ruleId}:${f.itemIds.join(',')}`,
      level: LEVEL[f.status],
      text: fromUser ? compatCopy.fromUserChoice(f.sentence) : f.sentence,
      itemIds: f.itemIds,
      levelLabel: f.lifted ? COMPAT_LIFTED_LABEL : COMPAT_STATUS_LABEL[f.status],
      ruleId: f.ruleId,
    };
    if (f.askSeller) line.askSeller = f.askSeller;
    if (fromUser) line.fromUserChoice = true;
    if (f.lifted) line.assumptionLifted = true;
    return line;
  });
}

/**
 * «از فروشنده بپرس» lines for one item's seller: findings about that item (its listing is the subject,
 * itemIds[0]); the camera/recorder signal question is asked at both sellers.
 */
export function askSellerFor(lines: readonly Api.CompatLine[], itemId: string): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.level === 'stated' || !l.askSeller) continue;
    const mine = l.itemIds[0] === itemId || (l.ruleId === 'camera_recorder_signal' && l.itemIds.includes(itemId));
    if (mine && !out.includes(l.askSeller)) out.push(l.askSeller);
  }
  return out;
}

function openOf(shop: Shop, visit: Visit): OpenStatus {
  return openStatusAt(shop.hours, visit);
}

/** The least open status of a stop's shops: closed > unknown > open. */
function leastOpen(list: readonly OpenStatus[]): OpenStatus {
  if (list.includes('closed')) return 'closed';
  if (list.includes('unknown')) return 'unknown';
  return 'open';
}

function shopPlace(shop: Shop): { mall: string; floor?: string; unit?: string } {
  const out: { mall: string; floor?: string; unit?: string } = { mall: shop.mallName ?? shop.areaLabel ?? '' };
  const f = Api.apiCopy.floorLabel(shop.floor);
  const u = Api.apiCopy.unitLabel(shop.unit);
  if (f) out.floor = f;
  if (u) out.unit = u;
  return out;
}

export function planResponse(ps: PlannedState & { activeVariant: string | null }, state: WireState, catalog: Catalog): Api.PlanResponse {
  const { rs, ctx, result, selected } = ps;
  const shopsById = ps.shops;
  const lines = compatLines(ps.compat, autoConflicts(ps.compat, ps.chosen, autoOf(rs)));
  // a plan with a conflict (even one the user caused) or a lifted assumption never reads as a normal complete plan
  const hasConflict = lines.some((l) => l.level === 'conflict');
  const compatUnverified = lines.some((l) => l.assumptionLifted);
  const marker = hasConflict ? planCopy.markerConflict : compatUnverified ? planCopy.markerUnverified : undefined;
  const riById = new Map(rs.items.map((ri) => [ri.item.id, ri]));

  // ---- stops: one per building (planner stop); each lists its shop(s) with floor / unit and their lines ----
  const stops: Api.Stop[] = [];
  let shopTotal = 0;
  if (selected) {
    for (const st of selected.stops) {
      const shops: Api.StopShop[] = st.shops.map((ss) => {
        const shop = ss.shop;
        const assignments = selected.assignments.filter((a) => a.shopId === shop.id);
        const stopLines: Api.StopLine[] = assignments.map((a) => {
          const ri = riById.get(a.itemId)!;
          const cand = ri.byId.get(a.productId);
          const offer = cand?.offers.find((o) => o.id === a.offerId);
          const unit = ri.item.kind === 'wire' ? (itemSaleUnit(ri) ?? saleUnitOf(cand)) : undefined;
          const line: Api.StopLine = {
            itemId: a.itemId,
            qty: a.qty,
            state: toWireState(a.state),
            productName: cand?.product.title ?? '',
            listingTitle: offer?.sellerTitle || cand?.product.title || '',
            unitPrice: a.unitPrice,
            lineTotal: a.lineTotal,
            warranty: Api.apiCopy.warranty(offer?.warrantyCode, offer?.warrantyMonths),
            priceChangedAt: offer?.changedAt ?? '',
            shopId: shop.id,
            askSeller: askSellerFor(lines, a.itemId),
            productId: String(a.productId),
          };
          const code = cand ? displayModelCode(cand.product.title) : undefined;
          if (code) line.modelCode = code;
          if (unit) line.unitLabel = Api.apiCopy.saleUnitLabel[unit];
          const f = cand ? conditionFlags(cand) : [];
          if (f.length) {
            line.flags = f;
            line.flagLabels = flagLabels(f);
          }
          return line;
        });
        return {
          shopId: shop.id,
          shopName: shop.name,
          ...shopPlace(shop),
          address: shop.address ?? '',
          hoursText: Api.apiCopy.hoursText(shop.hours, ctx.displayDay, ctx.dayLabel),
          open: openOf(shop, ctx.displayVisit),
          lines: stopLines,
        };
      });
      const first = shops[0];
      if (!first) continue;
      shopTotal += shops.length;
      const stop: Api.Stop = {
        id: `stop-${st.buildingKey}`,
        index: st.order,
        mall: first.mall,
        shopId: first.shopId,
        shopName: first.shopName,
        address: first.address,
        hoursText: first.hoursText,
        open: leastOpen(shops.map((x) => x.open)),
        lines: shops.flatMap((x) => x.lines),
        buildingKey: st.buildingKey,
        buildingIndex: st.order,
        shops,
        shopCount: shops.length,
        subtotal: st.subtotal,
      };
      if (first.floor) stop.floor = first.floor;
      if (first.unit) stop.unit = first.unit;
      if (st.distanceToNextM !== null) stop.distanceToNext = Math.round(st.distanceToNextM);
      stops.push(stop);
    }
  }

  // ---- coverage ----
  const coverage = selected?.totals.coverage ?? result.coverage;
  const missingReasons = coverage.missingItems.map((m) => ({
    ...m,
    reason: (ps.overflowIds.has(m.itemId) ? 'stop_limit' : m.reason) as MissingReason,
  }));
  const missing = missingReasons.map((m) => ({ itemId: m.itemId, name: m.label, why: Api.apiCopy.missingWhy[m.reason] }));
  const unpriced: Api.UnpricedItem[] = coverage.unpricedItems.map((u) => {
    const seen = new Set<string>();
    const sellers: Api.UnpricedItem['sellers'] = [];
    for (const s of u.sellers) {
      if (seen.has(s.shopId)) continue;
      seen.add(s.shopId);
      const shop = shopsById.get(s.shopId);
      if (shop) sellers.push({ shopName: shop.name, ...shopPlace(shop) });
    }
    return { itemId: u.itemId, name: u.label, sellers };
  });

  // ---- alternatives ----
  const alternatives: Api.PlanAlternative[] = [];
  let noAlternativesReason: string | undefined;
  if (selected) {
    for (const p of result.plans) {
      if (p === selected || ps.conflictingPlans?.has(p)) continue;
      const dCost = p.totals.total - selected.totals.total;
      const dStops = p.stopCount - selected.stopCount;
      alternatives.push({
        id: `stops:${p.stopCount}`,
        label: dStops < 0 ? Api.apiCopy.altFewerStops : Api.apiCopy.altCheaper,
        description: planCopy.delta(dCost, dStops),
        deltaToman: dCost,
        deltaStops: dStops,
      });
    }
    if (alternatives.length === 0) {
      noAlternativesReason = result.notes.find((n) => n.code === 'only_one' || n.code === 'only_one_single_source')?.text ?? planCopy.onlyOne();
    }
  }

  // ---- shops closed at the visit time that the plan would otherwise use ----
  const closedNotes: Api.ReplacedStopNote[] = [];
  if (ctx.visit && selected) {
    const open = planRun({ items: ps.inputs, shops: [...new Set(ps.inputs.flatMap((i) => i.offers.map((o) => o.shopId)))].map((id) => shopsById.get(id)).filter((s): s is Shop => !!s), exclusions: { shopIds: state.excludedShops['*'] ?? [] } });
    const base = open.plans.find((p) => p.id === open.defaultPlanId);
    if (base) {
      const used = new Set(selected.assignments.map((a) => a.shopId));
      const sameCoverage = base.totals.coverage.coveredCount === selected.totals.coverage.coveredCount;
      const extra = sameCoverage ? selected.totals.total - base.totals.total : 0;
      const dropped = [...new Set(base.assignments.map((a) => a.shopId))].filter(
        (id) => !used.has(id) && result.closedShopIds.includes(id),
      );
      dropped.forEach((id, i) => closedNotes.push({ text: Api.apiCopy.closedNote(shopsById.get(id)?.name ?? '', i === 0 ? extra : 0) }));
    }
  }

  let reason = selected?.reasons[0]?.text ?? result.notes.find((n) => n.code === 'nothing_plannable')?.text ?? planCopy.nothingPlannable();
  // no superlative («ارزان‌ترین / کم‌توقف‌ترین ترکیب») next to a conflict or an unverified pairing
  if (marker && selected) {
    reason = selected.totals.coverage.complete
      ? planCopy.flagged(selected.totals.coverage.totalCount, stops.length, marker)
      : `${planCopy.partial(selected.totals.coverage.coveredCount, selected.totals.coverage.totalCount, stops.length)} ${marker}.`;
  }
  const out: Api.PlanResponse = {
    title: '',
    coverage: { covered: coverage.coveredCount, total: coverage.totalCount, missing },
    totalToman: selected?.totals.total ?? 0,
    usesSuggestions: coverage.usesSuggestions || coverage.usesAlternatives,
    complete: !!selected && coverage.complete,
    reason,
    stopCount: stops.length,
    stops,
    unpriced,
    compat: lines,
    alternatives,
    activeVariant: ps.activeVariant,
    visitActive: ctx.visitActive,
    closedNotes,
    orderNote: result.orderNote,
    // the cards show what the plan buys (same product, state, rule and price as the stop lines)
    items: planItemDtos(catalog, rs, selected),
    shopCount: shopTotal,
    hasConflict,
  };
  if (compatUnverified) out.compatUnverified = true;
  if (marker) out.totalMarker = marker;
  if (noAlternativesReason) out.noAlternativesReason = noAlternativesReason;
  if (selected) {
    out.totalLine = marker ? planCopy.withMarker(selected.totals.line, marker) : selected.totals.line;
    // grouped by reason («پیدا نشد» / «منتظر انتخاب» / «قیمت ثبت نشده» …), with the adapter's stop-limit overrides
    if (missingReasons.length) out.missingLine = planCopy.missingLines(missingReasons);
    if (selected.totals.suggestionNote) out.suggestionNote = selected.totals.suggestionNote;
  }
  return out;
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

/**
 * Options list caps per group: matching models first, then a few incomplete and differing ones. Listings that
 * differ ONLY by their condition (used / refurbished / copy) have their own group, so they stay visible (flagged).
 */
const MODEL_CAPS = { eligible: 40, incomplete: 10, differs: 10, condition: 20 } as const;
type CapGroup = keyof typeof MODEL_CAPS;
function capGroup(e: CandidateEval): CapGroup {
  if (e.fit === 'differs' && e.conditionIssue && e.failed.length === 0 && e.withinBudget !== false) return 'condition';
  return e.fit;
}

function specsOf(c: MarketCandidate, brands: Map<string, string>): string[] {
  const out: string[] = [];
  const put = (attrs: ProductAttrs, fromSpec: boolean) => {
    for (const k of ATTR_KEYS) {
      const v = attrs[k] as AttrValue | undefined;
      if (v === undefined || k === 'length_m') continue;
      const text = attrDisplay(k, v, brands);
      out.push(fromSpec ? Api.apiCopy.specSourced(text) : text);
    }
  };
  put(c.attrs, false);
  put(c.specAttrs, true);
  for (const f of conditionFlags(c)) out.push(CONDITION_FLAG_LABEL[f]);
  return out;
}

function priceSpan(c: MarketCandidate): { low: number; high: number } {
  const prices = c.offers.filter(isPricedOffer).map((o) => o.price);
  return prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : { low: 0, high: 0 };
}

/** One model of an item's options list (also the `noMatch.closest` entries, which have no current pick). */
function modelOptionDto(
  ri: ResolvedItem,
  e: CandidateEval,
  cur: { brands: Map<string, string>; currentId?: number | undefined; curEval?: CandidateEval | undefined; curUnit?: Api.SaleUnitDto | undefined },
): Api.ModelOption {
  const c = ri.byId.get(e.productId)!;
  const span = priceSpan(c);
  const sellers = sellerInfo(c);
  const isCurrent = e.productId === cur.currentId;
  const parts: string[] = [];
  // unit guard: never a price delta across sale units
  const comparable = ri.item.kind !== 'wire' || (cur.curUnit !== undefined && saleUnitOf(c) === cur.curUnit);
  const curPrice = cur.curEval?.minPrice;
  if (!isCurrent && comparable && e.minPrice !== null && curPrice != null && e.minPrice !== curPrice) {
    parts.push(Api.apiCopy.priceDelta(e.minPrice - curPrice));
  }
  if (e.minPrice === null) parts.push(Api.apiCopy.noPrice);
  if (e.fit === 'incomplete') parts.push(INCOMPLETE_SPECS_LABEL);
  if (e.fit === 'incomplete') for (const i of c.issues ?? []) if (i.fit === 'incomplete') parts.push(i.text);
  // an incomplete listing says which required detail it lacks (e.g. the voltage a compat rule needs)
  if (e.fit === 'incomplete') for (const u of e.unknown) parts.push(describeConstraintEval(u));
  const m: Api.ModelOption = {
    productId: String(e.productId),
    name: c.product.title,
    specs: specsOf(c, cur.brands),
    priceLow: span.low,
    priceHigh: span.high,
    sellerCount: sellers.count,
    sellerCountLabel: sellers.label,
    current: isCurrent,
    fit: e.fit,
  };
  const code = displayModelCode(c.product.title);
  if (code) m.modelCode = code;
  if (!isCurrent && parts.length) m.diffLabel = parts.join('، ');
  if (e.fit === 'differs' && e.differences.length) m.conflict = Api.apiCopy.joinFa(e.differences);
  const u = ri.item.kind === 'wire' ? saleUnitOf(c) : undefined;
  if (u) m.unitLabel = Api.apiCopy.saleUnitLabel[u];
  const f = conditionFlags(c);
  if (f.length) {
    m.flags = f;
    m.flagLabels = flagLabels(f);
  }
  return m;
}

export function optionsResponse(ps: PlannedState, itemId: string, productId: string | undefined): Api.OptionsResponse | null {
  const ri = ps.rs.items.find((x) => x.item.id === itemId);
  if (!ri) return null;
  const res = ri.result.resolution;
  const brands = brandLabels(ri.cands);
  const assignment = ps.selected?.assignments.find((a) => a.itemId === itemId);
  const currentId = assignment?.productId ?? res.chosenProductId;
  const current = currentId !== undefined ? ri.byId.get(currentId) : undefined;
  const curEval = res.evaluations.find((e) => e.productId === currentId);
  const curUnit = saleUnitOf(current);

  const evals: CandidateEval[] = res.evaluations;
  const taken: Record<CapGroup, number> = { eligible: 0, incomplete: 0, differs: 0, condition: 0 };
  const shown = evals.filter((e) => {
    const g = capGroup(e);
    return e.productId === currentId || taken[g]++ < MODEL_CAPS[g];
  });
  const models: Api.ModelOption[] = shown.map((e) => modelOptionDto(ri, e, { brands, currentId, curEval, curUnit }));

  // sellers of the requested product, else of the current one
  const pid = productId && /^\d{1,12}$/.test(productId) ? Number(productId) : currentId;
  const target = pid !== undefined ? ri.byId.get(pid) : undefined;
  const planShops = (ps.selected?.stops ?? []).filter((s) => hasCoords(s));
  const sellers: Api.SellerOption[] = [];
  if (target) {
    const unit = ri.item.kind === 'wire' ? saleUnitOf(target) : undefined;
    for (const o of target.offers) {
      const shop = ps.shops.get(o.shopId);
      if (!shop) continue;
      const others = planShops.filter((s) => s.buildingKey !== shop.buildingKey);
      const s: Api.SellerOption = {
        shopId: shop.id,
        shopName: shop.name,
        ...shopPlace(shop),
        listingTitle: o.sellerTitle || target.product.title,
        price: isPricedOffer(o) ? o.price : null,
        warranty: Api.apiCopy.warranty(o.warrantyCode, o.warrantyMonths),
        hoursText: Api.apiCopy.hoursText(shop.hours, ps.ctx.displayDay, ps.ctx.dayLabel),
        open: openOf(shop, ps.ctx.displayVisit),
        current: !!assignment && assignment.shopId === shop.id && assignment.productId === target.product.id,
        productId: String(target.product.id),
      };
      if (hasCoords(shop) && others.length) {
        const d = Math.min(...others.map((st) => haversineM(shop, st as { lat: number; lon: number })));
        s.distanceNote = Api.apiCopy.distanceToPlan(d);
      }
      if (unit) s.unitLabel = Api.apiCopy.saleUnitLabel[unit];
      if (o.priceFlag === 'unit_mismatch') s.priceNote = plausibilityCopy.offerUnitMismatch;
      sellers.push(s);
    }
    sellers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || (a.shopId < b.shopId ? -1 : 1));
  }
  // one pool for the card and the list: `modelTotal` is the number the item card states («۷ مدل»: the eligible
  // models, or every candidate when none is eligible), never the whole category behind it
  const eligibleCount = res.counts.eligible;
  const modelTotal = eligibleCount > 0 ? eligibleCount : evals.length;
  return {
    models,
    sellers,
    onlyOneSeller: sellers.length === 1,
    modelTotal,
    eligibleCount,
    poolLabel: Api.apiCopy.optionsPool(eligibleCount, evals.length),
  };
}
