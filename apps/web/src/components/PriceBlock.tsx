import { useState } from 'react';
import { t } from '../copy/fa';
import { formatToman, formatTomanCompact } from '../lib/format';
import { BidiText } from './Bdi';

interface Props {
  amount: number;
  /** Small prefix such as «از» for ranges. */
  prefix?: string;
  suffix?: string;
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * Compact in lists («۳٫۲ میلیون تومان»), exact on tap («۳٬۲۰۰٬۰۰۰ تومان»).
 * The date next to a price is rendered by the caller identically on every row.
 */
export function PriceBlock({ amount, prefix, suffix, size = 'md', className = '' }: Props) {
  const [exact, setExact] = useState(false);
  const compact = formatTomanCompact(amount);
  const full = formatToman(amount);
  const same = compact === full;
  return (
    <button
      type="button"
      onClick={() => !same && setExact((v) => !v)}
      aria-expanded={same ? undefined : exact}
      aria-label={`${prefix ? prefix + ' ' : ''}${full}${suffix ? ' ' + suffix : ''}${same ? '' : ' - ' + t.money.exactOnTap}`}
      className={`inline-flex min-h-touch items-center gap-1 rounded-lg text-start font-bold ${
        size === 'lg' ? 'text-lg' : 'text-base'
      } ${same ? 'cursor-default' : 'underline decoration-dotted decoration-line-strong underline-offset-4'} ${className}`}
    >
      {prefix && <span className="text-sm font-medium text-ink-soft">{prefix}</span>}
      <span>{exact ? full : compact}</span>
      {suffix && (
        <span className="text-sm font-medium text-ink-soft">
          <BidiText text={suffix} />
        </span>
      )}
    </button>
  );
}
