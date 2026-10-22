// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanMenuSheet } from './PlanMenuSheet';

let roots: Root[] = [];
function mount(props: Partial<React.ComponentProps<typeof PlanMenuSheet>> = {}) {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const p = { open: true, name: 'برنامه', onClose: vi.fn(), onRename: vi.fn(), getShareUrl: () => 'http://87.107.5.78:8088/#/s/PAYLOAD', onCopied: vi.fn(), onNewPlan: vi.fn(), onRemove: vi.fn(), ...props };
  flushSync(() => root.render(<PlanMenuSheet {...p} />));
  return p;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (id: string) => {
  q(id)!.click();
  await new Promise((r) => setTimeout(r, 30));
};
const unmountAll = () => {
  for (const r of roots) flushSync(() => r.unmount());
  roots = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
};

afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe('share link: copy on any origin', () => {
  it('secure origin: the clipboard API gets the real #/s/ link, the toast callback fires and the sheet closes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const p = mount();
    await click('menu-copy-link');
    expect(writeText).toHaveBeenCalledWith('http://87.107.5.78:8088/#/s/PAYLOAD');
    expect(p.onCopied).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('plain HTTP (no clipboard API) and execCommand refuses: a visible, selected, readonly field holds the link; no failure message', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    const p = mount();
    await click('menu-copy-link');
    const input = q('share-url') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('http://87.107.5.78:8088/#/s/PAYLOAD');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(q('share-help')!.textContent).toContain('انتخاب همه');
    expect(document.body.textContent).not.toContain('کپی نشد');
    expect(document.body.textContent).not.toContain('نوار آدرس');
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onCopied).not.toHaveBeenCalled();
  });

  it('plain HTTP with a working execCommand: says copied, and still shows the field as a safety net', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: () => boolean }).execCommand = exec;
    mount();
    await click('menu-copy-link');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(q('share-help')!.textContent).toContain('کپی شد');
    expect((q('share-url') as HTMLInputElement).value).toContain('#/s/PAYLOAD');
  });

  it('Web Share is an extra row only where it exists', () => {
    vi.stubGlobal('navigator', { ...navigator, share: undefined });
    mount();
    expect(q('menu-share')).toBeNull();
    unmountAll();
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn() });
    mount();
    expect(q('menu-share')).toBeTruthy();
  });
});
