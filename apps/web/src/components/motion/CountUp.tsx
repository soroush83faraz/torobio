import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { canAnimate, ease } from './tokens';

interface Props {
  value: number;
  /** Turns the running number into display text (Persian digits, units). */
  format: (n: number) => string;
  /** Where the count starts, as a fraction of `value` (first reveal only). */
  from?: number;
  className?: string;
}

/**
 * A number that counts up when it first appears and glides when it changes. The final text is rendered on the
 * first paint (so screen readers, tests and no-JS reads see the real value); the animation only rewrites the
 * digits in place, with tabular numerals so nothing jitters. Reduced motion: the value simply appears.
 */
export function CountUp({ value, format, from = 0.55, className = '' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = shown.current ?? value * from;
    shown.current = value;
    if (reduced || !canAnimate() || start === value) {
      el.textContent = format(value);
      return;
    }
    const controls = animate(start, value, {
      duration: 0.9,
      ease: ease.out,
      onUpdate: (n) => {
        el.textContent = format(n);
      },
      onComplete: () => {
        el.textContent = format(value);
      },
    });
    return () => controls.stop();
  }, [value, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={ref} className={`num ${className}`}>
      {format(value)}
    </span>
  );
}
