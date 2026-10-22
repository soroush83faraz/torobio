/**
 * Realistic CCTV project (hand-made fixtures): «۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور».
 * Walks the J1 path with the LLM off: resolve → compat-critical question → answer → plan → compat chips → Friday.
 */
import { describe, expect, it } from 'vitest';
import { COMPAT_STATUS_LABEL } from '../../copy/fa';
import { evaluateCompat } from '../../compat/index';
import { buildPlanItems, chosenItemsForCompat } from '../../plan/offers';
import { planRun } from '../../plan/optimize';
import type { Requirement } from '../../types/index';
import { resolveItems } from '../resolve';
import { CCTV_SHOPS, cctvCandidates, cctvItems } from './fixtures';

describe('CCTV scenario', () => {
  const cands = cctvCandidates();

  it('step 1: cameras and drive resolve with no taps; the recorder and the adapter ask their compat-critical questions', () => {
    const { items, results, critical } = resolveItems(cctvItems(), cands);
    const st = Object.fromEntries(results.map((r) => [r.resolution.itemId, r.resolution]));
    expect(st.cam!.state).toBe('suggested');
    expect(st.cam!.chosenProductId).toBe(102);
    expect(st.cam!.counts).toMatchObject({ eligible: 2, incomplete: 1, differs: 2 });
    expect(st.hdd!.state).toBe('suggested');
    // the adapter voltage is compat-critical: 12 V is assumed (derived), so 403 (no voltage) is never auto-picked
    expect(items[3]!.constraints).toEqual([
      { attr: 'voltage_v', op: 'eq', value: 12, source: 'compat', ruleId: 'camera_adapter_12v', fromItemId: 'cam' },
    ]);
    expect(st.ad!).toMatchObject({ state: 'needs_info', needsInfoReason: 'compat_critical', eligibleIds: [402, 401], incompleteIds: [403] });
    expect(st.ad!.fallbackPick).toEqual({ productId: 402, rule: 'cheapest_eligible' });
    const vq = results[3]!.question.question!;
    expect(vq).toMatchObject({ key: 'voltage_v', priority: 1, source: 'compat', ruleId: 'camera_adapter_12v' });
    expect(vq.options.map((o) => [o.id, o.count])).toEqual([['voltage_v:12', 2]]);
    // nothing suggested is called «مدل مشخص»
    for (const r of results) expect(r.resolution.state).not.toBe('exact_model');
    // recorder: stated 4 channels already satisfies channels >= 4 cameras, so no duplicate derived chip
    // and, with cameras in the list, the recorder kind must be readable (205 has no kind → never auto-picked)
    expect(items[1]!.constraints.filter((c) => c.source === 'compat')).toEqual([
      { attr: 'recorder_kind', op: 'known', source: 'compat', ruleId: 'camera_recorder_signal', fromItemId: 'cam' },
    ]);
    expect(st.rec!.incompleteIds).toEqual([205]);
    expect(critical).toEqual([
      { itemId: 'rec', ruleId: 'camera_recorder_signal', attr: 'recorder_kind', relatedItemIds: ['cam'] },
      { itemId: 'ad', ruleId: 'camera_adapter_12v', attr: 'voltage_v', relatedItemIds: ['cam'] },
    ]);
    expect(st.rec!.state).toBe('needs_info');
    expect(st.rec!.needsInfoReason).toBe('compat_critical');
    expect(st.rec!.fallbackPick).toEqual({ productId: 202, rule: 'cheapest_eligible' });
    const q = results[1]!.question.question!;
    expect(q.priority).toBe(1);
    expect(q.options.map((o) => [o.id, o.count])).toEqual([['recorder_kind:analog', 2], ['recorder_kind:ip', 1]]);
  });

  it('step 2: before the answer the plan is partial and honest about it', () => {
    const { items, results } = resolveItems(cctvItems(), cands);
    const res = planRun({ items: buildPlanItems(items, results.map((r) => r.resolution), cands), shops: CCTV_SHOPS });
    const def = res.plans[0]!;
    expect(def.totals.coverage).toMatchObject({ coveredCount: 2, totalCount: 4, complete: false, usesSuggestions: true });
    expect(def.totals.line.startsWith('فقط ۲ از ۴ مورد')).toBe(true);
    expect(def.totals.missingLine).toBe('منتظر انتخاب: ضبط‌کننده ۴ کانال، آداپتور');
    for (const p of res.plans) expect([p.totals.line, ...p.reasons.map((r) => r.text)].join(' ')).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین/);
  });

  function answered(): Requirement[] {
    const its = cctvItems();
    its[1]!.constraints.push({ attr: 'recorder_kind', op: 'in', values: ['xvr', 'dvr'], source: 'answer' });
    // «کافیه، پیشنهاد بده» on the adapter: the 12 V assumption stays
    its[3]!.preference = { acceptSuggestion: true };
    return its;
  }

  it('step 3: after two taps the plan is complete; exact Pareto set with deltas', () => {
    const { items, results } = resolveItems(answered(), cands);
    const resolutions = results.map((r) => r.resolution);
    expect(resolutions[1]!.state).toBe('suggested');
    expect(resolutions[1]!.eligibleIds).toEqual([202, 201]);
    const res = planRun({ items: buildPlanItems(items, resolutions, cands), shops: CCTV_SHOPS });
    expect(resolutions[3]!).toMatchObject({ state: 'suggested', chosenProductId: 402 });
    expect(res.plans.map((p) => [p.stopCount, p.totals.total])).toEqual([[2, 18_450_000], [1, 19_800_000]]);
    const def = res.plans[0]!;
    expect(def.isDefault).toBe(true);
    expect(def.totals.line).toBe('جمع ۴ مورد: ۱۸٫۵ میلیون تومان');
    expect(def.totals.suggestionNote).toBe('با مدل‌های پیشنهادی');
    expect(def.reasons[0]!.text).toBe('ارزان‌ترین ترکیب برای هر ۴ مورد، با ۲ توقف.');
    expect(def.stops.map((s) => s.buildingKey).sort()).toEqual(['c:35.6895,51.4201', 'm:charsou']);
    const byItem = Object.fromEntries(def.assignments.map((a) => [a.itemId, a]));
    expect(byItem.cam).toMatchObject({ productId: 102, shopId: 'S1', unitPrice: 2_300_000, qty: 4, lineTotal: 9_200_000 });
    expect(byItem.rec).toMatchObject({ productId: 202, shopId: 'S1' });
    expect(byItem.hdd).toMatchObject({ productId: 302, shopId: 'C1' });
    expect(byItem.ad).toMatchObject({ productId: 402, shopId: 'C1' });
    const alt = res.plans[1]!;
    expect(alt.stops[0]!.mallName).toBe('پاساژ علاءالدین');
    expect(alt.delta).toMatchObject({ cost: 1_350_000, stops: -1 });
    expect(alt.delta!.text).toBe('۱٫۴ میلیون تومان بیشتر، یک توقف کمتر');
    expect(alt.singleShopId).toBe('A1');

    // step 4: compatibility chips for the chosen products
    const findings = evaluateCompat(chosenItemsForCompat(items, resolutions, cands, def));
    const status = Object.fromEntries(findings.map((f) => [f.ruleId, f.status]));
    expect(status).toEqual({
      recorder_channels: 'listing_stated', // 4 ch for 4 cameras, read from the listing
      camera_recorder_signal: 'unknown', // camera 102 does not state its signal
      recorder_hdd_internal: 'assumed',
      hdd_surveillance: 'unknown', // 302 does not say purple/surveillance
      camera_adapter_12v: 'assumed', // 402 states 12 V; 12 V for cameras is the general assumption
    });
    expect(COMPAT_STATUS_LABEL[findings[0]!.status]).toBe('طبق عنوان آگهی');
    expect(findings.filter((f) => f.status !== 'listing_stated').every((f) => !!f.askSeller)).toBe(true);
    // the one-stop alternative uses the AHD camera and the XVR: an assumption, never «verified»
    const altFindings = evaluateCompat(chosenItemsForCompat(items, resolutions, cands, alt));
    expect(altFindings.find((f) => f.ruleId === 'camera_recorder_signal')!.status).toBe('assumed');
    expect(altFindings.find((f) => f.ruleId === 'hdd_surveillance')!.status).toBe('listing_stated');
    expect(altFindings.find((f) => f.ruleId === 'camera_adapter_12v')!.status).toBe('assumed');
  });

  it('step 5: Friday 11:40 flags closed stops, excludes them, and keeps shops without hours', () => {
    const { items, results } = resolveItems(answered(), cands);
    const res = planRun({
      items: buildPlanItems(items, results.map((r) => r.resolution), cands),
      shops: CCTV_SHOPS,
      visit: { day: 'fri', minute: 700 },
    });
    expect(res.closedShopIds).toEqual(['A1', 'S1']);
    const def = res.plans[0]!;
    expect(def.totals.coverage.missingItems).toEqual([{ itemId: 'rec', label: 'ضبط‌کننده ۴ کانال', reason: 'closed' }]);
    expect(def.totals.coverage.complete).toBe(false);
    expect(def.totals.total).toBe(9_800_000 + 2_800_000 + 250_000);
    expect(def.stops.map((s) => s.shops.map((x) => [x.shop.id, x.openStatus]))).toEqual([[['C1', 'open']]]);
    expect(def.reasons.some((r) => r.code === 'single_shop')).toBe(true);
    expect(res.notes.find((n) => n.code === 'closed_excluded')!.text).toContain('۲ مغازه');
    // A2 has no hours: never reported as closed
    expect(res.closedShopIds).not.toContain('A2');
  });

  it('skipping the compat question picks by the visible rule, still never a recorder with an unreadable kind', () => {
    const its = cctvItems();
    its[1]!.skippedQuestions = ['recorder_kind'];
    const { results } = resolveItems(its, cands);
    const rec = results[1]!.resolution;
    expect(rec.state).toBe('suggested');
    expect(rec.chosenProductId).toBe(202);
    expect(rec.chosenProductId).not.toBe(205); // 205 is cheaper but its kind is unknown
  });

  it('a typed model code is the only way to get «مدل مشخص»', () => {
    const its = answered();
    its[1]!.modelCode = 'XVR1B04-I'; // listing says DH-XVR1B04-I
    const { results } = resolveItems(its, cands);
    expect(results[1]!.resolution.state).toBe('exact_model');
    expect(results[1]!.resolution.chosenProductId).toBe(201);
    expect(results[1]!.resolution.label).toBe('مدل مشخص');
    expect(results.filter((r) => r.resolution.state === 'exact_model').map((r) => r.resolution.itemId)).toEqual(['rec']);
  });
});
