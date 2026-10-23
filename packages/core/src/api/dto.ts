/**
 * Wire DTOs for the decision API (POST /api/parse, /api/resolve, /api/options, /api/plan, /api/places; GET /api/meta).
 * This file is the ONE definition of the request/response contract; apps/web/src/api/types.ts re-exports it.
 *
 * Shapes are extended ADDITIVELY (new fields optional, old names kept), so older clients keep working.
 * Responses travel inside the server envelope `{ data: T }`.
 *
 * Statelessness: every call carries the whole RequirementState. The server derives compat constraints
 * afresh on every call (stripDerived + applyDerivedConstraints); nothing is stored server-side.
 *
 * Parse -> resolve: the items /api/parse returns are valid requirement items. Put them verbatim into
 * `state.requirements` (every other state field is optional) and add answers / pins / preferences as the user
 * acts. Chips are a UI concern: the server derives them for the response (`ItemResolution.chips`).
 *
 * Request schemas are strict about sizes (public endpoint) but tolerant about semantics: an answer or a chip
 * constraint the server cannot decode is ignored, never an error (an older saved plan must still open).
 */
import { z } from 'zod';
import {
  ATTR_KEYS,
  CONDITION_MODES,
  type AttrKey,
  type Budget,
  type ConditionMode,
  type Requirement as EngineRequirement,
} from '../types/index';

// ---------------------------------------------------------------------------
// limits
// ---------------------------------------------------------------------------

export const API_LIMITS = {
  maxItems: 12,
  maxChips: 12,
  /** Item text; the parser accepts 500 characters per request, so one item can be that long. */
  maxTextLen: 500,
  maxIdLen: 64,
  maxExcludedPerItem: 50,
  maxAnswersPerItem: 16,
  maxConstraints: 24,
} as const;

const id = z.string().min(1).max(API_LIMITS.maxIdLen);
const shortText = (max: number) => z.string().max(max);
const boundedRecord = <V extends z.ZodType>(value: V, maxKeys: number) =>
  z.record(id, value).refine((o) => Object.keys(o).length <= maxKeys, { message: 'too many keys' });

// ---------------------------------------------------------------------------
// requirement state (client-owned, sent whole on every call)
// ---------------------------------------------------------------------------

const attrKey = z.enum(ATTR_KEYS as unknown as [AttrKey, ...AttrKey[]]);
const scalar = z.union([z.string().max(80), z.number().finite(), z.boolean()]);

/**
 * Optional provenance carried by parser constraints (engine `Constraint` shape). The server treats every stated
 * constraint as the user's; `source: 'compat'` constraints are ignored (the server re-derives them every call).
 */
const constraintMeta = {
  source: z.enum(['user', 'answer', 'compat']).optional(),
  ruleId: z.string().max(40).optional(),
  fromItemId: id.optional(),
};

/** A stated constraint (the server treats it as source 'user'). Same shape as the engine `Constraint`. */
export const ConstraintDtoSchema = z.discriminatedUnion('op', [
  z.object({ attr: attrKey, op: z.literal('eq'), value: scalar, ...constraintMeta }),
  z.object({
    attr: attrKey,
    op: z.literal('in'),
    values: z.array(z.union([z.string().max(80), z.number().finite()])).min(1).max(20).readonly(),
    ...constraintMeta,
  }),
  // one member for both bounds, exactly like the engine Constraint (so a ParsedItem type-checks as an input)
  z.object({ attr: attrKey, op: z.enum(['gte', 'lte']), value: z.number().finite(), ...constraintMeta }),
  z.object({ attr: attrKey, op: z.literal('contains'), value: z.string().min(1).max(80), ...constraintMeta }),
  z.object({ attr: attrKey, op: z.literal('known'), ...constraintMeta }),
]);
export type ConstraintDto = z.infer<typeof ConstraintDtoSchema>;

/**
 * Accepted listing conditions (engine ConditionMode): 'new' (default: used / refurbished / replica listings are
 * never auto-picked), 'any', 'used' («موبایل استوک»), 'replica' («ایرپاد کپی»).
 */
export const CONDITION_ATTR = 'condition' as const;
export const ConditionModeSchema = z.enum(CONDITION_MODES as unknown as [ConditionMode, ...ConditionMode[]]);
/** The listing-condition pseudo-constraint `{ attr: 'condition', op: 'eq', value }` (chip, parser constraint or answer). */
export const ConditionConstraintSchema = z.object({
  attr: z.literal(CONDITION_ATTR),
  op: z.literal('eq'),
  value: ConditionModeSchema,
  ...constraintMeta,
});
export type ConditionConstraintDto = z.infer<typeof ConditionConstraintSchema>;

