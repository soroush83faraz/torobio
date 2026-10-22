import { degradedKind, degradedText, useLlmConfigured } from '../api/health';
import type { DegradedReason } from '../api/types';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import type { LineChange } from '../lib/planDiff';
import type { ReactNode } from 'react';
import { BidiText, Interp } from './Bdi';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';

export interface ReplanInfo {
  /** 'report' (default): the user reported «موجود نیست». 'assist': the assistant changed the requirement state. */
  kind?: 'report' | 'assist';
  /** The shop the user reported as «موجود نیست» (report). */
  reportedShop?: string;
  /** The assistant's one-line Persian reason (assist). */
  message?: string;
  /** The server-side assistant was not used for this change (assist): a calm line says so. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
  /** A newer assistant answer changed nothing: this banner shows the LAST change, not the latest answer. */
  superseded?: boolean;
  /** Number of stops before / after (shown when it changed). */
  stopsBefore?: number;
  stopsAfter?: number | null;
  /** null while the new plan is being computed. */
  changes: LineChange[] | null;
  totalBefore: number;
  totalAfter: number | null;
}

interface Props {
  info: ReplanInfo;
  onUndo: () => void;
  onDismiss: () => void;
  onOthers: () => void;
}

function describe(c: LineChange): ReactNode {
  switch (c.kind) {
    case 'replaced':
      return <Interp tpl={t.replan.replaced} args={[c.fromShop ?? '', c.toShop ?? '']} />;
    case 'repriced':
      return t.replan.repriced(formatTomanCompact(c.fromPrice ?? 0), formatTomanCompact(c.toPrice ?? 0));
    case 'dropped':
      return t.replan.dropped;
    case 'added':
      return <Interp tpl={t.replan.added} args={[c.toShop ?? '']} />;
  }
}

/**
 * After «موجود نیست»: the shop is excluded for that item, the plan is recomputed, and the changed rows are
 * listed here (and highlighted in the plan). «برگرداندن» restores the state from before the report.
 */
export function ReplanBanner({ info, onUndo, onDismiss, onOthers }: Props) {
  const { changes } = info;
  const assist = info.kind === 'assist';
  const llm = useLlmConfigured();
  return (
    <Card as="section" tone="accent" role="status" aria-live="polite" data-testid="replan-diff" className="space-y-2">
      <h3 className="flex items-center gap-2 text-base">
        <Icon name="refresh" size={18} />
        {assist ? t.replan.assistTitle : t.replan.title}
      </h3>
      {assist ? (
        <>
          {info.degraded && (
            <p data-testid="assist-degraded" className="rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber-ink">
              {degradedText(degradedKind(info.degradedReason, llm))}
            </p>
          )}
          {info.message && (
            <p data-testid="assist-message" className="flex items-start gap-2 rounded-xl bg-canvas px-3 py-2 text-sm font-semibold">
              <Icon name="spark" size={16} className="mt-1 shrink-0 text-ink-soft" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {info.superseded && <span data-testid="assist-last-change" className="font-bold">{t.assistant.lastChange}{': '}</span>}
                <BidiText text={info.message} />
              </span>
            </p>
          )}
        </>
      ) : (
        <p
          data-testid="replan-report"
          className="flex items-start gap-2 rounded-xl border-2 border-dashed border-line-strong bg-canvas px-3 py-2 text-sm font-semibold"
        >
          <Icon name="user" size={16} className="mt-1 text-ink-soft" />
          <span>
            <Interp tpl={t.replan.reported} args={[info.reportedShop ?? '']} />
          </span>
        </p>
      )}
      {changes === null ? (
        <p className="text-sm text-ink-soft">{assist ? t.assistant.working : t.replan.pending}</p>
      ) : changes.length === 0 ? (
        <p className="text-sm">{assist ? t.replan.onlyConditions : t.replan.nothingChanged}</p>
      ) : (
        <ul className="space-y-1.5">
          {changes.map((c) => (
            <li key={c.itemId} data-testid="replan-change" data-kind={c.kind} className="text-sm">
              <span className="font-bold">
                <BidiText text={c.name} />
              </span>
              {': '}
              {describe(c)}
            </li>
          ))}
        </ul>
      )}
      {changes && info.stopsBefore != null && info.stopsAfter != null && info.stopsAfter !== info.stopsBefore && (
        <p data-testid="replan-stops" className="text-sm font-semibold">
          {t.replan.stopsChange(info.stopsBefore, info.stopsAfter)}
        </p>
      )}
      {changes && info.totalAfter != null && info.totalAfter !== info.totalBefore && (
        <p className="text-sm font-semibold">{t.replan.total(formatTomanCompact(info.totalAfter), formatTomanCompact(info.totalBefore))}</p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary" onClick={onUndo} data-testid="replan-undo">
          {t.replan.undo}
        </Button>
        {!assist && (
          <Button variant="secondary" onClick={onOthers}>
            {t.replan.others}
          </Button>
        )}
        <Button variant="ghost" onClick={onDismiss}>
          {t.replan.dismiss}
        </Button>
      </div>
    </Card>
  );
}

/** Marks a changed row so it is easy to find in the plan. */
export function ChangedTag() {
  return (
    <span data-testid="changed-tag" className="rounded-chip bg-accent px-2.5 py-0.5 text-xs font-bold text-white">
      {t.replan.changedTag}
    </span>
  );
}
