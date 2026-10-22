/**
 * Versioned local persistence (localStorage key `plans:v1`).
 * Stores requirements, answers, pins, preference, day/time, mode, checks and user reports.
 * Computed plans are NEVER stored: they are recomputed on open so they match the data version.
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { PlanVariant, Requirement, RequirementState, VisitTime } from '../api/types';
import { CONDITION_ANY, detachInherited, reidItems, relaxRequirement } from '../lib/items';
import { sanitizeDeep, sanitizeText } from '../lib/sanitize';

export type View = 'list' | 'plan' | 'market';
export type ReportKind = 'available' | 'unavailable' | 'price' | 'paid';

/** A user report. Device-local, never mixed into dataset facts or dataset totals. */
export interface Report {
  kind: ReportKind;
  /** The shop the report is about; a report never follows an item to a different shop. */
  shopId: string;
  price?: number;
  /** ISO timestamp. */
  at: string;
}

export interface SavedPlan extends RequirementState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** null until the first resolve decides where the user lands. */
  view: View | null;
  /** checks[itemId] = bought. */
  checks: Record<string, boolean>;
  /** reports[itemId] = latest user report for the item. */
  reports: Record<string, Report>;
}

/** The key stays `plans:v1`; the payload inside is versioned (zustand `version`) and migrated. */
export const STORAGE_KEY = 'plans:v1';
/** 1 = mock-era plans. 2 = plans whose items are /api/parse items verbatim (numeric category ids). */
export const STORAGE_VERSION = 2;
const MAX_PLANS = 30;

export const defaultVisit: VisitTime = { day: 'today', window: 'any' };

/* ---------------- storage with graceful failure ---------------- */

const memory = new Map<string, string>();
let available = true;

function probe(): boolean {
  try {
    const k = '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      available = false;
      return memory.get(name) ?? null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      available = false;
      memory.set(name, value);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      available = false;
      memory.delete(name);
    }
  },
};

/** False when the browser blocks storage (private mode, blocked site data). */
export function isStorageAvailable(): boolean {
  if (available) available = probe();
  return available;
}

/* ---------------- helpers ---------------- */

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nowIso = () => new Date().toISOString();

export function emptyState(requirements: Requirement[]): RequirementState {
  return {
    requirements,
    answers: {},
    settled: {},
    pins: {},
    shopPins: {},
    excludedShops: {},
    variant: null,
    visit: { ...defaultVisit },
  };
}

export function blankPlan(name: string, requirements: Requirement[]): SavedPlan {
  const ts = nowIso();
  return {
    id: uid('p'),
    name: sanitizeText(name),
    createdAt: ts,
    updatedAt: ts,
    view: null,
    checks: {},
    reports: {},
    ...emptyState(sanitizeDeep(requirements)),
  };
}

/** Plan text read back from storage (or an old state / imported link) is cleaned the same way as new text. */
export function sanitizePlan(p: SavedPlan): SavedPlan {
  if (!p || typeof p !== 'object') return p;
  return {
    ...p,
    name: sanitizeText(String(p.name ?? '')),
    requirements: Array.isArray(p.requirements) ? sanitizeDeep(p.requirements) : p.requirements,
  };
}

/** The part of a plan the API needs (and the share link carries). */
export function requirementStateOf(p: SavedPlan): RequirementState {
  return {
    requirements: p.requirements,
    answers: p.answers,
    settled: p.settled,
    pins: p.pins,
    shopPins: p.shopPins,
    excludedShops: p.excludedShops,
    variant: p.variant,
    visit: p.visit,
  };
}

/** How many items already have a usable answer is computed by the UI from resolutions;
 *  for the resume card we store a small cache of the last known progress. */
export interface ProgressCache {
  ready: number;
  total: number;
}

/* ---------------- store ---------------- */

/** A calm one-time notice shown on Home after a migration (dismissible, persisted until dismissed). */
export interface StoreNotice {
  /** Plans made with the earlier sample data that could not be opened against the real data. */
  droppedLegacy: number;
}

interface PlansState {
  plans: Record<string, SavedPlan>;
  notice: StoreNotice | null;
  dismissNotice(): void;
  /** Last known progress per plan, for the resume card (cheap, regenerated on open). */
  progress: Record<string, ProgressCache>;
  /** Transient: last autosave moment, drives the indicator pulse. */
  lastSavedAt: number | null;

  create(name: string, requirements: Requirement[]): string;
  importCopy(plan: Partial<SavedPlan> & { requirements: Requirement[] }): string;
  patch(id: string, fn: (p: SavedPlan) => void): void;
  restore(id: string, snapshot: SavedPlan): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  setView(id: string, view: View): void;
  setProgress(id: string, ready: number, total: number): void;

