/**
 * API shapes used by the web app. The UI imports types from here, never from the mock.
 * They are the decision-API contract shared with the server (packages/core/src/api/dto.ts): the same
 * shapes this file used to declare, extended additively (optional machine-readable fields such as chip
 * constraints, sale units and engine detail lines). Money is whole toman; dates are ISO strings.
 * Server responses arrive inside the envelope `{ data: T }`.
 *
 * Type-only imports: nothing from @app/core is bundled into the web app.
 */
import type {
  AssistAction as CoreAssistAction,
  ItemResolution as CoreItemResolution,
  ModelOption,
  PlanResponse as CorePlanResponse,
  ResolveResponse as CoreResolveResponse,
  AssistRequest as CoreAssistRequest,
  AssistResponse as CoreAssistResponse,
  PlanVariant,
  StatedConstraintDto as CoreStatedConstraintDto,
  Requirement as CoreRequirement,
  RequirementChip as CoreChip,
  RequirementState as CoreRequirementState,
} from '@app/core/src/api/dto';

export type { PlanVariant };

/**
 * Dead end: nothing matched what the user stated. Sent by the server (additively) on an item resolution; the web
 * app also derives a graceful fallback when it is absent (see lib/items.ts `isDeadEnd`).
 * `relax[].attr` is a stated attribute key, or 'budget' / 'condition'.
 */
export interface NoMatch {
  reasonFa: string;
  relax: { attr: string; label: string }[];
  closest: ModelOption[];
}

/** The server's item resolution plus the optional additive `noMatch`. */
export type ItemResolution = CoreItemResolution & { noMatch?: NoMatch };
export type ResolveResponse = Omit<CoreResolveResponse, 'items'> & { items: ItemResolution[] };
/**
 * `coverage.missing[].kind` is optional and additive (a server that separates the reasons may send it); the UI
 * otherwise derives the kind from the per-item states (lib/items.ts `missingGroups`).
 */
export type MissingKind = 'not_found' | 'needs_info' | 'no_price';
export type PlanResponse = Omit<CorePlanResponse, 'items' | 'coverage'> & {
  items?: ItemResolution[];
  /** True when the plan holds a compatibility conflict (additive; `totalLine` then carries the marker too). */
  hasConflict?: boolean;
  coverage: Omit<CorePlanResponse['coverage'], 'missing'> & { missing: (CorePlanResponse['coverage']['missing'][number] & { kind?: MissingKind })[] };
};
export type {
  ConstraintDto,
  RequirementChip,
  VisitDay,
  VisitWindow,
  VisitTime,
  // resolve
  ItemState,
  QuestionOption,
  Question,
  ProductRef,
  SaleUnitDto,
  // options
  ModelOption,
  SellerOption,
  OptionsResponse,
  // plan
  CompatLevel,
  CompatLine,
  ConditionFlag,
  StopLine,
  StopShop,
  Stop,
  PlanCoverage,
  UnpricedItem,
  PlanAlternative,
  ReplacedStopNote,
  // places («کجا بروم»: POST /api/places)
  PlaceBadge,
  PlaceItemLine,
  PlaceMall,
  PlacesResponse,
} from '@app/core/src/api/dto';

/* ------------------------------------------------------------------------------------------------
 * Web-owned shapes. The UI stores /api/parse items VERBATIM (nothing is converted to chips), so the
 * stored requirement is the core Requirement made tolerant of both worlds: parser fields
 * (`constraints`, `rawText`, `inherited`, `domain`...) and the older chip fields (all optional).
 * The server accepts either; http.ts fills the few wire-required fields at the boundary only.
 * ---------------------------------------------------------------------------------------------- */

/** A parser constraint: the wire constraint plus where it came from. */
export type StoredConstraint = CoreStatedConstraintDto & { source?: string };

export interface ParseNote {
  code: string;
  messageFa: string;
  fragment?: string;
  itemId?: string;
}

