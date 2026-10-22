// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLlmConfigured, degradedKind } from '../api/health';
import { setApiAdapter, type ApiAdapter } from '../api/client';
import type { AssistResponse } from '../api/types';
import { emptyState } from '../store/plans';
import { AssistantSheet } from './AssistantSheet';

const state = emptyState([]);
let roots: Root[] = [];
const SIMPLE = 'دستیار در حالت ساده است: فقط درخواست‌های کوتاه مثل «ارزان‌تر» یا «بدون این مغازه» را می‌فهمد';
const OUTAGE = 'دستیار هوشمند فعلاً در دسترس نیست';

function health(llm: boolean) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ok', llm }) })));
}
function adapter(answers: (AssistResponse | Error)[]): ApiAdapter {
  let i = 0;
  return {
    assist: async () => {
      const a = answers[Math.min(i++, answers.length - 1)]!;
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as ApiAdapter;
}
const unchanged = (messageFa: string, extra: Partial<AssistResponse> = {}): AssistResponse => ({
  action: { type: 'none' },
  newState: state,
  changed: false,
  supported: true,
  message: messageFa,
  messageFa,
  source: 'keywords',
  ...extra,
});
function mount(props: Partial<React.ComponentProps<typeof AssistantSheet>> = {}) {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  flushSync(() => root.render(<AssistantSheet open state={state} onClose={() => undefined} onApply={() => undefined} {...props} />));
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const tick = () => new Promise((r) => setTimeout(r, 40));
async function ask(chip: string) {
  q(`assist-${chip}`)!.click();
  await tick();
}

beforeEach(() => resetLlmConfigured());
afterEach(() => {
  for (const r of roots) flushSync(() => r.unmount());
  roots = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

describe('assistant sheet: honest wording for the no-model mode', () => {
  it('server without a model: says «حالت ساده» up front, never «در دسترس نیست»', async () => {
    health(false);
    setApiAdapter(adapter([unchanged('همین الان ارزان‌ترین است.', { degraded: true })]));
    mount();
    await tick();
    expect(q('assist-simple-mode')!.textContent).toBe(SIMPLE);
    await ask('cheaper');
    expect(q('assist-result')!.textContent).toContain('ارزان‌ترین');
    expect(q('assist-degraded')).toBeNull(); // the simple-mode line already says it
    expect(document.body.textContent).not.toContain(OUTAGE);
  });

  it('server says degradedReason failed: the outage wording stays', async () => {
    health(true);
    setApiAdapter(adapter([unchanged('پاسخ ساده', { degraded: true, degradedReason: 'failed' })]));
    mount();
    await tick();
    expect(q('assist-simple-mode')).toBeNull();
    await ask('cheaper');
    expect(q('assist-degraded')!.textContent).toBe(OUTAGE + '؛ پاسخ ساده نمایش داده شد');
  });

  it('server says not_configured while health is unknown: simple-mode line, not an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    setApiAdapter(adapter([unchanged('پاسخ ساده', { degraded: true, degradedReason: 'not_configured' })]));
    mount();
    await tick();
    await ask('cheaper');
    expect(q('assist-simple-mode')!.textContent).toBe(SIMPLE);
    expect(document.body.textContent).not.toContain(OUTAGE);
  });

  it('missing reason: health llm:false reads as not_configured, otherwise as a failure', () => {
    expect(degradedKind(undefined, false)).toBe('not_configured');
    expect(degradedKind(undefined, true)).toBe('failed');
    expect(degradedKind(undefined, null)).toBe('failed');
    expect(degradedKind('budget', false)).toBe('budget');
  });
});

describe('assistant sheet: no stale answer', () => {
  it('a new request clears the previous answer, even when the new one fails', async () => {
    health(true);
    setApiAdapter(adapter([unchanged('پاسخ قدیمی'), new Error('x')]));
    mount();
    await tick();
    await ask('cheaper');
    expect(q('assist-result')!.textContent).toContain('پاسخ قدیمی');
    await ask('closer');
    expect(q('assist-result')).toBeNull();
    expect(document.body.textContent).not.toContain('پاسخ قدیمی');
    expect(q('assist-error')).toBeTruthy();
  });

  it('an answer that changes nothing tells the page that its change banner is no longer the latest word', async () => {
    health(true);
    const onUnchanged = vi.fn();
    setApiAdapter(adapter([unchanged('همین الان ارزان‌ترین است.')]));
    mount({ onUnchanged });
    await tick();
    await ask('cheaper');
    expect(onUnchanged).toHaveBeenCalledTimes(1);
    expect(onUnchanged.mock.calls[0]![0].messageFa).toBe('همین الان ارزان‌ترین است.');
  });
});
