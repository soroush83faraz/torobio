import { AnimatePresence, motion } from 'motion/react';
import type { PlanResponse, Stop, StopLine, StopShop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ChangedTag } from '../components/ReplanBanner';
import { CoverageTotal } from '../components/CoverageTotal';
import { Icon } from '../components/Icon';
import { ProductThumb } from '../components/ProductThumb';
import { ReportBadge } from '../components/ReportBadge';
import { EmptyState } from '../components/States';
import { FlagNote } from '../components/FlagNote';
import { StateBadge } from '../components/StateBadge';
import { StopCard } from '../components/StopCard';
import { AnimatedCheck, ProgressRing, ease, spring } from '../components/motion';
import { safeImageUrl } from '../lib/images';
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

/**
 * «در بازارم»: in-the-shop mode for one hand. Big check-off rows with the product image, a prominent «نشان بده به
 * فروشنده», two clear report actions, and the progress pinned to the bottom (the thumb's reach). Bought rows fold
 * down. Dataset facts and user reports stay visibly separate.
 */
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
      {/* the dock at the bottom shows the progress; this stays for screen readers and the page outline */}
      <div className="sr-only-fa">
        <h2>{t.market.heading}</h2>
        <p data-testid="market-progress">
          {t.market.progress(done, lines.length)}
        </p>
      </div>

      <div className="space-y-4">
        {plan.stops.map((stop, i) => {
          const stopDone = allLines([stop]).every((l) => saved.checks[l.itemId]);
          return (
            <StopCard
              key={stop.id}
              stop={stop}
              number={i + 1}
              visitActive={plan.visitActive}
              current={currentStop?.id === stop.id}
              compact
              done={stopDone}
              intro={
                currentStop?.id === stop.id ? (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-chip bg-accent-soft px-3 text-sm font-bold text-accent-ink">
                    <Icon name="pin" size={14} />
                    {t.market.currentStop}
                  </p>
                ) : stopDone ? (
                  <p className="mt-1 inline-flex items-center gap-1 rounded-chip bg-good-soft px-3 text-sm font-bold text-good-ink">
                    <Icon name="check" size={14} />
                    {t.market.stopDone}
                  </p>
                ) : undefined
              }
              renderLines={(shop) =>
                shop.lines.map((line) => (
                  <MarketRow
                    key={line.itemId}
                    line={line}
                    plan={plan}
                    checked={!!saved.checks[line.itemId]}
                    changed={!!changed?.has(line.itemId)}
                    report={reportFor(saved, line)}
                    onToggle={() => onToggle(line.itemId)}
                    onShowSeller={() => onShowSeller(line, stop, shop)}
                    onUnavailable={() => onUnavailable(line, stop, shop)}
                    onPriceDiffers={() => onPriceDiffers(line, stop, shop)}
                    onPaid={() => onPaid(line, stop, shop)}
                    onRemoveReport={() => onRemoveReport(line.itemId)}
                    onOptions={() => onOptions(line, stop, shop)}
                  />
                ))
              }
            />
          );
        })}
      </div>

      {plan.unpriced.length > 0 && (
        <Card tone="sunken" as="section">
          <h3 className="flex items-center gap-2 text-base">
            <Icon name="tag-off" size={18} />
            {t.market.noPriceTitle}
          </h3>
          <ul className="mt-2 space-y-2">
            {plan.unpriced.map((u) => (
              <li key={u.itemId} className="flex items-center gap-3">
                <CheckButton checked={!!saved.checks[u.itemId]} label={t.market.checkLabel(u.name)} onClick={() => onToggle(u.itemId)} />
                <span className="text-base font-semibold">
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
      {/* room for the progress bar pinned at the bottom */}
      <div className="h-24" aria-hidden="true" />

      <ProgressDock done={done} total={lines.length} next={currentStop?.mall} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CheckButton({ checked, label, onClick, big = false }: { checked: boolean; label: string; onClick: () => void; big?: boolean }) {
  const size = big ? 'h-14 w-14 rounded-2xl' : 'h-12 w-12 rounded-xl';
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      data-testid="check"
      whileTap={{ scale: 0.9 }}
      animate={checked ? { scale: [1, 1.14, 1] } : { scale: 1 }}
      transition={checked ? { duration: 0.42, ease: ease.out } : spring.press}
      className={`relative inline-flex shrink-0 items-center justify-center border-2 transition-colors duration-200 ${size} ${
        checked ? 'animate-resolved border-good bg-good text-white' : 'border-line-strong bg-surface text-transparent hover:border-good'
      }`}
    >
      {checked ? <AnimatedCheck key="on" size={big ? 30 : 26} /> : <Icon name="check" size={big ? 30 : 26} strokeWidth={2.6} />}
    </motion.button>
  );
}

function MarketRow({
  line,
  plan,
  checked,
  changed,
  report,
  onToggle,
  onShowSeller,
  onUnavailable,
  onPriceDiffers,
  onPaid,
  onRemoveReport,
  onOptions,
}: {
  line: StopLine;
  plan: PlanResponse;
  checked: boolean;
  changed: boolean;
  report?: Report;
  onToggle: () => void;
  onShowSeller: () => void;
  onUnavailable: () => void;
  onPriceDiffers: () => void;
  onPaid: () => void;
  onRemoveReport: () => void;
  onOptions: () => void;
}) {
  const ask = askForLine(line, plan.compat);
  return (
    <div
      data-testid="market-line"
      data-checked={checked}
      data-changed={changed || undefined}
      className={`rounded-2xl border p-3 transition-colors duration-300 ${
        changed ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/40' : checked ? 'border-good/30 bg-good-soft/50' : 'border-line bg-canvas'
      }`}
    >
      {changed && (
        <p className="mb-1">
          <ChangedTag />
        </p>
      )}
      <div className="flex items-start gap-3">
        <CheckButton big checked={checked} label={t.market.checkLabel(line.productName)} onClick={onToggle} />
        <div className="min-w-0 flex-1">
          <p className={`text-lg font-bold leading-snug transition-colors ${checked ? 'text-ink-soft line-through decoration-good/60 decoration-2' : ''}`}>
            <span className="num text-accent-ink">{formatCount(line.qty)} × </span>
            <BidiText text={line.productName} />
          </p>
          {/* dataset fact: normal style */}
          <p className="mt-0.5 text-sm text-ink-soft" data-testid="dataset-price">
            {line.unitPrice != null ? t.market.datasetPrice(formatTomanCompact(line.unitPrice), formatJalaliShort(line.priceChangedAt)) : ''}
            {line.unitLabel ? (
              <>
                {' · '}
                <BidiText text={line.unitLabel} />
              </>
            ) : (
              ''
            )}
          </p>
        </div>
        <ProductThumb src={safeImageUrl(line.imageUrl)} size={56} className={checked ? 'opacity-60' : ''} />
      </div>

      <AnimatePresence initial={false}>
        {!checked && (
          <motion.div
            key="details"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StateBadge state={line.state} />
              <FlagNote flags={line.flags} flagLabels={line.flagLabels} />
            </div>
            {ask.length > 0 && (
              <div data-testid="market-ask" className="mt-2 rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                <span className="font-bold">{t.plan.askSeller}: </span>
                {ask.map((q, k) => (
                  <span key={q}>
                    {k > 0 ? ' · ' : ''}
                    <BidiText text={q} />
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {report && (
        <div className="mt-2">
          <ReportBadge report={report} onRemove={onRemoveReport} />
        </div>
      )}

      {checked ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" icon="tag-off" onClick={onPaid}>
            {t.market.paidPrice}
          </Button>
          <Button variant="ghost" icon="eye" onClick={onShowSeller} data-testid="show-seller">
            {t.market.showSeller}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Button variant="primary" size="lg" block icon="eye" onClick={onShowSeller} data-testid="show-seller" className="!rounded-2xl text-base font-extrabold">
            {t.market.showSeller}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onUnavailable} data-testid="mark-unavailable" className="!rounded-2xl !px-2">
              {t.market.unavailable}
            </Button>
            <Button variant="secondary" onClick={onPriceDiffers} data-testid="price-differs" className="!rounded-2xl !px-2">
              {t.market.priceDiffers}
            </Button>
          </div>
          {report?.kind === 'unavailable' && (
            <Button variant="ghost" icon="swap" onClick={onOptions}>
              {t.market.replanTitle}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The progress, pinned where the thumb is: «۲ از ۴ مورد» with a ring and the next stop. */
function ProgressDock({ done, total, next }: { done: number; total: number; next?: string }) {
  const all = total > 0 && done >= total;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-canvas via-canvas/85 to-transparent pt-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="page pb-3">
        <div
          role="status"
          aria-live="polite"
          data-testid="market-dock"
          className="surface-coal pointer-events-auto flex min-h-[60px] items-center gap-3 rounded-[20px] px-3 py-2 text-coal-ink shadow-raised"
        >
          <ProgressRing value={total ? done / total : 0} size={44} stroke={4} trackClass="text-white/20" arcClass="text-good-bright">
            {all ? <Icon name="check" size={20} className="text-good-bright" /> : null}
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={done}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
                transition={{ duration: 0.3, ease: ease.out }}
                className="text-lg font-extrabold leading-tight"
              >
                {all ? t.market.allDone : t.market.progressShort(done, total)}
              </motion.p>
            </AnimatePresence>
            {!all && next && (
              <p className="truncate text-sm text-coal-soft">
                <BidiText text={t.market.nextStop(next)} />
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
