import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../copy/fa';
import { IconButton } from './Button';
import { useToasts } from './Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky footer (primary action). */
  footer?: ReactNode;
  /** Optional element to focus first; defaults to the first focusable control. */
  initialFocus?: () => HTMLElement | null;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

let openCount = 0;
/** Open sheets, last = top-most. Only the top-most one reacts to Escape. */
const sheetStack: symbol[] = [];

/** Keeps the sheet above the on-screen keyboard (visualViewport). */
function useViewportInset(active: boolean) {
  const [inset, setInset] = useState({ bottom: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight });
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset({ bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop), height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

/**
 * Bottom sheet: focus trap, Esc, drag-to-close on the handle/header, safe-area padding,
 * keyboard-aware height, background made inert while open.
 */
export function BottomSheet({ open, onClose, title, children, footer, initialFocus }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ startY: number; startT: number; id: number } | null>(null);
  const inset = useViewportInset(open);
  const returnFocus = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => onClose(), [onClose]);

  // Scroll lock, inert background, focus management. A layout effect: the sheet is focused and listening for Escape
  // before the browser can deliver another key event (a requestAnimationFrame here left a one-frame window in which
  // Escape went to the inert page and the sheet stayed open).
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useLayoutEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    // a lingering toast must not cover the sheet's controls
    useToasts.setState({ toasts: [] });
    const root = document.getElementById('root');
    openCount += 1;
    root?.setAttribute('inert', '');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setClosing(false);
    setDragY(0);
    const me = Symbol('sheet');
    sheetStack.push(me);
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || sheetStack[sheetStack.length - 1] !== me) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onDocKey, true);
    const target =
      initialFocus?.() ?? dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? dialogRef.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onDocKey, true);
      const at = sheetStack.indexOf(me);
      if (at >= 0) sheetStack.splice(at, 1);
      openCount -= 1;
      if (openCount <= 0) {
        root?.removeAttribute('inert');
        openCount = 0;
      }
      document.body.style.overflow = prevOverflow;
      returnFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Escape is handled at document level (see the layout effect), so it works wherever focus is.
    if (e.key !== 'Tab') return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((n) => n.offsetParent !== null);
    if (!nodes.length) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Swipe / drag down on the handle area closes the sheet.
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { startY: e.clientY, startT: e.timeStamp, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setDragY(Math.max(0, e.clientY - drag.current.startY));
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const velocity = dy / Math.max(1, e.timeStamp - drag.current.startT);
    drag.current = null;
    if (dy > 110 || (dy > 30 && velocity > 0.6)) {
      setClosing(true);
      setDragY(window.innerHeight);
      setTimeout(requestClose, 160);
    } else {
      setDragY(0);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" dir="rtl" lang="fa">
      <div
        className="animate-fade-in absolute inset-0 bg-ink/45"
        onClick={requestClose}
        aria-hidden="true"
        data-testid="sheet-backdrop"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current ? 'none' : closing ? 'transform 0.16s ease-in' : 'transform 0.2s ease-out',
          bottom: inset.bottom,
          maxHeight: `min(92dvh, ${Math.max(240, inset.height - 12)}px)`,
        }}
        className="animate-sheet-in absolute inset-x-0 mx-auto flex w-full max-w-[480px] flex-col rounded-t-3xl bg-canvas shadow-sheet outline-none"
      >
        <div
          className="flex shrink-0 cursor-grab touch-none select-none flex-col items-center px-4 pt-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label={t.common.dragHandle}
        >
          <span className="h-1.5 w-12 rounded-full bg-line-strong/60" aria-hidden="true" />
          <div className="flex w-full items-center justify-between gap-2 pb-1 pt-1">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            <IconButton icon="close" label={t.common.close} onClick={requestClose} onPointerDown={(e) => e.stopPropagation()} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line bg-canvas px-4 pt-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
        {!footer && <div className="shrink-0" style={{ height: 'env(safe-area-inset-bottom)' }} />}
      </div>
    </div>,
    document.body,
  );
}
