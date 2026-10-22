import type { ReactNode } from 'react';
import { t } from '../copy/fa';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

interface EmptyProps {
  title: string;
  body?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  tone?: 'neutral' | 'danger';
}

export function EmptyState({ title, body, icon = 'list', children, tone = 'neutral' }: EmptyProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink-soft'
        }`}
      >
        <Icon name={icon} size={24} />
      </span>
      <h2 className="text-lg">{title}</h2>
      {body && <div className="text-sm text-ink-soft">{body}</div>}
      {children && <div className="mt-1 flex w-full flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({
  title = t.error.title,
  body = t.error.body,
  onRetry,
}: {
  title?: string;
  body?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div role="alert">
      <EmptyState title={title} body={body} icon="alert" tone="danger">
        {onRetry && (
          <Button variant="primary" icon="refresh" onClick={onRetry}>
            {t.error.retry}
          </Button>
        )}
      </EmptyState>
    </div>
  );
}
