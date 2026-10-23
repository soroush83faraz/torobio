import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { spring } from './tokens';

/**
 * Mount once at the app root. `reducedMotion="user"` makes every motion component drop transform and layout
 * animation when the OS asks for reduced motion; opacity and colour changes (which carry state) remain.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={spring.arrive}>
      {children}
    </MotionConfig>
  );
}
