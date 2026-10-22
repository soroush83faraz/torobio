import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/plans';
import { applyLocalAction, normalizeAssist } from './assistState';
import type { AssistResponse } from './types';

const state = emptyState([]);

describe('normalizeAssist', () => {
  it('uses the server newState as is', () => {
    const newState = { ...state, variant: 'fewest' };
    const r: AssistResponse = { action: { type: 'set_preference', preference: 'fewest_stops' }, newState, changed: true, supported: true, message: 'م', messageFa: 'م' };
    expect(normalizeAssist({ state }, r)).toMatchObject({ newState, changed: true, messageFa: 'م' });
  });
  it('trusts the server on changed:false', () => {
    const r: AssistResponse = { action: { type: 'none' }, newState: state, changed: false, supported: true, message: 'همین الان', degraded: true };
    expect(normalizeAssist({ state }, r)).toMatchObject({ changed: false, degraded: true, messageFa: 'همین الان' });
  });
  it('applies a state-level action locally when the answer has no newState (fallback / mock)', () => {
    const r: AssistResponse = { action: { type: 'exclude_shop', shopId: 's1' }, supported: true, message: 'م' };
    const n = normalizeAssist({ state }, r);
    expect(n.changed).toBe(true);
    expect(n.newState.excludedShops['*']).toEqual(['s1']);
    expect(state.excludedShops['*']).toBeUndefined();
  });
  it('an unsupported answer changes nothing', () => {
    const n = normalizeAssist({ state }, { action: { type: 'none' }, supported: false, message: 'نه' });
    expect(n).toMatchObject({ changed: false, newState: state });
    expect(applyLocalAction(state, { type: 'set_variant', value: 'fewest' }).variant).toBe('fewest');
  });
});
