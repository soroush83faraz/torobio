/**
 * Places adapter («کجا بروم»): the planned state -> buildings ranked for the whole list -> PlacesResponse.
 *
 * Nothing about prices or eligibility is decided here. The state is first read with the default rule
 * (`placesState`: every item settled, as «کافیه، پیشنهاد بده» does), so an item still waiting on a question is
 * evaluated with the engine's default pick (cheapest eligible) and the map is useful before every question is
 * answered; the plan's compatibility guard runs on those picks as usual. The per-item offers are then the planner's
 * (planInputs: the pick rule, budget, sale-unit quantity, seller exclusions and pins), and the offer gate (priced, not
 * excluded, not closed at the visit time) and the per-building cheapest line are core's (rankPlaces): the same rules
 * the planner applies to a stop. The guard's rule also holds inside each building: the lines bought there together
 * never hold a conflict caused by an automatic pick (an NVR is never counted next to analog cameras).
 */
import {
  Api,
  autoConflicts,
  conflictCulprit,
  evaluateCompat,
  isAutoPick,
  placesCopy,
  rankPlaces,
  type ChosenItem,
  type PlaceBuilding,
  type Shop,
} from '@app/core';
import { imageOf, leastOpen, openOf, planInputs, shopPlace, type PlannedState } from './engine.js';

/** Buildings returned, best first. */
export const MAX_PLACES = 8;

/**
 * The state as the default rule reads it: every item settled («کافیه، پیشنهاد بده»). Questions stop and each item
 * takes its visible pick rule; only a mandatory question (a wire's sale unit: roll and metre prices never mix) still
 * holds its item back. Items that are already resolved do not change.
 */
export function placesState(state: Api.RequirementState): Api.RequirementState {
  return { ...state, settled: { ...state.settled, ...Object.fromEntries(state.requirements.map((r) => [r.id, true])) } };
}

