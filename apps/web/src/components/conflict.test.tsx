// @vitest-environment jsdom
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { mockParse, mockPlan } from '../api/mock/engine';
import type { CompatLine, ItemResolution, PlanResponse } from '../api/types';
import { t } from '../copy/fa';
import { planMarker } from '../lib/items';
import { ListView } from '../screens/ListView';
import { PlanView } from '../screens/PlanView';
import { blankPlan, emptyState } from '../store/plans';
import { CompatRow } from './CompatChip';
import { stripMarker } from './CoverageTotal';

/** A real (mock-engine) complete plan; the conflict flag and line are what the server will send. */
function basePlan(): PlanResponse {
  const { items } = mockParse('گوشی سامسونگ Galaxy A56، قاب و گلس');
  const p = mockPlan(emptyState(items));
  expect(p.complete).toBe(true);
  return p;
}
const noop = () => undefined;

function mount(el: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  flushSync(() => createRoot(host).render(<MemoryRouter>{el}</MemoryRouter>));
  return host;
}
afterEach(() => {
  document.body.innerHTML = '';
});

const planView = (plan: PlanResponse) => (
  <PlanView plan={plan} busy={false} onShowSeller={noop} onChangeItem={noop} onSwitchVariant={noop} onOpenAssistant={noop} onOpenTime={noop} onGoList={noop} />
);

describe('hasConflict on the plan view', () => {
  it('shows the amber «ناسازگاری دارد» chip next to the total and renders the engine line as given', () => {
    const line = 'جمع ۳ مورد: ۲۰٫۳ میلیون تومان · ناسازگاری دارد (قاب با گوشی نمی‌خورد)';
    const host = mount(planView({ ...basePlan(), hasConflict: true, totalLine: line }));
    const chip = host.querySelector('[data-testid="conflict-chip"]')!;
    expect(chip.textContent).toBe('ناسازگاری دارد');
    expect(chip.className).toContain('bg-amber-soft');
    const total = host.querySelector('[data-total]')!;
    expect(total.getAttribute('data-conflict')).toBe('true');
    expect(total.contains(chip)).toBe(true);
    expect(host.querySelector('[data-testid="total-line"]')!.textContent).toBe(line);
  });

  it('no flag, no chip: the usual composed total', () => {
    const host = mount(planView({ ...basePlan(), hasConflict: false, totalLine: 'جمع ۳ مورد: x' }));
    expect(host.querySelector('[data-testid="conflict-chip"]')).toBeNull();
    expect(host.querySelector('[data-total="complete"]')!.textContent).toContain('جمع ۳ مورد');
    expect(host.textContent).not.toContain('ناسازگاری دارد');
  });

  it('a conflict without an engine line still shows the chip beside the composed total', () => {
    const p = basePlan();
    delete p.totalLine;
    const host = mount(planView({ ...p, hasConflict: true }));
    expect(host.querySelector('[data-total] [data-testid="conflict-chip"]')).not.toBeNull();
  });
});

