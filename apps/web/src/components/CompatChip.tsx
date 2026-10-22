import type { CompatLevel, CompatLine } from '../api/types';
import { t } from '../copy/fa';
import { BidiText } from './Bdi';
import { Icon } from './Icon';

/**
 * Three levels (plus conflict). NEVER a green tick:
 *  - stated:  neutral filled chip  (both sides say it in their own listing text)
 *  - assumed: outlined chip        (our general assumption, unverified)
 *  - unknown: amber dot            (an attribute is missing)
 */
export function CompatChip({ level, className = '' }: { level: CompatLevel; className?: string }) {
  const base = 'inline-flex items-center gap-1.5 rounded-chip px-3 py-0.5 text-sm font-medium';
  if (level === 'stated')
    return (
      <span data-compat="stated" className={`${base} bg-sunken text-ink ${className}`}>
        <Icon name="doc" size={15} />
        {t.compat.stated}
      </span>
    );
  if (level === 'assumed')
    return (
      <span data-compat="assumed" className={`${base} border-2 border-line-strong bg-transparent text-ink ${className}`}>
        <Icon name="dashed" size={15} />
        {t.compat.assumed}
      </span>
    );
  if (level === 'unknown')
    return (
      <span data-compat="unknown" className={`${base} bg-transparent text-ink ${className}`}>
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amber" />
        {t.compat.unknown}
      </span>
    );
  return (
    <span data-compat="conflict" className={`${base} border border-amber bg-amber-soft font-semibold text-amber-ink ${className}`}>
      <Icon name="alert" size={15} />
      {t.compat.conflict}
    </span>
  );
}

/** One relationship row in the «سازگاری» block: sentence + chip. */
export function CompatRow({ line }: { line: CompatLine }) {
  // The engine ends a user-caused conflict's sentence with «(از انتخاب‌های خودت)»; the tag below says it once.
  const sentence = line.fromUserChoice ? line.text.replace(/\s*[(（]\s*از انتخاب‌های خودت\s*[)）]\s*$/u, '') : line.text;
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <p className="text-sm">
        <BidiText text={sentence} />
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {line.assumptionLifted ? (
          <span data-compat={line.level} data-lifted="true" className="inline-flex items-center gap-1.5 rounded-chip border border-amber bg-amber-soft px-3 py-0.5 text-sm font-semibold text-amber-ink">
            <Icon name="alert" size={15} />
            {t.compat.assumptionLifted}
          </span>
        ) : (
          <CompatChip level={line.level} />
        )}
        {line.fromUserChoice && (
          <span data-testid="from-user-choice" className="rounded-chip bg-sunken px-3 py-0.5 text-sm text-ink-soft">
            {t.compat.fromUserChoice}
          </span>
        )}
      </div>
    </li>
  );
}
