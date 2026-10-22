// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemResolution, ModelOption, Requirement } from '../api/types';
import { isDeadEnd, missingGroups, relaxRequirement } from '../lib/items';
import { mockParse, mockResolve } from '../api/mock/engine';
import { emptyState, usePlans } from '../store/plans';
import { CONDITION_ANY } from '../lib/items';
import { ItemCard } from './ItemCard';

const model = (i: number): ModelOption => ({
  productId: `p${i}`,
  name: `Galaxy A5${i} 5G`,
  specs: [],
  priceLow: 18_000_000 + i,
  priceHigh: 19_000_000,
  sellerCount: 3,
  diffLabel: `مدل ${i} فرق دارد`,
  current: false,
  flags: i === 1 ? ['used'] : undefined,
});

const req: Requirement = { id: 'i1', text: 'گوشی سامسونگ A56 زیر ۵۰ میلیون', qty: 1, categoryId: null, categoryLabel: '', chips: [] };

function mount(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  flushSync(() => createRoot(host).render(el));
  return host;
}
afterEach(() => {
  document.body.innerHTML = '';
});

const card = (res: ItemResolution, extra: Partial<React.ComponentProps<typeof ItemCard>> = {}) =>
  mount(<ItemCard req={req} res={res} onChange={() => undefined} onRemove={() => undefined} onActivate={() => undefined} onDetachChip={() => undefined} {...extra} />);

describe('dead end (server noMatch)', () => {
  const res: ItemResolution = {
    itemId: 'i1',
    state: 'alternative',
    pendingQuestions: 0,
    noMatch: {
      reasonFa: 'موردی با این مشخصات زیر ۵۰ میلیون پیدا نشد.',
      relax: [
        { attr: 'budget', label: 'بدون سقف قیمت' },
        { attr: 'condition', label: 'کارکرده هم باشد' },
      ],
      closest: [1, 2, 3, 4, 5].map(model),
    },
  };

  it('shows the amber state with the reason, one primary button per relaxation and at most 3 closest models', () => {
    const el = card(res);
    const panel = el.querySelector('[data-testid="no-match"]')!;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('data-source')).toBe('server');
    expect(panel.textContent).toContain('مورد مطابق خواسته پیدا نشد');
    expect(el.querySelector('[data-testid="no-match-reason"]')!.textContent).toBe('موردی با این مشخصات زیر ۵۰ میلیون پیدا نشد.');
    const relax = [...el.querySelectorAll<HTMLElement>('[data-testid="relax"]')];
    expect(relax.map((b) => [b.dataset.attr, b.textContent])).toEqual([
      ['budget', 'بدون سقف قیمت'],
      ['condition', 'کارکرده هم باشد'],
    ]);
    expect(el.querySelectorAll('[data-testid="closest-model"]')).toHaveLength(3);
    expect(el.querySelectorAll('[data-testid="pick-closest"]')[0]!.textContent).toBe('انتخاب این مدل');
    // flags travel with the model
    expect(el.querySelector('[data-testid="flag-note"]')!.textContent).toContain('کارکرده');
    // never a bare «جایگزین» badge
    expect(el.querySelector('[data-state="alternative"][class*="rounded-chip"]')).toBeNull();
    expect(el.textContent).not.toContain('جایگزین');
  });

  it('wires the buttons: relax(attr), pick(productId)', () => {
    const onRelax = vi.fn();
    const onPickModel = vi.fn();
    const el = card(res, { onRelax, onPickModel });
    el.querySelector<HTMLElement>('[data-testid="relax"][data-attr="condition"]')!.click();
    el.querySelectorAll<HTMLElement>('[data-testid="pick-closest"]')[1]!.click();
    expect(onRelax).toHaveBeenCalledWith('condition');
    expect(onPickModel).toHaveBeenCalledWith('p2');
  });

  it('with no closest models it still offers the options sheet', () => {
    const onChange = vi.fn();
    const el = card({ ...res, noMatch: { ...res.noMatch!, closest: [] } }, { onChange });
    el.querySelector<HTMLElement>('[data-testid="see-closest"]')!.click();
    expect(onChange).toHaveBeenCalled();
  });
});

describe('dead end derived on the client (older server / mock)', () => {
  const res: ItemResolution = {
    itemId: 'i1',
    state: 'alternative',
    pendingQuestions: 0,
    differs: 'موردی دقیقاً مطابق خواستهٔ تو نبود. نزدیک‌ترین‌ها را ببین.',
  };

  it('«جایگزین» with no product is never a bare badge: «این مورد دقیقاً پیدا نشد» + the options button', () => {
    expect(isDeadEnd(res)).toBe(true);
    const onChange = vi.fn();
    const el = card(res, { onChange });
    const panel = el.querySelector('[data-testid="no-match"]')!;
    expect(panel.getAttribute('data-source')).toBe('derived');
    expect(panel.textContent).toContain('این مورد دقیقاً پیدا نشد');
    expect(el.querySelector('[data-testid="no-match-reason"]')!.textContent).toContain('نزدیک‌ترین‌ها را ببین');
    expect(el.textContent).not.toContain('جایگزین');
    const btn = el.querySelector<HTMLElement>('[data-testid="see-closest"]')!;
    expect(btn.textContent).toBe('ببین گزینه‌های نزدیک');
    btn.click();
    expect(onChange).toHaveBeenCalled();
  });

  it('a real alternative (with a product) keeps its badge and no panel', () => {
    const alt: ItemResolution = { ...res, product: { id: 'p1', name: 'Galaxy A56' } };
    expect(isDeadEnd(alt)).toBe(false);
    const el = card(alt);
    expect(el.querySelector('[data-testid="no-match"]')).toBeNull();
    expect(el.textContent).toContain('جایگزین');
  });
});

