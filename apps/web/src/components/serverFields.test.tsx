// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemResolution, Requirement } from '../api/types';
import { ModelRow } from '../sheets/OptionsSheet';
import { ItemCard } from './ItemCard';

function mount(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  flushSync(() => createRoot(host).render(el));
  return host;
}
afterEach(() => {
  document.body.innerHTML = '';
});

const req = { id: 'i1', text: 'برنج', qty: 2, categoryIds: [], constraints: [] } as unknown as Requirement;
const noop = () => undefined;
const card = (res: ItemResolution, extra: Partial<React.ComponentProps<typeof ItemCard>> = {}) =>
  mount(<ItemCard req={req} res={res} onChange={noop} onRemove={noop} onActivate={noop} onDetachChip={noop} {...extra} />);

const notFound: ItemResolution = {
  itemId: 'i1',
  state: 'not_found',
  pendingQuestions: 0,
  reason: 'این مورد در فهرست پیدا نشد.',
  nearbyCategories: ['سیم و کابل برق ساختمان', 'دوربین مدار بسته'],
  nearbyCategoryIds: [1834, 1153],
  nearbyLabelFa: 'چیزهایی که در این فهرست دارم',
};

describe('not-found category chips', () => {
  it('are buttons under the server heading; tapping chip i reports its index', () => {
    const onPick = vi.fn();
    const host = card(notFound, { onPickNearby: onPick });
    expect(host.textContent).toContain('چیزهایی که در این فهرست دارم');
    const chips = host.querySelectorAll<HTMLButtonElement>('[data-testid="nearby-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[1]!.textContent).toBe('دوربین مدار بسته');
    chips[1]!.click();
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('stay plain chips when the server sent no ids (older server)', () => {
    const { nearbyCategoryIds: _ids, ...old } = notFound;
    const host = card(old, { onPickNearby: vi.fn() });
    expect(host.querySelectorAll('[data-testid="nearby-chip"]')).toHaveLength(0);
    expect(host.textContent).toContain('دوربین مدار بسته');
  });
});

describe('server fields on the item card', () => {
  const ok: ItemResolution = { itemId: 'i1', state: 'suggested', pendingQuestions: 0, product: { id: 'p', name: 'دوربین x' }, unitPrice: 1_000_000, sellerCount: 3, eligibleCount: 4, rule: 'ارزان‌ترین' };

  it('shows the server sellerCountLabel instead of a client phrase', () => {
    const host = card({ ...ok, sellerCountLabel: '۳ فروشنده با قیمت' });
    expect(host.querySelector('[data-testid="seller-count"]')!.textContent).toBe('۳ فروشنده با قیمت');
  });

  it('shows the conflictNote in an amber block', () => {
    const host = card({ ...ok, conflictNote: 'با «دی وی آر ۴ کانال» که خودت خواستی جور نیست.' });
    const note = host.querySelector('[data-testid="conflict-note"]')!;
    expect(note.textContent).toContain('خودت خواستی جور نیست');
    expect(note.className).toContain('bg-amber-soft');
  });
});

describe('options rows', () => {
  it('ModelRow uses sellerCountLabel', () => {
    const host = mount(
      <ModelRow
        m={{ productId: 'p', name: 'x', specs: [], priceLow: 1000, priceHigh: 1000, sellerCount: 2, sellerCountLabel: '۲ فروشنده، بدون قیمت', current: false, fit: 'matches' } as never}
        onPick={noop}
      />,
    );
    expect(host.textContent).toContain('۲ فروشنده، بدون قیمت');
  });
});
