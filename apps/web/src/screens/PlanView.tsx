import type { PlanResponse, Stop, StopLine, StopShop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ChangedTag } from '../components/ReplanBanner';
import { CompatRow } from '../components/CompatChip';
import { CoverageTotal } from '../components/CoverageTotal';
import { FlagNote } from '../components/FlagNote';
import { EmptyState } from '../components/States';
import { Icon } from '../components/Icon';
import { PriceBlock } from '../components/PriceBlock';
import { StateBadge } from '../components/StateBadge';
import { StopCard, StopConnector } from '../components/StopCard';
import { t } from '../copy/fa';
import { formatCount, formatJalaliDate, formatTomanCompact } from '../lib/format';
import { altLabel } from '../lib/alternatives';
import { missingGroups, planMarker } from '../lib/items';
import { shopsOf } from '../lib/stops';
import { useUi } from '../store/ui';

interface Props {
  plan: PlanResponse;
  busy: boolean;
  /** Item ids whose row changed in the last replan (highlighted). */
  changed?: ReadonlySet<string>;
  onShowSeller: (line: StopLine, stop: Stop, shop: StopShop) => void;
  onChangeItem: (itemId: string) => void;
  onSwitchVariant: (id: string | null) => void;
  /** Opens the assistant sheet; `shopId` when it was opened from a shop's card («بدون این مغازه»). */
  onOpenAssistant: (shopId?: string) => void;
  onOpenTime: () => void;
  onGoList: () => void;
}

