import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { rubberBand, settleSnap } from './placeModel';

/**
 * Non-modal bottom sheet that rests at snap heights over a map (Apple-Maps style).
 *
 * - The header (handle + whatever is passed) always drags.
 * - Below the top snap the body drags the sheet too (touch-action: none), so a flick on the list expands it.
 * - At the top snap the body scrolls natively; pulling down while scrolled to the top drags the sheet down.
 * - A release settles to the nearest snap, a flick moves one snap in its direction.
 * - The handle is a button: Enter/Space toggles, arrow keys step between snaps.
 * The height is applied to the DOM directly while dragging (no React render per frame); `onHeight` reports it.
 */
export interface SnapSheetProps {
  /** Visible heights in px, ascending. */
  snaps: readonly number[];
  index: number;
  onIndexChange: (i: number) => void;
  /** Every applied height; `live` is true while a finger drives it (no transition). */
  onHeight?: (px: number, live: boolean) => void;
  header: ReactNode;
  children: ReactNode;
  /** Accessible name of the sheet region. */
  label: string;
  scrollRef?: RefObject<HTMLDivElement>;
  className?: string;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SETTLE_MS = 420;

interface Drag {
  startY: number;
  startX: number;
  startH: number;
  lastY: number;
  lastT: number;
  v: number;
  active: boolean;
  pointerId: number | null;
}

export function SnapSheet({ snaps, index, onIndexChange, onHeight, header, children, label, scrollRef, className = '' }: SnapSheetProps) {
  const rootRef = useRef<HTMLElement>(null);
  const ownScroll = useRef<HTMLDivElement>(null);
  const scroller = scrollRef ?? ownScroll;
  const heightRef = useRef(snaps[index] ?? 0);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;

  const max = snaps[snaps.length - 1] ?? 0;
  const min = snaps[0] ?? 0;
  const atTop = index === snaps.length - 1;

  const apply = useCallback(
    (h: number, live: boolean) => {
      const el = rootRef.current;
      heightRef.current = h;
      if (!el) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.style.transition = live || still ? 'none' : `transform ${SETTLE_MS}ms ${EASE}`;
      el.style.transform = `translate3d(0, ${Math.round(max - h)}px, 0)`;
      onHeightRef.current?.(h, live);
    },
    [max],
  );

  // settle on the current snap whenever it (or the snap set) changes
  useLayoutEffect(() => {
    const target = snaps[index];
    if (target == null) return;
    apply(target, false);
    const s = scroller.current;
    if (s) s.style.paddingBottom = `${Math.max(0, max - target)}px`;
  }, [index, snaps, max, apply, scroller]);

  const begin = (y: number, x: number, pointerId: number | null) => {
    drag.current = { startY: y, startX: x, startH: heightRef.current, lastY: y, lastT: performance.now(), v: 0, active: false, pointerId };
  };
  const move = (y: number): void => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    // positive velocity = the sheet grows (finger moves up)
    d.v = 0.8 * ((d.lastY - y) / dt) + 0.2 * d.v;
    d.lastY = y;
    d.lastT = now;
    apply(rubberBand(d.startH + (d.startY - y), min, max), true);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    // a stale velocity (finger held still before lifting) is not a flick
    const v = performance.now() - d.lastT > 90 ? 0 : d.v;
    const next = settleSnap(heightRef.current, v, snaps);
    if (next === index) apply(snaps[next]!, false);
    else onIndexChange(next);
  };

  /* ---- pointer: header always, body below the top snap ---- */
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const inHeader = !!(e.target as HTMLElement).closest('[data-sheet-header]');
    if (!inHeader && atTop) return; // native scroll (touch) or wheel (mouse) owns the body at the top snap
    begin(e.clientY, e.clientX, e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      const dy = e.clientY - d.startY;
      const dx = e.clientX - d.startX;
      if (Math.abs(dy) < 7) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        drag.current = null;
        return;
      }
      d.active = true;
      d.startY = e.clientY;
      d.lastY = e.clientY;
      rootRef.current?.setPointerCapture?.(e.pointerId);
    }
    move(e.clientY);
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.active) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
    end();
  };

  /* ---- touch: pull the list down from its top at the top snap ---- */
  useEffect(() => {
    const s = scroller.current;
    if (!s || !atTop) return;
    let startY = 0;
    let startX = 0;
    let pulling = false;
    const ts = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      startY = t.clientY;
      startX = t.clientX;
      pulling = false;
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY;
      if (!pulling) {
        if (s.scrollTop > 0 || dy < 8 || Math.abs(t.clientX - startX) > Math.abs(dy)) return;
        pulling = true;
        begin(t.clientY, t.clientX, null);
        drag.current!.active = true;
      }
      e.preventDefault();
      move(t.clientY);
    };
    const te = () => {
      if (pulling) end();
      pulling = false;
    };
    s.addEventListener('touchstart', ts, { passive: true });
    s.addEventListener('touchmove', tm, { passive: false });
    s.addEventListener('touchend', te);
    s.addEventListener('touchcancel', te);
    return () => {
      s.removeEventListener('touchstart', ts);
      s.removeEventListener('touchmove', tm);
      s.removeEventListener('touchend', te);
      s.removeEventListener('touchcancel', te);
    };
    // begin/move/end read refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atTop, scroller, snaps, index]);

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onIndexChange(Math.min(snaps.length - 1, index + 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onIndexChange(Math.max(0, index - 1));
    }
  };
  const toggle = () => onIndexChange(atTop ? Math.max(0, snaps.length - 2) : snaps.length - 1);

  return (
    <section
      ref={rootRef}
      aria-label={label}
      className={`absolute inset-x-0 bottom-0 z-[600] flex flex-col rounded-t-[26px] bg-canvas will-change-transform ${className}`}
      style={{ height: max, transform: `translate3d(0, ${Math.round(max - (snaps[index] ?? 0))}px, 0)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div data-sheet-header className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing">
        <button
          type="button"
          onClick={toggle}
          onKeyDown={onHandleKey}
          aria-label={atTop ? 'کوچک کردن فهرست' : 'بزرگ کردن فهرست'}
          aria-expanded={atTop}
          className="mx-auto flex h-7 w-24 items-center justify-center rounded-full"
        >
          <span aria-hidden="true" className="block h-[5px] w-10 rounded-full bg-line-strong/60" />
        </button>
        {header}
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ touchAction: atTop ? 'pan-y' : 'none' }}
      >
        {children}
      </div>
    </section>
  );
}
