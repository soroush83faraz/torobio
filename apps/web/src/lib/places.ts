/**
 * «کجا برم؟» helpers shared by the Workspace (fetching, the list teaser) and the pick action.
 */
import type { PlaceMall, PlacesResponse, RequirementState } from '../api/types';
import { formatCount } from './format';

/**
 * The state the map is asked about: the list itself, without the user's seller pins. A pin restricts an item to one
 * shop, so with pins every other mall would lose that item and the map could no longer compare malls; picking a
 * mall on the map is exactly what sets those pins.
 */
export function placesStateOf(state: RequirementState): RequirementState {
  return { ...state, shopPins: {} };
}

/** Stable cache key of a places request. */
export function placesKey(state: RequirementState): string {
  return JSON.stringify(placesStateOf(state));
}

/** itemId -> the shop of the mall's cheapest line, for every covered line that names its shop. */
export function mallPins(mall: PlaceMall): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of mall.items) if (it.covered && it.shopId) out[it.itemId] = it.shopId;
  return out;
}

/**
 * Picking a mall: every covered item is pinned to its shop there. The map ranks malls with every item settled (the
 * engine's default pick for an unanswered question), so an item still waiting on a question is settled too; without
 * that the plan would leave it out and the mall would not be the plan. Mutates `p` (store `patch`).
 */
export function applyMallPick(p: Pick<RequirementState, 'shopPins' | 'settled'>, mall: PlaceMall): number {
  const pins = mallPins(mall);
  for (const [itemId, shopId] of Object.entries(pins)) {
    p.shopPins[itemId] = shopId;
    p.settled[itemId] = true;
  }
  return Object.keys(pins).length;
}

const BUILDING_WORD = /^(پاساژ|مجتمع|بازار|مرکز|سرای|سرا|تیمچه|برج|ساختمان|خیابان|کوچه|میدان|بازارچه)\s/;

/** «پاساژ علاءالدین» stays as is; a bare name gets «پاساژ» in front so the sentence reads. */
export function buildingName(name: string): string {
  const n = name.trim();
  return BUILDING_WORD.test(n) ? n : `پاساژ ${n}`;
}

/** The recommended mall, when the server named one. */
export function bestMall(places: PlacesResponse | null | undefined): PlaceMall | null {
  if (!places?.bestId) return null;
  return places.malls.find((m) => m.id === places.bestId) ?? null;
}

/** The list teaser's line: «همهٔ ۴ مورد یک‌جا پیدا می‌شود» / «۳ از ۴ مورد یک‌جا پیدا می‌شود». */
export function teaserLine(m: PlaceMall): string {
  if (m.covered >= m.total) return m.total === 2 ? 'هر دو مورد یک‌جا پیدا می‌شود' : `همهٔ ${formatCount(m.total)} مورد یک‌جا پیدا می‌شود`;
  return `${formatCount(m.covered)} از ${formatCount(m.total)} مورد یک‌جا پیدا می‌شود`;
}
