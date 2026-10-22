import { describe, expect, it } from 'vitest';
import { ITEM_STATE_LABEL } from '../../copy/fa';
import type { Candidate, Constraint, ProductAttrs, Requirement } from '../../types/index';
import { resolveItem, resolveItems } from '../resolve';
import { cand, int, pick, req, rng, user } from './fixtures';

describe('item classification (B1.1)', () => {
  const cams = (): Candidate[] => [
    cand(1, { brand: 'Dahua', resolution_mp: 2 }, [['s1', 2_000_000], ['s2', 2_100_000]], { modelCodes: ['HAC-HDW1200CLQP'] }),
    cand(2, { brand: 'Dahua', resolution_mp: 2 }, [['s1', 1_800_000]]),
    cand(3, { brand: 'Dahua', resolution_mp: 5 }, [['s1', 1_000_000]]),
    cand(4, { brand: 'Dahua' }, [['s3', 500_000]]), // incomplete: cheaper but unknown MP
  ];
  const spec = [user({ attr: 'brand', op: 'eq', value: 'Dahua' }), user({ attr: 'resolution_mp', op: 'eq', value: 2 })];

  it('brand + megapixels is a suggestion, not an exact model', () => {
    const { resolution } = resolveItem(req('c', 'دوربین داهوا ۲ مگاپیکسل', spec), cams());
    expect(resolution.state).toBe('suggested');
    expect(resolution.label).toBe(ITEM_STATE_LABEL.suggested);
    expect(resolution.label).not.toBe('مدل مشخص');
    expect(resolution.rule).toBe('cheapest_eligible');
    expect(resolution.chosenProductId).toBe(2);
    expect(resolution.counts.eligible).toBe(2);
    expect(resolution.detail).toContain('یکی از ۲ مدل مطابق خواسته');
  });

  it('never auto-picks an incomplete-spec product even when it is the cheapest', () => {
    const { resolution } = resolveItem(req('c', 'x', spec), cams());
    expect(resolution.chosenProductId).not.toBe(4);
    expect(resolution.incompleteIds).toContain(4);
  });

  it('exact_model for a model-code match', () => {
    const { resolution } = resolveItem(req('c', 'x', [], { modelCode: 'HAC-HDW1200CLQP' }), cams());
    expect(resolution.state).toBe('exact_model');
    expect(resolution.rule).toBe('model_code');
    expect(resolution.chosenProductId).toBe(1);
    expect(resolution.label).toBe('مدل مشخص');
  });

  it('an unmatched model code is never exact; others are alternatives', () => {
    const { resolution } = resolveItem(req('c', 'x', [], { modelCode: 'NOPE-12345' }), cams());
    expect(resolution.state).toBe('alternative');
    expect(resolution.chosenProductId).toBeUndefined();
  });

  it('exact_model for a user-pinned product; price_unknown when the pin has no price', () => {
    expect(resolveItem(req('c', 'x', spec, { pinnedProductId: 3 }), cams()).resolution.state).toBe('exact_model');
    const unpriced = [...cams(), cand(9, { brand: 'Dahua', resolution_mp: 2 }, [['s1', null]])];
    const pinnedUnpriced = resolveItem(req('c', 'x', spec, { pinnedProductId: 9 }), unpriced).resolution;
    expect(pinnedUnpriced.state).toBe('price_unknown');
    expect(pinnedUnpriced.rule).toBe('user_pinned');
    const gone = resolveItem(req('c', 'x', spec, { pinnedProductId: 77 }), cams()).resolution;
    expect(gone.state).toBe('not_found');
    expect(gone.notFoundReason).toBe('pinned_missing');
  });

  it('budget selects the cheapest eligible within budget and says so', () => {
    const { resolution } = resolveItem(req('c', 'x', spec, { budget: { min: 1_900_000 } }), cams());
    expect(resolution.chosenProductId).toBe(1);
    expect(resolution.rule).toBe('cheapest_eligible_within_budget');
  });

  it('not_found / price_unknown', () => {
    expect(resolveItem(req('c', 'x', spec), []).resolution.state).toBe('not_found');
    const unpriced = [cand(1, { brand: 'Dahua', resolution_mp: 2 }, [['s1', null]])];
    const r = resolveItem(req('c', 'x', spec), unpriced).resolution;
    expect(r.state).toBe('price_unknown');
    expect(r.rule).toBe('no_price');
  });

  it('alternative when nothing matches; auto-picked only after the user relaxes, never with unknowns', () => {
    const only = [cand(3, { brand: 'Dahua', resolution_mp: 5 }, [['s1', 1_000_000]]), cand(4, { brand: 'Dahua' }, [['s1', 100_000]])];
    const strict = resolveItem(req('c', 'x', spec), only).resolution;
    expect(strict.state).toBe('alternative');
    expect(strict.chosenProductId).toBeUndefined();
    const relaxed = resolveItem(req('c', 'x', spec, { preference: { allowAlternatives: true } }), only).resolution;
    expect(relaxed.state).toBe('alternative');
    expect(relaxed.chosenProductId).toBe(3);
    expect(relaxed.rule).toBe('closest_alternative');
    expect(relaxed.detail).toContain('مگاپیکسل');
  });

  it('a loose requirement with a heterogeneous pool needs information; accepting the suggestion resolves it', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      cand(100 + i, { brand: ['Dahua', 'Hikvision', 'Uniview'][i % 3]!, resolution_mp: [2, 4, 5][i % 3]! }, [['s1', 1_000_000 + i * 250_000]]),
    );
    const loose = resolveItem(req('c', 'دوربین مداربسته'), pool);
    expect(loose.resolution.state).toBe('needs_info');
    expect(loose.resolution.needsInfoReason).toBe('loose_requirement');
    expect(loose.resolution.fallbackPick).toEqual({ productId: 100, rule: 'cheapest_eligible' });
    expect(loose.question.question).not.toBeNull();
    const accepted = resolveItem(req('c', 'دوربین مداربسته', [], { preference: { acceptSuggestion: true } }), pool);
    expect(accepted.resolution.state).toBe('suggested');
    expect(accepted.resolution.chosenProductId).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Property: the exactness rule
// ---------------------------------------------------------------------------

function randomCase(seed: number): { item: Requirement; cands: Candidate[] } {
  const r = rng(seed);
  const brands = ['Dahua', 'Hikvision', 'Uniview'];
  const n = int(r, 0, 14);
  const cands: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const attrs: ProductAttrs = {};
    if (r() < 0.8) attrs.brand = pick(r, brands);
    if (r() < 0.6) attrs.resolution_mp = pick(r, [2, 4, 5]);
    if (r() < 0.5) attrs.channels = pick(r, [4, 8, 16]);
    const offers: [string, number | null][] = [];
    const k = int(r, 0, 3);
    for (let j = 0; j < k; j++) offers.push([`s${int(r, 1, 4)}`, r() < 0.2 ? null : int(r, 10, 500) * 10_000]);
    cands.push(cand(i + 1, attrs, offers, { modelCodes: r() < 0.3 ? [`CODE-${i + 1}0000`] : [] }));
  }
  const constraints: Constraint[] = [];
  if (r() < 0.6) constraints.push(user({ attr: 'brand', op: 'eq', value: pick(r, brands) }));
  if (r() < 0.5) constraints.push(user({ attr: 'resolution_mp', op: 'eq', value: pick(r, [2, 4, 5]) }));
  if (r() < 0.3) constraints.push(user({ attr: 'channels', op: 'gte', value: pick(r, [4, 8]) }));
  const item = req('i', 'x', constraints);
  const mode = r();
  if (mode < 0.15 && n > 0) item.pinnedProductId = int(r, 1, n + 2);
  else if (mode < 0.3) item.modelCode = `CODE-${int(r, 1, 16)}0000`;
  if (r() < 0.3) item.budget = { max: int(r, 50, 400) * 10_000 };
  if (r() < 0.3) item.preference = { acceptSuggestion: r() < 0.5, allowAlternatives: r() < 0.5 };
  return { item, cands };
}

describe('property: exactness and auto-pick rules (500 random cases)', () => {
  it('exact_model iff priced pin / priced model-code match; suggestions never exact; no unknowns auto-picked', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const { item, cands } = randomCase(seed);
      const { resolution: res } = resolveItem(item, cands);
      const chosen = res.evaluations.find((e) => e.productId === res.chosenProductId);
      if (res.state === 'exact_model') {
        expect(item.pinnedProductId !== undefined || !!item.modelCode).toBe(true);
        expect(res.rule === 'user_pinned' || res.rule === 'model_code').toBe(true);
        if (res.rule === 'model_code') expect(chosen?.modelCodeMatch).toBe(true);
        if (res.rule === 'user_pinned') expect(res.chosenProductId).toBe(item.pinnedProductId);
      }
      if (item.pinnedProductId === undefined && !item.modelCode) {
        expect(res.state).not.toBe('exact_model');
        expect(res.label).not.toBe('مدل مشخص');
      }
      if (res.state === 'suggested') {
        expect(chosen?.fit).toBe('eligible');
        expect(res.rule === 'cheapest_eligible' || res.rule === 'cheapest_eligible_within_budget').toBe(true);
        expect(res.label).not.toBe('مدل مشخص');
        // the visible rule holds: no cheaper eligible priced product
        const cheaper = res.evaluations.filter((e) => e.fit === 'eligible' && e.minPrice !== null && e.minPrice < chosen!.minPrice!);
        expect(cheaper).toEqual([]);
      }
      // a product with an unknown on a needed attribute is never auto-picked
      if (chosen && res.rule !== 'user_pinned' && res.rule !== 'model_code') expect(chosen.unknown).toEqual([]);
      if (res.state === 'needs_info' || res.state === 'not_found') expect(res.chosenProductId).toBeUndefined();
    }
  });
});