/** `ps` is planState(catalog, placesState(state), now); `state` the same settled state. */
export function placesResponse(ps: PlannedState, state: Api.RequirementState): Api.PlacesResponse {
  const { rs, ctx } = ps;
  const { inputs } = planInputs(rs, state, { uncapped: true });
  const shops = [...new Set(inputs.flatMap((i) => i.offers.map((o) => o.shopId)))]
    .map((id) => ps.shops.get(id))
    .filter((s): s is Shop => !!s);
  const input = { items: inputs, shops, exclusions: { shopIds: state.excludedShops['*'] ?? [] } };
  const riById = new Map(rs.items.map((ri) => [ri.item.id, ri]));
  // the plan guard's rule, per building: what is bought there together never holds a conflict caused by an
  // automatic pick (e.g. an NVR next to analog cameras); a conflict between the user's own choices stands
  const resById = new Map(rs.items.map((ri) => [ri.item.id, ri.result.resolution]));
  const isAuto = (itemId: string) => isAutoPick(resById.get(itemId));
  const conflictOf = (picks: ReadonlyArray<{ itemId: string; productId: number }>): string | undefined => {
    const chosen: ChosenItem[] = rs.list.items.map((item) => {
      const p = picks.find((x) => x.itemId === item.id);
      const cand = p ? riById.get(item.id)?.byId.get(p.productId) : undefined;
      return cand ? { item, productId: cand.product.id, attrs: cand.attrs } : { item, attrs: null };
    });
    const f = autoConflicts(evaluateCompat(chosen), chosen, isAuto)[0];
    return f ? conflictCulprit(f, chosen, isAuto) : undefined;
  };
  const ranked = rankPlaces(ctx.visit ? { ...input, visit: ctx.visit } : input, { conflictOf });
  const total = ranked.coverableIds.length;

  const mallDto = (b: PlaceBuilding & { lat: number; lon: number }): Api.PlaceMall => {
    const shopOf = (id: string) => ps.shops.get(id)!;
    const items: Api.PlaceItemLine[] = ranked.coverableIds.map((itemId) => {
      const ri = riById.get(itemId)!;
      const l = b.lines.find((x) => x.itemId === itemId);
      if (!l) return { itemId, itemName: ri.dto.text, covered: false };
      const cand = ri.byId.get(l.productId);
      const shop = shopOf(l.shopId);
      const line: Api.PlaceItemLine = {
        itemId,
        itemName: ri.dto.text,
        covered: true,
        productName: cand?.product.title ?? '',
        unitPrice: l.unitPrice,
        qty: l.qty,
        shopName: shop.name,
        shopId: shop.id,
        shopsWithItem: l.shopIds.length,
      };
      const { floor, unit } = shopPlace(shop);
      if (floor) line.floor = floor;
      if (unit) line.unit = unit;
      const img = imageOf(cand);
      if (img) line.imageUrl = img;
      return line;
    });
    // the shops the user would buy at (each covered item's cheapest seller), in item order
    const pickShops = [...new Set(b.lines.map((l) => l.shopId))].map(shopOf);
    const first = pickShops[0]!;
    // hours of the first pick shop whose hours are known (a shop without hours says nothing about the building)
    const timed = pickShops.find((s) => s.hours) ?? first;
    const floors: string[] = [];
    for (const id of b.shopIds) {
      const f = shopPlace(shopOf(id)).floor;
      if (f && !floors.includes(f)) floors.push(f);
    }
    const out: Api.PlaceMall = {
      id: b.buildingKey,
      name: b.mallName ?? first.name,
      lat: b.lat,
      lon: b.lon,
      floors,
      shopCount: b.shopIds.length,
      covered: b.covered,
      total,
      totalToman: b.covered > 0 ? b.total : null,
      open: leastOpen(pickShops.map((s) => openOf(s, ctx.displayVisit))),
      hoursText: Api.apiCopy.hoursText(timed.hours, ctx.displayDay, ctx.dayLabel),
      badges: [],
      items,
    };
    if (first.areaLabel) out.areaLabel = first.areaLabel;
    return out;
  };

  // a map needs coordinates: buildings without any are left out (every shop of the 2026-10 snapshot has them)
  const malls = ranked.buildings
    .filter((b): b is PlaceBuilding & { lat: number; lon: number } => b.lat !== null && b.lon !== null)
    .slice(0, MAX_PLACES)
    .map(mallDto);

  // ---- badges ----
  const maxCovered = malls[0]?.covered ?? 0;
  const cheapest = malls
    .filter((m) => m.covered === maxCovered && maxCovered > 0 && m.totalToman !== null)
    .reduce<Api.PlaceMall | undefined>((best, m) => (!best || m.totalToman! < best.totalToman! ? m : best), undefined);
  const choiceOf = (m: Api.PlaceMall) => m.items.reduce((s, i) => s + (i.shopsWithItem ?? 0), 0);
  const mostChoice = malls.reduce<Api.PlaceMall | undefined>((best, m) => (!best || choiceOf(m) > choiceOf(best) ? m : best), undefined);
  for (const m of malls) {
    if (total >= 2 && m.covered === total) m.badges.push('one_stop');
    if (m === cheapest) m.badges.push('cheapest');
    // «more choice» only when some item really has several sellers there
    if (m === mostChoice && choiceOf(m) > m.covered) m.badges.push('most_choice');
    if (m.open === 'open') m.badges.push('open_now');
  }

  // ---- recommendation ----
  const top = malls[0];
  const best = top && top.covered >= 2 ? top : null;
  let headline: string;
  if (!top || total === 0) headline = placesCopy.nothing();
  else if (best) headline = best.covered === total ? placesCopy.allIn(total, best.name, best.totalToman ?? 0) : placesCopy.mostIn(best.covered, total, best.name);
  else if (total === 1) headline = placesCopy.single(ranked.buildings.length, top.name);
  else headline = placesCopy.scattered();

  return { malls, bestId: best?.id ?? null, headline };
}