export interface ParsedExtras {
  constraints?: StoredConstraint[];
  rawText?: string;
  confidence?: number;
  categoryCandidates?: { id: number; name: string; score: number }[];
  notes?: ParseNote[];
  /** Constraints taken over from a sibling item (e.g. the phone model on a case). */
  inherited?: { attr: string; fromItemId: string }[];
  domain?: string;
  ignoredAttrs?: string[];
}

export type Requirement = Omit<CoreRequirement, 'chips' | 'categoryId' | 'categoryLabel'> &
  ParsedExtras & {
    /** Older (mock-era / share-link) chips. Absent on parser items. */
    chips?: CoreChip[];
    categoryId?: string | null;
    categoryLabel?: string;
  };

export type RequirementState = Omit<CoreRequirementState, 'requirements'> & { requirements: Requirement[] };

export interface ParseRequest {
  text: string;
}
/** Parser output as the UI uses it. */
export interface ParseResponse {
  title: string;
  items: Requirement[];
  degraded?: boolean;
  /** Why the smart parse was not used (additive, server-side): not set up / failed just now / usage budget spent. */
  degradedReason?: DegradedReason;
  preference?: 'cheapest' | 'fewest_stops';
  notes?: ParseNote[];
}

export interface ResolveRequest {
  state: RequirementState;
}
export interface PlanRequest {
  state: RequirementState;
}
/** Same body as /api/plan. */
export interface PlacesRequest {
  state: RequirementState;
}
export interface OptionsRequest {
  state: RequirementState;
  itemId: string;
  productId?: string;
}
/**
 * Assistant actions as the web handles them: the server's closed set plus the local `set_variant` used by the
 * chips-only fallback / mock (never sent by the server).
 */
export type SpecAttr = 'capacity_tb' | 'resolution_mp' | 'channels' | 'power_w' | 'wire_section_mm2';
export type AssistAction =
  | CoreAssistAction
  | { type: 'set_variant'; value: PlanVariant }
  /** Server action (assist/types.ts): a stated number changed («هارد ۴ ترابایت»). The server's `newState` carries it. */
  | { type: 'set_spec'; itemId: string; attr: SpecAttr; value: number };
/** Server response; the state-application fields are optional because the fallback / mock do not produce them. */
export type AssistResponse = Pick<CoreAssistResponse, 'message' | 'supported'> &
  Partial<Pick<CoreAssistResponse, 'changed' | 'messageFa' | 'source' | 'degraded' | 'choices'>> & {
    action: AssistAction;
    newState?: RequirementState;
    /** Why the smart assistant was not used (additive, server-side): not set up / failed just now / usage budget spent. */
    degradedReason?: DegradedReason;
  };
export type DegradedReason = 'not_configured' | 'failed' | 'budget';
export type AssistRequest = Omit<CoreAssistRequest, 'state'> & { state: RequirementState };
export type { AssistChoice, AssistChip } from '@app/core/src/api/dto';
/** What `api.assist` resolves to: always carries the state after the action (the server's, or a local one for the chips fallback). */
export type AssistResult = AssistResponse & { newState: RequirementState; changed: boolean; messageFa: string };

/** What the UI needs from GET /api/meta (the adapter maps whatever the server sends). */
export interface MetaResponse {
  /** ISO date of the price snapshot, e.g. 2026-10-13. */
  snapshotDate: string;
  /** Persian display date when the server provides one («۲۱ مهر ۱۴۰۵»). */
  snapshotLabel?: string;
  /** Shops that have price listings (what the server's `shopCount` means). */
  shopCount: number;
  /** All shops in the data (`counts.shops`), 0 when the server does not say. */
  shopsTotal: number;
  productCount: number;
  /** Area names for the data note. */
  areas: string[];
  /** Category names for live suggestions; empty when the server has no such list. */
  categories: string[];
  dataVersion: string;
  /** Shop names are fictional in this build (an about-sheet disclosure). */
  fictionalShopNames?: boolean;
}
