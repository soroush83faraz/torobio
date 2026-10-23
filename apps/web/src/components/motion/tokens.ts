import type { Transition } from 'motion/react';

/** Motion vocabulary. Exits are faster than entrances; nothing bounces by reflex. */
export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  in: [0.4, 0, 1, 1] as const,
};

export const spring = {
  /** buttons, cards: quick and firm */
  press: { type: 'spring', stiffness: 520, damping: 32, mass: 0.6 } satisfies Transition,
  /** the segmented-control pill, layout shifts */
  layout: { type: 'spring', stiffness: 420, damping: 38 } satisfies Transition,
  /** a bubble or card arriving */
  arrive: { type: 'spring', stiffness: 300, damping: 30 } satisfies Transition,
};

export const duration = { fast: 0.15, base: 0.24, slow: 0.42 };

/** True outside the browser (unit tests in jsdom have no matchMedia): skip time-based effects there. */
export function canAnimate(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}
