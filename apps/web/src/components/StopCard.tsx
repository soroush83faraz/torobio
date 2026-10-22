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
  /** Anything shown between the stop header and its shops (e.g. «توقف فعلی»). */
  intro?: ReactNode;
  /** The lines bought at one shop of this stop. */
  renderLines: (shop: StopShop) => ReactNode;
  /** Optional per-shop actions under its lines (e.g. «بدون این مغازه»). */
  renderShopActions?: (shop: StopShop) => ReactNode;
  className?: string;
}

/**
 * Stop = one building. Header: number, mall, how many shops, the stop's subtotal. Then one block per shop with its
 * own floor/unit, hours (+ open/closed at the chosen time), full address on tap and its own lines.
 */
export function StopCard({ stop, number, visitActive, current, intro, renderLines, renderShopActions, className = '' }: Props) {
  const shops = shopsOf(stop);
  const multi = shops.length > 1;
  const lineCount = shops.reduce((k, s) => k + s.lines.length, 0);
  return (
    <section
      data-testid="stop"
      data-shop={shops[0]?.shopId}
      data-shop-count={shops.length}
      aria-label={t.plan.stopLabel(number)}
      className={`rounded-card border bg-surface p-4 shadow-card ${current ? 'border-accent ring-2 ring-accent/30' : 'border-line'} ${className}`}
    >
      <header className="flex gap-3">
        <span
          aria-hidden="true"
          data-testid="stop-number"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white"
        >
          {new Intl.NumberFormat('fa-IR').format(number)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-snug [overflow-wrap:anywhere]">
            <BidiText text={stop.mall} />
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-soft">
            {multi && (
              <span data-testid="shop-count" className="rounded-chip bg-sunken px-2.5 font-semibold text-ink">
                {t.plan.shopsCount(shops.length)}
              </span>
            )}
            {stop.subtotal != null && (multi || lineCount > 1) && (
              <span data-testid="stop-subtotal">
                {t.plan.stopSubtotal}: <span className="font-bold text-ink">{formatTomanCompact(stop.subtotal)}</span>
              </span>
            )}
          </p>
        </div>
      </header>
      {intro}
      <div className="mt-3 space-y-3">
        {shops.map((shop) => (
          <ShopBlock key={shop.shopId} shop={shop} multi={multi} visitActive={visitActive} actions={renderShopActions?.(shop)}>
            {renderLines(shop)}
          </ShopBlock>
        ))}
      </div>
    </section>
  );
}

function ShopBlock({ shop, multi, visitActive, actions, children }: { shop: StopShop; multi: boolean; visitActive: boolean; actions?: ReactNode; children: ReactNode }) {
  const [showAddress, setShowAddress] = useState(false);
  const place = [shop.floor, shop.unit].filter(Boolean).join(' · ');
  return (
    <div
      data-testid="stop-shop"
      data-shop={shop.shopId}
      className={multi ? 'rounded-2xl border border-line bg-sunken/50 p-3' : ''}
    >
      <p data-testid="shop-name" className="text-sm font-bold leading-snug [overflow-wrap:anywhere]">
        <Interp tpl={t.plan.shop} args={[shop.shopName]} />
      </p>
      {place && (
        <p className="text-sm text-ink-soft">
          <BidiText text={place} />
        </p>
      )}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
        <span className="inline-flex items-center gap-1">
          <Icon name="clock" size={15} />
          <BidiText text={shop.hoursText} />
        </span>
        {visitActive && shop.open === 'open' && <span className="rounded-chip bg-sunken px-2.5 text-ink">{t.plan.openAtTime}</span>}
        {visitActive && shop.open === 'closed' && (
          <span className="rounded-chip bg-amber-soft px-2.5 font-semibold text-amber-ink">{t.plan.closedAtTime}</span>
        )}
      </p>
      <button
        type="button"
        onClick={() => setShowAddress((v) => !v)}
        aria-expanded={showAddress}
        className="mt-0.5 inline-flex min-h-touch items-center gap-1 text-sm font-semibold text-accent-ink"
      >
        <Icon name="pin" size={15} />
        {showAddress ? t.plan.hideAddress : t.plan.fullAddress}
      </button>
      {showAddress && <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
          <BidiText text={shop.address} />
        </p>}
      <div className="mt-2 space-y-3">{children}</div>
      {actions}
    </div>
  );
}

/** «↓ حدود ۹۰ متر تا توقف بعدی (خط مستقیم)» between two stop cards. */
export function StopConnector({ metres }: { metres: number }) {
  return (
    <p className="flex items-center gap-2 px-2 py-2 text-sm text-ink-soft" aria-hidden={false}>
      <Icon name="arrow-down" size={16} />
      {t.plan.distanceNext(metres)}
    </p>
  );
}
