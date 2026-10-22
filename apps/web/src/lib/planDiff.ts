import type { PlanResponse, StopLine } from '../api/types';
import { shopsOf } from './stops';

export type ChangeKind = 'replaced' | 'repriced' | 'dropped' | 'added';

export interface LineChange {
  itemId: string;
  kind: ChangeKind;
  /** Product name of the row (before for dropped, after otherwise). */
  name: string;
  fromShop?: string;
  toShop?: string;
  fromPrice?: number | null;
  toPrice?: number | null;
}

interface Row {
  line: StopLine;
  shopName: string;
}

function rows(plan: PlanResponse): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const s of plan.stops) for (const shop of shopsOf(s)) for (const line of shop.lines) m.set(line.itemId, { line, shopName: shop.shopName });
  return m;
}

/**
 * Which rows of the plan changed between two plan responses (by item): moved to another shop / model,
 * re-priced at the same place, newly covered, or no longer covered. Pure; drives the highlighted diff.
 */
export function diffPlans(prev: PlanResponse, next: PlanResponse): LineChange[] {
  const a = rows(prev);
  const b = rows(next);
  const out: LineChange[] = [];
  for (const [itemId, was] of a) {
    const now = b.get(itemId);
    if (!now) {
      out.push({ itemId, kind: 'dropped', name: was.line.productName, fromShop: was.shopName, fromPrice: was.line.unitPrice });
    } else if (now.line.shopId !== was.line.shopId || (now.line.productId ?? '') !== (was.line.productId ?? '')) {
      out.push({
        itemId,
        kind: 'replaced',
        name: now.line.productName,
        fromShop: was.shopName,
        toShop: now.shopName,
        fromPrice: was.line.unitPrice,
        toPrice: now.line.unitPrice,
      });
    } else if (now.line.unitPrice !== was.line.unitPrice || now.line.qty !== was.line.qty) {
      out.push({
        itemId,
        kind: 'repriced',
        name: now.line.productName,
        toShop: now.shopName,
        fromPrice: was.line.unitPrice,
        toPrice: now.line.unitPrice,
      });
    }
  }
  for (const [itemId, now] of b) {
    if (!a.has(itemId)) out.push({ itemId, kind: 'added', name: now.line.productName, toShop: now.shopName, toPrice: now.line.unitPrice });
  }
  return out;
}
