import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef } from 'react';
import { spring } from './tokens';

/** Spread onto any motion element for the house press feedback (a firm spring squash). */
export const pressFeedback = {
  whileTap: { scale: 0.97 },
  transition: spring.press,
} as const;

/** A softer squash for big surfaces (cards), where 3% would travel too far. */
export const pressFeedbackSoft = {
  whileTap: { scale: 0.985 },
  transition: spring.press,
} as const;

/** `<button>` with spring press feedback. Reduced motion: MotionConfig drops the scale; colour states remain. */
export const Pressable = forwardRef<HTMLButtonElement, HTMLMotionProps<'button'> & { soft?: boolean }>(function Pressable(
  { soft, type = 'button', ...rest },
  ref,
) {
  return <motion.button ref={ref} type={type} {...(soft ? pressFeedbackSoft : pressFeedback)} {...rest} />;
});
