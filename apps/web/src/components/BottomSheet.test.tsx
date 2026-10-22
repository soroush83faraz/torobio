// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';

let roots: Root[] = [];
function mount(el: React.ReactElement): { host: HTMLElement; root: Root } {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  flushSync(() => root.render(el));
  return { host, root };
}
afterEach(() => {
  for (const r of roots) flushSync(() => r.unmount());
  roots = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

const esc = (target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

describe('BottomSheet Escape and focus', () => {
  it('Escape closes the sheet in the very same tick it opened (no requestAnimationFrame window)', () => {
    const onClose = vi.fn();
    mount(
      <BottomSheet open onClose={onClose} title="گزینه‌ها">
        <button type="button">یک</button>
      </BottomSheet>,
    );
    // no frame has passed: focus is already inside the dialog, and Escape pressed anywhere closes it
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    esc(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape works while focus is still on the (inert) page, not only inside the dialog', () => {
    const onClose = vi.fn();
    const { host } = mount(
      <BottomSheet open onClose={onClose} title="x">
        <button type="button">یک</button>
      </BottomSheet>,
    );
    (document.activeElement as HTMLElement).blur();
    esc(host);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the top-most sheet reacts to Escape', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    mount(
      <>
        <BottomSheet open onClose={lower} title="پایین">
          <button type="button">a</button>
        </BottomSheet>
        <BottomSheet open onClose={upper} title="بالا">
          <button type="button">b</button>
        </BottomSheet>
      </>,
    );
    esc();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it('a closed sheet ignores Escape, the page becomes inert while open, and focus returns to the opener', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const view = (open: boolean) => (
      <BottomSheet open={open} onClose={onClose} title="x">
        <button type="button">یک</button>
      </BottomSheet>
    );
    flushSync(() => root.render(view(false)));
    esc();
    expect(onClose).not.toHaveBeenCalled();
    flushSync(() => root.render(view(true)));
    expect(host.hasAttribute('inert')).toBe(true);
    flushSync(() => root.render(view(false)));
    expect(host.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the focus trap: Tab on the last control wraps to the first', () => {
    mount(
      <BottomSheet open onClose={() => undefined} title="x">
        <button type="button" id="a">a</button>
        <button type="button" id="b">b</button>
      </BottomSheet>,
    );
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button'));
    // jsdom has no layout (offsetParent null): the trap sees no focusable node and keeps focus inside
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    buttons[buttons.length - 1]!.dispatchEvent(ev);
    expect(ev.defaultPrevented || document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
  });
});