describe('hasConflict on the list view', () => {
  const { items } = mockParse('گوشی سامسونگ Galaxy A56، قاب و گلس');
  const saved = blankPlan('x', items);
  const ready: ItemResolution[] = items.map((r) => ({ itemId: r.id, state: 'suggested', pendingQuestions: 0, product: { id: 'p', name: 'x' } }));
  const list = (marker?: string) => (
    <ListView
      plan={saved}
      resolutions={ready}
      busy={false}
      activeId={null}
      setActiveId={noop}
      onAnswer={noop}
      onEnough={noop}
      onSettleAll={noop}
      onChange={noop}
      onRemove={noop}
      onDetachChip={noop}
      onIncludeCondition={noop}
      onRelax={noop}
      onPickModel={noop}
      onAdd={async () => true}
      onUnsure={noop}
      marker={marker}
      onPickNearby={noop}
    />
  );

  it('without a conflict the green «all ready» strip shows', () => {
    const host = mount(list());
    expect(host.querySelector('[data-testid="all-ready-strip"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="conflict-strip"]')).toBeNull();
  });

  it('with a conflict there is an amber strip and never the green one', () => {
    const host = mount(list('ناسازگاری دارد'));
    expect(host.querySelector('[data-testid="all-ready-strip"]')).toBeNull();
    expect(host.textContent).not.toContain(t.list.allReady);
    const strip = host.querySelector('[data-testid="conflict-strip"]')!;
    expect(strip.textContent).toContain('ناسازگاری دارد');
    expect(strip.className).toContain('bg-amber-soft');
  });

  it('the list strip carries the server marker text', () => {
    const host = mount(list('بدون تأیید سازگاری'));
    expect(host.querySelector('[data-testid="conflict-strip"]')!.textContent).toContain('بدون تأیید سازگاری');
    expect(host.querySelector('[data-testid="all-ready-strip"]')).toBeNull();
  });
});

describe('server marker (totalMarker / compatUnverified)', () => {
  it('a lifted assumption shows the amber «بدون تأیید سازگاری» chip, never the green strip', () => {
    const host = mount(planView({ ...basePlan(), hasConflict: false, compatUnverified: true, totalMarker: 'بدون تأیید سازگاری', totalLine: 'جمع ۳ مورد: ۲۰٫۳ میلیون تومان — بدون تأیید سازگاری' }));
    const chip = host.querySelector('[data-testid="conflict-chip"]')!;
    expect(chip.textContent).toBe('بدون تأیید سازگاری');
    // the line drops its own copy of the marker: it is said once, by the chip
    expect(host.querySelector('[data-testid="total-line"]')!.textContent).toBe('جمع ۳ مورد: ۲۰٫۳ میلیون تومان');
  });

  it('the flags alone give the same marker when the server sent no totalMarker', () => {
    expect(planMarker({ hasConflict: true })).toBe('ناسازگاری دارد');
    expect(planMarker({ compatUnverified: true })).toBe('بدون تأیید سازگاری');
    expect(planMarker({ totalMarker: 'x', hasConflict: true })).toBe('x');
    expect(planMarker({ hasConflict: false })).toBeUndefined();
  });

  it('stripMarker only removes a trailing copy of the marker', () => {
    expect(stripMarker('جمع ۲ مورد: ۶٫۲ میلیون تومان — ناسازگاری دارد', 'ناسازگاری دارد')).toBe('جمع ۲ مورد: ۶٫۲ میلیون تومان');
    expect(stripMarker('ناسازگاری دارد (قاب)', 'ناسازگاری دارد')).toBe('ناسازگاری دارد (قاب)');
  });
});

describe('compat line flags', () => {
  const base = { id: 'c', level: 'conflict' as const, text: 'دوربین IP به DVR وصل نمی‌شود (از انتخاب‌های خودت)', itemIds: ['i1'] };
  it('fromUserChoice shows «از انتخاب‌های خودت» once, as a tag', () => {
    const host = mount(<ul><CompatRow line={{ ...base, fromUserChoice: true } as CompatLine} /></ul>);
    expect(host.querySelector('[data-testid="from-user-choice"]')!.textContent).toBe('از انتخاب‌های خودت');
    expect(host.textContent!.match(/از انتخاب‌های خودت/g)).toHaveLength(1);
  });
  it('assumptionLifted shows the «فرض عمومی کنار گذاشته شد؛ تأیید نشده» label instead of the plain assumed chip', () => {
    const host = mount(<ul><CompatRow line={{ ...base, level: 'assumed', text: 'آداپتور ۱۲ ولت نیست', assumptionLifted: true } as CompatLine} /></ul>);
    expect(host.querySelector('[data-lifted="true"]')!.textContent).toBe('فرض عمومی کنار گذاشته شد؛ تأیید نشده');
  });
});
