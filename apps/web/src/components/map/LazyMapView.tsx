import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { MapViewProps } from './MapView';
import './fallback.css';

export type { MapPlace, MapStop, MapViewProps } from './MapView';

/** Leaflet (about 40 KB gzip with its CSS) loads only when a map is actually on screen. */
const MapView = lazy(() => import('./MapView'));

/** Static stand-in with the map's underlay colour: no layout jump when the chunk arrives. */
export function MapFallback({ className = '' }: { className?: string }) {
  return (
    <div className={`hbm-fallback h-full w-full ${className}`} role="status">
      <span className="sr-only-fa">نقشه در حال آمدن است</span>
    </div>
  );
}

/** A failed chunk (offline on first visit) keeps the stand-in instead of crashing the screen. */
class MapBoundary extends Component<{ children: ReactNode; className?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={`hbm-fallback grid h-full w-full place-items-center ${this.props.className ?? ''}`}>
        <p className="rounded-xl bg-surface/90 px-3 py-1 text-sm text-ink-soft">نقشه باز نشد؛ فهرست پایین کامل است.</p>
      </div>
    );
  }
}

export function LazyMapView(props: MapViewProps) {
  return (
    <MapBoundary className={props.className}>
      <Suspense fallback={<MapFallback className={props.className} />}>
        <MapView {...props} />
      </Suspense>
    </MapBoundary>
  );
}