describe('relaxing a requirement', () => {
  const parsed: Requirement = {
    id: 'i1',
    text: 'گوشی سامسونگ A56 زیر ۵۰ میلیون',
    qty: 1,
    categoryId: null,
    categoryLabel: '',
    budget: { max: 50_000_000 },
    constraints: [
      { attr: 'phone_model', op: 'eq', value: 'galaxy a56' },
      { attr: 'brand', op: 'eq', value: 'samsung' },
    ],
  };

  it('budget drops the price band only', () => {
    const r = relaxRequirement(parsed, 'budget');
    expect(r.budget).toBeUndefined();
    expect(r.constraints).toHaveLength(2);
    expect(parsed.budget).toBeTruthy(); // input untouched
  });
  it('any other attribute drops that constraint (and the legacy chip / inherited marker)', () => {
    const r = relaxRequirement({ ...parsed, inherited: [{ attr: 'brand', fromItemId: 'i0' }], chips: [{ key: 'brand', label: 'سامسونگ' }] }, 'brand');
    expect(r.constraints!.map((c) => c.attr)).toEqual(['phone_model']);
    expect(r.inherited).toEqual([]);
    expect(r.chips).toEqual([]);
    expect(r.budget).toBeTruthy();
  });

  it('the store applies it: budget / attribute edit the requirement, condition sets the «any» answer, all in one undoable step', () => {
    localStorage.clear();
    usePlans.setState({ plans: {}, progress: {}, lastSavedAt: null });
    const id = usePlans.getState().create('x', [parsed]);
    usePlans.getState().answer(id, 'i1', 'budget', 'something');
    usePlans.getState().relax(id, 'i1', 'budget');
    let p = usePlans.getState().plans[id]!;
    expect(p.requirements[0]!.budget).toBeUndefined();
    expect(p.answers.i1).toEqual({});
    usePlans.getState().relax(id, 'i1', 'condition');
    p = usePlans.getState().plans[id]!;
    expect(p.answers.i1!.condition).toBe(CONDITION_ANY);
    usePlans.getState().relax(id, 'i1', 'phone_model');
    expect(usePlans.getState().plans[id]!.requirements[0]!.constraints!.map((c) => c.attr)).toEqual(['brand']);
  });
});

describe('missing items are told apart', () => {
  const coverage = {
    covered: 1,
    total: 5,
    missing: [
      { itemId: 'a', name: 'برنج هاشمی', why: '' },
      { itemId: 'b', name: 'ضبط‌کننده', why: '' },
      { itemId: 'c', name: 'آداپتور', why: '' },
      { itemId: 'd', name: 'گوشی آیفون ۱۵', why: '' },
    ],
  };
  const items: ItemResolution[] = [
    { itemId: 'a', state: 'not_found', pendingQuestions: 0 },
    { itemId: 'b', state: 'needs_info', pendingQuestions: 1 },
    { itemId: 'c', state: 'no_price', pendingQuestions: 0 },
    { itemId: 'd', state: 'alternative', pendingQuestions: 0 },
  ];

  it('groups by the per-item state: پیدا نشد / منتظر انتخاب / بدون قیمت (a dead-end alternative counts as not found)', () => {
    expect(missingGroups({ coverage, items })).toEqual([
      { kind: 'not_found', names: ['برنج هاشمی', 'گوشی آیفون ۱۵'] },
      { kind: 'needs_info', names: ['ضبط‌کننده'] },
      { kind: 'no_price', names: ['آداپتور'] },
    ]);
  });
  it('prefers the server\'s own kind when it sends one', () => {
    const c = { ...coverage, missing: [{ itemId: 'b', name: 'ضبط‌کننده', why: '', kind: 'no_price' as const }] };
    expect(missingGroups({ coverage: c, items })).toEqual([{ kind: 'no_price', names: ['ضبط‌کننده'] }]);
  });
  it('without item states an entry is «منتظر انتخاب», never silently «پیدا نشد»', () => {
    expect(missingGroups({ coverage })).toEqual([{ kind: 'needs_info', names: ['برنج هاشمی', 'ضبط‌کننده', 'آداپتور', 'گوشی آیفون ۱۵'] }]);
  });
});

describe('mock engine: the dead end', () => {
  const text = 'گوشی آیفون ۱۵ زیر ۵۰ میلیون';
  it('an iPhone under a price ceiling is a dead end with relaxations and a closest model; relaxing resolves it', () => {
    const state = emptyState(mockParse(text).items);
    const res = mockResolve(state).items[0]!;
    expect(res.state).toBe('alternative');
    expect(res.product).toBeUndefined();
    expect(res.noMatch!.relax.map((r) => r.attr)).toEqual(['budget', 'condition']);
    expect(res.noMatch!.closest).toHaveLength(1);

    const noBudget = { ...state, requirements: state.requirements.map((r) => relaxRequirement(r, 'budget')) };
    expect(mockResolve(noBudget).items[0]!.noMatch).toBeUndefined();
    const anyCond = { ...state, answers: { [state.requirements[0]!.id]: { condition: CONDITION_ANY } } };
    expect(mockResolve(anyCond).items[0]!.noMatch).toBeUndefined();
  });
});
