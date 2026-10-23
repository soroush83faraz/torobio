import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { t } from '../copy/fa';
import { formatCount, formatRelativeDay } from '../lib/format';
import { usePlans, type SavedPlan } from '../store/plans';
import { BidiText } from './Bdi';
import { Icon } from './Icon';
import { ProgressRing } from './motion/Progress';
import { pressFeedbackSoft } from './motion/Press';

const MotionLink = motion.create(Link);

/** Name, progress («۳ از ۵ مورد آماده») with a ring, and last-used day. Used by Home and the header menu. */
export function PlanSummaryCard({ plan, onNavigate }: { plan: SavedPlan; onNavigate?: () => void }) {
  const progress = usePlans((s) => s.progress[plan.id]);
  const total = plan.requirements.length;
  const progressText = progress ? t.fmt.progress(progress.ready, progress.total) : `${formatCount(total)} مورد`;
  const ratio = progress && progress.total > 0 ? progress.ready / progress.total : 0;
  return (
    <MotionLink
      to={`/plan/${plan.id}`}
      onClick={onNavigate}
      {...pressFeedbackSoft}
      className="card flex min-h-[76px] items-center gap-3 p-3 pe-4 transition-shadow duration-200 hover:shadow-raised"
    >
      <ProgressRing value={ratio} size={52} stroke={4} trackClass="text-sunken" arcClass={ratio >= 1 ? 'text-good' : 'text-accent'}>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <Icon name="bag" size={20} />
        </span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-extrabold">
          <BidiText text={plan.name} />
        </span>
        <span className="num block text-sm text-ink-soft">
          {progressText} · {formatRelativeDay(plan.updatedAt)}
        </span>
      </span>
      <Icon name="chevron-forward" className="text-ink-soft" />
    </MotionLink>
  );
}