  answer(id: string, itemId: string, questionId: string, optionId: string): void;
  settleItems(id: string, itemIds: string[]): void;
  pinProduct(id: string, itemId: string, productId: string): void;
  pinShop(id: string, itemId: string, shopId: string): void;
  excludeShop(id: string, itemId: string, shopId: string): void;
  setVisit(id: string, visit: VisitTime): void;
  /** Replaces the whole requirement state (the assistant's `newState`); checks / reports of vanished items go. */
  applyState(id: string, next: RequirementState): void;
  setVariant(id: string, variant: PlanVariant): void;
  addItems(id: string, items: Requirement[]): void;
  removeItem(id: string, itemId: string): void;
  detachChip(id: string, itemId: string, chipKey: string): void;
  /**
   * «Relax» one stated constraint of an item that matched nothing: 'budget' drops the price band, 'condition' accepts
   * used / refurbished / copy listings too (the condition answer), any other attribute drops that constraint.
   */
  relax(id: string, itemId: string, attr: string): void;

  toggleCheck(id: string, itemId: string): void;
  setReport(id: string, itemId: string, report: Report | null): void;
}

export const usePlans = create<PlansState>()(
  persist(
    (set, get) => {
      const touch = (id: string, fn: (p: SavedPlan) => void) =>
        set((s) => {
          const cur = s.plans[id];
          if (!cur) return s;
          const next: SavedPlan = structuredClone(cur);
          fn(next);
          next.updatedAt = nowIso();
          return { plans: { ...s.plans, [id]: next }, lastSavedAt: Date.now() };
        });

      return {
        plans: {},
        notice: null,
        progress: {},
        lastSavedAt: null,
        dismissNotice: () => set({ notice: null }),

        create(name, requirements) {
          const plan = blankPlan(name, requirements);
          set((s) => ({ plans: trim({ ...s.plans, [plan.id]: plan }), lastSavedAt: Date.now() }));
          return plan.id;
        },
        importCopy(src) {
          const base = blankPlan(src.name ?? 'برنامهٔ دریافتی', src.requirements);
          const plan: SavedPlan = {
            ...base,
            answers: src.answers ?? {},
            settled: src.settled ?? {},
            pins: src.pins ?? {},
            shopPins: src.shopPins ?? {},
            excludedShops: src.excludedShops ?? {},
            variant: src.variant ?? null,
            visit: src.visit ?? { ...defaultVisit },
          };
          set((s) => ({ plans: trim({ ...s.plans, [plan.id]: plan }), lastSavedAt: Date.now() }));
          return plan.id;
        },
        patch: touch,
        restore(id, snapshot) {
          set((s) => ({ plans: { ...s.plans, [id]: snapshot }, lastSavedAt: Date.now() }));
        },
        remove(id) {
          set((s) => {
            const { [id]: _gone, ...rest } = s.plans;
            const { [id]: _p, ...prog } = s.progress;
            return { plans: rest, progress: prog, lastSavedAt: Date.now() };
          });
        },
        rename: (id, name) => touch(id, (p) => void (p.name = sanitizeText(name).trim() || p.name)),
        setView: (id, view) => touch(id, (p) => void (p.view = view)),
        setProgress(id, ready, total) {
          const cur = get().progress[id];
          if (cur && cur.ready === ready && cur.total === total) return;
          set((s) => ({ progress: { ...s.progress, [id]: { ready, total } } }));
        },

        answer: (id, itemId, qid, opt) =>
          touch(id, (p) => {
            p.answers[itemId] = { ...(p.answers[itemId] ?? {}), [qid]: opt };
          }),
        settleItems: (id, itemIds) =>
          touch(id, (p) => {
            for (const i of itemIds) p.settled[i] = true;
          }),
        pinProduct: (id, itemId, productId) =>
          touch(id, (p) => {
            p.pins[itemId] = productId;
          }),
        pinShop: (id, itemId, shopId) =>
          touch(id, (p) => {
            p.shopPins[itemId] = shopId;
          }),
        excludeShop: (id, itemId, shopId) =>
          touch(id, (p) => {
            const list = new Set(p.excludedShops[itemId] ?? []);
            list.add(shopId);
            p.excludedShops[itemId] = [...list];
            if (p.shopPins[itemId] === shopId) delete p.shopPins[itemId];
          }),
        setVisit: (id, visit) => touch(id, (p) => void (p.visit = visit)),
        applyState: (id, next) =>
          touch(id, (p) => {
            const n = structuredClone(next);
            p.requirements = sanitizeDeep(n.requirements);
            p.answers = n.answers ?? {};
            p.settled = n.settled ?? {};
            p.pins = n.pins ?? {};
            p.shopPins = n.shopPins ?? {};
            p.excludedShops = n.excludedShops ?? {};
            p.variant = n.variant ?? null;
            p.visit = n.visit ?? { ...defaultVisit };
            const ids = new Set(p.requirements.map((r) => r.id));
            for (const k of Object.keys(p.checks)) if (!ids.has(k)) delete p.checks[k];
            for (const k of Object.keys(p.reports)) if (!ids.has(k)) delete p.reports[k];
          }),
        setVariant: (id, variant) => touch(id, (p) => void (p.variant = variant)),
        addItems: (id, items) =>
          touch(id, (p) => {
            // parser ids ("i1"...) restart at every call: re-id so they never collide with existing items
            p.requirements.push(...reidItems(sanitizeDeep(items), new Set(p.requirements.map((r) => r.id))));
          }),
        removeItem: (id, itemId) =>
          touch(id, (p) => {
            p.requirements = p.requirements.filter((r) => r.id !== itemId);
            delete p.answers[itemId];
            delete p.settled[itemId];
            delete p.pins[itemId];
            delete p.shopPins[itemId];
            delete p.excludedShops[itemId];
            delete p.checks[itemId];
            delete p.reports[itemId];
          }),
        detachChip: (id, itemId, key) =>
          touch(id, (p) => {
            p.requirements = p.requirements.map((r) => (r.id === itemId ? detachInherited(r, key) : r));
          }),

        relax: (id, itemId, attr) =>
          touch(id, (p) => {
            if (attr === 'condition') {
              p.answers[itemId] = { ...(p.answers[itemId] ?? {}), condition: CONDITION_ANY };
              return;
            }
            p.requirements = p.requirements.map((r) => (r.id === itemId ? relaxRequirement(r, attr) : r));
            if (p.answers[itemId]) {
              const { [attr]: _gone, ...rest } = p.answers[itemId]!;
              p.answers[itemId] = rest;
            }
          }),

        toggleCheck: (id, itemId) =>
          touch(id, (p) => {
            p.checks[itemId] = !p.checks[itemId];
          }),
        setReport: (id, itemId, report) =>
          touch(id, (p) => {
            if (report) p.reports[itemId] = report;
            else delete p.reports[itemId];
          }),
      };
    },
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      // computed plans and transient fields are not persisted
      partialize: (s) => ({ plans: s.plans, progress: s.progress, notice: s.notice }),
      migrate: (persisted, version) => migrate(persisted, version),
      merge: (persisted, current) => {
        const p = persisted as Partial<Persisted> | undefined;
        if (!p || typeof p !== 'object') return current;
        const plans = Object.fromEntries(Object.entries(p.plans ?? {}).map(([k, v]) => [k, sanitizePlan(v)]));
        return { ...current, ...p, plans };
      },
    },
  ),
);

