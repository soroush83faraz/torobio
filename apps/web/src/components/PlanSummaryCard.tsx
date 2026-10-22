import { Link } from 'react-router-dom';
import { t } from '../copy/fa';
import { formatCount, formatRelativeDay } from '../lib/format';
import { usePlans, type SavedPlan } from '../store/plans';
import { BidiText } from './Bdi';
import { Icon } from './Icon';

/** Name, progress («۳ از ۵ مورد آماده») and last-used day. Used by Home and the header menu. */
export function PlanSummaryCard({ plan, onNavigate }: { plan: SavedPlan; onNavigate?: () => void }) {
  const progress = usePlans((s) => s.progress[plan.id]);
  const total = plan.requirements.length;
  const progressText = progress
    ? t.fmt.progress(progress.ready, progress.total)
    : `${formatCount(total)} مورد`;
  return (
    <Link
      to={`/plan/${plan.id}`}
      onClick={onNavigate}
      className="card flex min-h-[72px] items-center gap-3 p-4 transition-colors hover:bg-sunken active:bg-sunken"
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon name="bag" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold">
          <BidiText text={plan.name} />
        </span>
        <span className="block text-sm text-ink-soft">
          {progressText} · {formatRelativeDay(plan.updatedAt)}
        </span>
      </span>
      <Icon name="chevron-forward" className="text-ink-soft" />
    </Link>
  );
}
