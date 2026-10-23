/**
 * «کجا بروم؟» – the places screen: a map of the ranked malls on top and a snapping bottom sheet with one card per
 * mall. Selecting a card flies the map there; tapping a pin selects (and reveals) its card.
 *
 * Pure presentation: no store and no API. The integrator passes the PlacesResponse, optional plan stops for the
 * route line, and `onPick` for the primary action.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlaceBadge, PlaceItemLine, PlaceMall, PlacesResponse } from '@app/core/src/api/dto';
import type { Stop } from '../api/types';
import { BidiText } from '../components/Bdi';
import { Icon } from '../components/Icon';
import { CountUp } from '../components/map/CountUp';
import { LazyMapView, type MapPlace } from '../components/map/LazyMapView';
import { SnapSheet } from '../components/map/SnapSheet';
import {
  BADGE_LABEL,
  coverageRatio,
  coverageText,
  floorsText,
  hasFullCoverage,
  headlineFor,
  initialSelection,
  markerTone,
  openState,
  pillLabel,
  visibleBadges,
} from '../components/map/placeModel';
import { formatCount, formatNumber } from '../lib/format';
import './places.css';

export interface PlacesViewProps {
  places: PlacesResponse;
  /** Plan stops in visiting order; when they carry coordinates a route is drawn between them. */
  stops?: Stop[];
  onPick: (m: PlaceMall) => void;
  /** Results are being (re)computed: skeleton cards and a scanning map. */
  busy?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */

