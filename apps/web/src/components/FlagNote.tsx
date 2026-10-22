import type { ConditionFlag } from '../api/types';
import { t } from '../copy/fa';
import { flagLabelsOf } from '../lib/stops';

/**
 * «نکته: کارکرده» — the listing-condition flags of a product, read from its title. Neutral amber (a fact to know,
 * not an alarm). Renders nothing for a product without flags.
 */
export function FlagNote({ flags, flagLabels, className = '' }: { flags?: ConditionFlag[]; flagLabels?: string[]; className?: string }) {
  const labels = flagLabelsOf({ flags, flagLabels });
  if (labels.length === 0) return null;
  return (
    <span
      data-testid="flag-note"
      className={`inline-flex max-w-full items-center gap-1 rounded-2xl bg-amber-soft px-3 py-0.5 text-sm font-medium leading-snug text-amber-ink ${className}`}
    >
      <span className="font-bold">{t.plan.flagNote}:</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{labels.join('، ')}</span>
    </span>
  );
}