/** Any constraint a chip, a parser item or an answer can carry. */
export const StatedConstraintSchema = z.union([ConstraintDtoSchema, ConditionConstraintSchema]);
export type StatedConstraintDto = z.infer<typeof StatedConstraintSchema>;

export const RequirementChipSchema = z.object({
  key: shortText(40),
  label: shortText(120),
  /** Inherited from another item (e.g. phone model on a case). Display only: the server re-derives it. */
  inherited: z.boolean().optional(),
  /** Machine meaning of the chip. Detaching the chip removes the constraint. Chips without one are display-only. */
  constraint: StatedConstraintSchema.optional(),
});
export type RequirementChip = z.infer<typeof RequirementChipSchema>;

export const ITEM_KINDS = ['camera', 'recorder', 'hdd', 'adapter', 'phone', 'phone_case', 'screen_protector', 'wire', 'other'] as const;

export const BudgetSchema = z.object({ min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional() });

const ParseNoteSchema = z.object({
  code: shortText(40),
  messageFa: shortText(400),
  fragment: shortText(API_LIMITS.maxTextLen).optional(),
  itemId: id.optional(),
});
const CategoryCandidateSchema = z.object({ id: z.number().int().nonnegative(), name: shortText(200), score: z.number().finite() });

/**
 * One requirement item. Accepts BOTH shapes (and any mix):
 * - a /api/parse item verbatim (`ParsedItem`: `constraints`, `rawText`, `inherited`, `domain`, `notes`…; no chips);
 * - the UI's chip form (`chips` with constraints, `categoryId`, `categoryLabel`).
 * Precedence: when `constraints` is present it is authoritative and `chips` are display only; otherwise the
 * chips' constraints are used. Parser metadata the engine does not need is accepted and ignored.
 */
export const RequirementSchema = z.object({
  id,
  /** The user's text for this item, as typed (Persian). */
  text: shortText(API_LIMITS.maxTextLen),
  qty: z.number().int().min(1).max(100_000),
  /** Unit of `qty` when it is not a piece count. «متر» = metres (wire), «حلقه» = rolls. */
  unit: shortText(20).optional(),
  /** Category id in the dataset (stringified integer); null when nothing matched. */
  categoryId: shortText(40).nullable().default(null),
  categoryLabel: shortText(120).default(''),
  chips: z.array(RequirementChipSchema).max(API_LIMITS.maxChips).default(() => []),
  /** A model code typed by the user (Latin run). */
  modelCode: shortText(40).optional(),
  // ---- machine-readable (from /api/parse) ----
  /** Dataset category ids. Authoritative when present; otherwise `categoryId` is used; empty = server votes. */
  categoryIds: z.array(z.number().int().nonnegative()).max(8).optional(),
  /** Role in compat rules. The server recomputes it from the categories when it can. */
  kind: z.enum(ITEM_KINDS).optional(),
  /**
   * True when the quantity was written by the user (compat rules derive only from stated values).
   * Absent: true for chip-form items (legacy), false for parser items (the parser sets it when stated).
   */
  qtyStated: z.boolean().optional(),
  /** Per-unit price band (toman), as stated by the user. */
  budget: BudgetSchema.optional(),
  /** Parser constraints (engine `Constraint` shape). Authoritative over chips when present. */
  constraints: z.array(StatedConstraintSchema).max(API_LIMITS.maxConstraints).optional(),
  /** Accepted listing conditions; absent = 'new' (used / refurbished / replica listings are never auto-picked). */
  condition: ConditionModeSchema.optional(),
  /** Constraints the parser copied from a sibling item (the server re-derives the ones a compat rule covers). */
  inherited: z.array(z.object({ attr: attrKey, fromItemId: id })).max(8).optional(),
  // ---- parser metadata: accepted, not used by the decision engine ----
  rawText: shortText(API_LIMITS.maxTextLen).optional(),
  confidence: z.number().finite().optional(),
  categoryCandidates: z.array(CategoryCandidateSchema).max(8).optional(),
  notes: z.array(ParseNoteSchema).max(20).optional(),
  domain: shortText(40).optional(),
  ignoredAttrs: z.array(shortText(40)).max(30).optional(),
});
/** Requirement as the server sees it after validation (defaults applied). */
export type Requirement = z.infer<typeof RequirementSchema>;
/** What a client may send: a /api/parse item verbatim, or the chip form. */
export type RequirementInput = z.input<typeof RequirementSchema>;