export function PlacesView({ places, stops, onPick, busy = false, className = '' }: PlacesViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [H, setH] = useState(0);
  const [snapIndex, setSnapIndex] = useState(1);
  const [restInset, setRestInset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialSelection(places));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // a new response: select its recommendation again, fold everything
  const responseKey = places.malls.map((m) => m.id).join('|') + '#' + (places.bestId ?? '');
  const lastKey = useRef(responseKey);
  if (lastKey.current !== responseKey) {
    lastKey.current = responseKey;
    setSelectedId(initialSelection(places));
    setExpanded(new Set());
  }

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setH(Math.round(e!.contentRect.height)));
    ro.observe(el);
    setH(Math.round(el.getBoundingClientRect().height));
    return () => ro.disconnect();
  }, []);

  const snaps = useMemo(() => {
    if (H <= 0) return [0, 0, 0];
    const low = Math.round(Math.min(Math.max(H * 0.27, 178), 250));
    const mid = Math.round(Math.max(H * 0.55, low + 120));
    const high = Math.round(Math.max(H - 10, mid + 60));
    return [low, mid, high];
  }, [H]);

  const onSheetHeight = useCallback(
    (px: number, live: boolean) => {
      const wrap = mapWrapRef.current;
      if (wrap) {
        wrap.style.setProperty('--hbm-inset-bottom', `${Math.round(px)}px`);
        wrap.classList.toggle('is-dragging', live);
        wrap.classList.toggle('is-cramped', H - px < 170);
      }
      if (!live) setRestInset(Math.round(px));
    },
    [H],
  );

  const best = places.malls.find((m) => m.id === places.bestId) ?? null;
  const full = hasFullCoverage(places);
  const headline = headlineFor(places);

  const mapPlaces = useMemo<MapPlace[]>(
    () =>
      places.malls.map((m) => ({
        id: m.id,
        lat: m.lat,
        lon: m.lon,
        label: pillLabel(m),
        title: m.name,
        tone: markerTone(m, places.bestId),
      })),
    [places],
  );
  const route = useMemo(() => stops?.map((s) => ({ lat: s.lat, lon: s.lon, title: s.mall })), [stops]);

  const revealCard = useCallback((id: string) => {
    const card = cardRefs.current.get(id);
    const s = scrollRef.current;
    if (!card || !s) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    s.scrollTo({ top: Math.max(0, card.offsetTop - 12), behavior: still ? 'auto' : 'smooth' });
  }, []);

  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSnapIndex((i) => (i === 0 ? 1 : i));
      requestAnimationFrame(() => revealCard(id));
    },
    [revealCard],
  );

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // keep the selected card in view when the sheet settles higher
  useEffect(() => {
    if (selectedId && snapIndex > 0) revealCard(selectedId);
    // only on snap changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapIndex]);

  const ready = H > 0;
  const empty = !busy && places.malls.length === 0;

  return (
    <div ref={rootRef} className={`hb-places relative isolate h-full min-h-[480px] w-full overflow-hidden bg-sunken ${className}`}>
      <div ref={mapWrapRef} className="absolute inset-0">
        {ready && (
          <LazyMapView
            places={busy ? [] : mapPlaces}
            selectedId={selectedId}
            onSelect={selectFromMap}
            route={busy ? undefined : route}
            insetBottom={restInset}
            busy={busy}
            label="نقشهٔ پاساژهای پیشنهادی"
          />
        )}
      </div>

      {ready && (
        <SnapSheet
          snaps={snaps}
          index={snapIndex}
          onIndexChange={setSnapIndex}
          onHeight={onSheetHeight}
          label="پاساژهای پیشنهادی"
          scrollRef={scrollRef}
          className="hb-sheet"
          header={
            <div className="px-4 pb-3">
              {busy ? <BannerSkeleton /> : empty ? null : <Banner full={full} headline={headline} best={best} />}
            </div>
          }
        >
          <div className="px-4 pb-6">
            {busy ? (
              <CardsSkeleton />
            ) : empty ? (
              <EmptyPlaces />
            ) : (
              <>
                <h2 className="mb-2 mt-1 text-sm font-semibold text-ink-soft">
                  {formatCount(places.malls.length)} پاساژ، به ترتیب مناسب بودن
                </h2>
                <ol className="space-y-3">
                  {places.malls.map((m, i) => (
                    <li
                      key={m.id}
                      ref={(el) => {
                        if (el) cardRefs.current.set(m.id, el);
                        else cardRefs.current.delete(m.id);
                      }}
                      className="hb-card-in"
                      style={{ animationDelay: `${Math.min(i, 6) * 55}ms` }}
                    >
                      <MallCard
                        mall={m}
                        best={m.id === places.bestId}
                        selected={m.id === selectedId}
                        expanded={expanded.has(m.id)}
                        onSelect={() => setSelectedId(m.id)}
                        onToggle={() => toggleExpanded(m.id)}
                        onPick={() => onPick(m)}
                      />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </SnapSheet>
      )}
    </div>
  );
}

export default PlacesView;

/* ------------------------------------------------------------------ */

function Banner({ full, headline, best }: { full: boolean; headline: string | null; best: PlaceMall | null }) {
  if (full && headline) {
    const open = best ? openState(best) : null;
    return (
      <div className="hb-banner flex items-center gap-3 rounded-[20px] px-4 py-3" role="status">
        <span className="hb-banner__mark grid h-10 w-10 shrink-0 place-items-center rounded-full" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="hb-banner__check" d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-base font-bold leading-snug text-white">
            <BidiText text={headline} />
          </p>
          {open && open.tone !== 'unknown' && <p className="hb-banner__sub text-sm">{open.text}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-[20px] bg-amber-soft px-4 py-3 text-amber-ink" role="status">
      <Icon name="info" size={22} className="mt-0.5" />
      <div className="min-w-0">
        <p className="text-base font-bold leading-snug">هیچ پاساژی همهٔ فهرست را ندارد؛ نزدیک‌ترین‌ها را ببین</p>
        {headline && (
          <p className="text-sm">
            <BidiText text={`بهترین: ${headline}`} />
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const BADGE_CLASS: Record<PlaceBadge, string> = {
  one_stop: 'hb-badge--one',
  cheapest: 'bg-amber-soft text-amber-ink',
  most_choice: 'bg-sunken text-ink-soft',
  open_now: 'bg-accent-soft text-accent-ink',
};

function MallCard({
  mall,
  best,
  selected,
  expanded,
  onSelect,
  onToggle,
  onPick,
}: {
  mall: PlaceMall;
  best: boolean;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onPick: () => void;
}) {
  const listId = useId();
  const open = openState(mall);
  const badges = visibleBadges(mall);
  const partial = mall.covered < mall.total;
  const floors = floorsText(mall.floors);

  return (
    <article
      className={`hb-card relative rounded-[20px] border bg-surface ${selected ? 'is-selected border-transparent' : 'border-line'} ${best ? 'is-best' : ''}`}
      aria-current={selected || undefined}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="block w-full rounded-[20px] p-4 text-start">
        <div className="flex items-start gap-3">
          <CoverageRing covered={mall.covered} total={mall.total} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold leading-snug text-ink">
              <BidiText text={mall.name} />
            </h3>
            <p className="text-sm text-ink-soft">
              {formatCount(mall.shopCount)} مغازهٔ مرتبط
              {floors ? `، ${floors}` : ''}
            </p>
            {badges.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="ویژگی‌ها">
                {badges.map((b) => (
                  <li key={b} className={`hb-badge inline-flex items-center gap-1 rounded-full px-2.5 text-sm font-semibold ${BADGE_CLASS[b]}`}>
                    {b === 'open_now' && <span className="hb-live-dot" aria-hidden="true" />}
                    {b === 'one_stop' && <Icon name="check" size={16} />}
                    {BADGE_LABEL[b]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-dashed border-line pt-3">
          <span className={`hb-open hb-open--${open.tone} inline-flex items-center gap-1.5 text-sm`}>
            <span className="hb-open__dot" aria-hidden="true" />
            {open.text}
          </span>
          <span className="text-end">
            {mall.totalToman != null && mall.totalToman > 0 ? (
              <>
                <span className="block text-xl font-extrabold leading-tight tabular-nums text-ink">
                  <CountUp value={mall.totalToman} format={(n) => formatNumber(Math.round(n / 1000) * 1000)} />
                  <span className="ms-1 text-sm font-semibold text-ink-soft">تومان</span>
                </span>
                {partial && <span className="block text-sm text-ink-soft">برای {formatCount(mall.covered)} مورد</span>}
              </>
            ) : (
              <span className="text-sm text-ink-soft">قیمت ثبت نشده</span>
            )}
          </span>
        </div>
      </button>

      <div className="flex flex-col gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          className="inline-flex min-h-touch items-center justify-between rounded-xl bg-sunken/70 px-3 text-sm font-semibold text-ink hover:bg-sunken"
        >
          <span>{expanded ? 'بستن فهرست اقلام' : `${formatCount(mall.items.length)} قلم این‌جا را ببین`}</span>
          <Icon name="chevron-down" size={20} className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <div id={listId} className={`hb-collapse ${expanded ? 'is-open' : ''}`} aria-hidden={!expanded}>
          <div className="min-h-0 overflow-hidden">
            <ul className="divide-y divide-line pt-1">
              {mall.items.map((it) => (
                <ItemRow key={it.itemId} item={it} />
              ))}
            </ul>
          </div>
        </div>
        {selected && (
          <button
            type="button"
            onClick={onPick}
            className="hb-pick inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold"
          >
            <Icon name="pin" size={20} />
            انتخاب این پاساژ
          </button>
        )}
      </div>
    </article>
  );
}

function CoverageRing({ covered, total }: { covered: number; total: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const ratio = coverageRatio(covered, total);
  const full = ratio >= 1;
  return (
    <span className={`hb-ring relative grid h-16 w-16 shrink-0 place-items-center ${full ? 'is-full' : ''}`} role="img" aria-label={`${coverageText(covered, total)} مورد`}>
      <svg viewBox="0 0 64 64" width="64" height="64" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} className="hb-ring__track" fill="none" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="hb-ring__arc"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ ['--hb-ring-off' as string]: `${c * (1 - ratio)}`, ['--hb-ring-len' as string]: `${c}` }}
        />
      </svg>
      <span className="relative flex flex-col items-center leading-none" aria-hidden="true">
        <span className="text-xl font-extrabold tabular-nums text-ink">{formatCount(covered)}</span>
        <span className="mt-0.5 text-xs font-semibold leading-none text-ink-soft">از {formatCount(total)}</span>
      </span>
    </span>
  );
}

function ItemRow({ item }: { item: PlaceItemLine }) {
  const [broken, setBroken] = useState(false);
  const where = [item.shopName, item.floor, item.unit].filter(Boolean).join('، ');
  if (!item.covered) {
    return (
      <li className="flex items-center gap-3 py-3 text-ink-soft">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-dashed border-line-strong/60">
          <Icon name="dashed" size={20} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            <BidiText text={item.itemName} />
          </p>
          <p className="text-sm">این‌جا پیدا نشد</p>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="hb-thumb grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
        {item.imageUrl && !broken ? (
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <Icon name="bag" size={22} className="text-ink-soft" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 font-semibold text-ink">
            <BidiText text={item.itemName} />
          </p>
          {item.unitPrice != null && (
            <p className="shrink-0 text-sm font-bold tabular-nums text-ink">
              {formatNumber(item.unitPrice)}
              {item.qty && item.qty > 1 ? <span className="font-medium text-ink-soft"> × {formatCount(item.qty)}</span> : null}
            </p>
          )}
        </div>
        {item.productName && (
          <p className="line-clamp-2 text-sm text-ink-soft">
            <BidiText text={item.productName} />
          </p>
        )}
        {where && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-accent-ink">
            <Icon name="building" size={16} />
            <span className="min-w-0 truncate">
              <BidiText text={where} />
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function BannerSkeleton() {
  return <div className="hb-shimmer h-[66px] rounded-[20px]" aria-hidden="true" />;
}

function CardsSkeleton() {
  return (
    <div role="status" className="space-y-3 pt-2">
      <span className="sr-only-fa">در حال پیدا کردن پاساژها</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-[20px] border border-line bg-surface p-4" aria-hidden="true">
          <div className="flex items-start gap-3">
            <div className="hb-shimmer h-16 w-16 rounded-full" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="hb-shimmer h-5 w-2/3 rounded-lg" />
              <div className="hb-shimmer h-4 w-1/2 rounded-lg" />
              <div className="hb-shimmer h-6 w-28 rounded-full" />
            </div>
          </div>
          <div className="mt-4 flex justify-between border-t border-dashed border-line pt-3">
            <div className="hb-shimmer h-4 w-24 rounded-lg" />
            <div className="hb-shimmer h-6 w-32 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyPlaces() {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-sunken text-ink-soft" aria-hidden="true">
        <Icon name="pin" size={26} />
      </span>
      <h2 className="mt-3 text-lg font-bold">برای این فهرست پاساژی پیدا نشد</h2>
      <p className="mt-1 max-w-[30ch] text-sm text-ink-soft">نام کالاها را کلی‌تر بنویس یا یکی از آن‌ها را بردار تا گزینه‌ها پیدا شوند.</p>
    </div>
  );
}
