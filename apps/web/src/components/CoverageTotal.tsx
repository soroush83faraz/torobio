import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import type { MissingGroup } from '../lib/items';
import { BidiText, Interp } from './Bdi';
import { Icon } from './Icon';
import { CountUp } from './motion/CountUp';

interface Props {
  covered: number;
  total: number;
  amount: number;
  usesSuggestions?: boolean;
  /** Items left out of the total, separated by why: «پیدا نشد» / «منتظر انتخاب» / «بدون قیمت». */
  missing?: MissingGroup[];
  /** Overrides the leading word, e.g. «جمع طبق فهرست». */
  label?: string;
  /** The server's marker («ناسازگاری دارد» / «بدون تأیید سازگاری», see `planMarker`): an amber chip sits next to the total. */
  marker?: string;
  /** The engine's own total line (Persian; ends with the marker when there is one); shown as given while `marker` is set. */
  line?: string;
  /**
   * The server's market-view total, worded once («جمع طبق فهرست برای ۴ مورد: …» / «جمع طبق فهرست، فقط ۳ از ۵ مورد: …»).
   * Rendered as given, with no `label` in front (that doubled «جمع»); only its «— marker» tail becomes the amber chip.
   */
  datasetLine?: string;
  /** Count the amount up (plan header). */
  countUp?: boolean;
  className?: string;
}

/** The engine appends «— <marker>» to the line; the chip beside it says the same, so the line drops its own copy. */
export function stripMarker(line: string, marker: string): string {
  const m = marker.trim();
  const at = line.trimEnd().lastIndexOf(m);
  if (at < 0 || line.trimEnd().length !== at + m.length) return line;
  const head = line.slice(0, at);
  // only the engine's own «— marker» tail is dropped; any other wording is shown as given
  return /\s*[\u2014\u2013]\s*$/u.test(head) ? head.replace(/\s*[\u2014\u2013]\s*$/u, '') || line : line;
}

/** «جمع» is already the label's word: «جمع طبق فهرست · ۴ مورد» (never «جمع طبق فهرست · جمع ۴ مورد»). */
export function dropLeadingTotalWord(text: string): string {
  return text.replace(/^جمع\s+/u, '');
}

function MarkerChip({ text }: { text: string }) {
  return (
    <span
      data-testid="conflict-chip"
      className="inline-flex items-center gap-1.5 rounded-chip border border-amber bg-amber-soft px-3 py-0.5 text-sm font-semibold text-amber-ink"
    >
      <Icon name="alert" size={15} />
      {text}
    </span>
  );
}

/**
 * B1.3: a total is never a bare number when anything is missing. Coverage sits on the same
 * line and at the same visual weight as the amount.
 *  - complete: «جمع ۵ مورد: ۱۸٫۴ میلیون تومان» (+ «با مدل‌های پیشنهادی»)
 *  - partial:  amber badge «فقط ۳ از ۵ مورد» + outlined amount, then what is missing.
 */
export function CoverageTotal({ covered, total, amount, usesSuggestions, missing = [], label, marker, line, datasetLine, countUp, className = '' }: Props) {
  if (covered === 0) {
    return (
      <p className={`text-base font-semibold text-ink-soft ${className}`} data-total="none">
        {t.total.nothing}
      </p>
    );
  }
  // the amount counts up when it first appears and glides when the plan changes (final text on first paint)
  const money = countUp ? <CountUp value={amount} format={(v) => formatTomanCompact(v)} /> : formatTomanCompact(amount);
  const complete = covered === total;
  if (datasetLine) {
    const text = marker ? stripMarker(datasetLine, marker) : datasetLine;
    return (
      <div className={className} data-total={complete ? 'complete' : 'partial'} data-conflict={marker ? 'true' : undefined}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
          <span data-testid="total-line" className={complete ? '' : 'rounded-lg bg-amber-soft px-2.5 py-0.5 text-amber-ink'}>
            <BidiText text={text} />
          </span>
          {marker && <MarkerChip text={marker} />}
        </p>
        {missing.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-ink-soft" data-testid="missing-groups">
            {missing.map((g) => (
              <li key={g.kind} data-kind={g.kind}>
                <Interp tpl={t.total.missingBy[g.kind]} args={[g.names.join('، ')]} />
              </li>
            ))}
          </ul>
        )}
        {usesSuggestions && <p className="text-sm text-ink-soft">{t.total.withSuggestions}</p>}
      </div>
    );
  }
  // A conflicted plan shows the engine's line as given (it carries the marker) with the amber chip beside it.
  if (marker && line) {
    return (
      <div className={className} data-total={complete ? 'complete' : 'partial'} data-conflict="true">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
          {label && <span>{label} ·</span>}
          <span data-testid="total-line">
            <BidiText text={label ? dropLeadingTotalWord(stripMarker(line, marker)) : stripMarker(line, marker)} />
          </span>
          <MarkerChip text={marker} />
        </p>
        {missing.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-ink-soft" data-testid="missing-groups">
            {missing.map((g) => (
              <li key={g.kind} data-kind={g.kind}>
                <Interp tpl={t.total.missingBy[g.kind]} args={[g.names.join('، ')]} />
              </li>
            ))}
          </ul>
        )}
        {usesSuggestions && <p className="text-sm text-ink-soft">{t.total.withSuggestions}</p>}
      </div>
    );
  }
  if (complete) {
    return (
      <div className={className} data-total="complete" data-conflict={marker ? 'true' : undefined}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
          <span>
            {label ? `${label} · ${dropLeadingTotalWord(t.total.complete(total))}` : t.total.complete(total)}
            <span className="text-accent-ink">
              {': '}
              {money}
            </span>
          </span>
          {marker && <MarkerChip text={marker} />}
        </p>
        {usesSuggestions && <p className="text-sm text-ink-soft">{t.total.withSuggestions}</p>}
      </div>
    );
  }
  return (
    <div className={className} data-total="partial" data-conflict={marker ? 'true' : undefined}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold">
        {label && <span>{label} ·</span>}
        <span className="whitespace-nowrap">
          <span className="rounded-lg bg-amber-soft px-2.5 py-0.5 text-amber-ink">{t.total.partial(covered, total)}</span>
          <span aria-hidden="true">{'\u00a0:'}</span>
        </span>
        <span className="whitespace-nowrap rounded-lg border-2 border-line-strong px-2.5 py-0.5">{money}</span>
        {marker && <MarkerChip text={marker} />}
      </p>
      {missing.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-sm text-ink-soft" data-testid="missing-groups">
          {missing.map((g) => (
            <li key={g.kind} data-kind={g.kind}>
              <Interp tpl={t.total.missingBy[g.kind]} args={[g.names.join('، ')]} />
            </li>
          ))}
        </ul>
      )}
      {usesSuggestions && <p className="text-sm text-ink-soft">{t.total.withSuggestions}</p>}
    </div>
  );
}
