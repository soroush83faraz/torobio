/**
 * applyAction: (state, action, facts) -> new requirement state + templated Persian message. Pure: the input state
 * is never mutated, there is no I/O besides the injected deterministic parser for add_item.
 *
 * Every id and value is validated here against the facts of THIS call (defence in depth: the keyword matcher and
 * the LLM decoder validate too). The plan is never edited: the client recomputes it with /api/plan.
 */
import { Api, ATTR_SCHEMA, constraintText } from '@app/core';
import type { ParsedItem } from '../parse/index.js';
import type { AssistFacts } from './facts.js';
import { msg } from './messages.js';
import {
  addStated,
  brandLabel,
  cloneState,
  currentBrand,
  dropItem,
  findItem,
  freshItemIds,
  isParserItem,
  removeLabelWords,
  removeStatedAttr,
  replaceBrandMention,
  sameState,
  statedAttrs,
  stripBrandMentions,
  toClientState,
} from './state.js';
import { MAX_BUDGET_TOMAN, SPEC_ATTR_KINDS, SPEC_ATTRS, type AssistAction, type AssistChoice } from './types.js';

type State = Api.RequirementState;

export interface ApplyEnv {
  facts: AssistFacts;
  now: Date;
  /**
   * Deterministic parser for add_item: text -> the parser's items, used verbatim as new requirements (only the ids
   * are reassigned). Omitted = adding items is unavailable (e.g. no database).
   */
  parseItems?: (text: string) => readonly ParsedItem[];
}

export type Rejection =
  | 'unknown_item'
  | 'unknown_shop'
  | 'unknown_mall'
  | 'unknown_brand'
  | 'not_stated'
  | 'invalid_budget'
  | 'invalid_spec'
  | 'spec_not_for_item'
  | 'too_many_items'
  | 'too_many_exclusions'
  | 'mall_too_big'
  | 'nothing_parsed'
  | 'parse_unavailable'
  | 'no_stops'
  | 'invalid_state';

export type ApplyResult =
  | { ok: true; action: AssistAction; newState: State; changed: boolean; messageFa: string }
  | { ok: false; reason: Rejection; messageFa: string; choices?: AssistChoice[] };

const MAX_EXCLUDED = Api.API_LIMITS.maxExcludedPerItem;
const MAX_ITEMS = Api.API_LIMITS.maxItems;

function reject(reason: Rejection, messageFa: string): ApplyResult {
  return { ok: false, reason, messageFa };
}

function done(action: AssistAction, before: State, after: State, messageFa: string): ApplyResult {
  // the result must stay a valid request state (the client sends it straight to /api/plan)
  const parsed = Api.RequirementStateSchema.safeParse(after);
  if (!parsed.success) return reject('invalid_state', msg.unsupported);
  return { ok: true, action, newState: toClientState(parsed.data), changed: !sameState(before, after), messageFa };
}

