/**
 * "Facts" of one assist call: the CURRENT plan and items, recomputed server-side from the requirement state the
 * client sent (the client never supplies plan ids: every id an action may use is validated against these facts).
 *
 * This is the only assist module that touches the decision engine (adapter / retrieval); the rest of the assistant
 * works on these plain facts, so it is unit-testable with hand-made facts and unaffected by engine internals.
 */
import type { Api } from '@app/core';
import { planResponse, planState } from '../adapter/engine.js';
import type { Db } from '../db.js';
import { catalogFor, type Catalog } from '../retrieval/catalog.js';
import { retrieve } from '../retrieval/retrieve.js';
import { brandLabel, currentBrand, isParserItem, parserNarrowTerms, statedAttrs, stripBrandMentions, type StatedAttr } from './state.js';

export interface BrandFacet {
  /** brand_key (what the engine matches on). */
  key: string;
  label: string;
  /** Candidates of the item with this brand. */
  count: number;
}

export interface FactItem {
  id: string;
  text: string;
  qty: number;
  kind?: string;
  /** Category name of a chip-form item (parser items have none). */
  categoryLabel?: string;
  state?: Api.ItemState;
  /** Brand key the user stated (chip or answer). */
  brand?: string;
  stated: StatedAttr[];
}

export interface FactStop {
  shopId: string;
  shopName: string;
  buildingKey: string | null;
  /** The building key when the stop is in a mall («m:…»); street shops have none. */
  mallKey: string | null;
  mallName: string | null;
  itemIds: string[];
}

export interface AssistFacts {
  items: FactItem[];
  /** One entry per shop of the selected plan. */
  stops: FactStop[];
  stopCount: number;
  totalToman: number;
  covered: number;
  total: number;
  complete: boolean;
  /** Engine reason sentence of the selected plan (templated, numbers from data). */
  reason: string;
  totalLine?: string;
  activeVariant: string | null;
  visitActive: boolean;
  /** Non-dominated alternatives, deltas relative to the selected plan. */
  alternatives: { id: string; deltaToman: number; deltaStops: number }[];
  /** Every shop of a building among the offers the planner may use: what excluding that mall means. */
  shopsInBuilding(buildingKey: string): string[];
  /** Brands an item could be switched to: real facets of its candidates (its own brand words ignored). */
  brandsFor(itemId: string): BrandFacet[];
}

export type FactsProvider = (state: Api.RequirementState) => AssistFacts;

const MAX_FACETS = 40;

function wireCategoryIds(req: Api.Requirement): number[] {
  if (req.categoryIds && req.categoryIds.length) return req.categoryIds;
  return req.categoryId && /^\d{1,9}$/.test(req.categoryId) ? [Number(req.categoryId)] : [];
}

/**
 * Brand facets of an item's candidate pool, retrieved WITHOUT its brand constraint and brand words. The retrieval
 * input mirrors what the plan does for the item's shape: a parser item is narrowed only by its unparsed fragments,
 * a chip-form item by the words of its text that no chip covers.
 */
export function brandFacets(catalog: Catalog, req: Api.Requirement, state: Api.RequirementState): BrandFacet[] {
  const stated = currentBrand(req, state);
  const text = stated ? stripBrandMentions(stripBrandMentions(req.text), stated) : stripBrandMentions(req.text);
  const chips = req.chips.filter((c) => c.constraint?.attr !== 'brand');
  const r = retrieve(catalog, {
    text,
    categoryIds: wireCategoryIds(req),
    coveredTexts: [...chips.map((c) => c.label), req.unit ?? '', req.categoryLabel],
    qty: req.qty,
    ...(isParserItem(req) ? { narrowTerms: parserNarrowTerms(req) } : {}),
  });
  const counts = new Map<string, { n: number; display: Map<string, number> }>();
  for (const c of r.candidates) {
    const key = c.attrs.brand;
    if (typeof key !== 'string' || key === '') continue;
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { n: 0, display: new Map() }));
    e.n += 1;
    if (c.brandDisplay) e.display.set(c.brandDisplay, (e.display.get(c.brandDisplay) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, e]) => {
      const lexicon = brandLabel(key);
      const common = [...e.display.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
      return { key, label: lexicon !== key ? lexicon : (common ?? lexicon), count: e.n };
    })
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, MAX_FACETS);
}

