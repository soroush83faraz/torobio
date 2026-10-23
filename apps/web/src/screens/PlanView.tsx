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
import { ProductThumb } from '../components/ProductThumb';
import { StateBadge } from '../components/StateBadge';
import { StopCard, StopConnector } from '../components/StopCard';
import { RouteMap, routeHasMap } from '../components/map/RouteMap';
import { t } from '../copy/fa';
import { formatCount, formatJalaliDate, formatTomanCompact } from '../lib/format';
import { altLabel } from '../lib/alternatives';
import { safeImageUrl } from '../lib/images';
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

/**
 * «برنامه»: the plan at a glance (route map + total), the stops as a numbered timeline with product images and the
 * shop's floor / unit, then compat, unpriced items and the alternatives as side-by-side comparison cards.
 */
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
  const hasMap = routeHasMap(plan.stops);
  return (
    <div className="space-y-5" aria-busy={busy || undefined} data-testid="plan-view">
      {/* ---------- the plan at a glance: route map + total ---------- */}
      <section aria-labelledby="plan-h" className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {hasMap && <RouteMap stops={plan.stops} className="h-52 border-b border-line" />}
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="plan-h" className="text-lg font-extrabold">
              {plan.complete ? t.plan.heading : t.plan.incompleteHeading}
            </h2>
            {!plan.complete && (
              <span className="rounded-chip bg-amber-soft px-3 py-0.5 text-sm font-bold text-amber-ink" data-testid="incomplete-badge">
                {t.total.partialBadge}
              </span>
            )}
          </div>
          <CoverageTotal
            className="mt-1.5"
            covered={plan.coverage.covered}
            total={plan.coverage.total}
            amount={plan.totalToman}
            usesSuggestions={plan.usesSuggestions}
            missing={missing}
            marker={planMarker(plan)}
            line={plan.totalLine}
            countUp
          />
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="inline-flex items-center gap-1 rounded-chip bg-sunken px-2.5 font-bold text-ink">
              <Icon name="route" size={15} className="text-accent" />
              {t.plan.stops(plan.stops.length)}
            </span>
            {shopTotal > plan.stops.length && <span className="rounded-chip bg-sunken px-2.5 font-bold text-ink">{t.plan.shopsCount(shopTotal)}</span>}
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            <BidiText text={plan.reason} />
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
        </div>
      </section>

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

      {/* ---------- stops as a timeline ---------- */}
      <section aria-label={t.plan.timeline}>
        <ol className={`relative ${plan.stops.length > 1 ? 'ps-11' : ''}`}>
          {plan.stops.length > 1 && (
            <span aria-hidden="true" className="absolute bottom-12 start-[17px] top-6 border-s-2 border-dashed border-line-strong/40" />
          )}
          {plan.stops.map((stop, i) => (
            <li key={stop.id} className={i < plan.stops.length - 1 && stop.distanceToNext == null ? 'pb-5' : ''}>
              <StopCard
                stop={stop}
                number={i + 1}
                timeline={plan.stops.length > 1}
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
            </li>
          ))}
        </ol>
      </section>

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

      {/* ---------- alternatives: side-by-side comparison ---------- */}
      <section aria-labelledby="alt-h">
        <h3 id="alt-h" className="mb-1 text-base font-extrabold">
          {t.plan.altHeading}
        </h3>
        {plan.alternatives.length === 0 ? (
          <p className="rounded-card bg-sunken px-4 py-3 text-sm text-ink-soft">
            <BidiText text={plan.noAlternativesReason ?? ''} />
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-soft">{t.plan.altCompare}</p>
            <div role="radiogroup" aria-labelledby="alt-h" className="grid grid-cols-2 gap-3">
              <AltCard
                checked
                label={t.plan.altCurrent}
                kindLabel={t.plan.altNow}
                stops={plan.stops.length}
                total={plan.totalToman}
                deltaToman={0}
                deltaStops={0}
                onSelect={() => onSwitchVariant(null)}
              />
              {plan.alternatives.map((a) => (
                <AltCard
                  key={a.id}
                  checked={false}
                  label={altLabel(a, plan.alternatives, plan.stops.length)}
                  description={a.description}
                  kindLabel={a.kindLabel}
                  stops={a.stopCount ?? Math.max(1, plan.stops.length + a.deltaStops)}
                  total={plan.totalToman + a.deltaToman}
                  deltaToman={a.deltaToman}
                  deltaStops={a.deltaStops}
                  onSelect={() => onSwitchVariant(a.id)}
                />
              ))}
            </div>
          </>
        )}
      </section>

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

/** One plan in the comparison: what it costs and how many stops, the difference against the current plan in colour. */
function AltCard({
  checked,
  label,
  description,
  kindLabel,
  stops,
  total,
  deltaToman,
  deltaStops,
  onSelect,
}: {
  checked: boolean;
  label: string;
  description?: string;
  kindLabel?: string;
  stops: number;
  total: number;
  deltaToman: number;
  deltaStops: number;
  onSelect: () => void;
}) {
  const money =
    deltaToman === 0 ? null : deltaToman > 0 ? t.plan.altDeltaMore(formatTomanCompact(deltaToman)) : t.plan.altDeltaLess(formatTomanCompact(-deltaToman));
  const hops = deltaStops === 0 ? null : deltaStops > 0 ? t.plan.altStopsMore(deltaStops) : t.plan.altStopsLess(-deltaStops);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid={checked ? 'alt-current' : 'alt-option'}
      data-delta-stops={deltaStops}
      onClick={onSelect}
      className={`flex min-h-touch flex-col items-start gap-1 rounded-card border p-3 text-start transition-[border-color,box-shadow] duration-200 ${
        checked ? 'border-accent bg-accent-soft/50 ring-2 ring-accent/25' : 'border-line bg-surface shadow-card hover:border-line-strong/60 hover:shadow-raised'
      }`}
    >
      <span className="flex w-full items-center justify-between gap-2">
        {kindLabel ? (
          <span data-testid={checked ? undefined : 'alt-kind'} className={`rounded-chip px-2 text-sm font-bold ${checked ? 'bg-accent text-white' : 'bg-sunken text-ink-soft'}`}>
            {kindLabel}
          </span>
        ) : (
          <span />
        )}
        <span aria-hidden="true" className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-accent' : 'border-line-strong'}`}>
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
        </span>
      </span>
      <span className="text-base font-extrabold leading-snug">
        <BidiText text={label} />
      </span>
      <span className="num text-lg font-extrabold leading-tight text-ink">{formatTomanCompact(total)}</span>
      <span className="flex flex-wrap gap-1 text-sm">
        {checked ? (
          <span className="text-ink-soft">{t.plan.stops(stops)}</span>
        ) : (
          <>
            {money && <span className={`rounded-lg px-1.5 font-bold ${deltaToman > 0 ? 'bg-saffron-soft text-saffron-ink' : 'bg-accent-soft text-accent-ink'}`}>{money}</span>}
            {hops && <span className={`rounded-lg px-1.5 font-bold ${deltaStops < 0 ? 'bg-accent-soft text-accent-ink' : 'bg-sunken text-ink'}`}>{hops}</span>}
          </>
        )}
      </span>
      {description && (
        <span className="text-sm text-ink-soft">
          <BidiText text={description} />
        </span>
      )}
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
      className={`rounded-2xl p-3 ${changed ? 'border border-accent bg-accent-soft/60 ring-2 ring-accent/40' : 'bg-sunken/45'}`}
    >
      {changed && (
        <p className="mb-1">
          <ChangedTag />
        </p>
      )}
      <div className="flex items-start gap-3">
        <ProductThumb src={safeImageUrl(line.imageUrl)} size={56} />
        <div className="min-w-0 flex-1">
          <p data-testid="stop-product" className="text-base font-bold leading-snug">
            {line.qty > 1 || line.unitLabel ? <span className="num text-accent-ink">{`${formatCount(line.qty)} × `}</span> : ''}
            <BidiText text={line.productName} />
          </p>
          <div className="mt-1">
            <StateBadge state={line.state} />
          </div>
        </div>
      </div>
      {line.unitPrice != null && (
        <div className="mt-2">
          <PriceBlock amount={line.unitPrice} suffix={line.unitLabel ?? (line.qty > 1 ? t.plan.each : undefined)} />
        </div>
      )}
      <p className="mt-2 text-sm text-ink-soft [overflow-wrap:anywhere]">
        «<BidiText text={line.listingTitle} />»
      </p>
      {line.flagLabels?.length || line.flags?.length ? (
        <p className="mt-1">
          <FlagNote flags={line.flags} flagLabels={line.flagLabels} />
        </p>
      ) : null}
      <p className="mt-1 text-sm text-ink-soft">
        <BidiText text={line.warranty} />
      </p>
      {line.lineTotal != null && line.qty > 1 && (
        <p className="text-sm text-ink-soft">
          {t.money.total}: <span className="num font-bold text-ink">{formatTomanCompact(line.lineTotal)}</span>
        </p>
      )}
      <p className="text-sm text-ink-soft">{t.plan.priceChanged(formatJalaliDate(line.priceChangedAt))}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" icon="eye" onClick={onShowSeller} data-testid="show-seller">
          {t.plan.showSeller}
        </Button>
        <Button variant="ghost" onClick={onChange}>
          {t.plan.change}
        </Button>
      </div>
    </div>
  );
}
