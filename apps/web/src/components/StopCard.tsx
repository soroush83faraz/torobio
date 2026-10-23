import { useState, type ReactNode } from 'react';
import type { Stop, StopShop } from '../api/types';
import { t } from '../copy/fa';
import { formatTomanCompact } from '../lib/format';
import { shopsOf } from '../lib/stops';
import { BidiText, Interp } from './Bdi';
import { Icon } from './Icon';

interface Props {
  stop: Stop;
  /** Position of the card in the list (1-based): the number shown always equals the cards the user sees. */
  number: number;
  /** True when a day/time is set, so open/closed badges are meaningful. */
  visitActive: boolean;
  /** Highlights the stop the user is at (checklist mode). */
  current?: boolean;
  /** Every line of this stop is bought (checklist mode): the marker turns into a check. */
  done?: boolean;
  /** Anything shown between the stop header and its shops (e.g. «توقف فعلی»). */
  intro?: ReactNode;
  /** The lines bought at one shop of this stop. */
  renderLines: (shop: StopShop) => ReactNode;
  /** Optional per-shop actions under its lines (e.g. «بدون این مغازه»). */
  renderShopActions?: (shop: StopShop) => ReactNode;
  /**
   * Timeline layout: the numbered marker hangs in the gutter at the card's start side (the caller draws the rail);
   * the card itself carries no number.
   */
  timeline?: boolean;
  /** In the shop (checklist): the header keeps the mall and `intro` only (no counts or subtotal). */
  compact?: boolean;
  className?: string;
}

/** The stop's number disc: teal, the current stop in saffron, a finished stop as a check. */
export function StopMarker({ number, current, done, className = '' }: { number: number; current?: boolean; done?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="stop-number"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-extrabold ring-4 ring-canvas ${
        done ? 'bg-accent-soft text-accent-ink' : current ? 'bg-saffron text-ink shadow-[0_6px_16px_-6px_rgba(232,163,23,0.9)]' : 'surface-night text-night-ink shadow-card'
      } ${className}`}
    >
      {done ? <Icon name="check" size={20} strokeWidth={2.6} /> : new Intl.NumberFormat('fa-IR').format(number)}
    </span>
  );
}

/**
 * Stop = one building. Header: mall, how many shops, the stop's subtotal. Then one block per shop with its own
 * floor/unit chips, hours (+ open/closed at the chosen time), full address on tap and its own lines.
 */
export function StopCard({ stop, number, visitActive, current, done, intro, renderLines, renderShopActions, timeline, compact, className = '' }: Props) {
  const shops = shopsOf(stop);
  const multi = shops.length > 1;
  const lineCount = shops.reduce((k, s) => k + s.lines.length, 0);
  return (
    <section
      data-testid="stop"
      data-shop={shops[0]?.shopId}
      data-shop-count={shops.length}
      data-current={current || undefined}
      aria-label={t.plan.stopLabel(number)}
      className={`relative rounded-card border bg-surface shadow-card ${current ? 'border-saffron/70 ring-2 ring-saffron/30' : 'border-line'} ${className}`}
    >
      {timeline && <StopMarker number={number} current={current} done={done} className="absolute -start-11 top-3.5 !h-9 !w-9 !text-sm" />}
      <header className="flex items-start gap-3 px-4 pt-4">
        {!timeline && <StopMarker number={number} current={current} done={done} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold leading-snug [overflow-wrap:anywhere]">
            <BidiText text={stop.mall} />
          </h3>
          {compact ? (
            intro
          ) : (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
            {multi && (
              <span data-testid="shop-count" className="rounded-chip bg-sunken px-2.5 font-semibold text-ink">
                {t.plan.shopsCount(shops.length)}
              </span>
            )}
            <span>{t.plan.stopItems(lineCount)}</span>
            {stop.subtotal != null && (multi || lineCount > 1) && (
              <span data-testid="stop-subtotal">
                {t.plan.stopSubtotal}: <span className="num font-bold text-ink">{formatTomanCompact(stop.subtotal)}</span>
              </span>
            )}
          </p>
          )}
        </div>
      </header>
      {intro && !compact && <div className="px-4">{intro}</div>}
      <div className="mt-3 space-y-3 px-4 pb-4">
        {shops.map((shop) => (
          <ShopBlock key={shop.shopId} shop={shop} visitActive={visitActive} actions={renderShopActions?.(shop)}>
            {renderLines(shop)}
          </ShopBlock>
        ))}
      </div>
    </section>
  );
}

/** «طبقهٔ ۲» / «واحد ۶۲» as chips: what the user looks for on the signs inside the building. */
function PlaceChips({ shop }: { shop: StopShop }) {
  if (!shop.floor && !shop.unit) return null;
  return (
    <span className="flex flex-wrap gap-1.5" aria-label={t.plan.floorUnit}>
      {[shop.floor, shop.unit].filter(Boolean).map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 text-sm font-bold leading-7 text-accent-ink">
          <BidiText text={v!} />
        </span>
      ))}
    </span>
  );
}

function OpenStatus({ shop, visitActive }: { shop: StopShop; visitActive: boolean }) {
  const known = visitActive && (shop.open === 'open' || shop.open === 'closed');
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
      {known && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 font-semibold ${
            shop.open === 'open' ? 'bg-accent-soft text-accent-ink' : 'bg-amber-soft text-amber-ink'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${shop.open === 'open' ? 'bg-accent' : 'bg-amber'}`} aria-hidden="true" />
          {shop.open === 'open' ? t.plan.openAtTime : t.plan.closedAtTime}
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Icon name="clock" size={15} />
        <BidiText text={shop.hoursText} />
      </span>
    </span>
  );
}

function ShopBlock({ shop, visitActive, actions, children }: { shop: StopShop; visitActive: boolean; actions?: ReactNode; children: ReactNode }) {
  const [showAddress, setShowAddress] = useState(false);
  return (
    <div data-testid="stop-shop" data-shop={shop.shopId} className="border-t border-dashed border-line pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p data-testid="shop-name" className="min-w-0 text-base font-bold leading-snug [overflow-wrap:anywhere]">
          <Interp tpl={t.plan.shop} args={[shop.shopName]} />
        </p>
        <PlaceChips shop={shop} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <OpenStatus shop={shop} visitActive={visitActive} />
        <button
          type="button"
          onClick={() => setShowAddress((v) => !v)}
          aria-expanded={showAddress}
          className="-me-1 inline-flex min-h-touch items-center gap-1 rounded-control px-1 text-sm font-semibold text-accent-ink hover:bg-accent-soft/60"
        >
          <Icon name="pin" size={15} />
          {showAddress ? t.plan.hideAddress : t.plan.fullAddress}
        </button>
      </div>
      {showAddress && (
        <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
          <BidiText text={shop.address} />
        </p>
      )}
      <div className="mt-2 space-y-3">{children}</div>
      {actions}
    </div>
  );
}

/** Between two timeline stops: «حدود ۹۰ متر پیاده», sitting on the rail. */
export function StopConnector({ metres }: { metres: number }) {
  return (
    <p className="relative flex min-h-12 items-center py-2 text-sm text-ink-soft" data-testid="stop-distance">
      <span className="sr-only-fa">{t.plan.distanceNext(metres)}</span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-0.5 font-semibold" aria-hidden="true">
        <Icon name="arrow-down" size={15} />
        {t.plan.distanceShort(metres)}
      </span>
    </p>
  );
}
