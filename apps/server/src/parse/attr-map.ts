/**
 * Parser-side view of the extractor -> engine attribute mapping. The key table itself is the adapter's
 * (apps/server/src/adapter/mapping.ts, `mapTextAttrs`); here a user's stated value only becomes a Constraint.
 *
 * Extractor keys with no engine attribute (wifi, sim, solar, line, ssd, conductor...) are
 * reported in `ignored` and never become a constraint.
 */
import { ANALOG_SIGNALS, type Constraint } from '@app/core';
import { mapTextAttrs } from '../adapter/mapping.js';

export interface MappedAttrs {
  constraints: Constraint[];
  /** Extractor keys understood but without an engine attribute. */
  ignored: string[];
}

/**
 * `dropKeys`: extractor keys to skip (e.g. values decoded from a typed model code, which the model code
 * itself already pins down).
 *
 * The extractor-key -> engine-key table lives ONLY in adapter/mapping.ts (`mapTextAttrs`); this function only
 * decides how a user's stated value becomes a Constraint.
 */
export function mapExtractedAttrs(attrs: Record<string, unknown>, dropKeys: ReadonlySet<string> = new Set()): MappedAttrs {
  const { entries, ignored } = mapTextAttrs(attrs, dropKeys);
  const constraints: Constraint[] = [];
  for (const { attr, value } of entries) {
    let draft: Record<string, unknown> | null = null;
    if (attr === 'camera_signal' && value === 'analog') {
      // "analog" stated by the user = any analog family signal (the product-side 'analog' is in this set too)
      draft = { attr, op: 'in', values: [...ANALOG_SIGNALS] };
    } else if (attr === 'fits_models') {
      const first = Array.isArray(value) ? value[0] : undefined; // a stated device model: match any product that fits it
      draft = first ? { attr, op: 'contains', value: first } : null;
    } else if (attr === 'hdd_surveillance') {
      draft = value === true ? { attr, op: 'eq', value: true } : null; // only `true` is a claim
    } else {
      draft = { attr, op: 'eq', value };
    }
    if (draft) constraints.push({ ...draft, source: 'user' } as Constraint);
  }
  return { constraints, ignored };
}
