import { useRef, type KeyboardEvent } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
  /** Small count/hint shown after the label. */
  badge?: string;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}

/** Tab-like segmented control. In RTL the first option sits at the right edge. */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className = '' }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (idx: number, delta: number) => {
    const next = (idx + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, idx: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    // In RTL, ArrowLeft moves to the next segment (visually to the left).
    if (e.key === 'ArrowLeft') move(idx, rtl ? 1 : -1);
    else if (e.key === 'ArrowRight') move(idx, rtl ? -1 : 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 rounded-2xl bg-sunken p-1 ${className}`}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition-colors ${
              selected ? 'bg-surface text-accent-ink shadow-card' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {o.label}
            {o.badge && (
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-amber-soft px-1.5 text-xs font-bold text-amber-ink">
                {o.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
