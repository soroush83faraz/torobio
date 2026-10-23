import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { ease } from './tokens';

const list: Variants = {
  hidden: {},
  shown: (step: number = 0.06) => ({ transition: { staggerChildren: step, delayChildren: 0.04 } }),
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.42, ease: ease.out } },
};

interface ListProps {
  as?: 'ul' | 'div' | 'ol';
  className?: string;
  /** Seconds between siblings; total delay stays short because lists here are short. */
  step?: number;
  children: ReactNode;
  'aria-busy'?: boolean;
  'aria-label'?: string;
}

/** A list that reveals its children one after another the first time it mounts. */
export function StaggerList({ as = 'ul', className, step = 0.06, children, ...rest }: ListProps) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={list} custom={step} initial="hidden" animate="shown" {...rest}>
      {children}
    </Tag>
  );
}

interface ItemProps {
  as?: 'li' | 'div';
  className?: string;
  children: ReactNode;
  /** Animate position when siblings appear / leave. */
  layout?: boolean;
}

export function StaggerItem({ as = 'li', className, children, layout }: ItemProps) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={item} layout={layout ? 'position' : undefined}>
      {children}
    </Tag>
  );
}

/** One element rising into place (hero lines). `delay` in seconds. */
export function Rise({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'p' | 'section' }) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: ease.out, delay }}
    >
      {children}
    </Tag>
  );
}
