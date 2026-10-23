import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong active:bg-accent-strong disabled:bg-accent-soft disabled:text-accent-ink/60',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken active:bg-sunken disabled:text-ink-soft disabled:border-line',
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
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
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
      className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl text-ink hover:bg-sunken active:bg-sunken ${className}`}
      {...rest}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}
