import { motion, useReducedMotion } from 'motion/react';

/**
 * «…» while the assistant is working. Three dots rise in turn; with reduced motion they pulse in opacity only.
 * Decorative: pair it with a text status for screen readers.
 */
export function TypingDots({ className = '', tone = 'ink' }: { className?: string; tone?: 'ink' | 'light' }) {
  const reduced = useReducedMotion();
  const color = tone === 'light' ? 'bg-night-ink' : 'bg-accent';
  return (
    <span aria-hidden="true" className={`inline-flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`block h-1.5 w-1.5 rounded-full ${color}`}
          animate={reduced ? { opacity: [0.35, 1, 0.35] } : { y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
