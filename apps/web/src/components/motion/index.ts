/**
 * Motion primitives. Everything here degrades under prefers-reduced-motion: <MotionRoot> drops transform/layout
 * animation globally, and the time-based pieces (CountUp, TypingDots) check `useReducedMotion` themselves.
 */
export { MotionRoot } from './MotionRoot';
export { StaggerList, StaggerItem, Rise } from './Stagger';
export { Pressable, pressFeedback, pressFeedbackSoft } from './Press';
export { CountUp } from './CountUp';
export { TypingDots } from './TypingDots';
export { AnimatedCheck, ProgressRing, StepDots } from './Progress';
export { spring, ease, duration, canAnimate } from './tokens';
