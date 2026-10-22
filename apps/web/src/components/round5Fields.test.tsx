// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompatLine, ItemResolution, PlanAlternative, Requirement, SellerOption } from '../api/types';
import { applyLocalAction } from '../api/assistState';
import { emptyState } from '../store/plans';
import { altLabel } from '../lib/alternatives';
import { askForLine } from '../lib/ask';
import { SellerRow } from '../sheets/OptionsSheet';
import { CompatRow } from './CompatChip';
import { CoverageTotal } from './CoverageTotal';
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
const noop = () => undefined;

const seller: SellerOption = {
  shopId: 's1',
  shopName: 'ایران‌مال',
  mall: 'علاالدین',
  listingTitle: 'شارژر ۲۰ وات اپل های کپی',
  price: 400_000,
  warranty: 'بدون گارانتی',
  hoursText: '۹ تا ۲۱',
  open: 'open',
  current: false,
  productId: 'p1',
  flags: ['replica'],
  flagLabels: ['کپی'],
  flagReason: 'در عنوان آگهی فروشنده: های کپی',
  conditionExcluded: true,
};

function lastButton(host: Element): HTMLButtonElement {
  const all = host.querySelectorAll('button');
  return all[all.length - 1] as HTMLButtonElement;
}

describe('seller rows with a condition flag', () => {
  it('a conditionExcluded seller is greyed out with its reason and cannot be picked unless the model is pinned', () => {
    const host = mount(<SellerRow s={seller} reported={false} visitActive={false} onPick={noop} />);
    const row = host.querySelector('[data-testid="seller-row"]')!;
    expect(row.getAttribute('data-blocked')).toBe('true');
    expect(row.className).toContain('opacity-70');
    expect(host.querySelector('[data-testid="flag-note"]')!.textContent).toContain('کپی');
    expect(host.querySelector('[data-testid="flag-reason"]')!.textContent).toContain('های کپی');
    expect(host.querySelector('[data-testid="condition-excluded-note"]')).not.toBeNull();
    expect(lastButton(host).disabled).toBe(true); // the price block is a button too: the action button is the last one
  });

  it('with the model pinned the same seller can be chosen', () => {
    const host = mount(<SellerRow s={seller} reported={false} visitActive={false} pinned onPick={noop} />);
    expect(host.querySelector('[data-testid="seller-row"]')!.getAttribute('data-blocked')).toBeNull();
    expect(lastButton(host).disabled).toBe(false);
  });

  it('a normal seller is untouched', () => {
    const { conditionExcluded: _c, flags: _f, flagLabels: _l, flagReason: _r, ...plain } = seller;
    const host = mount(<SellerRow s={plain} reported={false} visitActive={false} onPick={noop} />);
    expect(host.querySelector('[data-testid="seller-flags"]')).toBeNull();
    expect(lastButton(host).disabled).toBe(false);
  });
});

describe('adapter compatNote', () => {
  it('is a non-blocking note on the item card', () => {
    const req = { id: 'i1', text: 'آداپتور', qty: 1, categoryIds: [], constraints: [] } as unknown as Requirement;
    const res: ItemResolution = { itemId: 'i1', state: 'suggested', pendingQuestions: 0, compatNote: 'تعداد آداپتور را ننوشتی؛ ۱ عدد برای ۴ دوربین در نظر گرفته شد.' };
    const host = mount(<ItemCard req={req} res={res} onChange={noop} onRemove={noop} onActivate={noop} onDetachChip={noop} />);
    const note = host.querySelector('[data-testid="compat-note"]')!;
    expect(note.textContent).toContain('۱ عدد برای ۴ دوربین');
    expect(note.getAttribute('role')).toBe('note');
  });
});