export const VisitTimeSchema = z.object({
  day: z.enum(['today', 'tomorrow', 'date']),
  /** ISO date (YYYY-MM-DD) when day === 'date'. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  window: z.enum(['any', 'morning', 'noon', 'evening', 'exact']),
  /** 'HH:MM' (24h) when window === 'exact'. */
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export type VisitTime = z.infer<typeof VisitTimeSchema>;
export type VisitDay = VisitTime['day'];
export type VisitWindow = VisitTime['window'];

/** null = default (cheapest at maximal coverage); 'fewest' or 'stops:N' pick another non-dominated option. */
export type PlanVariant = string | null;

export const RequirementStateSchema = z.object({
  requirements: z.array(RequirementSchema).max(API_LIMITS.maxItems),
  /**
   * answers[itemId][questionId] = optionId. questionId = the question key (attribute, 'budget' or 'condition');
   * optionId = an encoded option (see answers.ts) or 'any' for «فرقی نمی‌کند».
   */
  answers: boundedRecord(boundedRecord(shortText(200), API_LIMITS.maxAnswersPerItem), API_LIMITS.maxItems).default(() => ({})),
  /** Items resolved by the visible default rule («کافیه، پیشنهاد بده»). */
  settled: boundedRecord(z.boolean(), API_LIMITS.maxItems).default(() => ({})),
  /** Product id (stringified) the user picked: makes the item «مدل مشخص». */
  pins: boundedRecord(shortText(20), API_LIMITS.maxItems).default(() => ({})),
  /** Seller (shop id) the user picked for an item. */
  shopPins: boundedRecord(shortText(API_LIMITS.maxIdLen), API_LIMITS.maxItems).default(() => ({})),
  /** Shops excluded for an item (key '*' = for every item). */
  excludedShops: boundedRecord(z.array(shortText(API_LIMITS.maxIdLen)).max(API_LIMITS.maxExcludedPerItem), API_LIMITS.maxItems + 1).default(
    () => ({}),
  ),
  variant: shortText(20).nullable().default(null),
  visit: VisitTimeSchema.default(() => ({ day: 'today' as const, window: 'any' as const })),
  /** Request-level preference from /api/parse: 'fewest_stops' selects the fewest-stops plan while `variant` is null. */
  preference: z.enum(['cheapest', 'fewest_stops']).optional(),
});
export type RequirementState = z.infer<typeof RequirementStateSchema>;
/** What a client may send (every map optional; parser items verbatim). */
export type RequirementStateInput = z.input<typeof RequirementStateSchema>;

export const ResolveRequestSchema = z.object({ state: RequirementStateSchema });
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;
export type ResolveRequestInput = z.input<typeof ResolveRequestSchema>;
export const PlanRequestSchema = z.object({ state: RequirementStateSchema });
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type PlanRequestInput = z.input<typeof PlanRequestSchema>;
export const OptionsRequestSchema = z.object({
  state: RequirementStateSchema,
  itemId: id,
  /** Sellers of this product instead of the item's current one (stringified product id). */
  productId: shortText(20).optional(),
});
export type OptionsRequest = z.infer<typeof OptionsRequestSchema>;
export type OptionsRequestInput = z.input<typeof OptionsRequestSchema>;

// ---------------------------------------------------------------------------
// parse (server parser output; every item is a valid RequirementInput)
// ---------------------------------------------------------------------------

export interface ParseRequest {
  text: string;
}

export type ParseNoteCode =
  /** No category in the supported catalog matches the item. The item is kept, never dropped. */
  | 'not_in_catalog'
  /** The database is unavailable, so categories could not be looked up. */
  | 'catalog_unavailable'
  /** Words of the item that were not understood as a category, brand, quantity, spec or budget. */
  | 'unparsed_fragment'
  /** Two or more categories scored close to each other. */
  | 'ambiguous_category'
  /** A model code was typed but no product in the catalog carries it. */
  | 'unknown_model_code'
  /** A constraint (phone model) was inherited from another item. */
  | 'inherited_model'
  /** The quantity was given in metres (wire): qty is a length, not a piece count. */
  | 'qty_in_meters'
  /** A budget with no item to attach it to (several items, or a total). */
  | 'unassigned_budget'
  | 'conflicting_preferences'
  | 'too_many_items';

export interface ParseNote {
  code: ParseNoteCode;
  /** Persian, fixed template text (never interpolates user text). */
  messageFa: string;
  /** User-written fragment the note is about (verbatim; may contain any script). */
  fragment?: string;
  itemId?: string;
}

export interface CategoryCandidate {
  id: number;
  name: string;
  /** 0..1: blend of the synonym table and the FTS category vote. */
  score: number;
}

/** A constraint taken over from another item, so the UI can show an editable chip. */
export interface InheritedAttr {
  attr: AttrKey;
  fromItemId: string;
}

/**
 * One /api/parse item: the engine Requirement plus parser metadata. Send it to /api/resolve, /api/plan and
 * /api/options unchanged inside `state.requirements` (it is a valid `RequirementInput`).
 * `condition` is set when the text asks for used («استوک / کارکرده / دست دوم») or copy («کپی») listings.
 */
export interface ParsedItem extends EngineRequirement {
  /** The item's words exactly as typed (qty/budget/preference phrases included). */
  rawText: string;
  /** 0..1 heuristic: category score, margin, stated specs, leftovers. NOT a probability. */
  confidence: number;
  /** Up to 3 in-catalog category candidates, best first. `categoryIds` is the accepted subset. */
  categoryCandidates: CategoryCandidate[];
  notes: ParseNote[];
  inherited?: InheritedAttr[];
  /** Extraction domain ('wire', 'charger'...) when the category has one; undefined on the generic path. */
  domain?: string;
  /** Unit of `qty` when it is not a piece count, e.g. «متر». */
  unit?: string;
  /** Extractor keys that were understood but have no closed-schema attribute (wifi, solar...). */
  ignoredAttrs?: string[];
}

export type ParsePreference = 'cheapest' | 'fewest_stops';

export interface ParseResponse {
  /** Auto-named project title (Persian). */
  title: string;
  items: ParsedItem[];
  preference?: ParsePreference;
  /** A budget for the whole request that could not be split per item. */
  totalBudget?: Budget;
  /** Global notes plus the item-level `unparsed_fragment` notes. */
  notes: ParseNote[];
  /** Which path produced `items`. */
  source: 'deterministic' | 'refined';
  /** A refiner is configured but its result was not used (timeout, error or invalid output). */
  degraded?: boolean;
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/** Wire item state (UI vocabulary). exact = engine exact_model, no_price = engine price_unknown. */
export type ItemState = 'exact' | 'suggested' | 'alternative' | 'needs_info' | 'not_found' | 'no_price';

export interface QuestionOption {
  id: string;
  label: string;
  hint?: string;
}

export interface Question {
  /** The question key (attribute or 'budget'); answers are stored under it. */
  id: string;
  itemId: string;
  kind: 'compat' | 'attribute' | 'unit' | 'budget';
  prompt: string;
  options: QuestionOption[];
  why?: string;
  /** false for the sale-unit question: it has no «فرقی نمی‌کند» option and «کافیه» does not end it. */
  skippable?: boolean;
}

export interface ProductRef {
  id: string;
  /** Listing title (may contain Latin runs). */
  name: string;
  modelCode?: string;
  /** First product image from the dataset (additive). */
  imageUrl?: string;
}

export type SaleUnitDto = 'roll' | 'meter';

/** Listing condition flag of a product, read from its title («طبق عنوان آگهی»). */
export type ConditionFlag = 'used' | 'refurbished' | 'replica';

export interface ItemResolution {
  itemId: string;
  state: ItemState;
  product?: ProductRef;
  eligibleCount?: number;
  /** Cleaned price range of the eligible pool, per unit. Omitted when prices are in different sale units. */
  rangeLow?: number;
  rangeHigh?: number;
  /**
   * Sellers of `product`: shops with a usable price for it; when it has no usable price at all, the shops that list
   * it. `sellerCountLabel` says which («۳ فروشنده با قیمت» / «۲ فروشنده، بدون قیمت»).
   */
  sellerCount?: number;
  sellerCountLabel?: string;
  /** Visible pick rule, e.g. «ارزان‌ترین مطابق خواسته». */
  rule?: string;
  differs?: string;
  /** Sale-unit label, e.g. «حلقهٔ ۱۰۰ متری» / «قیمت هر متر». */
  unitLabel?: string;
  unitPrice?: number | null;
  question?: Question;
  pendingQuestions: number;
  reason?: string;
  nearbyCategories?: string[];
  /**
   * What `nearbyCategories` is. 'related': categories that share a real word with the request;
   * 'popular': no evidence of anything close, so the catalog's biggest real categories (never a guess about the request).
   */
  nearbyKind?: 'related' | 'popular';
  /** Persian heading for `nearbyCategories` («چیزهایی که در این فهرست دارم» when 'popular'). */
  nearbyLabelFa?: string;
  /**
   * Dataset ids of `nearbyCategories` (same order). An item the parser judged absent («پیدا نشد») is terminal: it is
   * never searched by raw text, asked about or picked. It becomes a normal item only when the user picks one of these
   * categories: send the item again with `categoryIds: [id]`.
   */
  nearbyCategoryIds?: number[];
  incompleteSpecsCount?: number;
  // ---- additive ----
  /** Engine detail line (Persian), e.g. «یکی از ۱۵۴ مدل مطابق خواسته · ارزان‌ترین مطابق خواسته». */
  detail?: string;
  /** Persian state label from the engine copy. */
  label?: string;
  /** Constraints derived from sibling items this call (shown as inherited chips). */
  derivedChips?: RequirementChip[];
  /**
   * Every chip of the item, derived by the server from what it evaluated: stated constraints (parser
   * `constraints` or chip constraints, answers), the condition mode, then inherited/derived ones (inherited: true).
   * Detaching one = removing that constraint from the item (or its answer).
   */
  chips?: RequirementChip[];
  /** Name of the item's first searched category. */
  categoryLabel?: string;
  saleUnit?: SaleUnitDto;
  /** Categories the server searched (ids) and the resolved compat role. */
  categoryIds?: number[];
  kind?: (typeof ITEM_KINDS)[number];
  /** Every product considered for the item (eligible + incomplete + differing). */
  candidateCount?: number;
  /** Words of the item text that narrowed the search inside the categories (FTS); absent = whole categories. */
  searchTerms?: string[];
  /** Accepted listing conditions used for this item ('new' unless the user asked otherwise). */
  condition?: ConditionMode;
  /** Listings that matched everything but were kept out of the automatic pick because they are used / refurbished / copies. */
  conditionExcludedCount?: number;
  /** Persian note for `conditionExcludedCount`. */
  conditionNote?: string;
  /** Flags of the item's product (only when the user pinned a flagged product or asked for that condition). */
  productFlags?: ConditionFlag[];
  /**
   * Two things the user fixed contradict each other under a compat rule (e.g. «دوربین تحت شبکه» typed next to
   * «دی وی آر»). Persian; nothing is changed on the user's behalf and no question that deepens it is asked.
   */
  conflictNote?: string;
  /**
   * Non-blocking compat note (Persian), e.g. on an adapter next to several cameras when the user did not write how
   * many adapters: «تعداد آداپتور را ننوشتی؛ ۱ عدد برای ۴ دوربین در نظر گرفته شد…». Never a question.
   */
  compatNote?: string;
  /**
   * Present when the item has candidates but none meets every requirement (state 'alternative', or 'needs_info' with
   * nothing pickable). Nothing is picked on the user's behalf in that state; `product` stays absent.
   */
  noMatch?: NoMatch;
}

/** Why nothing matched, what the user can lift, and the nearest products (requirement/nomatch.ts). */
export interface NoMatch {
  /** One Persian sentence, numbers from the data, e.g. «هیچ مدلی با بودجهٔ ۵۰ میلیون پیدا نشد؛ ارزان‌ترین مدل ۱۰۰٫۶ میلیون تومان است». */
  reasonFa: string;
  /**
   * Stated conditions the user can lift, strongest first (most products let through alone). `attr` is an
   * AssistRelaxableAttr: an attribute key the user stated, 'budget' or 'condition' (send as relax_constraint).
   */
  relax: { attr: string; label: string }[];
  /** Up to 3 nearest products (fit 'differs' / 'incomplete', with `conflict` / `diffLabel` and flags). */
  closest: ModelOption[];
}

export interface ResolveResponse {
  items: ItemResolution[];
  pendingItemCount: number;
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

export interface ModelOption {
  productId: string;
  name: string;
  modelCode?: string;
  specs: string[];
  /** 0 = no usable price (the UI shows «قیمت ثبت نشده»). */
  priceLow: number;
  priceHigh: number;
  /** Shops with a usable price for the model (shops that list it when none has a price); see `sellerCountLabel`. */
  sellerCount: number;
  sellerCountLabel?: string;
  diffLabel?: string;
  current: boolean;
  /** Listing-stated conflict / differing spec: excluded by default; the reason is shown. */
  conflict?: string;
  // ---- additive ----
  fit?: 'eligible' | 'incomplete' | 'differs';
  unitLabel?: string;
  /** Listing condition flags («کارکرده»، «ریفربیش»، «کپی») read from the title. */
  flags?: ConditionFlag[];
  /** Persian labels of `flags` (core copy CONDITION_FLAG_LABEL). */
  flagLabels?: string[];
  /** First product image from the dataset (additive). */
  imageUrl?: string;
}

export interface SellerOption {
  shopId: string;
  shopName: string;
  mall: string;
  floor?: string;
  unit?: string;
  listingTitle: string;
  price: number | null;
  warranty: string;
  hoursText: string;
  open: 'open' | 'closed' | 'unknown';
  distanceNote?: string;
  current: boolean;
  // ---- additive ----
  productId?: string;
  unitLabel?: string;
  /** Why this seller's price is not used (e.g. it contradicts the listing's sale unit); `price` is then null. */
  priceNote?: string;
  /**
   * Condition flags of THIS seller's listing (product flags plus what the seller's own listing title states), set
   * only when the seller's own title states one: «کارکرده»، «ریفربیش»، «کپی».
   */
  flags?: ConditionFlag[];
  flagLabels?: string[];
  /** Persian reason: the words of the seller's own listing title, e.g. «در عنوان آگهی فروشنده: های کپی». */
  flagReason?: string;
  /**
   * true = this seller is kept out of the automatic pick, the item's cheapest price / seller count / price range and
   * the plan, because its listing condition does not fit the item (it is planned only when the user pinned both
   * this product and this shop). `price` is still the seller's price, for reference.
   */
  conditionExcluded?: true;
}

export interface OptionsResponse {
  models: ModelOption[];
  sellers: SellerOption[];
  onlyOneSeller: boolean;
  /** additive: total models before the list cap (eligible + incomplete + differing: every model in `models`' pool). */
  modelTotal?: number;
  /** Models that meet every requirement: the same number as the item card's `eligibleCount` («۷ مدل»). */
  eligibleCount?: number;
  /** Persian summary of the pool, e.g. «۷ مدل مطابق خواسته از ۵۷ مدل این دسته». */
  poolLabel?: string;
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export type CompatLevel = 'stated' | 'assumed' | 'unknown' | 'conflict';

export interface CompatLine {
  id: string;
  level: CompatLevel;
  text: string;
  askSeller?: string;
  itemIds: string[];
  // ---- additive ----
  /** Persian status label («طبق عنوان آگهی» / «فرض عمومی؛ تأیید نشده» / «نامشخص» / «ناسازگار»). */
  levelLabel?: string;
  ruleId?: string;
  /** A 'conflict' that comes from the user's own choices (stated / answered / pinned on every changeable side). */
  fromUserChoice?: boolean;
  /** The user lifted the rule's general assumption (e.g. an adapter voltage other than 12 V): not verified. */
  assumptionLifted?: boolean;
  /**
   * Item id -> «از فروشنده بپرس» phrased for the item bought at that seller («آیا این دوربین با ضبط‌کننده‌ای که می‌خرم
   * (DVR) سازگار است؟»). StopLine.askSeller already uses it; `askSeller` above stays the line's general question.
   */
  askSellerByItem?: Record<string, string>;
}

export interface StopLine {
  itemId: string;
  /** Number of sale units bought (rolls, metres or pieces). */
  qty: number;
  state: ItemState;
  productName: string;
  modelCode?: string;
  listingTitle: string;
  unitPrice: number | null;
  unitLabel?: string;
  lineTotal: number | null;
  warranty: string;
  priceChangedAt: string;
  shopId: string;
  askSeller: string[];
  // ---- additive ----
  productId?: string;
  /** Listing condition flags of the bought product (only possible when the user allowed or pinned it). */
  flags?: ConditionFlag[];
  flagLabels?: string[];
  /** First product image from the dataset (additive). */
  imageUrl?: string;
}

/** One shop inside a stop (building). */
export interface StopShop {
  shopId: string;
  shopName: string;
  /** Mall / building name (or the area when the shop is not in a mall). */
  mall: string;
  /** «طبقهٔ ۲»، «همکف»… */
  floor?: string;
  /** «واحد ۶۲»… */
  unit?: string;
  address: string;
  hoursText: string;
  open: 'open' | 'closed' | 'unknown';
  /** The lines bought at this shop. */
  lines: StopLine[];
  /** Shop coordinates (additive). */
  lat?: number;
  lon?: number;
}

/**
 * One stop = one building (planner stop). `stopCount === stops.length`.
 * The top-level shop fields (shopId, shopName, floor, unit, address, hoursText) describe the FIRST shop and are
 * kept for older clients; `shops` lists every shop in the building with its own floor/unit and lines.
 * `lines` = every line of the stop (all shops), `open` = the least open status among its shops.
 */
export interface Stop {
  id: string;
  /** 1-based order of the stop (= buildingIndex). */
  index: number;
  mall: string;
  floor?: string;
  unit?: string;
  shopId: string;
  shopName: string;
  address: string;
  hoursText: string;
  open: 'open' | 'closed' | 'unknown';
  /** Straight-line metres to the next stop. */
  distanceToNext?: number;
  lines: StopLine[];
  // ---- additive ----
  buildingKey?: string;
  buildingIndex?: number;
  /** Every shop of this stop, in assignment order (length >= 1). */
  shops?: StopShop[];
  /** shops.length */
  shopCount?: number;
  /** Sum of the priced line totals at this stop (toman). */
  subtotal?: number;
  /** Building centre (mean of its shops), additive. */
  lat?: number;
  lon?: number;
}

/* ---- Places: "where should I go" (additive endpoint POST /api/places) ---- */

export type PlaceBadge = 'one_stop' | 'cheapest' | 'most_choice' | 'open_now';

/** What one mall offers for one requirement. */
export interface PlaceItemLine {
  itemId: string;
  itemName: string;
  covered: boolean;
  productName?: string;
  imageUrl?: string;
  /** Cheapest usable price at this mall for the item's current pick rule (toman), null when unpriced. */
  unitPrice?: number | null;
  qty?: number;
  shopName?: string;
  /** Id of the shop selling the cheapest line (`shopName`): pin it with `shopPins[itemId]` to plan this mall. Additive. */
  shopId?: string;
  floor?: string;
  unit?: string;
  /** How many shops in this mall sell a matching product. */
  shopsWithItem?: number;
}

/** A building (mall / market) ranked for the whole shopping list. */
export interface PlaceMall {
  /** Building key (same as Stop.buildingKey). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  areaLabel?: string;
  /** Distinct floors of relevant shops, e.g. ['طبقهٔ ۲','طبقهٔ ۶']. */
  floors: string[];
  /** Relevant shops (sell at least one item of the list). */
  shopCount: number;
  covered: number;
  total: number;
  /** Sum of priced cheapest lines for covered items, null when none priced. */
  totalToman: number | null;
  open: 'open' | 'closed' | 'unknown';
  hoursText?: string;
  badges: PlaceBadge[];
  items: PlaceItemLine[];
}

export interface PlacesResponse {
  /** Best first; at most 8. */
  malls: PlaceMall[];
  /** The one-line recommendation target (a mall id) or null when nothing covers 2+ items. */
  bestId: string | null;
  /** Persian one-liner explaining the recommendation, e.g. «همهٔ ۴ مورد در پاساژ علاءالدین ۲ هست». */
  headline?: string;
}

export interface PlanCoverage {
  covered: number;
  total: number;
  missing: { itemId: string; name: string; why: string }[];
}

export interface UnpricedItem {
  itemId: string;
  name: string;
  sellers: { shopName: string; mall: string; floor?: string; unit?: string }[];
}

export interface PlanAlternative {
  id: string;
  /**
   * Distinct per alternative: its own stop count and its price delta vs the shown plan, e.g.
   * «۱ توقف · ۴٫۷ میلیون تومان بیشتر» (was the shared «کم‌توقف‌تر» / «ارزان‌تر», now in `kindLabel`).
   */
  label: string;
  description: string;
  deltaToman: number;
  deltaStops: number;
  // ---- additive ----
  /** Stops of this alternative plan (the id is `stops:<stopCount>`). */
  stopCount?: number;
  /** Direction vs the shown plan (non-dominated: fewer stops for more money, or cheaper with more stops). */
  kind?: 'fewer_stops' | 'cheaper';
  /** The former shared label («کم‌توقف‌تر» / «ارزان‌تر»), for a group heading. */
  kindLabel?: string;
}

export interface ReplacedStopNote {
  text: string;
}

export interface PlanResponse {
  title: string;
  coverage: PlanCoverage;
  totalToman: number;
  usesSuggestions: boolean;
  complete: boolean;
  reason: string;
  /** Number of buildings to visit; always equals `stops.length`. */
  stopCount: number;
  stops: Stop[];
  unpriced: UnpricedItem[];
  compat: CompatLine[];
  alternatives: PlanAlternative[];
  noAlternativesReason?: string;
  activeVariant: PlanVariant;
  visitActive: boolean;
  closedNotes: ReplacedStopNote[];
  // ---- additive ----
  /** Engine total line, e.g. «فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان». */
  totalLine?: string;
  /**
   * The market view's total by the listed prices, worded once: «جمع طبق فهرست برای ۴ مورد: ۲۰٫۳ میلیون تومان»
   * («جمع طبق فهرست، فقط ۳ از ۵ مورد: …», « — <marker>» when flagged). Render it as is instead of prefixing
   * «جمع طبق فهرست ·» to `totalLine` (which already starts with «جمع ۴ مورد»).
   */
  datasetTotalLine?: string;
  missingLine?: string;
  suggestionNote?: string;
  orderNote?: string;
  /** Resolutions computed in the same call (same as /api/resolve). */
  items?: ItemResolution[];
  /** Number of shops across all stops (>= stopCount). */
  shopCount?: number;
  /**
   * The plan holds at least one compat 'conflict' line (also one the user caused). Such a plan never reads as a
   * normal complete plan: `totalLine` ends with `totalMarker` («— ناسازگاری دارد») and `reason` has no superlative.
   * Always present on server responses.
   */
  hasConflict?: boolean;
  /** A compat assumption was lifted by the user (e.g. a non-12 V adapter next to cameras): «بدون تأیید سازگاری». */
  compatUnverified?: boolean;
  /** Persian marker carried by `totalLine` when `hasConflict` / `compatUnverified` («ناسازگاری دارد» / «بدون تأیید سازگاری»). */
  totalMarker?: string;
}

// ---------------------------------------------------------------------------
// assist (owned by the assistant unit; shape kept for the web)
// ---------------------------------------------------------------------------

export type AssistChip = 'cheaper' | 'closer' | 'fewer_stops' | 'only_open' | 'without_shop';

/** Attribute the user stated for an item, its budget, or its accepted listing condition (`'condition'`). */
export type AssistRelaxableAttr = AttrKey | 'budget' | typeof CONDITION_ATTR;

/** Mirrors apps/server/src/assist/types.ts (the server owns the contract). */
export type AssistAction =
  | { type: 'set_preference'; preference: 'cheapest' | 'fewest_stops' }
  | { type: 'exclude_shop'; shopId: string }
  | { type: 'exclude_mall'; mallKey: string }
  | { type: 'only_open'; value: boolean }
  | { type: 'swap_brand'; itemId: string; brand: string }
  | { type: 'relax_constraint'; itemId: string; attr: AssistRelaxableAttr }
  | { type: 'set_budget'; itemId: string; min?: number; max?: number }
  | { type: 'add_item'; text: string }
  | { type: 'remove_item'; itemId: string }
  | { type: 'explain' }
  | { type: 'none' };

export interface AssistRequest {
  state: RequirementState;
  chip?: AssistChip;
  text?: string;
  /** The card the assistant was opened from. */
  context?: { shopId?: string; itemId?: string };
}

export interface AssistChoice {
  label: string;
  request: { chip?: AssistChip; text?: string; context?: { shopId?: string; itemId?: string } };
}

export type AssistSource = 'chip' | 'keywords' | 'llm' | 'none';

export interface AssistResponse {
  action: AssistAction;
  /**
   * The requirement state after the action (identical to the request's when nothing changed). Same shape the client
   * sends: parser items stay parser items (`constraints`, `rawText`, no `chips`), so apply it wholesale and send it
   * back to /api/plan unchanged. `add_item` appends the parser's items verbatim (ids `a1`, `a2`…).
   */
  newState: RequirementState;
  changed: boolean;
  supported: boolean;
  messageFa: string;
  /** Same text as messageFa. */
  message: string;
  source: AssistSource;
  degraded?: true;
  choices?: AssistChoice[];
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

export interface MetaResponse {
  /** ISO date of the data snapshot, e.g. '2026-10-13'. */
  snapshotDate: string;
  /** Shops with at least one offer. */
  shopCount: number;
  productCount: number;
  /** Areas covering the market (each with >= 5% of the shops with offers), largest first. */
  areas: string[];
  /** Category names with products on offer, largest first (for home-screen suggestions). */
  categories: string[];
  dataVersion: string;
  // ---- additive ----
  /** Jalali display date (Persian digits), e.g. «۲۱ مهر ۱۴۰۵». */
  snapshotDateFa?: string;
  /** Raw counts from the build (products, offers, shops, shops_with_offers, categories). */
  counts?: Record<string, number>;
  /** Shop names are as provided by the dataset (the organisers may have fictionalised them). Always true. */
  fictionalShopNames?: boolean;
  buildTime?: string | null;
  /** snake_case aliases of snapshotDate / dataVersion (same values). */
  snapshot_date?: string;
  data_version?: string;
}
