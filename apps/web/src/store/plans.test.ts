// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mockParse } from '../api/mock/engine';
import { STORAGE_KEY, migrate, recentPlans, usePlans } from './plans';
import { decodeShare, encodeShare, shareUrl } from './share';

const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';

beforeEach(() => {
  localStorage.clear();
  usePlans.setState({ plans: {}, progress: {}, lastSavedAt: null });
});

function makePlan() {
  const { title, items } = mockParse(CCTV);
  return { id: usePlans.getState().create(title, items), items };
}

describe('plans store', () => {
  it('autosaves to the versioned key and never stores computed plans', () => {
    const { id, items } = makePlan();
    usePlans.getState().answer(id, items[1]!.id, 'signal', 'analog');
    usePlans.getState().toggleCheck(id, items[0]!.id);
    usePlans.getState().setReport(id, items[0]!.id, { kind: 'unavailable', shopId: 's1', at: '2026-10-21T08:00:00Z' });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!);
    expect(saved.version).toBe(2);
    const plan = saved.state.plans[id];
    expect(plan.answers[items[1]!.id].signal).toBe('analog');
    expect(plan.checks[items[0]!.id]).toBe(true);
    expect(plan.reports[items[0]!.id].kind).toBe('unavailable');
    // computed output must not be persisted
    expect(raw).not.toMatch(/stops|totalToman|coverage/);
  });

  it('rehydrates after a reload', async () => {
    const { id } = makePlan();
    usePlans.getState().rename(id, 'پروژهٔ من');
    const raw = localStorage.getItem(STORAGE_KEY)!;
    usePlans.setState({ plans: {} }); // simulates a fresh page load with an empty in-memory store
    localStorage.setItem(STORAGE_KEY, raw);
    await usePlans.persist.rehydrate();
    expect(usePlans.getState().plans[id]?.name).toBe('پروژهٔ من');
  });

  it('keeps user reports per item and lets them be removed (undo)', () => {
    const { id, items } = makePlan();
    const s = usePlans.getState();
    s.setReport(id, items[0]!.id, { kind: 'price', shopId: 's1', price: 3_400_000, at: '2026-10-21T08:00:00Z' });
    expect(usePlans.getState().plans[id]!.reports[items[0]!.id]?.price).toBe(3_400_000);
    s.setReport(id, items[0]!.id, null);
    expect(usePlans.getState().plans[id]!.reports[items[0]!.id]).toBeUndefined();
  });

  it('removes an item together with everything attached to it', () => {
    const { id, items } = makePlan();
    const s = usePlans.getState();
    s.answer(id, items[1]!.id, 'signal', 'ip');
    s.pinProduct(id, items[1]!.id, 'rec-nvr');
    s.removeItem(id, items[1]!.id);
    const p = usePlans.getState().plans[id]!;
    expect(p.requirements).toHaveLength(3);
    expect(p.answers[items[1]!.id]).toBeUndefined();
    expect(p.pins[items[1]!.id]).toBeUndefined();
  });

  it('orders recent plans newest first', async () => {
    const a = makePlan().id;
    await new Promise((r) => setTimeout(r, 5));
    const b = makePlan().id;
    expect(recentPlans(usePlans.getState().plans).map((p) => p.id)).toEqual([b, a]);
  });

  it('migrates unknown or corrupt data to an empty store', () => {
    expect(migrate(null, 0)).toEqual({ plans: {}, progress: {}, notice: null });
    expect(migrate({ plans: 5 }, 0)).toEqual({ plans: {}, progress: {}, notice: null });
  });

  it('v1 -> v2: drops mock-era plans with a notice, keeps plans made from real parser items', () => {
    const mine = makePlan(); // mock items: string category ids
    const real = {
      ...usePlans.getState().plans[mine.id]!,
      id: 'preal',
      requirements: [{ id: 'i1', text: 'دوربین', qty: 1, categoryIds: [1153], constraints: [] } as never],
    };
    const old = { plans: { [mine.id]: usePlans.getState().plans[mine.id]!, preal: real }, progress: { [mine.id]: { ready: 1, total: 4 } } };
    const out = migrate(old, 1);
    expect(Object.keys(out.plans)).toEqual(['preal']);
    expect(out.notice).toEqual({ droppedLegacy: 1 });
    expect(Object.keys(out.progress)).toEqual([]);
    // an already-current payload passes through untouched
    expect(migrate({ plans: old.plans, progress: {}, notice: null }, 2).plans).toBe(old.plans);
  });

  it('re-ids parser items added to an existing plan and rewrites their references', () => {
    const base = usePlans.getState().create('x', [{ id: 'i1', text: 'a', qty: 1, categoryIds: [1], constraints: [] } as never]);
    usePlans.getState().addItems(base, [
      { id: 'i1', text: 'گوشی', qty: 1, categoryIds: [2], constraints: [] } as never,
      { id: 'i2', text: 'قاب', qty: 1, categoryIds: [3], constraints: [], inherited: [{ attr: 'fits_models', fromItemId: 'i1' }] } as never,
    ]);
    const reqs = usePlans.getState().plans[base]!.requirements;
    expect(reqs.map((r) => r.id)).toEqual(['i1', 'i2', 'i3']);
    expect(reqs[2]!.inherited).toEqual([{ attr: 'fits_models', fromItemId: 'i2' }]);
  });
});

