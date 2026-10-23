/**
 * Exact shopping-run planner (B3.5).
 *
 * Stops are buildings (`buildingKey`). For each (building, item) the price is the cheapest valid offer × qty
 * (valid = priced, shop known, not excluded, not closed at the visit time; shops without hours are never closed).
 * One item is bought at one stop.
 *
 * f[j][k][mask] = minimum cost to buy exactly `mask` using exactly k of the first j buildings, each used building
 * buying a non-empty subset. Coverage first (largest coverable mask), then the exact Pareto set over
 * (total cost, number of stops). Ties at equal (cost, stops) are broken by compactness (smaller max pairwise
 * haversine), then by the sorted building keys. Stop order: nearest neighbour from the densest stop
 * (a suggested order, never a route).
 */
import {
  OPEN_STATUS_LABEL,
  PLAN_ORDER_NOTE,
  SUGGESTION_NOTE,
  distanceToNextText,
  planCopy,
} from '../copy/fa';
import type {
  Assignment,
  AssignmentRule,
  Coverage,
  MissingReason,
  Plan,
  PlanInput,
  PlanItemInput,
  PlanResult,
  PlanTag,
  Reason,
  Shop,
  Stop,
  StopShop,
  UnpricedItem,
} from '../types/index';
import { hasCoords, haversineM, spreadM } from './geo';
import { openStatusAt } from './hours';

export { OPEN_STATUS_LABEL };

/** Hard limit on items with priced offers (DP is O(N·K·3^m)). */
export const MAX_PLAN_ITEMS = 8;

interface BestOffer {
  offerId: string;
  productId: number;
  shopId: string;
  price: number;
}

