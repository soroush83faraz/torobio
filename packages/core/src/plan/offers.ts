import type { ChosenItem } from '../compat/rules';
import { isPricedOffer, priceWithinBudget } from '../requirement/evaluate';
import type { Candidate, ItemResolution, Plan, PlanItemInput, PlanOffer, Requirement } from '../types/index';

/**
 * Planner input from resolved items.
 * - exact_model / alternative (with a pick) / price_unknown → offers of the chosen product;
 * - suggested → priced offers of EVERY eligible product, inside the budget when one is set
 *   (the planner takes the cheapest eligible offer per stop, B3.5);
 * - needs_info / not_found / alternative without a pick → no offers (never planned).
 */
export function buildPlanItems(
  items: readonly Requirement[],
  resolutions: readonly ItemResolution[],
  candidatesByItem: Readonly<Record<string, readonly Candidate[]>>,
): PlanItemInput[] {
  const resById = new Map(resolutions.map((r) => [r.itemId, r]));
  return items.map((item) => {
    const res = resById.get(item.id);
    const cands = candidatesByItem[item.id] ?? [];
    const byId = new Map(cands.map((c) => [c.product.id, c]));
    const out: PlanItemInput = { itemId: item.id, label: item.text, qty: item.qty, state: res?.state ?? 'not_found', offers: [] };
    if (!res) return out;
    if (res.rule) out.rule = res.rule;
    if (res.chosenProductId !== undefined) out.chosenProductId = res.chosenProductId;
    const toPlan = (c: Candidate | undefined, filter: (p: number) => boolean, keepUnpriced: boolean): PlanOffer[] =>
      (c?.offers ?? [])
        .filter((o) => (isPricedOffer(o) ? filter(o.price) : keepUnpriced))
        .map((o) => ({ offerId: o.id, productId: o.productId, shopId: o.shopId, price: isPricedOffer(o) ? o.price : null }));
    switch (res.state) {
      case 'exact_model':
      case 'alternative':
      case 'price_unknown':
        if (res.chosenProductId !== undefined) out.offers = toPlan(byId.get(res.chosenProductId), () => true, true);
        break;
      case 'suggested':
        out.offers = res.eligibleIds.flatMap((id) => toPlan(byId.get(id), (p) => priceWithinBudget(p, item.budget), false));
        break;
      default:
        break;
    }
    return out;
  });
}

/**
 * Chosen products for compatibility evaluation: the plan's assignment per item, otherwise the item card's pick.
 */
export function chosenItemsForCompat(
  items: readonly Requirement[],
  resolutions: readonly ItemResolution[],
  candidatesByItem: Readonly<Record<string, readonly Candidate[]>>,
  plan?: Plan | null,
): ChosenItem[] {
  const resById = new Map(resolutions.map((r) => [r.itemId, r]));
  return items.map((item) => {
    const assigned = plan?.assignments.find((a) => a.itemId === item.id)?.productId;
    const res = resById.get(item.id);
    const pid = assigned ?? (res && res.state !== 'needs_info' ? res.chosenProductId : undefined);
    const cand = pid === undefined ? undefined : (candidatesByItem[item.id] ?? []).find((c) => c.product.id === pid);
    const ci: ChosenItem = { item, attrs: cand ? cand.attrs : null };
    if (cand) ci.productId = cand.product.id;
    return ci;
  });
}
