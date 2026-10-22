/**
 * applyAction on parser-item state: `constraints` (authoritative), `rawText`, no chips. This is the state the web
 * stores (parser items verbatim); the assistant must read and edit it as the plan does.
 */
import { Api } from '@app/core';
import { describe, expect, it } from 'vitest';
import { applyAction, type ApplyEnv } from '../src/assist/apply.js';
import { statedAttrs } from '../src/assist/state.js';
import type { AssistAction } from '../src/assist/types.js';
import type { ParsedItem } from '../src/parse/index.js';
import { makeFacts, parserCctvState } from './assist-fixtures.js';

const NOW = new Date('2026-10-21T14:05:00+03:30');

function run(s: Api.RequirementState, a: AssistAction, envOver: Partial<ApplyEnv> = {}) {
  const before = JSON.stringify(s);
  const r = applyAction(s, a, { facts: makeFacts(), now: NOW, ...envOver });
  expect(JSON.stringify(s)).toBe(before); // pure
  if (r.ok) expect(Api.RequirementStateSchema.safeParse(r.newState).success).toBe(true);
  return r;
}

function parsed(id: string, text: string, o: Partial<ParsedItem> = {}): ParsedItem {
  return { id, text, rawText: text, qty: 1, categoryIds: [], constraints: [], confidence: 0.8, categoryCandidates: [], notes: [], ...o } as ParsedItem;
}

const item0 = (r: ReturnType<typeof run>) => {
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.newState.requirements[0]!;
};

