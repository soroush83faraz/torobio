import { Api } from '@app/core';
import { describe, expect, it } from 'vitest';
import { applyAction, type ApplyEnv } from '../src/assist/apply.js';
import { replaceBrandMention, removeLabelWords, statedAttrs, stripBrandMentions } from '../src/assist/state.js';
import type { AssistAction } from '../src/assist/types.js';
import { cctvState, makeFacts } from './assist-fixtures.js';
import type { ParsedItem } from '../src/parse/index.js';
import { chip, item, state } from './scenarios.js';

/** A /api/parse item (the fields the assistant reads; metadata the parser always sets). */
function parsed(id: string, text: string, o: Partial<ParsedItem> = {}): ParsedItem {
  return { id, text, rawText: text, qty: 1, categoryIds: [], constraints: [], confidence: 0.8, categoryCandidates: [], notes: [], ...o } as ParsedItem;
}

const NOW = new Date('2026-10-21T14:05:00+03:30'); // Wednesday, Tehran

function run(s: Api.RequirementState, a: AssistAction, envOver: Partial<ApplyEnv> = {}) {
  const before = JSON.stringify(s);
  const r = applyAction(s, a, { facts: makeFacts(), now: NOW, ...envOver });
  expect(JSON.stringify(s)).toBe(before); // pure: the input state is never mutated
  if (r.ok) expect(Api.RequirementStateSchema.safeParse(r.newState).success).toBe(true);
  return r;
}

