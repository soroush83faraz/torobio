/**
 * Share link: the requirement state is compressed into the URL hash (no server, no account).
 * Opening it imports a COPY. Checks and user reports are never shared.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Requirement, RequirementState } from '../api/types';
import { sanitizeDeep, sanitizeText } from '../lib/sanitize';
import type { SavedPlan } from './plans';

interface Payload {
  v: 1;
  n: string;
  s: RequirementState;
}

export function encodeShare(plan: SavedPlan): string {
  const s: RequirementState = {
    // parser diagnostics (candidate lists, notes) are dropped: the link only carries what the server needs
    requirements: sanitizeDeep(plan.requirements).map(({ categoryCandidates: _c, notes: _n, confidence: _f, ...r }) => r),
    answers: plan.answers,
    settled: plan.settled,
    pins: plan.pins,
    shopPins: plan.shopPins,
    excludedShops: plan.excludedShops,
    variant: plan.variant,
    visit: plan.visit,
  };
  const payload: Payload = { v: 1, n: sanitizeText(plan.name), s };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

const isReq = (r: unknown): r is Requirement =>
  !!r && typeof r === 'object' && typeof (r as Requirement).id === 'string' && typeof (r as Requirement).text === 'string' && typeof (r as Requirement).qty === 'number';

/** Returns null for anything that is not a well-formed share payload. */
export function decodeShare(data: string): (Partial<SavedPlan> & { requirements: Requirement[] }) | null {
  try {
    const json = decompressFromEncodedURIComponent(data);
    if (!json) return null;
    const p = JSON.parse(json) as Payload;
    if (p?.v !== 1 || !p.s || !Array.isArray(p.s.requirements) || !p.s.requirements.every(isReq)) return null;
    // an imported link is untrusted: bidi overrides / control characters never reach the store or the screen
    return { name: sanitizeText(String(p.n ?? '')), ...sanitizeDeep(p.s) };
  } catch {
    return null;
  }
}

/** Full URL for the current origin; the payload rides in the hash route `#/s/<data>`. */
export function shareUrl(plan: SavedPlan, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}#/s/${encodeShare(plan)}`;
}