describe('share link', () => {
  it('round-trips requirements, answers and visit, and imports as a copy without checks or reports', () => {
    const { id, items } = makePlan();
    const s = usePlans.getState();
    s.answer(id, items[1]!.id, 'signal', 'analog');
    s.setVisit(id, { day: 'tomorrow', window: 'evening' });
    s.toggleCheck(id, items[0]!.id);
    s.setReport(id, items[0]!.id, { kind: 'unavailable', shopId: 's1', at: '2026-10-21T08:00:00Z' });
    const plan = usePlans.getState().plans[id]!;
    const data = encodeShare(plan);
    expect(data).not.toMatch(/[#/ ]/); // safe inside a hash route
    const decoded = decodeShare(data)!;
    const copyId = usePlans.getState().importCopy(decoded);
    const copy = usePlans.getState().plans[copyId]!;
    expect(copyId).not.toBe(id);
    expect(copy.requirements).toEqual(plan.requirements);
    expect(copy.answers).toEqual(plan.answers);
    expect(copy.visit).toEqual({ day: 'tomorrow', window: 'evening' });
    expect(copy.checks).toEqual({});
    expect(copy.reports).toEqual({});
    expect(shareUrl(plan, { origin: 'https://x.test', pathname: '/' })).toMatch(/^https:\/\/x\.test\/#\/s\//);
  });

  it('rejects garbage', () => {
    expect(decodeShare('not-a-valid-payload')).toBeNull();
    expect(decodeShare('')).toBeNull();
  });
});

describe('storage failure', () => {
  it('keeps working in memory when localStorage throws', async () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    try {
      const { id } = makePlan();
      usePlans.getState().rename(id, 'بدون ذخیره');
      expect(usePlans.getState().plans[id]!.name).toBe('بدون ذخیره');
      const { isStorageAvailable } = await import('./plans');
      expect(isStorageAvailable()).toBe(false);
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});

describe('applyState (assistant newState)', () => {
  it('replaces the whole requirement state and drops checks / reports of vanished items; restore undoes it', () => {
    const { id, items } = makePlan();
    const st = usePlans.getState();
    st.toggleCheck(id, items[0]!.id);
    st.setReport(id, items[0]!.id, { kind: 'unavailable', shopId: 's1', at: '2026-10-21T08:00:00Z' });
    const snapshot = structuredClone(usePlans.getState().plans[id]!);
    st.applyState(id, {
      requirements: items.slice(1),
      answers: {},
      settled: { [items[1]!.id]: true },
      pins: {},
      shopPins: {},
      excludedShops: { '*': ['s9'] },
      variant: 'fewest',
      visit: { day: 'tomorrow', window: 'any' },
    });
    const p = usePlans.getState().plans[id]!;
    expect(p.requirements).toHaveLength(items.length - 1);
    expect(p.excludedShops).toEqual({ '*': ['s9'] });
    expect(p.variant).toBe('fewest');
    expect(p.visit.day).toBe('tomorrow');
    expect(p.checks[items[0]!.id]).toBeUndefined();
    expect(p.reports[items[0]!.id]).toBeUndefined();
    usePlans.getState().restore(id, snapshot);
    expect(usePlans.getState().plans[id]!.requirements).toHaveLength(items.length);
    expect(usePlans.getState().plans[id]!.reports[items[0]!.id]).toBeDefined();
  });
});