describe('applyAction (pure reducer over the requirement state)', () => {
  it('set_preference: cheapest is a no-op on the default plan; fewest_stops sets the variant with real deltas', () => {
    const c = run(cctvState(), { type: 'set_preference', preference: 'cheapest' });
    expect(c).toMatchObject({ ok: true, changed: false });
    const f = run(cctvState(), { type: 'set_preference', preference: 'fewest_stops' });
    expect(f.ok && f.newState.variant).toBe('fewest');
    expect(f.ok && f.messageFa).toContain('یک توقف کمتر');
    expect(f.ok && f.messageFa).toContain('۸۰۰ هزار تومان گران‌تر');
    const back = run(cctvState({ variant: 'fewest' }), { type: 'set_preference', preference: 'cheapest' });
    expect(back.ok && back.newState.variant).toBeNull();
    expect(back.ok && back.changed).toBe(true);
  });

  it('exclude_shop: only a shop of the current plan; drops a seller pin on it', () => {
    const r = run(cctvState({ shopPins: { cam: 'shop_a1' } }), { type: 'exclude_shop', shopId: 'shop_a1' });
    expect(r.ok && r.newState.excludedShops['*']).toEqual(['shop_a1']);
    expect(r.ok && r.newState.shopPins.cam).toBeUndefined();
    expect(r.ok && r.messageFa).toContain('فروشگاه الف');
    expect(run(cctvState(), { type: 'exclude_shop', shopId: 'shop_zz' })).toMatchObject({ ok: false, reason: 'unknown_shop' });
    expect(run(cctvState(), { type: 'exclude_shop', shopId: 'shop_b1' })).toMatchObject({ ok: false, reason: 'unknown_shop' }); // real shop, not in the plan
    const again = run(cctvState({ excludedShops: { '*': ['shop_a1'] } }), { type: 'exclude_shop', shopId: 'shop_a1' });
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  it('exclude_mall: every shop of that building among the candidates; only malls of the plan; bounded', () => {
    const r = run(cctvState(), { type: 'exclude_mall', mallKey: 'm:الف' });
    expect(r.ok && r.newState.excludedShops['*']).toEqual(['shop_a1', 'shop_a2', 'shop_a3']);
    expect(r.ok && r.messageFa).toContain('پاساژ الف');
    expect(run(cctvState(), { type: 'exclude_mall', mallKey: 'm:ب' })).toMatchObject({ ok: false, reason: 'unknown_mall' });
    expect(run(cctvState(), { type: 'exclude_mall', mallKey: 'c:35.7,51.43' })).toMatchObject({ ok: false, reason: 'unknown_mall' });
    const big = makeFacts({ shopsInBuilding: () => Array.from({ length: 60 }, (_, i) => `s${i}`) });
    expect(applyAction(cctvState(), { type: 'exclude_mall', mallKey: 'm:الف' }, { facts: big, now: NOW })).toMatchObject({ ok: false, reason: 'mall_too_big' });
  });

  it('only_open: "open now" in Tehran when no time is chosen; a chosen time already filters; false clears it', () => {
    const r = run(cctvState(), { type: 'only_open', value: true });
    expect(r.ok && r.newState.visit).toEqual({ day: 'today', window: 'exact', time: '14:05' });
    expect(r.ok && r.messageFa).toContain('۱۴:۰۵');
    expect(r.ok && r.messageFa).toContain('ثبت نشده'); // unknown hours are never treated as closed
    const already = run(cctvState({ visit: { day: 'tomorrow', window: 'evening' } }), { type: 'only_open', value: true });
    expect(already).toMatchObject({ ok: true, changed: false });
    const off = run(cctvState({ visit: { day: 'tomorrow', window: 'evening' } }), { type: 'only_open', value: false });
    expect(off.ok && off.newState.visit).toEqual({ day: 'today', window: 'any' });
  });

  it("swap_brand: only a brand of the item's real facets; rewrites chip AND text; drops pins of the old brand", () => {
    const s = cctvState({ pins: { cam: '1' }, shopPins: { cam: 'shop_a1' }, answers: { cam: { brand: 'c~eq~brand~"dahua"' } } });
    const r = run(s, { type: 'swap_brand', itemId: 'cam', brand: 'hikvision' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cam = r.newState.requirements[0]!;
    expect(cam.chips.filter((c) => c.constraint?.attr === 'brand')).toEqual([{ key: 'brand', label: 'هایک ویژن', constraint: { attr: 'brand', op: 'eq', value: 'hikvision' } }]);
    expect(cam.text).toBe('۴ دوربین هایک ویژن ۲ مگاپیکسل');
    expect(cam.modelCode).toBeUndefined();
    expect(r.newState.pins.cam).toBeUndefined();
    expect(r.newState.shopPins.cam).toBeUndefined();
    expect(r.newState.answers.cam?.brand).toBeUndefined();
    expect(run(cctvState(), { type: 'swap_brand', itemId: 'cam', brand: 'sony' })).toMatchObject({ ok: false, reason: 'unknown_brand' });
    expect(run(cctvState(), { type: 'swap_brand', itemId: 'nope', brand: 'hikvision' })).toMatchObject({ ok: false, reason: 'unknown_item' });
    expect(run(cctvState(), { type: 'swap_brand', itemId: 'cam', brand: 'dahua' })).toMatchObject({ ok: true, changed: false });
  });

  it('relax_constraint: removes a stated spec and its words from the text; brand words too; budgets', () => {
    const mp = run(cctvState(), { type: 'relax_constraint', itemId: 'cam', attr: 'resolution_mp' });
    expect(mp.ok && mp.newState.requirements[0]!.chips.map((c) => c.key)).toEqual(['brand']);
    expect(mp.ok && mp.newState.requirements[0]!.text).toBe('۴ دوربین داهوا');
    const brand = run(cctvState(), { type: 'relax_constraint', itemId: 'cam', attr: 'brand' });
    expect(brand.ok && brand.newState.requirements[0]!.text).toBe('۴ دوربین ۲ مگاپیکسل');
    const budget = run(cctvState(), { type: 'relax_constraint', itemId: 'hdd', attr: 'budget' });
    expect(budget.ok && budget.newState.requirements[1]!.budget).toBeUndefined();
    expect(run(cctvState(), { type: 'relax_constraint', itemId: 'hdd', attr: 'channels' })).toMatchObject({ ok: false, reason: 'not_stated' });
  });

  it('relax_constraint: the derived 12 V of an adapter next to cameras becomes the «any» answer (idempotent); other items still not_stated', () => {
    const adapterState = (extra: Partial<Api.RequirementState> = {}) =>
      state([item('cam', 'دوربین', { kind: 'camera' }), item('ad', 'آداپتور', { kind: 'adapter' })], extra);
    const r = run(adapterState(), { type: 'relax_constraint', itemId: 'ad', attr: 'voltage_v' });
    expect(r.ok && r.newState.answers.ad?.voltage_v).toBe('any');
    expect(r.ok && r.changed).toBe(true);
    const again = run(adapterState({ answers: { ad: { voltage_v: 'any' } } }), { type: 'relax_constraint', itemId: 'ad', attr: 'voltage_v' });
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(run(adapterState(), { type: 'relax_constraint', itemId: 'cam', attr: 'voltage_v' })).toMatchObject({ ok: false, reason: 'not_stated' });
    const noCam = state([item('ad', 'آداپتور', { kind: 'adapter' })]);
    expect(run(noCam, { type: 'relax_constraint', itemId: 'ad', attr: 'voltage_v' })).toMatchObject({ ok: false, reason: 'not_stated' });
  });

  it('set_budget: validated bounds; an answered budget band no longer overrides it', () => {
    const r = run(cctvState({ answers: { hdd: { budget: 'b~~3000000' } } }), { type: 'set_budget', itemId: 'hdd', max: 5_000_000 });
    expect(r.ok && r.newState.requirements[1]!.budget).toEqual({ max: 5_000_000 });
    expect(r.ok && r.newState.answers.hdd?.budget).toBeUndefined();
    expect(r.ok && r.messageFa).toContain('تا ۵ میلیون تومان');
    for (const bad of [{ min: 9, max: 5 }, {}, { max: -1 }, { max: 1.5 }, { max: 1e13 }]) {
      expect(run(cctvState(), { type: 'set_budget', itemId: 'hdd', ...bad })).toMatchObject({ ok: false, reason: 'invalid_budget' });
    }
  });

  it('add_item: through the deterministic parser, fresh ids, at most 12 items', () => {
    const parseItems = (t: string) => [parsed('x', t, { categoryIds: [13], constraints: [{ attr: 'voltage_v', op: 'eq', value: 12, source: 'user' }] })];
    const r = run(cctvState(), { type: 'add_item', text: 'آداپتور ۱۲ ولت' }, { parseItems });
    expect(r.ok && r.newState.requirements.map((q) => q.id)).toEqual(['cam', 'hdd', 'a1']);
    expect(r.ok && r.messageFa).toContain('آداپتور ۱۲ ولت');
    expect(r.ok && r.newState.requirements[2]).toMatchObject({ rawText: 'آداپتور ۱۲ ولت', constraints: [{ attr: 'voltage_v', value: 12, source: 'user' }] }); // verbatim parser item
    const full = state(Array.from({ length: 12 }, (_, i) => item(`i${i}`, 'هارد')));
    expect(applyAction(full, { type: 'add_item', text: 'هارد' }, { facts: makeFacts(), now: NOW, parseItems })).toMatchObject({ ok: false, reason: 'too_many_items' });
    expect(run(cctvState(), { type: 'add_item', text: 'x' }, { parseItems: () => [] })).toMatchObject({ ok: false, reason: 'nothing_parsed' });
    expect(run(cctvState(), { type: 'add_item', text: 'x' })).toMatchObject({ ok: false, reason: 'parse_unavailable' });
  });

  it('remove_item: the item and every per-item record', () => {
    const s = cctvState({ answers: { hdd: { budget: 'any' } }, pins: { hdd: '20' }, settled: { hdd: true }, excludedShops: { hdd: ['shop_c1'] } });
    const r = run(s, { type: 'remove_item', itemId: 'hdd' });
    expect(r.ok && r.newState.requirements.map((q) => q.id)).toEqual(['cam']);
    expect(r.ok && [r.newState.answers.hdd, r.newState.pins.hdd, r.newState.settled.hdd, r.newState.excludedShops.hdd]).toEqual([undefined, undefined, undefined, undefined]);
    expect(run(cctvState(), { type: 'remove_item', itemId: 'zz' })).toMatchObject({ ok: false, reason: 'unknown_item' });
  });

  it('explain changes nothing and uses the engine sentences', () => {
    const r = run(cctvState(), { type: 'explain' });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(r.ok && r.messageFa).toContain('ارزان‌ترین ترکیب با همین پوشش');
  });
});

describe('state helpers', () => {
  it('brand rewriting is word-aligned', () => {
    expect(stripBrandMentions('دوربین هایک‌ویژن ۲ مگاپیکسل')).toBe('دوربین ۲ مگاپیکسل');
    expect(replaceBrandMention('دوربین داهوا', 'هایک ویژن')).toBe('دوربین هایک ویژن');
    expect(replaceBrandMention('دوربین', 'داهوا')).toBe('دوربین داهوا');
    expect(stripBrandMentions('دوربین داهوا', 'hikvision')).toBe('دوربین داهوا');
    expect(removeLabelWords('۴ دوربین ۲ مگاپیکسل', '۲ مگاپیکسل')).toBe('۴ دوربین');
    expect(removeLabelWords('۲ دوربین', '۴ کانال')).toBe('۲ دوربین');
  });

  it('stated attributes come from chips, answers and the budget', () => {
    const s = cctvState({ answers: { cam: { camera_signal: 'c~in~camera_signal~["ahd","hdcvi","tvi","analog"]', budget: 'b~~3000000' } } });
    expect(statedAttrs(s.requirements[0]!, s).map((x) => x.attr)).toEqual(['brand', 'resolution_mp', 'camera_signal', 'budget']);
  });
});
