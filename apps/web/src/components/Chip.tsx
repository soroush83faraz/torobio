import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  selected?: boolean;
  /** 'single' behaves like a radio (aria-checked); 'multi' like a toggle (aria-pressed). */
  mode?: 'single' | 'multi';
  icon?: IconName;
  children: ReactNode;
}

/** Interactive choice chip. 48px high, wraps in a flex-wrap container. */
export function Chip({ selected = false, mode = 'multi', icon, className = '', children, ...rest }: ChipProps) {
  const aria = mode === 'single' ? { role: 'radio', 'aria-checked': selected } : { 'aria-pressed': selected };
  return (
    <button
      type="button"
      {...aria}
      className={`inline-flex min-h-touch items-center justify-center gap-1.5 rounded-chip border px-4 text-sm font-medium transition-colors ${
        selected
          ? 'border-accent bg-accent text-white'
          : 'border-line-strong bg-surface text-ink hover:bg-sunken active:bg-sunken'
      } ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/** Read-only chip (requirements, tags). Not a touch target. */
export function InfoChip({
  children,
  tone = 'neutral',
  onRemove,
  removeLabel,
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'amber';
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-sunken text-ink',
    accent: 'bg-accent-soft text-accent-ink',
    amber: 'bg-amber-soft text-amber-ink',
  } as const;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-2xl px-3 py-0.5 text-sm font-medium leading-snug ${tones[tone]} ${className}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-me-2 inline-flex min-h-touch min-w-touch items-center justify-center rounded-full"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
}