describe('compat row', () => {
  const line: CompatLine = { id: 'camera_adapter_current:a,c', ruleId: 'camera_adapter_current', level: 'unknown', text: 'جریان آداپتور تأیید نشده', askSeller: 'جریان این آداپتور برای ۴ دوربین کافی است؟', itemIds: ['a', 'c'] };
  it('carries the rule id and the server question for non-stated lines', () => {
    const host = mount(<ul><CompatRow line={line} /></ul>);
    expect(host.querySelector('li')!.getAttribute('data-rule')).toBe('camera_adapter_current');
    expect(host.querySelector('[data-testid="compat-ask"]')!.textContent).toContain('جریان این آداپتور');
  });
  it('a stated line asks nothing', () => {
    const host = mount(<ul><CompatRow line={{ ...line, level: 'stated' }} /></ul>);
    expect(host.querySelector('[data-testid="compat-ask"]')).toBeNull();
  });
});

describe('askForLine', () => {
  const byItem: CompatLine = { id: 'x', level: 'unknown', text: 't', askSeller: 'general', itemIds: ['a', 'c'], askSellerByItem: { a: 'for the adapter', c: 'for the camera' } };
  it('uses the server StopLine.askSeller as is', () => {
    expect(askForLine({ itemId: 'c', askSeller: ['server wording'] }, [byItem])).toEqual(['server wording']);
  });
  it('falls back to the per-item wording of the compat lines, never the general one', () => {
    expect(askForLine({ itemId: 'c', askSeller: [] }, [byItem])).toEqual(['for the camera']);
    expect(askForLine({ itemId: 'a', askSeller: [] }, [{ ...byItem, level: 'stated' }])).toEqual([]);
  });
});

describe('datasetTotalLine', () => {
  it('is rendered as given, without «جمع طبق فهرست ·» in front (no doubled «جمع»)', () => {
    const host = mount(<CoverageTotal label={undefined} datasetLine="جمع طبق فهرست برای ۴ مورد: ۲۰٫۳ میلیون تومان" covered={4} total={4} amount={20_300_000} />);
    const text = host.textContent!;
    expect(text).toBe('جمع طبق فهرست برای ۴ مورد: ۲۰٫۳ میلیون تومان');
    expect(host.querySelector('[data-total]')!.getAttribute('data-total')).toBe('complete');
  });
  it('partial line keeps data-total=partial; the marker tail becomes the chip', () => {
    const host = mount(
      <CoverageTotal datasetLine="جمع طبق فهرست، فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان — ناسازگاری دارد" marker="ناسازگاری دارد" covered={3} total={5} amount={11_200_000} />,
    );
    expect(host.querySelector('[data-total]')!.getAttribute('data-total')).toBe('partial');
    expect(host.querySelector('[data-testid="total-line"]')!.textContent).toBe('جمع طبق فهرست، فقط ۳ از ۵ مورد: ۱۱٫۲ میلیون تومان');
    expect(host.querySelector('[data-testid="conflict-chip"]')!.textContent).toBe('ناسازگاری دارد');
  });
  it('absent: the old composition (label · total) still renders', () => {
    const host = mount(<CoverageTotal label="جمع طبق فهرست" covered={4} total={4} amount={20_300_000} />);
    expect(host.textContent).toContain('جمع طبق فهرست · ۴ مورد');
    expect(host.textContent).not.toContain('جمع جمع');
  });
});

describe('plan alternatives', () => {
  const alt = (o: Partial<PlanAlternative>): PlanAlternative => ({ id: 'stops:1', label: '', description: 'x', deltaToman: 1, deltaStops: -3, ...o });
  it('a distinct server label is used as is; a blank one falls back to the server stopCount', () => {
    const all = [alt({ id: 'stops:2', label: '۲ توقف · ۱٫۱ میلیون تومان بیشتر', stopCount: 2 }), alt({ id: 'stops:1', label: '', stopCount: 1 })];
    expect(altLabel(all[0]!, all, 4)).toBe('۲ توقف · ۱٫۱ میلیون تومان بیشتر');
    expect(altLabel(all[1]!, all, 4)).toBe('۱ توقف');
  });
});

describe('set_spec assistant action', () => {
  it('is applied by the server only: the local fallback leaves the state untouched', () => {
    const state = emptyState([]);
    expect(applyLocalAction(state, { type: 'set_spec', itemId: 'hdd', attr: 'capacity_tb', value: 4 })).toEqual(state);
  });
});