/** Facts from the real catalog (market.sqlite). Throws DbUnavailableError when the database is missing. */
export function dbFactsProvider(db: Db, now: () => Date): FactsProvider {
  return (state) => {
    const catalog = catalogFor(db);
    const ps = planState(catalog, state, now());
    const plan = planResponse(ps, state, catalog);
    const shops = catalog.shops();

    const byBuilding = new Map<string, Set<string>>();
    for (const ri of ps.rs.items) {
      for (const c of ri.cands) {
        for (const o of c.offers) {
          const bk = shops.get(o.shopId)?.buildingKey;
          if (!bk) continue;
          let set = byBuilding.get(bk);
          if (!set) byBuilding.set(bk, (set = new Set()));
          set.add(o.shopId);
        }
      }
    }

    const resolution = new Map((plan.items ?? []).map((i) => [i.itemId, i]));
    const items: FactItem[] = state.requirements.map((r) => {
      const res = resolution.get(r.id);
      const brand = currentBrand(r, state);
      const kind = res?.kind ?? r.kind;
      return {
        id: r.id,
        text: r.text,
        qty: r.qty,
        ...(kind ? { kind } : {}),
        ...(r.categoryLabel ? { categoryLabel: r.categoryLabel } : {}),
        ...(res ? { state: res.state } : {}),
        ...(brand ? { brand } : {}),
        stated: statedAttrs(r, state),
      };
    });

    // a plan stop is one building with one or more shops; a fact stop is one SHOP (the unit a user excludes)
    const stops: FactStop[] = [];
    for (const st of plan.stops) {
      const inStop = st.shops && st.shops.length ? st.shops : [{ shopId: st.shopId, shopName: st.shopName, mall: st.mall, lines: st.lines }];
      for (const sh of inStop) {
        const itemIds = [...new Set(sh.lines.map((l) => l.itemId))];
        const existing = stops.find((x) => x.shopId === sh.shopId);
        if (existing) {
          for (const id of itemIds) if (!existing.itemIds.includes(id)) existing.itemIds.push(id);
          continue;
        }
        const shop = shops.get(sh.shopId);
        const bk = st.buildingKey ?? shop?.buildingKey ?? null;
        stops.push({
          shopId: sh.shopId,
          shopName: sh.shopName,
          buildingKey: bk,
          mallKey: bk && bk.startsWith('m:') ? bk : null,
          mallName: shop?.mallName ?? (sh.mall || null),
          itemIds,
        });
      }
    }

    const memo = new Map<string, BrandFacet[]>();
    return {
      items,
      stops,
      stopCount: plan.stopCount,
      totalToman: plan.totalToman,
      covered: plan.coverage.covered,
      total: plan.coverage.total,
      complete: plan.complete,
      reason: plan.reason,
      ...(plan.totalLine ? { totalLine: plan.totalLine } : {}),
      activeVariant: plan.activeVariant,
      visitActive: plan.visitActive,
      alternatives: plan.alternatives.map((a) => ({ id: a.id, deltaToman: a.deltaToman, deltaStops: a.deltaStops })),
      shopsInBuilding: (bk) => [...(byBuilding.get(bk) ?? [])].sort(),
      brandsFor: (itemId) => {
        let f = memo.get(itemId);
        if (!f) {
          const req = state.requirements.find((r) => r.id === itemId);
          f = req ? brandFacets(catalog, req, state) : [];
          memo.set(itemId, f);
        }
        return f;
      },
    };
  };
}
