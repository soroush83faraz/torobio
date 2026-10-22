/**
 * SQLite rows (DATA_SCHEMA.md) -> engine Candidate / Offer / Shop.
 * Pure functions; the SQL lives in retrieval/catalog.ts.
 */
import type { Candidate, Offer, Shop, Weekday, WeeklyHours } from '@app/core';
import { WEEKDAYS, extractListingFlags, prepTitle, screenInchOf } from '@app/core';
import { mapAttrs, parseAttrsJson, type ListingFlags } from './mapping.js';

export interface ProductRow {
  id: number;
  title: string;
  category_id: number | null;
  brand: string | null;
  image_url: string | null;
  attrs: string | null;
  model_codes: string | null;
  min_price: number | null;
  offer_count: number;
  seller_count: number;
  domain: string | null;
}

export interface OfferRow {
  id: number;
  product_id: number;
  shop_id: string;
  price: number | null;
  price_flag: string | null;
  seller_title: string | null;
  warranty_code: string | null;
  warranty_months: number | null;
  changed_at: string | null;
}

export interface ShopRow {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  area_label: string | null;
  address: string | null;
  mall_key: string | null;
  mall_name: string | null;
  floor: string | null;
  unit: string | null;
  building_key: string;
  hours: string | null;
}

/** Candidate plus display-only data the API needs (never evaluated by the engine). */
export interface MarketCandidate extends Candidate {
  /** Persian display brand (products.brand). */
  brandDisplay: string | null;
  specAttrs: Candidate['attrs'];
  flags: ListingFlags;
  domain: string | null;
}

function parseCodes(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const PRICE_FLAGS = new Set(['missing', 'placeholder', 'outlier']);

export function toOffer(r: OfferRow): Offer {
  const o: Offer = {
    id: String(r.id),
    productId: r.product_id,
    shopId: r.shop_id,
    // price_clean is NULL for missing / placeholder / outlier prices: never 0
    price: typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 ? r.price : null,
    sellerTitle: r.seller_title,
    warrantyCode: r.warranty_code,
    warrantyMonths: r.warranty_months,
    changedAt: r.changed_at,
  };
  if (r.price_flag && PRICE_FLAGS.has(r.price_flag)) o.priceFlag = r.price_flag as Offer['priceFlag'];
  return o;
}

/**
 * Listing condition flags: the build-time extractor values (products.attrs) united with the same core detector
 * run on the title now, so detector improvements apply without a data rebuild. Both read the title only and
 * only ever ADD a flag (a flag keeps a listing out of the automatic pick; it never makes one eligible).
 */
export function listingFlags(stored: ListingFlags, title: string, domain: string | null): ListingFlags {
  const now = extractListingFlags(prepTitle(title), domain);
  const out: ListingFlags = {};
  const condition = stored.condition === 'refurbished' || now.condition === 'refurbished' ? 'refurbished' : (stored.condition ?? now.condition);
  if (condition) out.condition = condition;
  if (stored.replica || now.replica) out.replica = true;
  return out;
}

export function toCandidate(p: ProductRow, offers: Offer[]): MarketCandidate {
  const raw = parseAttrsJson(p.attrs);
  const mapped = mapAttrs(p.domain, raw);
  const { attrs, specAttrs } = mapped;
  const flags = listingFlags(mapped.flags, p.title, p.domain);
  // screen size is read from the title at query time for every category (no extraction domain covers TVs / monitors)
  if (attrs.screen_inch === undefined) {
    const inch = screenInchOf(prepTitle(p.title));
    if (inch !== null) attrs.screen_inch = inch;
  }
  return {
    listing: flags,
    product: {
      id: p.id,
      title: p.title,
      categoryId: p.category_id ?? -1,
      brand: p.brand,
      modelCodes: parseCodes(p.model_codes),
      imageUrl: p.image_url,
      sellerCount: p.seller_count,
    },
    attrs,
    offers,
    brandDisplay: p.brand,
    specAttrs,
    flags,
    domain: p.domain,
  };
}

const isRoundTheClock = (shifts: ReadonlyArray<readonly [number, number]> | undefined): boolean =>
  !!shifts && shifts.length === 1 && shifts[0]![0] === 0 && shifts[0]![1] === 1440;

/**
 * A Friday of exactly 00:00-23:59 on a shop whose every other open day is a normal schedule is the profile's
 * placeholder, not a fact (64 such shops in the 2026-10 snapshot; see scripts/data/src/clean/hours.ts and
 * docs/DATA_SCHEMA.md). Same rule as the data build, applied again here so older builds read the same way.
 */
function dropPlaceholderFriday(h: Partial<Record<Weekday, [number, number][]>>): boolean {
  if (!isRoundTheClock(h.fri)) return false;
  const others = WEEKDAYS.filter((d) => d !== 'fri').flatMap((d) => (h[d] && h[d]!.length > 0 ? [h[d]!] : []));
  if (others.length === 0 || others.some(isRoundTheClock)) return false;
  delete h.fri;
  return true;
}

/** DATA_SCHEMA hours JSON -> WeeklyHours; anything malformed counts as unknown (never as closed). */
export function parseHours(json: string | null): WeeklyHours | null {
  if (!json) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Partial<Record<Weekday, [number, number][]>> = {};
  let any = false;
  for (const d of WEEKDAYS) {
    const day = (v as Record<string, unknown>)[d];
    if (!Array.isArray(day)) continue;
    const shifts = day.filter(
      (s): s is [number, number] => Array.isArray(s) && s.length === 2 && s.every((x) => typeof x === 'number' && Number.isFinite(x)),
    );
    if (shifts.length !== day.length) continue; // malformed day = unknown
    out[d] = shifts.map(([a, b]) => [a, b]);
    any = true;
  }
  if (dropPlaceholderFriday(out)) any = Object.keys(out).length > 0;
  return any ? out : null;
}

export function toShop(r: ShopRow): Shop {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    buildingKey: r.building_key,
    mallKey: r.mall_key,
    mallName: r.mall_name,
    floor: r.floor,
    unit: r.unit,
    address: r.address,
    areaLabel: r.area_label,
    hours: parseHours(r.hours),
  };
}