describe('unit guard in the item line (G1a)', () => {
  const wires = (): Candidate[] => [
    cand(1, { wire_section_mm2: 2.5, sale_unit: 'meter' }, [['s1', 59_000]]),
    cand(2, { wire_section_mm2: 2.5, sale_unit: 'roll' }, [['s1', 115_800_000]]),
  ];
  const section = user({ attr: 'wire_section_mm2', op: 'eq', value: 2.5 });

  it('before the sale unit is chosen, a wire item states no price range (roll and metre prices never mix)', () => {
    const { results } = resolveItems([req('w', 'سیم ۲٫۵', [section], { kind: 'wire', preference: { acceptSuggestion: true } })], { w: wires() });
    const resolution = results[0]!.resolution;
    expect(resolution.state).toBe('needs_info'); // the sale-unit question cannot be skipped
    expect(resolution.priceRange).toEqual({ min: 59_000, max: 115_800_000 }); // kept for the server's own unit guard
    expect(resolution.detail).toBe('۲ مدل · یک نکتهٔ سازگاری را باید بدانیم');
  });

  it('once the unit is chosen, the range is of that unit only', () => {
    const unit: Constraint = { attr: 'sale_unit', op: 'eq', value: 'roll', source: 'answer' };
    const item = req('w', 'سیم ۲٫۵', [section, unit], { kind: 'wire' });
    const { resolution } = resolveItem(item, wires());
    expect(resolution.state).toBe('suggested');
    expect(resolution.priceRange).toEqual({ min: 115_800_000, max: 115_800_000 });
  });
});