/** Keep the newest MAX_PLANS plans. */
function trim(plans: Record<string, SavedPlan>): Record<string, SavedPlan> {
  const all = Object.values(plans).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return Object.fromEntries(all.slice(0, MAX_PLANS).map((p) => [p.id, p]));
}

/** A mock-era item: no numeric category (the real parser always sets `categoryIds`, possibly empty). */
export function isLegacyRequirement(r: Requirement): boolean {
  if (Array.isArray(r.categoryIds)) return false;
  return !(typeof r.categoryId === 'string' && /^\d+$/.test(r.categoryId));
}

type Persisted = { plans: Record<string, SavedPlan>; progress: Record<string, ProgressCache>; notice: StoreNotice | null };

/**
 * Migration hook.
 * v1 -> v2: plans created against the mock catalogue (string category ids, mock product/shop ids) cannot be
 * resolved by the real server. They are dropped, and the store records how many so Home can say so calmly.
 * Anything unreadable resets to an empty store.
 */
export function migrate(persisted: unknown, version: number): Persisted {
  const raw = persisted as { plans?: Record<string, SavedPlan>; progress?: Record<string, ProgressCache>; notice?: StoreNotice | null } | null;
  if (!raw || typeof raw !== 'object' || typeof raw.plans !== 'object' || raw.plans === null) {
    return { plans: {}, progress: {}, notice: null };
  }
  if (version >= 2) return { plans: raw.plans, progress: raw.progress ?? {}, notice: raw.notice ?? null };
  const plans: Record<string, SavedPlan> = {};
  const progress: Record<string, ProgressCache> = {};
  let dropped = 0;
  for (const [id, plan] of Object.entries(raw.plans)) {
    const ok = !!plan && Array.isArray(plan.requirements) && plan.requirements.length > 0 && !plan.requirements.some(isLegacyRequirement);
    if (ok) {
      plans[id] = plan;
      if (raw.progress?.[id]) progress[id] = raw.progress[id]!;
    } else dropped += 1;
  }
  return { plans, progress, notice: dropped > 0 ? { droppedLegacy: dropped } : null };
}

/** Recent plans, newest first. */
export function recentPlans(plans: Record<string, SavedPlan>, limit = 5): SavedPlan[] {
  return Object.values(plans)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
