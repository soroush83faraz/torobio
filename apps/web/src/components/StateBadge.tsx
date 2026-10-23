import type { ItemState } from '../api/types';
import { t } from '../copy/fa';
import { Icon, type IconName } from './Icon';

/** The six item states. Always icon + text, never colour alone. */
const STYLE: Record<ItemState, { icon: IconName; cls: string }> = {
  exact: { icon: 'badge-check', cls: 'bg-accent text-white border-transparent' },
  suggested: { icon: 'spark', cls: 'bg-accent-soft text-accent-ink border-accent/30' },
  alternative: { icon: 'swap', cls: 'bg-sunken text-ink border-transparent' },
  needs_info: { icon: 'question', cls: 'bg-saffron-soft text-saffron-ink border-saffron/50' },
  not_found: { icon: 'x-circle', cls: 'bg-danger-soft text-danger border-transparent' },
  no_price: { icon: 'tag-off', cls: 'bg-sunken text-ink-soft border-dashed border-line-strong' },
};

export function StateBadge({ state, className = '' }: { state: ItemState; className?: string }) {
  const s = STYLE[state];
  return (
    <span
      data-state={state}
      className={`inline-flex items-center gap-1 rounded-chip border px-2.5 py-0.5 text-sm font-bold leading-6 ${s.cls} ${className}`}
    >
      <Icon name={s.icon} size={16} />
      {t.states[state]}
    </span>
  );
}
