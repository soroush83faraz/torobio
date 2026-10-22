import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { t } from '../copy/fa';
import { Icon } from './Icon';

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  push(message: string, opts?: { actionLabel?: string; onAction?: () => void; duration?: number }): number;
  dismiss(id: number): void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(message, opts = {}) {
    const id = ++seq;
    // One toast at a time keeps the screen calm; the newest replaces the previous.
    set({ toasts: [{ id, message, duration: opts.duration ?? (opts.onAction ? 7000 : 3500), ...opts }] });
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (message: string, opts?: Parameters<ToastState['push']>[1]) => useToasts.getState().push(message, opts);

/** Toast with an «برگردان» action. */
export const toastUndo = (message: string, onUndo: () => void) =>
  toast(message, { actionLabel: t.common.undo, onAction: onUndo });

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, dismiss]);
  return (
    <div className="animate-toast-in pointer-events-auto flex items-center gap-2 rounded-2xl bg-ink px-4 py-2 text-white shadow-sheet">
      <p className="flex-1 text-sm">{item.message}</p>
      {item.onAction && (
        <button
          type="button"
          onClick={() => {
            item.onAction?.();
            dismiss(item.id);
          }}
          className="min-h-touch rounded-lg px-3 text-sm font-bold text-[#8fe0dc] hover:bg-white/10"
        >
          {item.actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label={t.common.dismiss}
        className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg hover:bg-white/10"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** Mount once. Sits above the sticky action bar and the safe area. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  // Portalled outside #root so it stays usable while a sheet makes the app inert.
  return createPortal(
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      aria-label={t.common.toastRegion}
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + var(--bottom-bar, 0px) + 12px)' }}
    >
      <div className="flex w-full max-w-[480px] flex-col gap-2">
        {toasts.map((x) => (
          <ToastView key={x.id} item={x} />
        ))}
      </div>
    </div>,
    document.body,
  );
}
