/**
 * Makes every assistant answer carry the requirement state after the action.
 *
 * The server always returns `newState` (and `changed`): it is used as is, wholesale. Only the chips-only fallback
 * (server unreachable) and the mock answer with an action alone; for those the few state-level actions they can
 * produce are applied here, deterministically. Nothing is interpreted or invented client-side.
 */
import type { AssistRequest, AssistResponse, AssistResult, RequirementState } from './types';

function sameState(a: RequirementState, b: RequirementState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The state after a state-level action; the input is never mutated. */
export function applyLocalAction(state: RequirementState, action: AssistResponse['action']): RequirementState {
  const next = structuredClone(state);
  switch (action.type) {
    case 'set_variant':
      next.variant = action.value;
      break;
    case 'set_preference':
      next.variant = action.preference === 'fewest_stops' ? 'fewest' : null;
      break;
    case 'exclude_shop': {
      const list = new Set(next.excludedShops['*'] ?? []);
      list.add(action.shopId);
      next.excludedShops['*'] = [...list];
      for (const [itemId, pinned] of Object.entries(next.shopPins)) if (pinned === action.shopId) delete next.shopPins[itemId];
      break;
    }
    case 'set_spec':
      // the server always answers with `newState` (the number is rewritten into the item's constraints and words
      // there); a local fallback never produces this action, so nothing is invented here
      break;
    default:
      break;
  }
  return next;
}

export function normalizeAssist(req: AssistRequest, res: AssistResponse): AssistResult {
  const messageFa = res.messageFa ?? res.message;
  if (res.newState) {
    return { ...res, messageFa, newState: res.newState, changed: res.changed ?? !sameState(req.state, res.newState) };
  }
  const newState = res.supported ? applyLocalAction(req.state, res.action) : req.state;
  return { ...res, messageFa, newState, changed: !sameState(req.state, newState) };
}