describe('applyAction on parser-item state (constraints, no chips)', () => {
  it('stated attributes are read from `constraints` (brand, spec, budget), not from chips', () => {
    const s = parserCctvState();
    expect(statedAttrs(s.requirements[0]!, s).map((x) => [x.attr, x.label])).toEqual([
      ['resolution_mp', '۲ مگاپیکسل'],
      ['brand', 'داهوا'],
    ]);
    expect(statedAttrs(s.requirements[1]!, s).map((x) => x.attr)).toEqual(['capacity_tb', 'budget']);
    // listing condition: the `condition` field, a condition constraint and a condition answer all count; 'new' never
    const used = Api.RequirementStateSchema.parse({ requirements: [{ id: 'p', text: 'موبایل', qty: 1, condition: 'used', constraints: [] }], answers: { p: { condition: 'c~eq~condition~"any"' } } });
    expect(statedAttrs(used.requirements[0]!, used).map((x) => x.attr)).toEqual(['condition']);
  });

  it('swap_brand replaces the brand constraint and rewrites text and rawText; the item stays a parser item', () => {
    const s = parserCctvState({ pins: { cam: '1' }, shopPins: { cam: 'shop_a1' } });
    const r = run(s, { type: 'swap_brand', itemId: 'cam', brand: 'hikvision' });
    const c = item0(r);
    expect(c.constraints).toEqual([
      { attr: 'resolution_mp', op: 'eq', value: 2, source: 'user' },
      { attr: 'brand', op: 'eq', value: 'hikvision', source: 'user' },
    ]);
    expect(c.text).toBe('دوربین هایک ویژن ۲ مگاپیکسل');
    expect(c.rawText).toBe('۴ دوربین هایک ویژن ۲ مگاپیکسل');
    expect(c).not.toHaveProperty('chips');
    expect(c.modelCode).toBeUndefined();
    expect(r.ok && [r.newState.pins.cam, r.newState.shopPins.cam]).toEqual([undefined, undefined]);
    expect(run(s, { type: 'swap_brand', itemId: 'cam', brand: 'dahua' })).toMatchObject({ ok: true, changed: false });
    expect(run(s, { type: 'swap_brand', itemId: 'cam', brand: 'sony' })).toMatchObject({ ok: false, reason: 'unknown_brand' });
  });

  it('relax_constraint removes the constraint and its words (brand, spec), the budget, and a listing condition', () => {
    const brand = run(parserCctvState(), { type: 'relax_constraint', itemId: 'cam', attr: 'brand' });
    expect(item0(brand).constraints).toEqual([{ attr: 'resolution_mp', op: 'eq', value: 2, source: 'user' }]);
    expect(item0(brand).text).toBe('دوربین ۲ مگاپیکسل');
    expect(item0(brand).rawText).toBe('۴ دوربین ۲ مگاپیکسل');
    const mp = run(parserCctvState(), { type: 'relax_constraint', itemId: 'cam', attr: 'resolution_mp' });
    expect(item0(mp).constraints).toEqual([{ attr: 'brand', op: 'eq', value: 'dahua', source: 'user' }]);
    expect(item0(mp).text).toBe('دوربین داهوا');
    const budget = run(parserCctvState(), { type: 'relax_constraint', itemId: 'hdd', attr: 'budget' });
    expect(budget.ok && budget.newState.requirements[1]!.budget).toBeUndefined();
    expect(run(parserCctvState(), { type: 'relax_constraint', itemId: 'hdd', attr: 'channels' })).toMatchObject({ ok: false, reason: 'not_stated' });

    const used = Api.RequirementStateSchema.parse({
      requirements: [{ id: 'p', text: 'موبایل استوک', qty: 1, condition: 'used', constraints: [{ attr: 'condition', op: 'eq', value: 'used', source: 'user' }] }],
      answers: { p: { condition: 'c~eq~condition~"any"' } },
    });
    const relaxed = run(used, { type: 'relax_constraint', itemId: 'p', attr: 'condition' });
    expect(item0(relaxed).constraints).toEqual([]);
    expect(item0(relaxed).condition).toBeUndefined();
    expect(relaxed.ok && relaxed.newState.answers.p?.condition).toBeUndefined();
  });

  it('a phone model a case inherited from the phone is re-derived by the server: not stated, not relaxable', () => {
    const s = Api.RequirementStateSchema.parse({
      requirements: [
        { id: 'ph', text: 'گوشی سامسونگ A54', qty: 1, kind: 'phone', constraints: [{ attr: 'phone_model', op: 'eq', value: 'a54', source: 'user' }] },
        { id: 'cs', text: 'قاب', qty: 1, kind: 'phone_case', constraints: [{ attr: 'fits_models', op: 'contains', value: 'a54', source: 'user' }], inherited: [{ attr: 'fits_models', fromItemId: 'ph' }] },
      ],
    });
    expect(statedAttrs(s.requirements[1]!, s)).toEqual([]);
    expect(run(s, { type: 'relax_constraint', itemId: 'cs', attr: 'fits_models' })).toMatchObject({ ok: false, reason: 'not_stated' });
  });

  it("set_budget writes `budget`; remove_item drops the item and other items' inherited records of it", () => {
    const r = run(parserCctvState(), { type: 'set_budget', itemId: 'cam', min: 1_000_000, max: 2_000_000 });
    expect(item0(r).budget).toEqual({ min: 1_000_000, max: 2_000_000 });
    const s = Api.RequirementStateSchema.parse({
      requirements: [
        { id: 'ph', text: 'گوشی', qty: 1, kind: 'phone', constraints: [] },
        { id: 'cs', text: 'قاب', qty: 1, kind: 'phone_case', constraints: [], inherited: [{ attr: 'fits_models', fromItemId: 'ph' }] },
      ],
    });
    const removed = run(s, { type: 'remove_item', itemId: 'ph' });
    expect(removed.ok && removed.newState.requirements.map((q) => [q.id, q.inherited])).toEqual([['cs', undefined]]);
  });

  it('newState is the client shape: parser items carry no chips / categoryId defaults, changed or not', () => {
    const changed = item0(run(parserCctvState(), { type: 'swap_brand', itemId: 'cam', brand: 'hikvision' }));
    const same = item0(run(parserCctvState(), { type: 'explain' }));
    for (const r of [changed, same]) for (const k of ['chips', 'categoryId', 'categoryLabel']) expect(r, k).not.toHaveProperty(k);
  });

  it("add_item uses the parser's items verbatim and renames the references between the new items", () => {
    const parseItems = () => [
      parsed('i1', 'گوشی', { kind: 'phone' }),
      parsed('i2', 'قاب', { kind: 'phone_case', inherited: [{ attr: 'fits_models', fromItemId: 'i1' }], notes: [{ code: 'inherited_model', messageFa: 'x', itemId: 'i2' }] }),
    ];
    const r = run(parserCctvState(), { type: 'add_item', text: 'گوشی و قاب' }, { parseItems });
    expect(r.ok && r.newState.requirements.slice(2).map((q) => [q.id, q.inherited?.[0]?.fromItemId, q.notes?.[0]?.itemId])).toEqual([
      ['a1', undefined, undefined],
      ['a2', 'a1', 'a2'],
    ]);
    expect(r.ok && r.newState.requirements[2]).toMatchObject({ rawText: 'گوشی', kind: 'phone' });
  });
});
