/**
 * Interactive Leaflet map of malls (lazy chunk: import it through LazyMapView, never from a Home-bundle module).
 *
 * - OSM raster tiles with Persian labels (provider switch in tiles.ts), calmed with a CSS filter that is a custom
 *   property (re-themable).
 * - Malls are DivIcon pills («۴ از ۴ · ۱۲٫۳ م»); the recommended one pulses; the selected one turns ink.
 *   Pills that would overlap a higher-priority pill collapse to their dot, recomputed after every zoom/move.
 * - The visible band is the area above the bottom sheet: fitting and flying keep markers inside it.
 * - Optional ordered route: a halo + base line that draws itself, then a marching dashed line, numbered stops.
 * - «موقعیت من» asks for the position only when tapped. The position stays in this component's memory: it is drawn
 *   on the map and never stored or sent anywhere.
 * - prefers-reduced-motion: no fly animations, no pulses, no draw-in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import { boundsOf, framingPoints, hasCoords, sheetAwarePadding, type LatLon } from './geo';
import { resolveCollisions, type MarkerTone } from './placeModel';
import { toPersianDigits } from '../../lib/format';
import { tileConfig } from './tiles';

export interface MapPlace {
  id: string;
  lat: number;
  lon: number;
  /** Pill text, e.g. «۴ از ۴ · ۱۲٫۳ م». The part before « · » is drawn in the coverage colour. */
  label: string;
  /** Accessible name, e.g. the mall name. */
  title: string;
  tone: MarkerTone;
}

export interface MapStop {
  lat?: number;
  lon?: number;
  /** Accessible name of the stop. */
  title?: string;
}

export interface MapViewProps {
  places: readonly MapPlace[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Ordered stops; a self-drawing route connects the ones with coordinates. */
  route?: readonly MapStop[];
  /** Px of the map hidden under a bottom sheet at rest (fit and fly keep markers above it). */
  insetBottom?: number;
  /** Px hidden under a floating header. */
  insetTop?: number;
  /** Results are loading: markers hide behind a scanning veil. */
  busy?: boolean;
  className?: string;
  /** Accessible name of the map region. */
  label?: string;
  /**
   * false: a still preview (no drag, zoom or controls) for a small header that opens a full map on tap. Read once,
   * when the map is created. Default true.
   */
  interactive?: boolean;
}

const TILES = tileConfig(import.meta.env.VITE_MAP_TILES as string | undefined, import.meta.env.VITE_MAP_TILES_ATTRIBUTION as string | undefined);
/** Tehran's bazaar belt with a generous margin; the map cannot be dragged far outside it. */
const BELT = L.latLngBounds([35.56, 51.18], [35.9, 51.64]);
const CORE: L.LatLngExpression = [35.6935, 51.4155];
/** Farther than this from the core, «موقعیت من» explains instead of flying across the country. */
const FAR_M = 30_000;

const PIN_HEIGHT = 34;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function pinHtml(p: MapPlace): string {
  const [cov, price] = p.label.split(' · ');
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const pulse = p.tone === 'best' ? '<span class="hbm-pin__pulse"></span><span class="hbm-pin__pulse"></span>' : '';
  const body = price
    ? `<span class="hbm-pin__cov">${esc(cov ?? '')}</span><span class="hbm-pin__sep"></span><span>${esc(price)}</span>`
    : `<span class="hbm-pin__cov">${esc(cov ?? '')}</span>`;
  return `${pulse}<span class="hbm-pin__dot"></span><span class="hbm-pin__body">${body}</span>`;
}

interface PinRef {
  marker: L.Marker;
  el: HTMLElement;
  sig: string;
  width: number;
}

type Note = { text: string; key: number } | null;

export default function MapView({
  places,
  selectedId = null,
  onSelect,
  route,
  insetBottom = 0,
  insetTop = 0,
  busy = false,
  className = '',
  label = 'نقشهٔ پاساژها',
  interactive = true,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsRef = useRef(new Map<string, PinRef>());
  const routeRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const insetRef = useRef({ top: insetTop, bottom: insetBottom });
  insetRef.current = { top: insetTop, bottom: insetBottom };
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const placesRef = useRef(places);
  placesRef.current = places;
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState(false);
  const [note, setNote] = useState<Note>(null);

  /* ---- create the map once ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const still = reducedMotion();
    const map = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      center: CORE,
      zoom: 15,
      minZoom: 11,
      maxZoom: 19,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      maxBounds: BELT,
      maxBoundsViscosity: 0.85,
      fadeAnimation: !still,
      zoomAnimation: !still,
      markerZoomAnimation: !still,
      inertia: !still,
      bounceAtZoomLimits: false,
      ...(interactive
        ? {}
        : { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false }),
    });
    L.tileLayer(TILES.url, {
      subdomains: TILES.subdomains,
      maxZoom: 19,
      maxNativeZoom: TILES.maxNativeZoom,
      className: 'hbm-tiles',
      attribution: TILES.attribution,
      // origin only (see tiles.ts): the tile host's usage policy needs it; the page path never leaves
      referrerPolicy: TILES.referrerPolicy,
    }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    map.getContainer().setAttribute('aria-label', label);
    map.getContainer().setAttribute('role', 'region');
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(host);
    setReady(true);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      pinsRef.current.clear();
    };
    // the map is created once; the label is applied on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Centre that puts `ll` in the middle of the visible band (above the sheet), at zoom `z`. */
  const bandCenter = useCallback((ll: L.LatLng, z: number): L.LatLng => {
    const map = mapRef.current!;
    const { top, bottom } = insetRef.current;
    const pt = map.project(ll, z).add(L.point(0, (bottom - top) / 2 - PIN_HEIGHT / 2));
    return map.unproject(pt, z);
  }, []);

  /* ---- pills: priority order and collision ---- */
  const relayout = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const sel = selectedRef.current;
    const order = [...placesRef.current]
      .map((p, rank) => ({ p, rank }))
      .sort((a, b) => {
        const pa = a.p.id === sel ? 0 : a.p.tone === 'best' ? 1 : a.p.tone === 'muted' ? 3 : 2;
        const pb = b.p.id === sel ? 0 : b.p.tone === 'best' ? 1 : b.p.tone === 'muted' ? 3 : 2;
        return pa - pb || a.rank - b.rank;
      });
    const pins = order.map(({ p }) => pinsRef.current.get(p.id)).filter((x): x is PinRef => !!x);
    const rects = pins.map((pin) => {
      if (!pin.el.classList.contains('is-collapsed') || pin.width === 0) {
        const body = pin.el.querySelector<HTMLElement>('.hbm-pin__body');
        if (body && body.offsetWidth > 0) pin.width = body.offsetWidth;
      }
      const pt = map.latLngToContainerPoint(pin.marker.getLatLng());
      const w = pin.width || 96;
      return { x: pt.x - w / 2, y: pt.y - 13 - PIN_HEIGHT, w, h: PIN_HEIGHT + 8 };
    });
    const shown = resolveCollisions(rects, 6);
    pins.forEach((pin, i) => pin.el.classList.toggle('is-collapsed', !shown.has(i)));
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on('zoomend moveend resize', relayout);
    return () => {
      map.off('zoomend moveend resize', relayout);
    };
  }, [ready, relayout]);

