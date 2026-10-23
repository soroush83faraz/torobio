/**
 * The plan's route as a compact still map (the plan header) that opens a full-screen interactive map on tap.
 * Two or more stops with coordinates: the self-drawing numbered route. One stop: a single pin with the mall's name.
 * Renders nothing when no stop has coordinates (older servers, the mock without coordinates).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Stop } from '../../api/types';
import { t } from '../../copy/fa';
import { Icon } from '../Icon';
import { hasCoords } from './geo';
import { LazyMapView, type MapPlace, type MapStop } from './LazyMapView';

export function routeHasMap(stops: readonly Stop[]): boolean {
  return stops.some((s) => hasCoords(s));
}

function useRouteProps(stops: readonly Stop[]) {
  return useMemo(() => {
    const located = stops.filter((s) => hasCoords(s));
    if (located.length >= 2) {
      return { places: [] as MapPlace[], route: stops.map<MapStop>((s) => ({ lat: s.lat, lon: s.lon, title: s.mall })) };
    }
    const one = located[0];
    const places: MapPlace[] = one ? [{ id: one.id, lat: one.lat!, lon: one.lon!, label: one.mall, title: one.mall, tone: 'best' }] : [];
    return { places, route: undefined };
  }, [stops]);
}

export function RouteMap({ stops, className = '' }: { stops: readonly Stop[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const { places, route } = useRouteProps(stops);
  if (!routeHasMap(stops)) return null;
  return (
    <div className={`relative isolate overflow-hidden ${className}`} data-testid="route-map">
      <div className="pointer-events-none absolute inset-0">
        {/* insets: the «نقشهٔ بزرگ» chip covers the top band; numbered stop discs hang below their point */}
        <LazyMapView places={places} route={route} interactive={false} insetTop={34} insetBottom={0} label={t.plan.routeLabel} />
      </div>
      {/* the whole still map is the button: tap to enlarge */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute inset-0 z-[500] flex items-start justify-end p-3"
        aria-label={t.plan.routeExpand}
        data-testid="route-expand"
      >
        <span className="inline-flex min-h-touch items-center gap-1.5 rounded-full bg-surface/95 px-4 text-sm font-bold text-ink shadow-raised ring-1 ring-black/5">
          <Icon name="route" size={18} className="text-accent" />
          {t.plan.routeExpand}
        </span>
      </button>
      {open && <RouteOverlay places={places} route={route} onClose={() => setOpen(false)} />}
    </div>
  );
}

function RouteOverlay({ places, route, onClose }: { places: MapPlace[]; route?: MapStop[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div dir="rtl" role="dialog" aria-modal="true" aria-label={t.plan.routeLabel} className="animate-fade-in fixed inset-0 z-50 bg-sunken" data-testid="route-overlay">
      <LazyMapView places={places} route={route} label={t.plan.routeLabel} />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute start-3 z-[600] inline-flex min-h-touch items-center gap-2 rounded-full bg-surface px-4 text-sm font-bold text-ink shadow-raised"
        style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      >
        <Icon name="close" size={18} />
        {t.plan.routeClose}
      </button>
    </div>,
    document.body,
  );
}