/** 'HH:MM' of `now` in Tehran (the plan's clock). */
function tehranHHMM(now: Date): string {
  const m = Api.tehranMinute(now);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function validBound(v: number | undefined): boolean {
  return v === undefined || (Number.isInteger(v) && v >= 0 && v <= MAX_BUDGET_TOMAN);
}

function excludeAll(s: State, shopIds: readonly string[]): boolean {
  const list = [...(s.excludedShops['*'] ?? [])];
  for (const id of shopIds) if (!list.includes(id)) list.push(id);
  if (list.length > MAX_EXCLUDED) return false;
  s.excludedShops['*'] = list;
  // a seller pin on an excluded shop would silently fight the exclusion
  for (const [itemId, pinned] of Object.entries(s.shopPins)) if (shopIds.includes(pinned)) delete s.shopPins[itemId];
  return true;
}

const MAX_SPEC_VALUE = 1e6;

export function applyAction(state: State, action: AssistAction, env: ApplyEnv): ApplyResult {
  const f = env.facts;
  const s = cloneState(state);
  switch (action.type) {
    case 'none':
    case 'explain':
      return done(action, state, s, action.type === 'explain' ? msg.explain(f) : msg.unsupported);

    case 'set_preference': {
      if (action.preference === 'cheapest') {
        s.variant = null;
        if (state.variant === null || state.variant === undefined) return done(action, state, s, msg.cheapestAlready);
        // the cheapest alternative relative to the current (non-default) plan
        const alt = [...f.alternatives].sort((a, b) => a.deltaToman - b.deltaToman)[0];
        return done(action, state, s, msg.cheapest(alt && alt.deltaToman < 0 ? -alt.deltaToman : undefined, alt?.deltaStops));
      }
      s.variant = 'fewest';
      const fewer = [...f.alternatives].filter((a) => a.deltaStops < 0).sort((a, b) => a.deltaStops - b.deltaStops || a.deltaToman - b.deltaToman)[0];
      if (!fewer) return done(action, state, s, msg.fewestAlready(f.stopCount));
      return done(action, state, s, msg.fewest(false, -fewer.deltaStops, fewer.deltaToman));
    }

    case 'exclude_shop': {
      const stop = f.stops.find((x) => x.shopId === action.shopId);
      if (!stop) return reject('unknown_shop', msg.unknownShop);
      if ((state.excludedShops['*'] ?? []).includes(stop.shopId)) return done(action, state, s, msg.excludeShopAlready(stop.shopName));
      if (!excludeAll(s, [stop.shopId])) return reject('too_many_exclusions', msg.tooManyExclusions);
      return done(action, state, s, msg.excludeShop(stop.shopName));
    }

    case 'exclude_mall': {
      const stops = f.stops.filter((x) => x.mallKey !== null && x.mallKey === action.mallKey);
      const first = stops[0];
      if (!first) return reject('unknown_mall', msg.unknownMall);
      const shopIds = [...new Set([...stops.map((x) => x.shopId), ...f.shopsInBuilding(action.mallKey)])];
      const mall = first.mallName ?? first.shopName;
      const total = new Set([...(state.excludedShops['*'] ?? []), ...shopIds]).size;
      if (shopIds.length > MAX_EXCLUDED) return reject('mall_too_big', msg.mallTooBig(mall));
      if (total > MAX_EXCLUDED) return reject('too_many_exclusions', msg.tooManyExclusions);
      excludeAll(s, shopIds);
      return done(action, state, s, msg.excludeMall(mall));
    }

    case 'only_open': {
      const active = Api.isVisitActive(state.visit);
      if (action.value) {
        if (active) return done(action, state, s, msg.onlyOpenAlready);
        const hhmm = tehranHHMM(env.now);
        s.visit = { day: 'today', window: 'exact', time: hhmm };
        return done(action, state, s, msg.onlyOpenNow(hhmm));
      }
      if (!active) return done(action, state, s, msg.onlyOpenOffAlready);
      s.visit = { day: 'today', window: 'any' };
      return done(action, state, s, msg.onlyOpenOff);
    }

    case 'swap_brand': {
      const req = findItem(s, action.itemId);
      if (!req) return reject('unknown_item', msg.unknownItem);
      const facet = f.brandsFor(req.id).find((b) => b.key === action.brand);
      if (!facet) return reject('unknown_brand', msg.unknownBrand(req.text));
      const oldKey = currentBrand(req, state);
      if (oldKey === facet.key) return done(action, state, s, msg.swapBrandAlready(req.text, facet.label));
      const label = facet.label || brandLabel(facet.key);
      removeStatedAttr(req, 'brand');
      addStated(req, { attr: 'brand', op: 'eq', value: facet.key, source: 'user' }, label);
      req.text = replaceBrandMention(req.text, label, oldKey).slice(0, Api.API_LIMITS.maxTextLen);
      if (req.rawText !== undefined) req.rawText = replaceBrandMention(req.rawText, label, oldKey).slice(0, Api.API_LIMITS.maxTextLen);
      const answers = s.answers[req.id];
      if (answers) delete answers.brand;
      // a picked product / typed model code / seller of the old brand no longer applies
      delete s.pins[req.id];
      delete s.shopPins[req.id];
      delete req.modelCode;
      return done(action, state, s, msg.swapBrand(req.text, label));
    }

    case 'relax_constraint': {
      const req = findItem(s, action.itemId);
      if (!req) return reject('unknown_item', msg.unknownItem);
      const stated = statedAttrs(req, state).find((x) => x.attr === action.attr);
      if (!stated && action.attr === 'voltage_v' && req.kind === 'adapter' && s.requirements.some((r) => r.kind === 'camera')) {
        // the adapter's 12 V is a derived (assumed) constraint of the camera rule, not a stated one: lifting it is the
        // «فرقی نمی‌کند» answer to the voltage question (the voltage must still be known)
        (s.answers[req.id] ??= {}).voltage_v = Api.SKIP_OPTION_ID;
        return done(action, state, s, msg.relax(req.text, 'ولتاژ ۱۲ (فرض عمومی)'));
      }
      if (!stated) return reject('not_stated', msg.notStated(req.text));
      const answers = s.answers[req.id];
      if (action.attr === 'budget') {
        delete req.budget;
        if (answers) delete answers.budget;
        return done(action, state, s, msg.relaxBudget(req.text));
      }
      removeStatedAttr(req, action.attr);
      if (action.attr === Api.CONDITION_ATTR) delete req.condition;
      if (answers) delete answers[action.attr];
      // the constraint's words must not keep showing on the item (nor, for chip-form items, narrowing the search)
      if (action.attr === 'brand') {
        const key = currentBrand(findItem(state, req.id) ?? req, state);
        req.text = (key ? stripBrandMentions(req.text, key) : req.text) || req.text;
        if (req.rawText !== undefined) req.rawText = (key ? stripBrandMentions(req.rawText, key) : req.rawText) || req.rawText;
        delete s.pins[req.id];
      } else if (action.attr !== Api.CONDITION_ATTR) {
        const labels = isParserItem(req) ? [stated.label] : (findItem(state, req.id)?.chips ?? []).filter((c) => !c.inherited && c.constraint?.attr === action.attr).map((c) => c.label);
        for (const label of labels) {
          req.text = removeLabelWords(req.text, label);
          if (req.rawText !== undefined) req.rawText = removeLabelWords(req.rawText, label);
        }
      }
      return done(action, state, s, msg.relax(req.text, stated.label));
    }

    case 'set_budget': {
      const req = findItem(s, action.itemId);
      if (!req) return reject('unknown_item', msg.unknownItem);
      const { min, max } = action;
      if ((min === undefined && max === undefined) || !validBound(min) || !validBound(max) || (min !== undefined && max !== undefined && min > max)) {
        return reject('invalid_budget', msg.invalidBudget);
      }
      req.budget = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
      const answers = s.answers[req.id];
      if (answers) delete answers.budget; // an answered budget band would override the new one
      return done(action, state, s, msg.setBudget(req.text, min, max));
    }

    case 'set_spec': {
      const req = findItem(s, action.itemId);
      if (!req) return reject('unknown_item', msg.unknownItem);
      if (!(SPEC_ATTRS as readonly string[]).includes(action.attr) || !Number.isFinite(action.value) || action.value <= 0 || action.value > MAX_SPEC_VALUE) {
        return reject('invalid_spec', msg.invalidSpec);
      }
      const stated = statedAttrs(req, state).find((x) => x.attr === action.attr);
      const kind = req.kind ?? f.items.find((i) => i.id === req.id)?.kind;
      if (!stated && !(kind && SPEC_ATTR_KINDS[action.attr].includes(kind))) return reject('spec_not_for_item', msg.specNotForItem(req.text));
      const dto: Api.ConstraintDto = { attr: action.attr, op: 'eq', value: action.value, source: 'user' };
      const engine = Api.toEngineConstraint(dto, 'user');
      if (!engine) return reject('invalid_spec', msg.invalidSpec);
      const label = constraintText(engine);
      if (stated?.value === action.value) return done(action, state, s, msg.specAlready(req.text, label));
      removeStatedAttr(req, action.attr);
      const answers = s.answers[req.id];
      if (answers) delete answers[action.attr];
      addStated(req, dto, label);
      if (stated) {
        // the old number's words give way to the new ones (word-aligned; a text that never spelled it stays as typed)
        const swap = (t: string): string => {
          const base = removeLabelWords(t, stated.label);
          return base === t ? t : `${base} ${label}`;
        };
        req.text = swap(req.text).slice(0, Api.API_LIMITS.maxTextLen);
        if (req.rawText !== undefined) req.rawText = swap(req.rawText).slice(0, Api.API_LIMITS.maxTextLen);
      }
      // a product picked under the old value no longer applies
      delete s.pins[req.id];
      return done(action, state, s, msg.setSpec(req.text, label));
    }

    case 'add_item': {
      if (!env.parseItems) return reject('parse_unavailable', msg.parseUnavailable);
      // the parser's items verbatim (they are valid requirement items); invalid ones are dropped, never repaired
      const parsed = env.parseItems(action.text).flatMap((p) => {
        const r = Api.RequirementSchema.safeParse(p);
        return r.success ? [{ item: r.data, from: p.id }] : [];
      });
      if (parsed.length === 0) return reject('nothing_parsed', msg.nothingParsed);
      if (s.requirements.length + parsed.length > MAX_ITEMS) return reject('too_many_items', msg.tooManyItems);
      const ids = freshItemIds(s, parsed.length);
      const renamed = new Map(parsed.map((p, i) => [p.from, ids[i] as string]));
      const rename = (old: string) => renamed.get(old) ?? old;
      parsed.forEach((p, i) => {
        const r = p.item;
        r.id = ids[i] as string;
        // references between the new items follow the new ids
        if (r.inherited) r.inherited = r.inherited.map((h) => ({ ...h, fromItemId: rename(h.fromItemId) }));
        if (r.constraints) r.constraints = r.constraints.map((c) => (c.fromItemId ? { ...c, fromItemId: rename(c.fromItemId) } : c));
        if (r.notes) r.notes = r.notes.map((n) => (n.itemId ? { ...n, itemId: rename(n.itemId) } : n));
        s.requirements.push(r);
      });
      return done(action, state, s, msg.added(parsed.map((p) => p.item.text)));
    }

    case 'remove_item': {
      const req = findItem(s, action.itemId);
      if (!req) return reject('unknown_item', msg.unknownItem);
      dropItem(s, req.id);
      return done(action, state, s, msg.removed(req.text));
    }
  }
}

/** Is `attr` a key of the closed schema (or the budget)? */
export function isRelaxableAttr(attr: string): attr is keyof typeof ATTR_SCHEMA | 'budget' | typeof Api.CONDITION_ATTR {
  return attr === 'budget' || attr === Api.CONDITION_ATTR || Object.prototype.hasOwnProperty.call(ATTR_SCHEMA, attr);
}
