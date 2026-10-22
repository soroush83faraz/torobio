/**
 * POST /api/assist contract (PLAN B3.6 job 2, v3 6.9).
 *
 * Free Persian text (or a chip) -> ONE action from a closed set, validated against the current state / plan and
 * applied to the REQUIREMENT STATE by a pure function. The plan is then recomputed by the normal /api/plan route;
 * the assistant never edits a plan. The response carries the whole new state, so the client can apply it (and
 * keep the previous one for «برگرداندن»).
 */
import { Api, type AttrKey } from '@app/core';
import { z } from 'zod';

export const ASSIST_CHIPS = ['cheaper', 'closer', 'fewer_stops', 'only_open', 'without_shop'] as const;
export type AssistChip = (typeof ASSIST_CHIPS)[number];

/** Max user text (code points). Longer -> 413 with a Persian message. */
export const MAX_ASSIST_TEXT = 300;
/** Upper bound of a budget bound (toman); same order as the engine's answer decoder. */
export const MAX_BUDGET_TOMAN = 1e12;

export const ACTION_TYPES = [
  'set_preference',
  'exclude_shop',
  'exclude_mall',
  'only_open',
  'swap_brand',
  'relax_constraint',
  'set_budget',
  'add_item',
  'remove_item',
  'explain',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** An attribute the user stated for an item, its budget, or its accepted listing condition («استوک», «کپی»). */
export type RelaxableAttr = AttrKey | 'budget' | typeof Api.CONDITION_ATTR;

export type AssistAction =
  | { type: 'set_preference'; preference: 'cheapest' | 'fewest_stops' }
  /** shopId of a shop in the CURRENT plan. */
  | { type: 'exclude_shop'; shopId: string }
  /** mallKey (building key «m:…») of a mall in the CURRENT plan. */
  | { type: 'exclude_mall'; mallKey: string }
  | { type: 'only_open'; value: boolean }
  /** brand: a brand_key from the item's real facets. */
  | { type: 'swap_brand'; itemId: string; brand: string }
  | { type: 'relax_constraint'; itemId: string; attr: RelaxableAttr }
  /** Bounds read by the deterministic budget extractor from the user's own words (never from the LLM). */
  | { type: 'set_budget'; itemId: string; min?: number; max?: number }
  /** text: the user's own words; it goes through the deterministic parser. */
  | { type: 'add_item'; text: string }
  | { type: 'remove_item'; itemId: string }
  | { type: 'explain' }
  /** Nothing applied (unsupported, needs a choice, or nothing to change). */
  | { type: 'none' };

const id = z.string().min(1).max(Api.API_LIMITS.maxIdLen);

export const AssistRequestSchema = z.object({
  state: Api.RequirementStateSchema,
  /** Free text (length checked by the route for a Persian 413). */
  text: z.string().optional(),
  chip: z.enum(ASSIST_CHIPS).optional(),
  /** The card the assistant was opened from (the shop of «بدون این مغازه», the item of a question). */
  context: z.object({ shopId: id.optional(), itemId: id.optional() }).optional(),
});
export type AssistRequest = z.infer<typeof AssistRequestSchema>;
export type AssistContext = NonNullable<AssistRequest['context']>;

/** A ready-made follow-up request (e.g. which shop «بدون این مغازه» means). */
export interface AssistChoice {
  label: string;
  request: { chip?: AssistChip; text?: string; context?: AssistContext };
}

/** What produced the action: a chip, the deterministic keyword fallback, the LLM, or nothing. */
export type AssistSource = 'chip' | 'keywords' | 'llm' | 'none';

export interface AssistResponse {
  action: AssistAction;
  /** The requirement state after the action (identical to the request's state when nothing changed). */
  newState: Api.RequirementState;
  changed: boolean;
  /** false: unsupported / out of scope / needs a choice. */
  supported: boolean;
  /** Templated Persian (LLM prose only for 'explain' / unsupported, and only after the post-check). */
  messageFa: string;
  /** Same text as messageFa (field name the web client already reads). */
  message: string;
  source: AssistSource;
  /** The LLM is configured but could not be used for this request (timeout, error, invalid answer, budget). */
  degraded?: true;
  choices?: AssistChoice[];
}
