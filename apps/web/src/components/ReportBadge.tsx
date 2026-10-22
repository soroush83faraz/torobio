import { t } from '../copy/fa';
import { formatRelativeDayTime, formatTomanCompact } from '../lib/format';
import type { Report } from '../store/plans';
import { Icon } from './Icon';

/**
 * «گزارش شما»: always an outlined, dashed badge with a person icon, never styled like a dataset fact.
 * Device-local, never verified, never part of the dataset total.
 */
export function ReportBadge({ report, onRemove }: { report: Report; onRemove?: () => void }) {
  const when = formatRelativeDayTime(report.at);
  const text =
    report.kind === 'available'
      ? t.report.available(when)
      : report.kind === 'unavailable'
        ? t.report.unavailable(when)
        : report.kind === 'price'
          ? t.report.price(when, formatTomanCompact(report.price ?? 0))
          : t.report.paid(when, formatTomanCompact(report.price ?? 0));
  return (
    <div
      data-testid="user-report"
      data-kind={report.kind}
      className="rounded-xl border-2 border-dashed border-line-strong bg-canvas px-3 py-2 text-sm font-semibold"
    >
      <p className="flex items-start gap-2">
        <Icon name="user" size={16} className="mt-1 text-ink-soft" />
        <span className="flex-1">{text}</span>
      </p>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mb-1 min-h-touch rounded-lg pe-2 text-sm font-bold text-accent-ink"
        >
          {t.report.remove}
        </button>
      )}
    </div>
  );
}
