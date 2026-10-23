import { LayoutGroup, motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { spring } from './motion/tokens';

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

/**
 * Tab-like segmented control. In RTL the first option sits at the right edge. The selected pill is one shared
 * element that glides between tabs (layoutId); with reduced motion it simply appears under the new tab.
 */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className = '' }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const group = useId();

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
    <LayoutGroup id={group}>
      <div role="tablist" aria-label={label} className={`flex gap-1 rounded-[18px] border border-line/70 bg-sunken/80 p-1 ${className}`}>
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
              className={`relative flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-control px-2 text-sm font-bold transition-colors duration-200 ${
                selected ? 'text-night-ink' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="seg-pill"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-control surface-night shadow-[0_6px_14px_-8px_rgba(11,36,34,0.8)]"
                  transition={spring.layout}
                />
              )}
              <span className="relative">{o.label}</span>
              {o.badge && (
                <span
                  className={`num relative inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                    selected ? 'bg-saffron text-ink' : 'bg-saffron-soft text-saffron-ink'
                  }`}
                >
                  {o.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