  /* ---- sync markers with places ---- */
  const placesKey = useMemo(() => places.map((p) => p.id).join('|'), [places]);
  const routeRef2 = useRef(route);
  routeRef2.current = route;
  const routeKey = useMemo(
    () => (route ?? []).map((s) => (hasCoords(s) ? `${s.lat.toFixed(5)},${s.lon.toFixed(5)}` : '-')).join(';'),
    [route],
  );
  /** What the first fit frames: the places, else the route. */
  const fitKey = placesKey || (routeKey ? `route:${routeKey}` : '');
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pins = pinsRef.current;
    const keep = new Set(places.map((p) => p.id));
    for (const [id, pin] of pins) {
      if (!keep.has(id)) {
        pin.marker.remove();
        pins.delete(id);
      }
    }
    places.forEach((p, i) => {
      if (!hasCoords(p)) return;
      const sig = `${p.label}|${p.tone}|${p.title}`;
      const existing = pins.get(p.id);
      if (existing) {
        existing.marker.setLatLng([p.lat, p.lon]);
        if (existing.sig !== sig) {
          existing.el.innerHTML = pinHtml(p);
          existing.el.className = existing.el.className.replace(/hbm-pin--\w+/g, '').trim() + ` hbm-pin--${p.tone}`;
          existing.el.setAttribute('aria-label', `${p.title}، ${p.label.replace(' · ', '، ')}`);
          existing.sig = sig;
          existing.width = 0;
        }
        return;
      }
      const icon = L.divIcon({ className: 'hbm-pin-wrap', html: '', iconSize: [0, 0], iconAnchor: [0, 0] });
      const marker = L.marker([p.lat, p.lon], { icon, keyboard: false, riseOnHover: true, title: '' });
      marker.addTo(map);
      const wrap = marker.getElement()!;
      const el = document.createElement('div');
      el.className = `hbm-pin hbm-pin--${p.tone} is-new`;
      el.setAttribute('dir', 'rtl');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${p.title}، ${p.label.replace(' · ', '، ')}`);
      el.style.setProperty('--i', String(i));
      el.innerHTML = pinHtml(p);
      wrap.appendChild(el);
      const pick = () => onSelectRef.current?.(p.id);
      L.DomEvent.on(el, 'click', (e) => {
        L.DomEvent.stop(e);
        pick();
      });
      L.DomEvent.on(el, 'keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          L.DomEvent.preventDefault(e);
          pick();
        }
      });
      el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
      pins.set(p.id, { marker, el, sig, width: 0 });
    });
    requestAnimationFrame(relayout);
    // placesKey covers identity; labels/tones are compared through `sig`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, places, relayout]);

  /* ---- fit all markers into the visible band ---- */
  const fitAll = useCallback(
    (animate: boolean, everything = false) => {
      const map = mapRef.current;
      if (!map) return;
      // no places (a plan's route on its own): frame the route's stops
      const own: LatLon[] = placesRef.current.filter(hasCoords);
      const all: LatLon[] = own.length ? own : (routeRef2.current ?? []).filter(hasCoords);
      // the first view frames the bazaar core (a far-away branch would zoom everything out to dots); the «همهٔ
      // پاساژها» control shows every place
      const pts = everything ? all : framingPoints(all);
      const b = boundsOf(pts, { minSpanDeg: 0.0035 });
      if (!b) return;
      const h = map.getSize().y;
      const { top, bottom } = insetRef.current;
      // side padding: half of a typical pill so edge pills are not clipped
      // a route alone has no pills above its points, only numbered discs beside and below them: tighter padding,
      // so a small header map is not all margin
      const pad = own.length
        ? sheetAwarePadding(h, bottom, { top: top + PIN_HEIGHT + 24, side: 74, gap: 20 })
        : sheetAwarePadding(h, bottom, { top: top + 14, side: 44, gap: 46, minVisible: 60 });
      map.fitBounds(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        {
          paddingTopLeft: pad.topLeft,
          paddingBottomRight: pad.bottomRight,
          maxZoom: 17.25,
          animate: animate && !reducedMotion(),
          duration: 0.8,
        },
      );
    },
    [],
  );

  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitKey === '' || fittedFor.current === fitKey) return;
    fittedFor.current = fitKey;
    fitAll(false);
  }, [ready, fitKey, fitAll]);

  /* ---- selection: classes, z-order, fly ---- */
  const flownTo = useRef<string | null>(null);
  /** A selection fly is running; it already aims at the band of the latest inset. */
  const flyingRef = useRef(false);
  const flyToSelected = useCallback(
    (force = false) => {
      const map = mapRef.current;
      const id = selectedRef.current;
      if (!map || !id) return;
      const pin = pinsRef.current.get(id);
      if (!pin) return;
      if (!force && flownTo.current === id) return;
      flownTo.current = id;
      const ll = pin.marker.getLatLng();
      const z = Math.min(Math.max(map.getZoom(), 16.25), 17.5);
      const target = bandCenter(ll, z);
      if (reducedMotion()) {
        map.setView(target, z, { animate: false });
        return;
      }
      const far = map.getCenter().distanceTo(target) > 1500 || Math.abs(map.getZoom() - z) > 1.25;
      flyingRef.current = true;
      map.once('moveend', () => (flyingRef.current = false));
      map.flyTo(target, z, { duration: far ? 0.95 : 0.6, easeLinearity: 0.2 });
    },
    [bandCenter],
  );

  useEffect(() => {
    for (const [id, pin] of pinsRef.current) {
      const on = id === selectedId;
      pin.el.classList.toggle('is-selected', on);
      pin.marker.setZIndexOffset(on ? 1000 : pin.el.classList.contains('hbm-pin--best') ? 500 : 0);
    }
    relayout();
    // the first selection is shown by fitAll; later ones fly
    if (fittedFor.current && flownTo.current !== null) flyToSelected();
    else flownTo.current = selectedId;
  }, [selectedId, placesKey, relayout, flyToSelected]);

  /* ---- sheet moved: keep the selected pin in the band ---- */
  const lastInset = useRef(insetBottom);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lastInset.current === insetBottom) return;
    const delta = insetBottom - lastInset.current;
    lastInset.current = insetBottom;
    const id = selectedRef.current;
    const pin = id ? pinsRef.current.get(id) : null;
    if (!pin) return;
    // a selection fly is under way (often started one render earlier, before the sheet reported its new height):
    // re-aim it at the new band instead of cutting it short with a pan
    if (flyingRef.current) {
      flyToSelected(true);
      return;
    }
    const pt = map.latLngToContainerPoint(pin.marker.getLatLng());
    const bandBottom = map.getSize().y - insetBottom;
    // only move when the pin left the band (or the band grew a lot): no needless motion
    if (pt.y > bandBottom - 24 || pt.y < insetTop + PIN_HEIGHT + 16 || delta < -120) {
      // vertical only: the user's horizontal framing stays as it was
      const bandMid = (insetTop + bandBottom) / 2 + PIN_HEIGHT / 2;
      map.panBy([0, pt.y - bandMid], { animate: !reducedMotion(), duration: 0.5 });
    }
  }, [insetBottom, insetTop, flyToSelected]);

  /* ---- route ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeRef.current?.remove();
    routeRef.current = null;
    const pts = (route ?? []).filter(hasCoords);
    if (pts.length < 2) return;
    const lls = pts.map((s) => L.latLng(s.lat, s.lon));
    const group = L.layerGroup();
    const halo = L.polyline(lls, { className: 'hbm-route hbm-route--halo', weight: 9, interactive: false, smoothFactor: 1.5 });
    const base = L.polyline(lls, { className: 'hbm-route hbm-route--base', weight: 5, interactive: false, smoothFactor: 1.5 });
    const dash = L.polyline(lls, { className: 'hbm-route hbm-route--dash', weight: 4, interactive: false, smoothFactor: 1.5 });
    group.addLayer(halo).addLayer(base).addLayer(dash);
    pts.forEach((s, i) => {
      const icon = L.divIcon({
        className: 'hbm-pin-wrap',
        html: `<span class="hbm-stop" aria-hidden="true">${toPersianDigits(i + 1)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      group.addLayer(L.marker([s.lat, s.lon], { icon, interactive: false, keyboard: false, zIndexOffset: -200, title: s.title ?? '' }));
    });
    group.addTo(map);
    routeRef.current = group;
    if (!reducedMotion()) {
      for (const line of [halo, base]) {
        const path = line.getElement() as SVGPathElement | undefined;
        if (!path || typeof path.getTotalLength !== 'function') continue;
        const len = path.getTotalLength();
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.getBoundingClientRect();
        path.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(0.22, 1, 0.36, 1)';
        path.style.strokeDashoffset = '0';
        path.addEventListener(
          'transitionend',
          () => {
            path.style.strokeDasharray = '';
            path.style.strokeDashoffset = '';
            path.style.transition = '';
          },
          { once: true },
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeKey]);

  /* ---- locate me ---- */
  const showNote = useCallback((text: string) => setNote({ text, key: Date.now() }), []);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 4200);
    return () => window.clearTimeout(id);
  }, [note]);

  const locate = useCallback(() => {
    const map = mapRef.current;
    if (!map || locating) return;
    if (!('geolocation' in navigator)) {
      showNote('مرورگرت موقعیت‌یابی ندارد.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        meRef.current?.remove();
        const me = L.layerGroup([
          L.circle(ll, { radius: Math.min(pos.coords.accuracy, 400), className: 'hbm-accuracy', interactive: false }),
          L.marker(ll, {
            icon: L.divIcon({ className: 'hbm-pin-wrap', html: '<span class="hbm-me"></span>', iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 2000,
          }),
        ]).addTo(map);
        meRef.current = me;
        setLocated(true);
        if (ll.distanceTo(CORE) > FAR_M) {
          showNote('موقعیتت بیرون از محدودهٔ بازار است.');
          return;
        }
        const z = Math.max(map.getZoom(), 16);
        const target = bandCenter(ll, z);
        if (reducedMotion()) map.setView(target, z, { animate: false });
        else map.flyTo(target, z, { duration: 0.9 });
      },
      (err) => {
        setLocating(false);
        showNote(
          err.code === err.PERMISSION_DENIED
            ? 'اجازهٔ دیدن موقعیت داده نشد. از تنظیمات مرورگر می‌شود روشنش کرد.'
            : 'موقعیتت پیدا نشد. کمی بعد دوباره امتحان کن.',
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [locating, bandCenter, showNote]);

  return (
    <div className={`hbm h-full w-full ${className}`}>
      <div ref={hostRef} className="absolute inset-0" />
      {busy && <div className="hbm-veil" aria-hidden="true" />}
      {interactive && (
        <div className="hbm-controls">
          <button
            type="button"
            className={`hbm-ctl ${located ? 'is-on' : ''}`}
            onClick={locate}
            aria-busy={locating || undefined}
            aria-label="نمایش موقعیت من روی نقشه"
            title="موقعیت من"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
              {locating ? (
                <path d="M12 3a9 9 0 1 0 9 9" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="3.2" fill={located ? 'currentColor' : 'none'} />
                  <circle cx="12" cy="12" r="7.5" />
                  <path d="M12 1.8v2.7M12 19.5v2.7M1.8 12h2.7M19.5 12h2.7" />
                </>
              )}
            </svg>
          </button>
          <button type="button" className="hbm-ctl" onClick={() => fitAll(true, true)} aria-label="دیدن همهٔ پاساژها روی نقشه" title="همهٔ پاساژها">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
              <circle cx="12" cy="12" r="2.2" />
            </svg>
          </button>
        </div>
      )}
      <div aria-live="polite" className="contents">
        {note && (
          <p key={note.key} className="hbm-note">
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}