/** «برنامه»: plan block, stops, compat block, totals with coverage. */
export function PlanView({ plan, busy, changed, onShowSeller, onChangeItem, onSwitchVariant, onOpenAssistant, onOpenTime, onGoList }: Props) {
  const setAbout = useUi((s) => s.setAbout);

  if (plan.coverage.covered === 0 && plan.unpriced.length === 0) {
    return (
      <EmptyState title={t.plan.emptyHeading} body={t.plan.emptyBody} icon="route">
        <Button variant="primary" onClick={onGoList}>
          {t.plan.toList}
        </Button>
      </EmptyState>
    );
  }

  const missing = missingGroups(plan);
  const shopTotal = plan.stops.reduce((k, st) => k + shopsOf(st).length, 0);
  return (
    <div className="space-y-4" aria-busy={busy || undefined} data-testid="plan-view">
      <Card as="section" aria-labelledby="plan-h">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="plan-h" className="text-lg">
            {plan.complete ? t.plan.heading : t.plan.incompleteHeading}
          </h2>
          {!plan.complete && (
            <span className="rounded-chip bg-amber-soft px-3 py-0.5 text-sm font-bold text-amber-ink" data-testid="incomplete-badge">
              {t.total.partialBadge}
            </span>
          )}
        </div>
        <CoverageTotal
          className="mt-2"
          covered={plan.coverage.covered}
          total={plan.coverage.total}
          amount={plan.totalToman}
          usesSuggestions={plan.usesSuggestions}
          missing={missing}
          marker={planMarker(plan)}
          line={plan.totalLine}
        />
        <p className="mt-2 text-sm text-ink-soft">
          {t.plan.stops(plan.stops.length)}
          {shopTotal > plan.stops.length ? ` · ${t.plan.shopsCount(shopTotal)}` : ''} · <BidiText text={plan.reason} />
        </p>
        <p className="text-sm text-ink-soft">{t.plan.orderNote}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" icon="clock" onClick={onOpenTime}>
            {t.plan.changeTime}
          </Button>
          <Button variant="secondary" icon="spark" onClick={() => onOpenAssistant()} data-testid="open-assistant">
            {t.plan.assistant}
          </Button>
        </div>
      </Card>

      {plan.closedNotes.map((n) => (
        <Card key={n.text} tone="amber" role="note">
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-ink">
            <Icon name="clock" size={18} className="mt-1" />
            <span>
              <BidiText text={n.text} />
            </span>
          </p>
        </Card>
      ))}

      <div>
        {plan.stops.map((stop, i) => (
          <div key={stop.id}>
            <StopCard
              stop={stop}
              number={i + 1}
              visitActive={plan.visitActive}
              renderLines={(shop) =>
                shop.lines.map((line) => (
                  <LineBlock
                    key={line.itemId}
                    line={line}
                    changed={changed?.has(line.itemId)}
                    onShowSeller={() => onShowSeller(line, stop, shop)}
                    onChange={() => onChangeItem(line.itemId)}
                  />
                ))
              }
              renderShopActions={(shop) => (
                <Button variant="ghost" icon="x-circle" className="mt-1" onClick={() => onOpenAssistant(shop.shopId)} data-testid="without-shop">
                  {t.plan.withoutShop}
                </Button>
              )}
            />
            {stop.distanceToNext != null && i < plan.stops.length - 1 && <StopConnector metres={stop.distanceToNext} />}
          </div>
        ))}
      </div>

      {plan.unpriced.length > 0 && (
        <Card as="section" tone="sunken" aria-labelledby="unpriced-h">
          <h3 id="unpriced-h" className="flex items-center gap-2 text-base">
            <Icon name="tag-off" size={18} />
            {t.plan.unpricedHeading}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">{t.plan.unpricedHint}</p>
          <ul className="mt-2 space-y-3">
            {plan.unpriced.map((u) => (
              <li key={u.itemId}>
                <p className="text-sm font-semibold">
                  <BidiText text={u.name} />
                </p>
                <ul className="mt-1 text-sm text-ink-soft">
                  {u.sellers.map((s) => (
                    <li key={s.shopName}>
                      <BidiText text={s.shopName} /> · <BidiText text={[s.mall, s.floor, s.unit].filter(Boolean).join(' · ')} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {plan.compat.length > 0 && (
        <Card as="section" aria-labelledby="compat-h" data-testid="compat-block">
          <h3 id="compat-h" className="mb-3 text-base">
            {t.plan.compatHeading}
          </h3>
          <ul>
            {plan.compat.map((c) => (
              <CompatRow key={c.id} line={c} />
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" aria-labelledby="alt-h" tone="sunken">
        <h3 id="alt-h" className="mb-2 text-base">
          {t.plan.altHeading}
        </h3>
        {plan.alternatives.length === 0 ? (
          <p className="text-sm text-ink-soft">
            <BidiText text={plan.noAlternativesReason ?? ''} />
          </p>
        ) : (
          <div role="radiogroup" aria-labelledby="alt-h" className="space-y-1">
            <AltRow checked label={t.plan.altCurrent} description={`${t.plan.stops(plan.stops.length)}`} deltaStops={0} onSelect={() => onSwitchVariant(null)} />
            {plan.alternatives.map((a) => (
              <AltRow
                key={a.id}
                checked={false}
                label={altLabel(a, plan.alternatives, plan.stops.length)}
                description={a.description}
                deltaStops={a.deltaStops}
                onSelect={() => onSwitchVariant(a.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <p className="flex items-start justify-between gap-2 text-sm text-ink-soft">
        <span>{t.plan.dataFooter}</span>
        <button
          type="button"
          onClick={() => setAbout(true)}
          className="min-h-touch shrink-0 font-semibold text-accent-ink underline underline-offset-4"
        >
          {t.header.about}
        </button>
      </p>
    </div>
  );
}

function AltRow({ checked, label, description, deltaStops, onSelect }: { checked: boolean; label: string; description: string; deltaStops: number; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid={checked ? 'alt-current' : 'alt-option'}
      data-delta-stops={deltaStops}
      onClick={onSelect}
      className="flex min-h-touch w-full items-start gap-3 rounded-xl px-2 py-2 text-start hover:bg-white/70"
    >
      <span
        aria-hidden="true"
        className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-accent' : 'border-line-strong'}`}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
      </span>
      <span className="text-sm">
        <span className="font-bold">
          <BidiText text={label} />
        </span>
        {': '}
        <BidiText text={description} />
      </span>
    </button>
  );
}

function LineBlock({ line, changed, onShowSeller, onChange }: { line: StopLine; changed?: boolean; onShowSeller: () => void; onChange: () => void }) {
  return (
    <div
      data-testid="stop-line"
      data-state={line.state}
      data-item={line.itemId}
      data-changed={changed || undefined}
      className={`rounded-xl border p-3 ${changed ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/40' : 'border-line bg-canvas'}`}
    >
      {changed && (
        <p className="mb-1">
          <ChangedTag />
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p data-testid="stop-product" className="min-w-0 flex-1 text-base font-bold leading-snug">
          {line.qty > 1 || line.unitLabel ? `${formatCount(line.qty)} × ` : ''}
          <BidiText text={line.productName} />
        </p>
        <StateBadge state={line.state} />
      </div>
      <p className="mt-1 text-sm text-ink-soft [overflow-wrap:anywhere]">
        «<BidiText text={line.listingTitle} />»
      </p>
      {(line.flagLabels?.length || line.flags?.length) ? (
        <p className="mt-1">
          <FlagNote flags={line.flags} flagLabels={line.flagLabels} />
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
        {line.unitPrice != null && (
          <PriceBlock amount={line.unitPrice} suffix={line.unitLabel ?? (line.qty > 1 ? t.plan.each : undefined)} />
        )}
        <span className="text-ink-soft">
          <BidiText text={line.warranty} />
        </span>
      </div>
      {line.lineTotal != null && line.qty > 1 && (
        <p className="text-sm text-ink-soft">
          {t.money.total}: <span className="font-bold text-ink">{formatTomanCompact(line.lineTotal)}</span>
        </p>
      )}
      <p className="text-sm text-ink-soft">{t.plan.priceChanged(formatJalaliDate(line.priceChangedAt))}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onShowSeller} data-testid="show-seller">
          {t.plan.showSeller}
        </Button>
        <Button variant="ghost" onClick={onChange}>
          {t.plan.change}
        </Button>
      </div>
    </div>
  );
}
