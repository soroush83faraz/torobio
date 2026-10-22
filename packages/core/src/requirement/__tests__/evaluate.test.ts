import { describe, expect, it } from 'vitest';
import {
  evaluateCandidate,
  evaluateConstraint,
  minValidPrice,
  modelCodeMatches,
  normToken,
  priceWithinBudget,
} from '../evaluate';
import { cand, req, user } from './fixtures';

describe('evaluateConstraint', () => {
  it('returns unknown whenever the product lacks the attribute', () => {
    expect(evaluateConstraint(user({ attr: 'channels', op: 'eq', value: 4 }), {}).result).toBe('unknown');
    expect(evaluateConstraint(user({ attr: 'channels', op: 'gte', value: 4 }), {}).result).toBe('unknown');
    expect(evaluateConstraint(user({ attr: 'fits_models', op: 'contains', value: 'A56' }), {}).result).toBe('unknown');
    expect(evaluateConstraint(user({ attr: 'fits_models', op: 'contains', value: 'A56' }), { fits_models: [] }).result).toBe('unknown');
  });

  it('eq on numbers, strings (normalised) and booleans', () => {
    expect(evaluateConstraint(user({ attr: 'resolution_mp', op: 'eq', value: 2 }), { resolution_mp: 2 }).result).toBe('pass');
    expect(evaluateConstraint(user({ attr: 'resolution_mp', op: 'eq', value: 2 }), { resolution_mp: 5 }).result).toBe('fail');
    expect(evaluateConstraint(user({ attr: 'brand', op: 'eq', value: 'dahua' }), { brand: 'Dahua' }).result).toBe('pass');
    expect(evaluateConstraint(user({ attr: 'hdd_surveillance', op: 'eq', value: true }), { hdd_surveillance: true }).result).toBe('pass');
  });

  it('known never fails: pass when readable, unknown otherwise', () => {
    const k = { attr: 'recorder_kind', op: 'known', source: 'compat' } as const;
    expect(evaluateConstraint(k, { recorder_kind: 'nvr' }).result).toBe('pass');
    expect(evaluateConstraint(k, {}).result).toBe('unknown');
    expect(evaluateConstraint({ attr: 'fits_models', op: 'known', source: 'compat' }, { fits_models: [] }).result).toBe('unknown');
  });

  it('in / gte / lte / contains', () => {
    const inC = user({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'] });
    expect(evaluateConstraint(inC, { recorder_kind: 'dvr' }).result).toBe('pass');
    expect(evaluateConstraint(inC, { recorder_kind: 'nvr' }).result).toBe('fail');
    expect(evaluateConstraint(user({ attr: 'channels', op: 'gte', value: 4 }), { channels: 8 }).result).toBe('pass');
    expect(evaluateConstraint(user({ attr: 'channels', op: 'gte', value: 4 }), { channels: 2 }).result).toBe('fail');
    expect(evaluateConstraint(user({ attr: 'voltage_v', op: 'lte', value: 12 }), { voltage_v: 12 }).result).toBe('pass');
    const fit = user({ attr: 'fits_models', op: 'contains', value: 'a56' });
    expect(evaluateConstraint(fit, { fits_models: ['A55', 'A56'] }).result).toBe('pass');
    expect(evaluateConstraint(fit, { fits_models: ['A57'] }).result).toBe('fail');
  });
});

describe('tokens, model codes, prices', () => {
  it('normalises Persian digits, case and separators', () => {
    expect(normToken('xvr-1b04 i')).toBe('XVR1B04I');
    expect(normToken('A۵۶')).toBe('A56');
  });
  it('matches model codes with a short vendor prefix only', () => {
    expect(modelCodeMatches(['DH-XVR1B04-I'], 'XVR1B04-I')).toBe(true);
    expect(modelCodeMatches(['XVR1B04-I'], 'dh-xvr1b04-i')).toBe(true);
    expect(modelCodeMatches(['XVR1B04-I'], 'XVR1B08-I')).toBe(false);
    expect(modelCodeMatches(['ABC1234'], '1234')).toBe(false); // too short to suffix-match
  });
  it('ignores null and non-positive prices', () => {
    expect(minValidPrice([{ id: 'a', productId: 1, shopId: 's', price: null }, { id: 'b', productId: 1, shopId: 's', price: 5000 }])).toBe(5000);
    expect(minValidPrice([{ id: 'a', productId: 1, shopId: 's', price: null }])).toBeNull();
  });
  it('budget bounds are inclusive', () => {
    expect(priceWithinBudget(100, { max: 100 })).toBe(true);
    expect(priceWithinBudget(101, { max: 100 })).toBe(false);
    expect(priceWithinBudget(100, { min: 100 })).toBe(true);
  });
});

describe('evaluateCandidate', () => {
  it('fit = differs on a fail, incomplete on an unknown, eligible otherwise', () => {
    const item = req('cam', 'دوربین', [user({ attr: 'resolution_mp', op: 'eq', value: 2 }), user({ attr: 'brand', op: 'eq', value: 'Dahua' })]);
    expect(evaluateCandidate(item, cand(1, { brand: 'Dahua', resolution_mp: 2 }, [['s', 10_000]])).fit).toBe('eligible');
    expect(evaluateCandidate(item, cand(2, { brand: 'Dahua' }, [['s', 10_000]])).fit).toBe('incomplete');
    const d = evaluateCandidate(item, cand(3, { brand: 'Dahua', resolution_mp: 5 }, [['s', 10_000]]));
    expect(d.fit).toBe('differs');
    expect(d.differences[0]).toContain('مگاپیکسل');
  });
  it('out of budget is a difference', () => {
    const item = req('x', 'هارد', [], { budget: { max: 1_000_000 } });
    const e = evaluateCandidate(item, cand(1, {}, [['s', 2_000_000]]));
    expect(e.fit).toBe('differs');
    expect(e.withinBudget).toBe(false);
  });
});
