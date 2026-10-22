import type { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li';
  tone?: 'default' | 'sunken' | 'accent' | 'amber' | 'report';
  children: ReactNode;
}

const TONE = {
  default: 'bg-surface border-line shadow-card',
  sunken: 'bg-sunken border-line',
  accent: 'bg-accent-soft border-accent/30',
  amber: 'bg-amber-soft border-amber/50',
  // User reports are visually distinct from dataset facts: dashed outline, no shadow.
  report: 'bg-canvas border-dashed border-line-strong',
} as const;

export function Card({ as: Tag = 'div', tone = 'default', className = '', children, ...rest }: Props) {
  return (
    <Tag className={`rounded-card border p-4 ${TONE[tone]} ${className}`} {...(rest as object)}>
      {children}
    </Tag>
  );
}
