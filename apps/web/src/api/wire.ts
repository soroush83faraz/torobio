/**
 * Wire glue: the server accepts /api/parse items verbatim inside `state.requirements` (parse -> resolve
 * contract in packages/core/src/api/dto.ts), so the only thing left to do at the boundary is to keep purely
 * diagnostic parser output (candidate lists, notes, confidence, ignored attrs) out of requests: request
 * bodies are limited to 16 KB server-side. Older stored items (chip form) pass through unchanged.
 */
import type { Requirement, RequirementState } from './types';

/** Keys that only the UI/diagnostics use. Never sent. */
const DIAGNOSTIC_KEYS = ['categoryCandidates', 'notes', 'confidence', 'ignoredAttrs'] as const;

export function toWireRequirement(r: Requirement): Requirement {
  const out: Requirement = { ...r };
  for (const k of DIAGNOSTIC_KEYS) delete (out as unknown as Record<string, unknown>)[k];
  return out;
}

export function toWireState(state: RequirementState): RequirementState {
  return { ...state, requirements: state.requirements.map(toWireRequirement) };
}
