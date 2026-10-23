import { motion } from 'motion/react';
import { ease } from './tokens';

/** A check mark that draws itself. Pathlength animation is not spatial movement, so it stays with reduced motion. */
export function AnimatedCheck({ size = 20, className = '', delay = 0 }: { size?: number; className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.36, ease: ease.out, delay }}
      />
    </svg>
  );
}

interface RingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  /** Tailwind text colour classes for the track and the arc (stroke uses currentColor). */
  trackClass?: string;
  arcClass?: string;
  children?: React.ReactNode;
}

/**
 * Progress ring for real progress (items ready out of total). Decorative: the caller always prints the numbers.
 * RTL: the arc starts at the top and runs counter-clockwise, the reading direction.
 */
export function ProgressRing({ value, size = 44, stroke = 4, className = '', trackClass = 'text-line', arcClass = 'text-accent', children }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 rotate-90 -scale-x-100">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="currentColor" className={trackClass} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="currentColor"
          strokeLinecap="round"
          className={arcClass}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: ease.out, delay: 0.15 }}
        />
      </svg>
      {children && <span className="relative">{children}</span>}
    </span>
  );
}

/** Segmented progress for a short sequence («سؤال ۱ از ۳»): one pill per step, the current one stretches. */
export function StepDots({ current, total, tone = 'accent' }: { current: number; total: number; tone?: 'accent' | 'light' }) {
  const on = tone === 'light' ? 'bg-saffron' : 'bg-accent';
  const off = tone === 'light' ? 'bg-night-ink/25' : 'bg-accent/20';
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {Array.from({ length: Math.max(1, total) }, (_, i) => (
        <motion.span
          key={i}
          layout
          className={`block h-1.5 rounded-full ${i < current ? on : off}`}
          animate={{ width: i === current - 1 ? 22 : 8 }}
          transition={{ duration: 0.4, ease: ease.out }}
        />
      ))}
    </span>
  );
}
