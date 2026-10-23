import { motion } from 'motion/react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { pressFeedback } from './motion/Press';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

/** Handlers motion owns (it redefines their signatures) are not part of the public props. */
type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'style'>;

interface Props extends NativeProps {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_6px_16px_-8px_rgba(183,24,34,0.7)] hover:bg-accent-strong active:bg-accent-strong disabled:bg-line disabled:text-ink-soft disabled:shadow-none',
  secondary:
    'bg-surface text-ink border border-line-strong/70 shadow-card hover:bg-sunken active:bg-sunken disabled:text-ink-soft disabled:border-line disabled:shadow-none',
  ghost: 'bg-transparent text-accent-ink hover:bg-accent-soft active:bg-accent-soft disabled:text-ink-soft',
  danger: 'bg-surface text-danger border border-danger/60 hover:bg-danger-soft active:bg-danger-soft',
};

const SIZE: Record<Size, string> = {
  md: 'min-h-touch px-4 text-sm',
  lg: 'min-h-14 px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', block, icon, loading, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  const off = disabled || loading;
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={off}
      aria-busy={loading || undefined}
      {...(off ? {} : pressFeedback)}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </motion.button>
  );
});

/** Icon-only button with a mandatory Persian label. 48px target. */
export function IconButton({
  icon,
  label,
  className = '',
  ...rest
}: { icon: IconName; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-control text-ink transition-colors duration-150 hover:bg-sunken active:scale-95 active:bg-sunken ${className}`}
      {...rest}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}
