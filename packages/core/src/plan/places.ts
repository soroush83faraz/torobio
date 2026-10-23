/**
 * "Where should I go": every building scored on its own for the whole list (POST /api/places).
 *
 * Input is the planner's (PlanInput): the same per-item offers (the item's pick rule decided which products they
 * belong to, see buildPlanItems) and the same offer gate (priced, shop known, not excluded, not closed at the visit
 * time; shopGate). A building COVERS an item when at least one of its shops has a valid offer for it; its line is the
 * cheapest valid offer there (× qty), exactly the price the planner would use at that stop.
 *
 * Compatibility (optional `conflictOf`): the lines of ONE building are what the user would buy together, so the
 * caller's compat guard is asked about them; the item it names takes its next cheaper product in that building, and
 * is left uncovered there when none is left. Without `conflictOf` every line is the plain cheapest offer.
 *
 * Ranking: covered items (desc), then the sum of the covered lines (asc), then the relevant shops (desc: more
 * choice in the same building), then the building key. Items in state needs_info / not_found are never covered
 * (as in the planner); the caller decides which items reach this function in which state.
 */
import type { PlanInput, PlanOffer, Shop } from '../types/index';
import { hasCoords } from './geo';
import { isPlanPrice, shopGate } from './optimize';

export interface PlaceLine {
  itemId: string;
  /** The cheapest valid (and, with `conflictOf`, compatible) offer of the item in this building. */
  offerId: string;
  productId: number;
  shopId: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  /** Distinct shops of the building with a valid offer for the item (the cheapest one first). */
  shopIds: string[];
}

export interface PlaceBuilding {
  buildingKey: string;
  mallName: string | null;
  /** Mean of the relevant shops' coordinates; null when none has coordinates. */
  lat: number | null;
  lon: number | null;
  /** Shops of the building with a valid offer for at least one covered item, in item order then shop id. */
  shopIds: string[];
  /** One line per covered item, in input item order. */
  lines: PlaceLine[];
  covered: number;
  /** Sum of the covered lines (toman). */
  total: number;
}

export interface PlacesResult {
  /** Every building with at least one covered item, best first. */
  buildings: PlaceBuilding[];
  /** Items with a valid offer somewhere (what a building can cover at most), in input order. */
  coverableIds: string[];
}

export interface PlacesOptions {
  /**
   * Compat guard over one building's picks: the item whose product must change (an automatic pick in conflict with
   * another line), or undefined when the picks may stand together.
   */
  conflictOf?: (picks: ReadonlyArray<{ itemId: string; productId: number }>) => string | undefined;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type ValidOffer = PlanOffer & { price: number };

/** The planner's per-building best-offer order: price, then offer id, then shop id. */
const byPrice = (a: ValidOffer, b: ValidOffer) => a.price - b.price || cmpStr(a.offerId, b.offerId) || cmpStr(a.shopId, b.shopId);

export function rankPlaces(input: PlanInput, opts: PlacesOptions = {}): PlacesResult {
  const shopsById = new Map<string, Shop>();
  for (const s of input.shops) if (!shopsById.has(s.id)) shopsById.set(s.id, s);
  const { isExcluded, isClosed } = shopGate(input);

  // building -> item -> valid offers
  const byBuilding = new Map<string, { mallName: string | null; offers: Map<string, ValidOffer[]> }>();
  const coverable: string[] = [];
  for (const item of input.items) {
    if (item.state === 'needs_info' || item.state === 'not_found') continue;
    let any = false;
    for (const o of item.offers) {
      const shop = shopsById.get(o.shopId);
      if (!shop || !isPlanPrice(o.price) || isExcluded(shop) || isClosed(shop)) continue;
      any = true;
      let b = byBuilding.get(shop.buildingKey);
      if (!b) {
        b = { mallName: null, offers: new Map() };
        byBuilding.set(shop.buildingKey, b);
      }
      if (!b.mallName && shop.mallName) b.mallName = shop.mallName;
      const list = b.offers.get(item.itemId) ?? [];
      list.push({ ...o, price: o.price });
      b.offers.set(item.itemId, list);
    }
    if (any) coverable.push(item.itemId);
  }

  const qtyOf = new Map(input.items.map((it) => [it.itemId, it.qty]));
  const buildings: PlaceBuilding[] = [];
  for (const [key, b] of byBuilding) {
    // items in input order, each with its offers cheapest first
    const lists = input.items
      .filter((it) => b.offers.has(it.itemId))
      .map((it) => ({ itemId: it.itemId, offers: b.offers.get(it.itemId)!.sort(byPrice), rejected: new Set<number>() }));
    const pick = (l: (typeof lists)[number]) => l.offers.find((o) => !l.rejected.has(o.productId));
    // compat guard: the culprit takes its next cheaper product here; bounded by the number of products
    for (let guard = lists.reduce((n, l) => n + l.offers.length, 0); opts.conflictOf && guard > 0; guard--) {
      const picks = lists.flatMap((l) => {
        const o = pick(l);
        return o ? [{ itemId: l.itemId, productId: o.productId }] : [];
      });
      const culprit = opts.conflictOf(picks);
      const l = culprit === undefined ? undefined : lists.find((x) => x.itemId === culprit);
      const cur = l ? pick(l) : undefined;
      if (!l || !cur) break;
      l.rejected.add(cur.productId);
    }
    const lines: PlaceLine[] = [];
    for (const l of lists) {
      const o = pick(l);
      if (!o) continue;
      const qty = qtyOf.get(l.itemId)!;
      const others = [...new Set(l.offers.filter((x) => !l.rejected.has(x.productId)).map((x) => x.shopId))].filter((id) => id !== o.shopId).sort(cmpStr);
      lines.push({ itemId: l.itemId, offerId: o.offerId, productId: o.productId, shopId: o.shopId, unitPrice: o.price, qty, lineTotal: o.price * qty, shopIds: [o.shopId, ...others] });
    }
    if (!lines.length) continue;
    const shopIds: string[] = [];
    for (const l of lines) for (const id of l.shopIds) if (!shopIds.includes(id)) shopIds.push(id);
    const known = shopIds.map((id) => shopsById.get(id)!).filter(hasCoords);
    buildings.push({
      buildingKey: key,
      mallName: b.mallName,
      lat: known.length ? known.reduce((s, x) => s + x.lat!, 0) / known.length : null,
      lon: known.length ? known.reduce((s, x) => s + x.lon!, 0) / known.length : null,
      shopIds,
      lines,
      covered: lines.length,
      total: lines.reduce((s, l) => s + l.lineTotal, 0),
    });
  }
  buildings.sort((a, b) => b.covered - a.covered || a.total - b.total || b.shopIds.length - a.shopIds.length || cmpStr(a.buildingKey, b.buildingKey));
  return { buildings, coverableIds: coverable };
}