interface Building {
  key: string;
  lat: number | null;
  lon: number | null;
  mallName: string | null;
  /** per plannable item index */
  best: (BestOffer | null)[];
  avail: number;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function reason(code: string, params: Record<string, string | number>, text: string): Reason {
  return { code, params, text };
}

/** A usable plan price: a finite positive number (null / 0 / placeholder prices never count). */
export const isPlanPrice = (p: number | null): p is number => p !== null && Number.isFinite(p) && p > 0;

/**
 * Which shops an offer may be bought at (shared by the planner and the places ranking): not excluded (shop, mall
 * or building) and not closed at the visit time. Shops without hours are never closed; without a visit nothing is.
 */
export function shopGate(input: Pick<PlanInput, 'exclusions' | 'visit'>): { isExcluded: (s: Shop) => boolean; isClosed: (s: Shop) => boolean } {
  const exShops = new Set(input.exclusions?.shopIds ?? []);
  const exMalls = new Set(input.exclusions?.mallKeys ?? []);
  const exBuildings = new Set(input.exclusions?.buildingKeys ?? []);
  const visit = input.visit;
  const isExcluded = (s: Shop) => exShops.has(s.id) || (!!s.mallKey && exMalls.has(s.mallKey)) || exBuildings.has(s.buildingKey);
  const closedCache = new Map<string, boolean>();
  const isClosed = (s: Shop) => {
    if (!visit) return false;
    let c = closedCache.get(s.id);
    if (c === undefined) {
      c = openStatusAt(s.hours, visit) === 'closed';
      closedCache.set(s.id, c);
    }
    return c;
  };
  return { isExcluded, isClosed };
}

export function planRun(input: PlanInput): PlanResult {
  const shopsById = new Map<string, Shop>();
  for (const s of [...input.shops].sort((a, b) => cmpStr(a.id, b.id))) if (!shopsById.has(s.id)) shopsById.set(s.id, s);
  const visit = input.visit;
  const { isExcluded, isClosed } = shopGate(input);
  const statusOf = (s: Shop) => (visit ? openStatusAt(s.hours, visit) : null);

  // ---- classify items -------------------------------------------------------------------------------
  const items = input.items;
  const missing: Coverage['missingItems'] = [];
  const unpriced: UnpricedItem[] = [];
  const plannable: { item: PlanItemInput; offers: { o: BestOffer; shop: Shop }[] }[] = [];
  const closedIds = new Set<string>();

  for (const item of items) {
    const push = (r: MissingReason) => missing.push({ itemId: item.itemId, label: item.label, reason: r });
    if (item.state === 'needs_info' || item.state === 'not_found') {
      push(item.state);
      continue;
    }
    if (item.offers.length === 0) {
      push(item.state === 'alternative' ? 'no_choice' : 'no_offer');
      continue;
    }
    const valid: { o: BestOffer; shop: Shop }[] = [];
    let pricedSeen = false;
    let pricedClosed = false;
    const unpricedSellers: UnpricedItem['sellers'] = [];
    for (const o of item.offers) {
      const shop = shopsById.get(o.shopId);
      if (!shop) continue;
      const priced = isPlanPrice(o.price);
      if (isExcluded(shop)) {
        if (priced) pricedSeen = true;
        continue;
      }
      if (isClosed(shop)) {
        closedIds.add(shop.id);
        if (priced) {
          pricedSeen = true;
          pricedClosed = true;
        }
        continue;
      }
      if (!priced) {
        unpricedSellers.push({ shopId: shop.id, offerId: o.offerId, productId: o.productId, buildingKey: shop.buildingKey });
        continue;
      }
      valid.push({ o: { offerId: o.offerId, productId: o.productId, shopId: o.shopId, price: o.price! }, shop });
    }
    if (valid.length > 0) {
      plannable.push({ item, offers: valid });
    } else if (!pricedSeen && unpricedSellers.length > 0) {
      unpricedSellers.sort((a, b) => cmpStr(a.buildingKey, b.buildingKey) || cmpStr(a.shopId, b.shopId) || cmpStr(a.offerId, b.offerId));
      unpriced.push({ itemId: item.itemId, label: item.label, sellers: unpricedSellers });
      push('price_unknown');
    } else if (pricedClosed) {
      push('closed');
    } else if (pricedSeen) {
      push('excluded');
    } else {
      push('no_offer');
    }
  }

  const m = plannable.length;
  if (m > MAX_PLAN_ITEMS) throw new RangeError(`planRun: at most ${MAX_PLAN_ITEMS} plannable items (got ${m})`);

  // ---- buildings ------------------------------------------------------------------------------------
  const coordSum = new Map<string, { lat: number; lon: number; n: number; mall: string | null }>();
  for (const s of shopsById.values()) {
    const e = coordSum.get(s.buildingKey) ?? { lat: 0, lon: 0, n: 0, mall: null };
    if (hasCoords(s)) {
      e.lat += s.lat;
      e.lon += s.lon;
      e.n++;
    }
    if (!e.mall && s.mallName) e.mall = s.mallName;
    coordSum.set(s.buildingKey, e);
  }
  const bmap = new Map<string, Building>();
  plannable.forEach(({ offers }, i) => {
    for (const { o, shop } of offers) {
      let b = bmap.get(shop.buildingKey);
      if (!b) {
        const c = coordSum.get(shop.buildingKey);
        b = {
          key: shop.buildingKey,
          lat: c && c.n ? c.lat / c.n : null,
          lon: c && c.n ? c.lon / c.n : null,
          mallName: c?.mall ?? null,
          best: new Array<BestOffer | null>(m).fill(null),
          avail: 0,
        };
        bmap.set(shop.buildingKey, b);
      }
      const cur = b.best[i];
      if (
        !cur ||
        o.price < cur.price ||
        (o.price === cur.price && (cmpStr(o.offerId, cur.offerId) || cmpStr(o.shopId, cur.shopId)) < 0)
      ) {
        b.best[i] = o;
      }
      b.avail |= 1 << i;
    }
  });
  const buildings = [...bmap.values()].sort((a, b) => cmpStr(a.key, b.key));
  const N = buildings.length;
  const S = 1 << m;
  const qty = plannable.map((p) => p.item.qty);

  const orderNote = PLAN_ORDER_NOTE;
  const closedShopIds = [...closedIds].sort(cmpStr);
  const notes: Reason[] = [];
  if (closedShopIds.length) notes.push(reason('closed_excluded', { count: closedShopIds.length }, planCopy.closedExcluded(closedShopIds.length)));

  const baseCoverage = (covered: number, assignments: Assignment[]): Coverage => {
    const extraMissing = missing.slice();
    return {
      coveredCount: covered,
      totalCount: items.length,
      complete: covered === items.length,
      unpricedItems: unpriced,
      missingItems: extraMissing,
      usesSuggestions: assignments.some((a) => a.state === 'suggested'),
      usesAlternatives: assignments.some((a) => a.state === 'alternative'),
    };
  };

  if (m === 0 || N === 0) {
    notes.push(reason('nothing_plannable', {}, planCopy.nothingPlannable()));
    return {
      plans: [],
      defaultPlanId: null,
      coverage: baseCoverage(0, []),
      closedShopIds,
      orderNote,
      notes,
      diagnostics: { buildings: N, plannableItems: m, tieEnumerationTruncated: false, tiedSetsInspected: 0 },
    };
  }

  // ---- subset costs per building -----------------------------------------------------------------------
  const sc: Float64Array[] = buildings.map((b) => {
    const arr = new Float64Array(S).fill(Infinity);
    arr[0] = 0;
    for (let sub = 1; sub < S; sub++) {
      if ((sub & b.avail) !== sub) continue;
      const low = sub & -sub;
      const i = 31 - Math.clz32(low);
      arr[sub] = arr[sub ^ low]! + b.best[i]!.price * qty[i]!;
    }
    return arr;
  });

  // ---- DP over buildings --------------------------------------------------------------------------
  const K = Math.max(1, Math.min(input.maxStops ?? m, m));
  const W = (K + 1) * S;
  const f: Float64Array[] = [new Float64Array(W).fill(Infinity)];
  f[0]![0] = 0;
  for (let j = 0; j < N; j++) {
    const prev = f[j]!;
    const next = Float64Array.from(prev);
    const avail = buildings[j]!.avail;
    const costs = sc[j]!;
    for (let k = 0; k < K; k++) {
      const base = k * S;
      for (let mask = 0; mask < S; mask++) {
        const v = prev[base + mask]!;
        if (v === Infinity) continue;
        const rem = avail & ~mask;
        for (let sub = rem; sub > 0; sub = (sub - 1) & rem) {
          const nv = v + costs[sub]!;
          const idx = base + S + (mask | sub);
          if (nv < next[idx]!) next[idx] = nv;
        }
      }
    }
    f.push(next);
  }
  const fin = f[N]!;

  // ---- coverage first ---------------------------------------------------------------------------------
  let target = -1;
  let targetCost = Infinity;
  for (let mask = 0; mask < S; mask++) {
    let c = Infinity;
    for (let k = 1; k <= K; k++) c = Math.min(c, fin[k * S + mask]!);
    if (c === Infinity) continue;
    const pc = popcount(mask);
    const tpc = target < 0 ? -1 : popcount(target);
    if (pc > tpc || (pc === tpc && c < targetCost)) {
      target = mask;
      targetCost = c;
    }
  }
  plannable.forEach((p, i) => {
    if (!(target & (1 << i))) missing.push({ itemId: p.item.itemId, label: p.item.label, reason: 'stop_limit' });
  });

  // ---- Pareto over (cost, stops) -----------------------------------------------------------------------
  const frontier: { k: number; cost: number }[] = [];
  let bestSoFar = Infinity;
  for (let k = 1; k <= K; k++) {
    const c = fin[k * S + target]!;
    if (c < bestSoFar) {
      frontier.push({ k, cost: c });
      bestSoFar = c;
    }
  }

  // ---- enumerate tied optimal building sets, keep the most compact --------------------------------------
  const cap = Math.max(1, input.maxTieEnumeration ?? 5000);
  let truncated = false;
  let inspected = 0;
  const coords = buildings.map((b) => ({ lat: b.lat, lon: b.lon }));

  const chooseSet = (k: number, cost: number): number[] => {
    const sets = new Map<string, number[]>();
    const acc: number[] = [];
    const rec = (j: number, kk: number, mask: number, t: number): void => {
      if (sets.size >= cap) {
        truncated = true;
        return;
      }
      if (j === 0) {
        if (kk === 0 && mask === 0) {
          const s = [...acc].sort((a, b) => a - b);
          const key = s.join(',');
          if (!sets.has(key)) sets.set(key, s);
        }
        return;
      }
      const b = j - 1;
      const fb = f[b]!;
      if (kk > 0) {
        const rem = mask & buildings[b]!.avail;
        for (let sub = rem; sub > 0; sub = (sub - 1) & rem) {
          const pv = fb[(kk - 1) * S + (mask ^ sub)]!;
          if (pv !== Infinity && pv + sc[b]![sub]! === t) {
            acc.push(b);
            rec(b, kk - 1, mask ^ sub, pv);
            acc.pop();
            if (sets.size >= cap) return;
          }
        }
      }
      if (fb[kk * S + mask]! === t) rec(b, kk, mask, t);
    };
    rec(N, k, target, cost);
    if (sets.size >= cap) truncated = true; // the cap was reached: more tied sets may exist
    inspected += sets.size;
    let best: number[] | null = null;
    let bestSpread = Infinity;
    let bestKey = '';
    for (const s of sets.values()) {
      const sp = spreadM(s.map((i) => coords[i]!));
      const key = s.map((i) => buildings[i]!.key).join('\u0000');
      if (!best || sp < bestSpread - 1e-6 || (Math.abs(sp - bestSpread) <= 1e-6 && key < bestKey)) {
        best = s;
        bestSpread = sp;
        bestKey = key;
      }
    }
    return best ?? [];
  };

  // ---- build plans --------------------------------------------------------------------------------
  const plans: Plan[] = frontier.map(({ k, cost }) => {
    const set = chooseSet(k, cost);
    const assignments: Assignment[] = [];
    const byBuilding = new Map<number, number[]>();
    plannable.forEach((p, i) => {
      if (!(target & (1 << i))) return;
      let bi = -1;
      for (const b of set) {
        const o = buildings[b]!.best[i];
        if (!o) continue;
        const cur = bi < 0 ? null : buildings[bi]!.best[i]!;
        if (!cur || o.price < cur.price || (o.price === cur.price && cmpStr(buildings[b]!.key, buildings[bi]!.key) < 0)) bi = b;
      }
      const o = buildings[bi]!.best[i]!;
      const it = p.item;
      let rule: AssignmentRule | undefined = it.rule;
      if (it.state === 'suggested') rule = o.productId === it.chosenProductId ? (it.rule ?? 'cheapest_eligible') : 'cheapest_eligible_at_stop';
      const a: Assignment = {
        itemId: it.itemId,
        productId: o.productId,
        offerId: o.offerId,
        shopId: o.shopId,
        buildingKey: buildings[bi]!.key,
        unitPrice: o.price,
        qty: it.qty,
        lineTotal: o.price * it.qty,
        state: it.state,
      };
      if (rule) a.rule = rule;
      assignments.push(a);
      const l = byBuilding.get(bi) ?? [];
      l.push(assignments.length - 1);
      byBuilding.set(bi, l);
    });

    const stopsRaw = set.map((b) => {
      const idx = byBuilding.get(b) ?? [];
      const as = idx.map((x) => assignments[x]!);
      const shopIds = [...new Set(as.map((a) => a.shopId))].sort(cmpStr);
      const shops: StopShop[] = shopIds.map((id) => ({ shop: shopsById.get(id)!, openStatus: statusOf(shopsById.get(id)!) }));
      const bld = buildings[b]!;
      return {
        buildingKey: bld.key,
        mallName: bld.mallName,
        lat: bld.lat,
        lon: bld.lon,
        shops,
        itemIds: as.map((a) => a.itemId),
        subtotal: as.reduce((s, a) => s + a.lineTotal, 0),
      };
    });
    const stops = orderStops(stopsRaw);
    const total = assignments.reduce((s, a) => s + a.lineTotal, 0);
    const spread = spreadM(stops);
    const shopSet = new Set(assignments.map((a) => a.shopId));
    const plan: Plan = {
      id: `plan:${[...set].map((b) => buildings[b]!.key).sort(cmpStr).join('|')}`,
      stops,
      assignments,
      totals: makeTotals(total, baseCoverage(assignments.length, assignments), items.length),
      stopCount: stops.length,
      spreadM: spread,
      tags: [],
      isDefault: false,
      reasons: [],
    };
    if (shopSet.size === 1) plan.singleShopId = [...shopSet][0]!;
    return plan;
  });

  // ---- default, tags, deltas, reasons ---------------------------------------------------------------
  const complete = plans[0]!.totals.coverage.complete;
  const minCost = Math.min(...plans.map((p) => p.totals.total));
  const minStops = Math.min(...plans.map((p) => p.stopCount));
  const minSpread = Math.min(...plans.map((p) => p.spreadM));
  if (complete) {
    for (const p of plans) {
      const tags: PlanTag[] = [];
      if (p.totals.total === minCost) tags.push('cheapest');
      if (p.stopCount === minStops) tags.push('fewest_stops');
      if (Math.abs(p.spreadM - minSpread) < 1e-6) tags.push('most_compact');
      p.tags = tags;
    }
  }
  const pref = input.preference ?? 'cheapest';
  const byPref = [...plans].sort((a, b) => {
    if (pref === 'fewest_stops') return a.stopCount - b.stopCount || a.totals.total - b.totals.total;
    if (pref === 'compact') return a.spreadM - b.spreadM || a.totals.total - b.totals.total || a.stopCount - b.stopCount;
    return a.totals.total - b.totals.total || a.stopCount - b.stopCount;
  });
  const def = byPref[0]!;
  def.isDefault = true;

  const n = items.length;
  const covered = def.totals.coverage.coveredCount;
  if (!complete) {
    def.reasons.push(reason('partial', { covered, total: n, stops: def.stopCount }, planCopy.partial(covered, n, def.stopCount)));
  } else if (pref === 'fewest_stops') {
    def.reasons.push(reason('default_fewest_stops', { items: n, stops: def.stopCount }, planCopy.defaultFewestStops(n, def.stopCount)));
  } else if (pref === 'compact') {
    def.reasons.push(reason('default_compact', { items: n, spreadM: Math.round(def.spreadM) }, planCopy.defaultCompact(n, def.spreadM)));
  } else {
    def.reasons.push(reason('default_cheapest', { items: n, stops: def.stopCount }, planCopy.defaultCheapest(n, def.stopCount)));
  }
  for (const p of plans) {
    if (p.stopCount > 1 && p.spreadM > 0)
      p.reasons.push(reason('spread', { spreadM: Math.round(p.spreadM) }, planCopy.spread(p.spreadM)));
    if (p.singleShopId) {
      const name = shopsById.get(p.singleShopId)?.name ?? '';
      p.reasons.push(reason('single_shop', { shopId: p.singleShopId }, planCopy.singleShop(name)));
    }
    if (p !== def) {
      const cost = p.totals.total - def.totals.total;
      const stopsD = p.stopCount - def.stopCount;
      const text = planCopy.delta(cost, stopsD);
      p.delta = { cost, stops: stopsD, spreadM: p.spreadM - def.spreadM, text };
      p.reasons.unshift(reason('delta', { cost, stops: stopsD }, text));
    }
  }
  if (plans.length === 1) {
    const single = plannable.findIndex((_, i) => (target & (1 << i)) !== 0 && buildings.filter((b) => b.avail & (1 << i)).length === 1);
    if (single >= 0) {
      const label = plannable[single]!.item.label;
      notes.push(reason('only_one_single_source', { itemId: plannable[single]!.item.itemId }, planCopy.onlyOneBecauseSingleSource(label)));
    } else {
      notes.push(reason('only_one', {}, planCopy.onlyOne()));
    }
  }

  // default first, then the rest by stop count
  const ordered = [def, ...plans.filter((p) => p !== def).sort((a, b) => a.stopCount - b.stopCount)];
  return {
    plans: ordered,
    defaultPlanId: def.id,
    coverage: def.totals.coverage,
    closedShopIds,
    orderNote,
    notes,
    diagnostics: { buildings: N, plannableItems: m, tieEnumerationTruncated: truncated, tiedSetsInspected: inspected },
  };
}

function makeTotals(total: number, coverage: Coverage, n: number): Plan['totals'] {
  const line = coverage.complete ? planCopy.totalComplete(n, total) : planCopy.totalPartial(coverage.coveredCount, n, total);
  const t: Plan['totals'] = { total, coverage, line };
  // one group per reason: «پیدا نشد: …» · «منتظر انتخاب: …» · «قیمت ثبت نشده: …»
  if (coverage.missingItems.length) t.missingLine = planCopy.missingLines(coverage.missingItems);
  if (coverage.usesSuggestions) t.suggestionNote = SUGGESTION_NOTE;
  return t;
}

type RawStop = Omit<Stop, 'order' | 'distanceToNextM'>;

/** Nearest neighbour from the densest stop (min sum of distances to the others). Unknown coordinates go last. */
export function orderStops(raw: readonly RawStop[]): Stop[] {
  const known = raw.filter((s) => hasCoords(s));
  const unknown = raw.filter((s) => !hasCoords(s)).sort((a, b) => cmpStr(a.buildingKey, b.buildingKey));
  const d = (a: RawStop, b: RawStop) => haversineM(a as { lat: number; lon: number }, b as { lat: number; lon: number });
  const out: RawStop[] = [];
  if (known.length) {
    const sums = known.map((s) => known.reduce((acc, o) => acc + (o === s ? 0 : d(s, o)), 0));
    let start = 0;
    for (let i = 1; i < known.length; i++) {
      const a = known[i]!;
      const b = known[start]!;
      if (
        sums[i]! < sums[start]! - 1e-6 ||
        (Math.abs(sums[i]! - sums[start]!) <= 1e-6 &&
          (a.itemIds.length > b.itemIds.length || (a.itemIds.length === b.itemIds.length && cmpStr(a.buildingKey, b.buildingKey) < 0)))
      )
        start = i;
    }
    const left = new Set(known.map((_, i) => i));
    let cur = start;
    left.delete(cur);
    out.push(known[cur]!);
    while (left.size) {
      let best = -1;
      let bd = Infinity;
      for (const i of left) {
        const dist = d(known[cur]!, known[i]!);
        if (dist < bd - 1e-6 || (Math.abs(dist - bd) <= 1e-6 && cmpStr(known[i]!.buildingKey, known[best]!.buildingKey) < 0)) {
          best = i;
          bd = dist;
        }
      }
      left.delete(best);
      out.push(known[best]!);
      cur = best;
    }
  }
  out.push(...unknown);
  return out.map((s, i) => {
    const nxt = out[i + 1];
    const dist = nxt && hasCoords(s) && hasCoords(nxt) ? d(s, nxt) : null;
    return { ...s, order: i + 1, distanceToNextM: dist };
  });
}

/** Persian line for the distance to the next stop. */
export function stopDistanceText(stop: Stop): string | null {
  return stop.distanceToNextM === null ? null : distanceToNextText(stop.distanceToNextM);
}
