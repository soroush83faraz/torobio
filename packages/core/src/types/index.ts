/**
 * Shared engine types (U3). Pure data shapes; no I/O.
 *
 * Conventions
 * - Money is integer toman. `null` price = no usable price (never 0).
 * - Attribute absent on a product = unknown (never guessed). Unknown is a first-class result.
 * - Minutes are counted from 00:00 of the given weekday (DATA_SCHEMA `shops.hours`).
 */

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type Weekday = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
/** Persian week order (starts on Saturday). */
export const WEEKDAYS: readonly Weekday[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

/**
 * DATA_SCHEMA hours JSON: `{"sat":[[540,1140]],"fri":[],...}`.
 * `[]` = closed that day; key absent = unknown for that day. The whole value is `null` when no hours are known.
 */
export type WeeklyHours = Partial<Record<Weekday, ReadonlyArray<readonly [number, number]>>>;

export interface Visit {
  day: Weekday;
  /** Minute of the day (0..1439). Omitted = "any time that day". */
  minute?: number;
}

export type OpenStatus = 'open' | 'closed' | 'unknown';

// ---------------------------------------------------------------------------
// Closed attribute schema (keys the extractor/server must map into `Candidate.attrs`)
// ---------------------------------------------------------------------------

/**
 * Camera transmission. 'analog' = a known analog-family camera whose exact format is not stated
 * (CVBS, «آنالوگ» alone, several HD-analog formats, Hikvision Turbo…); it still implies an XVR/DVR recorder.
 */
export type CameraSignal = 'ahd' | 'hdcvi' | 'tvi' | 'analog' | 'ip';
export type RecorderKind = 'xvr' | 'dvr' | 'nvr';
export type CameraForm = 'bullet' | 'dome' | 'turret' | 'ptz';
export type SaleUnit = 'meter' | 'roll' | 'piece';
export type WireStrand = 'flexible' | 'solid';

export interface ProductAttrs {
  brand?: string;
  resolution_mp?: number;
  camera_signal?: CameraSignal;
  camera_form?: CameraForm;
  lens_mm?: number;
  recorder_kind?: RecorderKind;
  channels?: number;
  capacity_tb?: number;
  /** true only when the listing says purple / skyhawk / surveillance. Absent = unknown. */
  hdd_surveillance?: boolean;
  voltage_v?: number;
  current_a?: number;
  /**
   * Device-model keys an accessory states it fits, in the extractor convention (lower-case Latin, single
   * spaces, e.g. ["galaxy a56"]; see extract/ATTRIBUTES.md). Compared with `deviceModelsMatch`.
   */
  fits_models?: string[];
  /** Device-model key of a phone itself (same convention, e.g. "galaxy a56 5g"). */
  phone_model?: string;
  storage_gb?: number;
  ram_gb?: number;
  wire_section_mm2?: number;
  wire_cores?: number;
  length_m?: number;
  sale_unit?: SaleUnit;
  /** Stated power in watts (lighting, chargers, power banks, adapters). */
  power_w?: number;
  /** Power-bank capacity in mAh. */
  capacity_mah?: number;
  /** Wire conductor build: «افشان» (flexible) or «مفتولی» (solid). */
  wire_strand?: WireStrand;
  /** Screen size in inches stated in the title («۵۵ اینچ»); read at query time for any category. */
  screen_inch?: number;
}

export type AttrKey = keyof ProductAttrs;
export type AttrValue = string | number | boolean | string[];
export type AttrKind = 'number' | 'string' | 'enum' | 'boolean' | 'string_list';

export interface AttrSpec {
  kind: AttrKind;
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /** Whether the question engine may ask about it as a discriminating facet (priority 2). */
  askable: boolean;
}

/** The closed schema. Order = tie-break order for questions. */
export const ATTR_SCHEMA: Readonly<Record<AttrKey, AttrSpec>> = {
  brand: { kind: 'string', askable: true },
  resolution_mp: { kind: 'number', askable: true },
  camera_signal: { kind: 'enum', values: ['ahd', 'hdcvi', 'tvi', 'analog', 'ip'], askable: true },
  camera_form: { kind: 'enum', values: ['bullet', 'dome', 'turret', 'ptz'], askable: true },
  lens_mm: { kind: 'number', askable: false },
  recorder_kind: { kind: 'enum', values: ['xvr', 'dvr', 'nvr'], askable: true },
  channels: { kind: 'number', askable: true },
  capacity_tb: { kind: 'number', askable: true },
  hdd_surveillance: { kind: 'boolean', askable: false },
  voltage_v: { kind: 'number', askable: true },
  current_a: { kind: 'number', askable: true },
  fits_models: { kind: 'string_list', askable: false },
  phone_model: { kind: 'string', askable: true },
  storage_gb: { kind: 'number', askable: true },
  ram_gb: { kind: 'number', askable: true },
  wire_section_mm2: { kind: 'number', askable: true },
  wire_cores: { kind: 'number', askable: true },
  length_m: { kind: 'number', askable: false },
  sale_unit: { kind: 'enum', values: ['meter', 'roll', 'piece'], askable: true },
  // stated-spec attributes (audit F3): evaluated when the user states them, never asked as facets
  power_w: { kind: 'number', askable: false },
  capacity_mah: { kind: 'number', askable: false },
  wire_strand: { kind: 'enum', values: ['flexible', 'solid'], askable: false },
  screen_inch: { kind: 'number', askable: false },
};

export const ATTR_KEYS: readonly AttrKey[] = Object.keys(ATTR_SCHEMA) as AttrKey[];
export const ANALOG_SIGNALS: readonly CameraSignal[] = ['ahd', 'hdcvi', 'tvi', 'analog'];

// ---------------------------------------------------------------------------
// Requirements (what the user asked for)
// ---------------------------------------------------------------------------

/** Role of an item in the compatibility rules. Only CCTV and phone accessories have rules. */
export type ItemKind =
  | 'camera'
  | 'recorder'
  | 'hdd'
  | 'adapter'
  | 'phone'
  | 'phone_case'
  | 'screen_protector'
  /** Building wire / cable: no compatibility rules, but a distinct role for the parser and the question engine. */
  | 'wire'
  | 'other';

export type CompatRuleId =
  | 'recorder_channels'
  | 'camera_recorder_signal'
  | 'recorder_hdd_internal'
  | 'hdd_surveillance'
  | 'camera_adapter_12v'
  | 'phone_accessory_fit'
  /** Unit guard (not a sibling rule): a wire price is only usable when the sale unit is known and fixed. */
  | 'wire_sale_unit';

/** user = typed/parsed; answer = picked from a question; compat = derived by a rule from a sibling's stated requirement. */
export type ConstraintSource = 'user' | 'answer' | 'compat';

interface ConstraintBase {
  attr: AttrKey;
  source: ConstraintSource;
  /** Set when source = 'compat'. */
  ruleId?: CompatRuleId;
  /** Sibling item the derived constraint came from (source = 'compat'). */
  fromItemId?: string;
}

export type Constraint =
  | (ConstraintBase & { op: 'eq'; value: string | number | boolean })
  | (ConstraintBase & { op: 'in'; values: ReadonlyArray<string | number> })
  | (ConstraintBase & { op: 'gte' | 'lte'; value: number })
  /** For `string_list` attributes (fits_models): the list must contain the token. */
  | (ConstraintBase & { op: 'contains'; value: string })
  /**
   * The attribute must be readable from the listing (never fails: absent → unknown). Derived by compat rules for
   * attributes they need, so products lacking them are never auto-picked.
   */
  | (ConstraintBase & { op: 'known' });

/** Per-unit price band, both bounds inclusive, toman. */
export interface Budget {
  min?: number;
  max?: number;
}

/** Key of a question: an attribute, or the budget question. */
export type QuestionKey = AttrKey | 'budget';

export interface Requirement {
  id: string;
  /** Display text of the item as the user wrote it (used as the label in sentences). */
  text: string;
  qty: number;
  /** true when the quantity was written by the user (compat rules derive only from stated values). */
  qtyStated?: boolean;
  categoryIds: number[];
  kind?: ItemKind;
  constraints: Constraint[];
  /** Normalised model code typed by the user (e.g. "XVR1B04-I"). */
  modelCode?: string;
  budget?: Budget;
  /** Product the user picked from the list. Always "exact_model". */
  pinnedProductId?: number;
  /**
   * Item-level preference flags.
   * - acceptSuggestion: «کافیه، پیشنهاد بده» / «فرقی نمی‌کند» for the whole item → stop asking, pick by the visible rule.
   * - allowAlternatives: the user relaxed; the closest non-matching product may be auto-picked as «جایگزین».
   */
  preference?: { acceptSuggestion?: boolean; allowAlternatives?: boolean };
  /** Questions answered with «فرقی نمی‌کند». */
  skippedQuestions?: QuestionKey[];
  /** Accepted listing conditions; absent = 'new' (see ConditionMode). */
  condition?: ConditionMode;
}

// ---------------------------------------------------------------------------
// Market data (adapted by the server from SQLite rows)
// ---------------------------------------------------------------------------

export interface Offer {
  id: string;
  productId: number;
  shopId: string;
  /** price_clean (toman) or null. */
  price: number | null;
  /** 'unit_mismatch': the price contradicts the listing's stated sale unit (query-time check; price is then null). */
  priceFlag?: 'missing' | 'placeholder' | 'outlier' | 'unit_mismatch' | null;
  sellerTitle?: string | null;
  warrantyCode?: string | null;
  warrantyMonths?: number | null;
  changedAt?: string | null;
}

export interface ProductInfo {
  id: number;
  title: string;
  categoryId: number;
  brand?: string | null;
  /** Normalised model codes (upper-case latin). */
  modelCodes: string[];
  imageUrl?: string | null;
  sellerCount?: number;
}

/**
 * Listing condition read from the title (extract/ATTRIBUTES.md `condition`, `replica`). Absent = the listing does
 * not state it ("not stated as used"), which is NOT a claim that the item is new.
 */
export interface ListingFlags {
  condition?: 'used' | 'refurbished';
  replica?: boolean;
}

/**
 * Which listing conditions a requirement accepts.
 * - 'new' (default when absent): used / refurbished / replica listings are never eligible (listed as «جایگزین»
 *   with the flag, never auto-picked, never an exact model-code match);
 * - 'any': used and refurbished listings are eligible too; replicas still are not;
 * - 'used': the user asked for used/refurbished («موبایل استوک»): only listings stating it are eligible;
 * - 'replica': the user asked for a copy («ایرپاد کپی»): only listings stating it are eligible.
 * A product the user pinned is always taken as is.
 */
export type ConditionMode = 'new' | 'any' | 'used' | 'replica';
export const CONDITION_MODES: readonly ConditionMode[] = ['new', 'any', 'used', 'replica'];

/** Why a candidate's listing condition does not fit the requirement. */
export type ConditionIssue = 'used' | 'refurbished' | 'replica' | 'not_used' | 'not_replica';

export interface Candidate {
  product: ProductInfo;
  /** Extracted attributes; absent key = unknown. Brand must be copied into attrs.brand when known. */
  attrs: ProductAttrs;
  offers: Offer[];
  /** Listing condition flags (title-stated). Absent = nothing stated. */
  listing?: ListingFlags;
  /**
   * Plausibility issues found for this request (requirement/plausibility.ts): the listing names another kind of
   * goods, or its price contradicts its sale unit. Set by the server per request; absent = none found.
   */
  issues?: ListingIssue[];
}

/**
 * Why a listing is not taken as the requested thing although its attributes pass:
 * - other_kind: the title names itself as another kind of goods (an accessory / part, or a sibling product type
 *   of a mixed category) -> 'differs';
 * - unit_unclear: every price of the listing contradicts its stated sale unit (roll vs metre) -> 'incomplete'.
 */
export type ListingIssueCode = 'other_kind' | 'unit_unclear';
export interface ListingIssue {
  code: ListingIssueCode;
  fit: 'differs' | 'incomplete';
  /** Persian sentence shown in the options list. */
  text: string;
}

export interface Shop {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  buildingKey: string;
  mallKey?: string | null;
  mallName?: string | null;
  floor?: string | null;
  unit?: string | null;
  address?: string | null;
  areaLabel?: string | null;
  /** null = no hours known (never treated as closed). */
  hours: WeeklyHours | null;
}

// ---------------------------------------------------------------------------
// Item resolution
// ---------------------------------------------------------------------------

export type ItemState = 'exact_model' | 'suggested' | 'alternative' | 'needs_info' | 'not_found' | 'price_unknown';
export const ITEM_STATES: readonly ItemState[] = [
  'exact_model',
  'suggested',
  'alternative',
  'needs_info',
  'not_found',
  'price_unknown',
];

export type ConstraintResult = 'pass' | 'fail' | 'unknown';

export interface ConstraintEval {
  constraint: Constraint;
  result: ConstraintResult;
  actual?: AttrValue;
}

/** eligible = every constraint passes (and inside the budget); incomplete = no fail but ≥1 unknown; differs = ≥1 fail. */
export type CandidateFit = 'eligible' | 'incomplete' | 'differs';

export interface CandidateEval {
  productId: number;
  fit: CandidateFit;
  evals: ConstraintEval[];
  failed: ConstraintEval[];
  unknown: ConstraintEval[];
  modelCodeMatch: boolean;
  /** Cheapest usable price of the product (per unit) or null. */
  minPrice: number | null;
  pricedOfferCount: number;
  /** null when no budget is set or the price is unknown. */
  withinBudget: boolean | null;
  /** Persian sentences describing each difference (fails, budget, model code, condition). */
  differences: string[];
  /** Set when the listing condition does not fit the requirement (the candidate is then 'differs'). */
  conditionIssue?: ConditionIssue;
  /** Plausibility issues of the listing (copied from Candidate.issues). */
  issues?: ListingIssueCode[];
}

export type PickRule =
  | 'model_code'
  | 'user_pinned'
  | 'cheapest_eligible'
  | 'cheapest_eligible_within_budget'
  | 'closest_alternative'
  | 'no_price';

export type NeedsInfoReason = 'compat_critical' | 'loose_requirement';

export interface ItemResolution {
  itemId: string;
  state: ItemState;
  /** Product used for the item card. Undefined when nothing may be picked automatically. */
  chosenProductId?: number;
  /** Machine-readable selection rule behind `chosenProductId`. */
  rule?: PickRule;
  /** What «فرقی نمی‌کند» would pick right now (shown on the chip), when different from chosen. */
  fallbackPick?: { productId: number; rule: PickRule };
  needsInfoReason?: NeedsInfoReason;
  notFoundReason?: 'no_candidates' | 'pinned_missing';
  counts: { candidates: number; eligible: number; eligiblePriced: number; incomplete: number; differs: number };
  /** Price range of eligible priced products (per unit). */
  priceRange?: { min: number; max: number };
  eligibleIds: number[];
  incompleteIds: number[];
  differsIds: number[];
  evaluations: CandidateEval[];
  /** Persian state label and secondary line, from copy/fa.ts. */
  label: string;
  detail: string;
  /**
   * Candidates kept out of eligibility only because of their listing condition (used / refurbished / replica
   * under the default policy). They stay in `evaluations` as 'differs'.
   */
  conditionExcludedCount?: number;
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

export type CompatStatus = 'listing_stated' | 'assumed' | 'unknown' | 'conflict';
/** What the status is grounded on. */
export type CompatBasis = 'listing' | 'general_rule' | 'missing';

export interface CompatFinding {
  ruleId: CompatRuleId;
  /** Machine key of the relationship, e.g. "recorder_channels>=camera_qty". */
  relationship: string;
  itemIds: string[];
  status: CompatStatus;
  basis: CompatBasis;
  sentence: string;
  /** «از فروشنده بپرس» line; present for assumed / unknown / conflict. */
  askSeller?: string;
  /**
   * The user lifted the general assumption behind this rule (e.g. chose or allowed an adapter voltage other than
   * 12 V next to cameras): the pairing is neither a conflict nor checked; the plan must not read as verified.
   */
  lifted?: true;
}

export interface DerivedConstraint {
  itemId: string;
  constraint: Constraint;
}

export interface CriticalUnknown {
  itemId: string;
  ruleId: CompatRuleId;
  /** The attribute the question will constrain on `itemId`. */
  attr: AttrKey;
  relatedItemIds: string[];
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export interface QuestionOption {
  id: string;
  label: string;
  /** Candidates (of the set the question splits) that this option keeps. */
  count: number;
  apply: { constraint?: Constraint; budget?: Budget };
}

export interface Question {
  itemId: string;
  key: QuestionKey;
  priority: 1 | 2 | 3;
  source: 'compat' | 'facet' | 'budget';
  ruleId?: CompatRuleId;
  text: string;
  options: QuestionOption[];
  /** Candidates that lack the attribute (they stay listed as «مشخصات کامل نیست»). */
  unknownCount: number;
  skipLabel: string;
  stopLabel: string;
  score?: { entropy: number; coverage: number; value: number };
}

export type QuestionStopReason =
  | 'accepted_default'
  | 'fits_one_screen'
  | 'no_discriminating_question'
  | 'no_candidates'
  | 'pinned';

export interface QuestionOutcome {
  question: Question | null;
  stopReason?: QuestionStopReason;
  eligibleCount: number;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type PlanPreference = 'cheapest' | 'fewest_stops' | 'compact';

export interface PlanOffer {
  offerId: string;
  productId: number;
  shopId: string;
  price: number | null;
}

export interface PlanItemInput {
  itemId: string;
  label: string;
  qty: number;
  state: ItemState;
  rule?: PickRule;
  /** Product chosen for the item card (for the "cheapest overall" vs "cheapest at this stop" rule). */
  chosenProductId?: number;
  offers: PlanOffer[];
}

export interface PlanExclusions {
  shopIds?: string[];
  mallKeys?: string[];
  buildingKeys?: string[];
}

export interface PlanInput {
  items: PlanItemInput[];
  shops: Shop[];
  exclusions?: PlanExclusions;
  visit?: Visit;
  preference?: PlanPreference;
  /** Upper bound on stops. Default: number of plannable items. */
  maxStops?: number;
  /** Cap on tied optimal combinations inspected for the compactness tie-break. Default 5000. */
  maxTieEnumeration?: number;
}

export type AssignmentRule = PickRule | 'cheapest_eligible_at_stop';

export interface Assignment {
  itemId: string;
  productId: number;
  offerId: string;
  shopId: string;
  buildingKey: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  state: ItemState;
  rule?: AssignmentRule;
}

export interface StopShop {
  shop: Shop;
  /** null when no visit time was given. */
  openStatus: OpenStatus | null;
}

export interface Stop {
  /** 1-based suggested order (nearest neighbour; not a route). */
  order: number;
  buildingKey: string;
  mallName: string | null;
  lat: number | null;
  lon: number | null;
  shops: StopShop[];
  itemIds: string[];
  subtotal: number;
  /** Straight-line metres to the next stop; null for the last stop or unknown coordinates. */
  distanceToNextM: number | null;
}

export type MissingReason = 'needs_info' | 'not_found' | 'price_unknown' | 'no_choice' | 'closed' | 'excluded' | 'no_offer' | 'stop_limit';

export interface UnpricedItem {
  itemId: string;
  label: string;
  sellers: { shopId: string; offerId: string; productId: number; buildingKey: string }[];
}

export interface Coverage {
  coveredCount: number;
  totalCount: number;
  complete: boolean;
  unpricedItems: UnpricedItem[];
  missingItems: { itemId: string; label: string; reason: MissingReason }[];
  usesSuggestions: boolean;
  usesAlternatives: boolean;
}

export interface Totals {
  total: number;
  coverage: Coverage;
  /** Persian total line, e.g. «جمع ۵ مورد: …» or «فقط ۳ از ۵ مورد: …». */
  line: string;
  /** «بدون قیمت یا انتخاب: …» when something is missing. */
  missingLine?: string;
  /** «با مدل‌های پیشنهادی» when suggestions are used. */
  suggestionNote?: string;
}

export interface Reason {
  code: string;
  params: Record<string, string | number>;
  text: string;
}

export type PlanTag = 'cheapest' | 'fewest_stops' | 'most_compact';

export interface Plan {
  id: string;
  stops: Stop[];
  assignments: Assignment[];
  totals: Totals;
  stopCount: number;
  /** Max pairwise straight-line distance between stops (metres, known coordinates only). */
  spreadM: number;
  tags: PlanTag[];
  isDefault: boolean;
  /** Difference vs the default plan (absent on the default). */
  delta?: { cost: number; stops: number; spreadM: number; text: string };
  reasons: Reason[];
  /** Set when one shop carries every planned item. */
  singleShopId?: string;
}

export interface PlanResult {
  plans: Plan[];
  defaultPlanId: string | null;
  coverage: Coverage;
  /** Shops dropped because they are closed at the visit time. */
  closedShopIds: string[];
  orderNote: string;
  notes: Reason[];
  /** Developer diagnostics (not user-facing). */
  diagnostics: {
    buildings: number;
    plannableItems: number;
    /** true when `maxTieEnumeration` was reached: compactness tie-break then covers the first N tied sets only. */
    tieEnumerationTruncated: boolean;
    tiedSetsInspected: number;
  };
}
