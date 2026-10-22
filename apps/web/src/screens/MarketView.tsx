import type { PlanResponse, Stop, StopLine, StopShop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ChangedTag } from '../components/ReplanBanner';
import { CoverageTotal } from '../components/CoverageTotal';
import { Icon } from '../components/Icon';
import { ReportBadge } from '../components/ReportBadge';
import { EmptyState } from '../components/States';
import { FlagNote } from '../components/FlagNote';
import { StateBadge } from '../components/StateBadge';
import { StopCard } from '../components/StopCard';
import { missingGroups, planMarker } from '../lib/items';
import { askForLine } from '../lib/ask';
import { allLines } from '../lib/stops';
import { t } from '../copy/fa';
import { formatCount, formatJalaliShort, formatTomanCompact } from '../lib/format';
import type { Report, SavedPlan } from '../store/plans';

interface Props {
  saved: SavedPlan;
  plan: PlanResponse;
  /** Item ids whose row changed in the last replan (highlighted). */
  changed?: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  onShowSeller: (line: StopLine, stop: Stop, shop: StopShop) => void;
  onUnavailable: (line: StopLine, stop: Stop, shop: StopShop) => void;
  onPriceDiffers: (line: StopLine, stop: Stop, shop: StopShop) => void;
  onPaid: (line: StopLine, stop: Stop, shop: StopShop) => void;
  onRemoveReport: (itemId: string) => void;
  onOptions: (line: StopLine, stop: Stop, shop: StopShop) => void;
}

/** A report only counts for the shop it was made about. */
const reportFor = (saved: SavedPlan, line: StopLine): Report | undefined => {
  const r = saved.reports[line.itemId];
  return r && r.shopId === line.shopId ? r : undefined;
};

