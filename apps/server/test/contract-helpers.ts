/**
 * Parse -> resolve -> (answer) -> plan chain helpers for the API contract suites. Everything goes through
 * HTTP (app.inject) exactly as the web app calls it: /api/parse items are put into `state.requirements`
 * VERBATIM (no field added, removed or renamed), every other state field is left out unless a step sets it.
 */
import type { Api } from '@app/core';
import { expect } from 'vitest';
import type { makeApp } from './helpers.js';

export type App = Awaited<ReturnType<typeof makeApp>>['app'];

export async function post<T>(app: App, url: string, payload: unknown): Promise<T> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object });
  if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 400)}`);
  return (res.json() as { data: T }).data;
}

export interface Chain {
  parsed: Api.ParseResponse;
  state: Api.RequirementStateInput;
}

/** /api/parse, then a state made of the parser items as they came (plus the parser's preference). */
export async function parseToState(app: App, text: string): Promise<Chain> {
  const parsed = await post<Api.ParseResponse>(app, '/api/parse', { text });
  // compile-time contract: a parser item IS a valid requirement input
  const requirements: Api.RequirementInput[] = parsed.items;
  const state: Api.RequirementStateInput = { requirements };
  if (parsed.preference) state.preference = parsed.preference;
  return { parsed, state };
}

export const resolve = (app: App, state: Api.RequirementStateInput) => post<Api.ResolveResponse>(app, '/api/resolve', { state });
export const plan = (app: App, state: Api.RequirementStateInput) => post<Api.PlanResponse>(app, '/api/plan', { state });
export const options = (app: App, state: Api.RequirementStateInput, itemId: string, productId?: string) =>
  post<Api.OptionsResponse>(app, '/api/options', productId ? { state, itemId, productId } : { state, itemId });

export const byId = (r: { items: Api.ItemResolution[] }, id: string) => {
  const it = r.items.find((i) => i.itemId === id);
  if (!it) throw new Error(`no item ${id}`);
  return it;
};

/** Answer an item's current question with the first option whose id matches `pick` (copied from the response). */
export function answer(state: Api.RequirementStateInput, q: Api.Question, pick: (o: Api.QuestionOption) => boolean): Api.RequirementStateInput {
  const opt = q.options.find(pick);
  if (!opt) throw new Error(`no option for ${q.id}: ${q.options.map((o) => o.id).join(' | ')}`);
  const answers = { ...(state.answers ?? {}) };
  answers[q.itemId] = { ...(answers[q.itemId] ?? {}), [q.id]: opt.id };
  return { ...state, answers };
}

export function settle(state: Api.RequirementStateInput, itemId: string): Api.RequirementStateInput {
  return { ...state, settled: { ...(state.settled ?? {}), [itemId]: true } };
}

/** Honesty and shape invariants every plan must keep. */
export function expectPlanInvariants(p: Api.PlanResponse, requestedExact: ReadonlySet<string> = new Set()): void {
  // the count shown to users is the number of stop cards; one stop = one building
  expect(p.stopCount).toBe(p.stops.length);
  expect(new Set(p.stops.map((s) => s.buildingKey)).size).toBe(p.stops.length);
  let shopTotal = 0;
  let sum = 0;
  for (const s of p.stops) {
    expect(s.shops?.length ?? 0).toBeGreaterThan(0);
    shopTotal += s.shops!.length;
    expect(s.shopCount).toBe(s.shops!.length);
    // top-level fields describe the first shop; lines are all lines of the building
    expect(s.shopId).toBe(s.shops![0]!.shopId);
    expect(s.lines.length).toBe(s.shops!.reduce((n, x) => n + x.lines.length, 0));
    for (const sh of s.shops!) for (const l of sh.lines) expect(l.shopId).toBe(sh.shopId);
    for (const l of s.lines) {
      // a suggestion is never labelled exact; exact only where the user typed a code / pinned a product
      if (!requestedExact.has(l.itemId)) expect(l.state).not.toBe('exact');
      if (l.lineTotal !== null) sum += l.lineTotal;
    }
  }
  expect(p.shopCount).toBe(shopTotal);
  // coverage-aware total: never a bare number when something is missing
  expect(p.totalToman).toBe(sum);
  if (p.stops.length > 0) {
    if (p.coverage.covered < p.coverage.total) {
      expect(p.totalLine).toMatch(/^فقط /);
      expect(p.complete).toBe(false);
      expect(p.missingLine).toBeTruthy();
    } else {
      expect(p.totalLine).toMatch(/^جمع /);
    }
  }
  for (const c of p.compat) expect(['stated', 'assumed', 'unknown', 'conflict']).toContain(c.level);
  for (const i of p.items ?? []) if (!requestedExact.has(i.itemId)) expect(i.state).not.toBe('exact');
  expectNoAutoPickConflict(p);
}

/**
 * The plan guard's invariant (G1a): the engine's own picks never stand next to a conflict. A 'conflict' line comes
 * only from the user's own choices (pinned / typed model code, or stated / answered on every side: G3a
 * `fromUserChoice`), and such a plan never reads as a normal complete plan: `hasConflict`, the marker on the total
 * line («— ناسازگاری دارد») and no superlative reason.
 */
export function expectNoAutoPickConflict(p: Api.PlanResponse): void {
  const conflicts = p.compat.filter((x) => x.level === 'conflict');
  for (const c of conflicts) expect(c.fromUserChoice, `conflict next to automatic picks only: ${c.text}`).toBe(true);
  expect(p.hasConflict).toBe(conflicts.length > 0);
  if (conflicts.length && p.totalLine) {
    expect(p.totalLine).toContain('ناسازگاری دارد');
    expect(p.reason).not.toMatch(/ارزان‌ترین ترکیب|کم‌توقف‌ترین/);
  }
}

/** G3a contract: every assigned item's card shows the product its stop line buys (product, price, state). */
export function expectCardsMatchLines(p: Api.PlanResponse): void {
  let sum = 0;
  for (const s of p.stops) {
    for (const l of s.lines) {
      if (l.lineTotal !== null) sum += l.lineTotal;
      const it = (p.items ?? []).find((i) => i.itemId === l.itemId);
      expect(it, `card of ${l.itemId}`).toBeTruthy();
      expect(it!.product?.id, `card product of ${l.itemId}`).toBe(l.productId);
      expect(it!.unitPrice, `card price of ${l.itemId}`).toBe(l.unitPrice);
      expect(it!.state).toBe(l.state);
    }
  }
  expect(p.totalToman).toBe(sum);
}

export function expectNoExactSuggestion(r: { items: Api.ItemResolution[] }, requestedExact: ReadonlySet<string> = new Set()): void {
  for (const i of r.items) {
    if (requestedExact.has(i.itemId)) continue;
    expect(i.state).not.toBe('exact');
    expect(i.label).not.toBe('مدل مشخص');
    if (i.state === 'suggested') expect(i.rule).toBeTruthy();
  }
}
