/**
 * Copying text on any origin. The app is also served over plain HTTP (no TLS yet), where `navigator.clipboard` does not
 * exist: then the old `execCommand('copy')` on a selected field is tried. `copyText` says honestly which path worked,
 * so the UI can fall back to a visible, selectable field when neither did.
 */
export type CopyResult = 'clipboard' | 'exec' | 'failed';

/** Selects everything inside a text field (works for touch browsers too, where select() alone can be ignored). */
export function selectAll(el: HTMLInputElement | HTMLTextAreaElement) {
  el.focus();
  try {
    el.select();
    el.setSelectionRange(0, el.value.length);
    el.scrollLeft = 0; // show where the link begins, not its tail
  } catch {
    /* some mobile browsers refuse programmatic selection; the user can still long-press */
  }
}

function execCopy(text: string, field?: HTMLInputElement | HTMLTextAreaElement | null): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  let temp: HTMLTextAreaElement | null = null;
  const prev = document.activeElement as HTMLElement | null;
  try {
    let el = field ?? null;
    if (!el) {
      temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.setAttribute('aria-hidden', 'true');
      temp.style.cssText = 'position:fixed;top:0;width:1px;height:1px;opacity:0;';
      // inside the open dialog if there is one: the page behind a modal is inert and could not hold the selection
      (document.querySelector('[role="dialog"]') ?? document.body).appendChild(temp);
      el = temp;
    }
    selectAll(el);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    temp?.remove();
    prev?.focus?.();
  }
}

export async function copyText(text: string, field?: HTMLInputElement | HTMLTextAreaElement | null): Promise<CopyResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    } catch {
      /* permission denied / not focused: try the fallback */
    }
  }
  return execCopy(text, field) ? 'exec' : 'failed';
}

/** Web Share exists only on secure origins (and some mobile browsers); it is an extra button, never the only way. */
export function canWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Returns false when the user dismissed the share sheet or sharing failed. */
export async function webShare(data: { title: string; url: string }): Promise<boolean> {
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}