/** «در بازارم»: checklist only, requirements hidden. Dataset facts and user reports stay visibly separate. */
export function MarketView({ saved, plan, changed, onToggle, onShowSeller, onUnavailable, onPriceDiffers, onPaid, onRemoveReport, onOptions }: Props) {
  const lines = allLines(plan.stops);
  if (lines.length === 0 && plan.unpriced.length === 0) {
    return <EmptyState title={t.market.nothing} icon="bag" />;
  }
  const done = lines.filter((l) => saved.checks[l.itemId]).length;
  const currentStop = plan.stops.find((s) => allLines([s]).some((l) => !saved.checks[l.itemId]));

  // Second, separately labelled total: only when reports exist and they change something.
  const reports = lines.map((l) => ({ l, r: reportFor(saved, l) }));
  const hasMoneyReports = reports.some(({ r }) => r && r.kind !== 'available');
  let withReportsTotal = 0;
  let withReportsCount = 0;
  for (const { l, r } of reports) {
    if (r?.kind === 'unavailable') continue;
    withReportsCount += 1;
    const unit = r && (r.kind === 'price' || r.kind === 'paid') && r.price != null ? r.price : l.unitPrice ?? 0;
    withReportsTotal += unit * l.qty;
  }

  return (
    <div className="space-y-4" data-testid="market-view">
      <div>
        <h2 className="text-lg">{t.market.heading}</h2>
        <p className="text-sm text-ink-soft" data-testid="market-progress">
          {t.market.progress(done, lines.length)}
        </p>
      </div>

      <div className="space-y-4">
        {plan.stops.map((stop, i) => (
          <StopCard
            key={stop.id}
            stop={stop}
            number={i + 1}
            visitActive={plan.visitActive}
            current={currentStop?.id === stop.id}
            intro={
              currentStop?.id === stop.id ? (
                <p className="mt-2 inline-flex items-center gap-1 rounded-chip bg-accent-soft px-3 text-sm font-bold text-accent-ink">
                  <Icon name="pin" size={14} />
                  {t.market.currentStop}
                </p>
              ) : undefined
            }
            renderLines={(shop) =>
              shop.lines.map((line) => {
                const checked = !!saved.checks[line.itemId];
                const report = reportFor(saved, line);
                return (
                <div
                  key={line.itemId}
                  data-testid="market-line"
                  data-checked={checked}
                  data-changed={changed?.has(line.itemId) || undefined}
                  className={`rounded-xl border p-3 ${
                    changed?.has(line.itemId)
                      ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/40'
                      : checked
                        ? 'border-accent/40 bg-accent-soft/50'
                        : 'border-line bg-canvas'
                  }`}
                >
                  {changed?.has(line.itemId) && (
                    <p className="mb-1">
                      <ChangedTag />
                    </p>
                  )}
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={t.market.checkLabel(line.productName)}
                      onClick={() => onToggle(line.itemId)}
                      data-testid="check"
                      className={`mt-0.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 ${
                        checked ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-transparent'
                      }`}
                    >
                      <Icon name="check" size={26} strokeWidth={2.6} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-lg font-bold leading-snug ${checked ? 'text-ink-soft line-through' : ''}`}>
                        {formatCount(line.qty)} × <BidiText text={line.productName} />
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StateBadge state={line.state} />
                        <FlagNote flags={line.flags} flagLabels={line.flagLabels} />
                      </div>
                      {/* dataset fact: normal style */}
                      <p className="mt-1 text-sm text-ink-soft" data-testid="dataset-price">
                        {line.unitPrice != null
                          ? t.market.datasetPrice(formatTomanCompact(line.unitPrice), formatJalaliShort(line.priceChangedAt))
                          : ''}
                        {line.unitLabel ? (
                          <>
                            {' · '}
                            <BidiText text={line.unitLabel} />
                          </>
                        ) : (
                          ''
                        )}
                      </p>
                      {askForLine(line, plan.compat).length > 0 && (
                        <div data-testid="market-ask" className="mt-1 text-sm">
                          <span className="font-semibold text-amber-ink">{t.plan.askSeller}: </span>
                          {askForLine(line, plan.compat).map((q, k) => (
                            <span key={q}>
                              {k > 0 ? ' · ' : ''}
                              <BidiText text={q} />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {report && (
                    <div className="mt-2">
                      <ReportBadge report={report} onRemove={() => onRemoveReport(line.itemId)} />
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => onShowSeller(line, stop, shop)} data-testid="show-seller">
                      {t.plan.showSeller}
                    </Button>
                    <Button variant="secondary" onClick={() => onUnavailable(line, stop, shop)} data-testid="mark-unavailable">
                      {t.market.unavailable}
                    </Button>
                    <Button variant="secondary" onClick={() => onPriceDiffers(line, stop, shop)}>
                      {t.market.priceDiffers}
                    </Button>
                    {checked && (
                      <Button variant="ghost" onClick={() => onPaid(line, stop, shop)}>
                        {t.market.paidPrice}
                      </Button>
                    )}
                    {report?.kind === 'unavailable' && (
                      <Button variant="ghost" onClick={() => onOptions(line, stop, shop)}>
                        {t.market.replanTitle}
                      </Button>
                    )}
                  </div>
                </div>
                );
              })
            }
          />
        ))}
      </div>

      {plan.unpriced.length > 0 && (
        <Card tone="sunken" as="section">
          <h3 className="flex items-center gap-2 text-base">
            <Icon name="tag-off" size={18} />
            {t.market.noPriceTitle}
          </h3>
          <ul className="mt-2 space-y-2">
            {plan.unpriced.map((u) => (
              <li key={u.itemId} className="flex items-start gap-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!saved.checks[u.itemId]}
                  aria-label={t.market.checkLabel(u.name)}
                  onClick={() => onToggle(u.itemId)}
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 ${
                    saved.checks[u.itemId] ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface text-transparent'
                  }`}
                >
                  <Icon name="check" size={26} strokeWidth={2.6} />
                </button>
                <span className="pt-3 text-base font-semibold">
                  <BidiText text={u.name} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Totals: dataset first, user reports in a separate, visibly different block. */}
      <Card as="section" aria-labelledby="totals-h" data-testid="market-totals">
        <h3 id="totals-h" className="sr-only">
          {t.money.total}
        </h3>
        <CoverageTotal
          label={plan.datasetTotalLine ? undefined : t.total.byDataset}
          datasetLine={plan.datasetTotalLine}
          covered={plan.coverage.covered}
          total={plan.coverage.total}
          amount={plan.totalToman}
          usesSuggestions={plan.usesSuggestions}
          missing={missingGroups(plan)}
          marker={planMarker(plan)}
          line={plan.totalLine}
        />
        <p className="mt-1 text-sm text-ink-soft">{t.total.datasetOnly}</p>
      </Card>
      {hasMoneyReports && (
        <Card as="section" tone="report" data-testid="reports-total">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-soft">
            <Icon name="user" size={16} />
            {t.report.badge} · {t.report.deviceOnly}
          </p>
          <CoverageTotal
            label={t.total.withReports}
            covered={withReportsCount}
            total={plan.coverage.total}
            amount={withReportsTotal}
            missing={missingGroups(plan)}
          />
        </Card>
      )}
      <p className="text-sm text-ink-soft">{t.market.reportsNote}</p>
    </div>
  );
}
