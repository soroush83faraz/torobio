/**
 * Offer-level listing condition (D1).
 *
 * A product title can say nothing while one seller's own listing title says «… های کپی» or «استوک». The condition
 * rule (evaluate.ts conditionIssueFor) is therefore applied to every OFFER, on the union of the product's flags and
 * the offer's own flags, before anything reads prices:
 *
 * - offers whose condition the requirement does not accept are moved out of `offers` into
 *   `conditionExcludedOffers`: they are never the cheapest price, never counted as a seller, never in a price range,
 *   budget quantile or plan stop; they stay listed (flagged, with the reason) in the options sellers list;
 * - when EVERY offer is set aside, the product itself carries the offers' flags (`listing.fromOffers`), so it is
 *   evaluated as a flagged listing («جایگزین» with the reason, never auto-picked) and keeps its offers for display;
 * - a product the user pinned is taken as is: its accepted offers are used when there are any, otherwise all of
 *   its offers (flags shown).
 *
 * Pure; returns new candidate objects (callers may hold shared, cached candidates).
 */
import type { Candidate, ConditionMode, ListingFlags, Offer, Requirement } from '../types/index';
import { conditionIssueFor } from './evaluate';

const hasFlag = (f: ListingFlags | undefined): boolean => !!f && (f.condition !== undefined || f.replica === true);

/** Union of listing flags (refurbished wins over used; evidence kept in order, without repeats). */
export function mergeListingFlags(...all: ReadonlyArray<ListingFlags | undefined>): ListingFlags {
  const out: ListingFlags = {};
  const evidence: string[] = [];
  for (const f of all) {
    if (!f) continue;
    if (f.condition === 'refurbished' || (f.condition === 'used' && out.condition === undefined)) out.condition = f.condition;
    if (f.replica) out.replica = true;
    for (const e of f.evidence ?? []) if (!evidence.includes(e)) evidence.push(e);
  }
  if (evidence.length) out.evidence = evidence;
  return out;
}

/**
 * The offer's own flags that the product TITLE does not already state (`titleFlags`: the product's title-read
 * flags, not a view's merged `listing`). Undefined = the seller states nothing beyond the title.
 */
export function offerOwnFlags(titleFlags: ListingFlags | undefined, offer: Offer): ListingFlags | undefined {
  const f = offer.listing;
  if (!hasFlag(f)) return undefined;
  const out: ListingFlags = {};
  if (f!.condition && f!.condition !== titleFlags?.condition) out.condition = f!.condition;
  if (f!.replica && !titleFlags?.replica) out.replica = true;
  if (!hasFlag(out)) return undefined;
  if (f!.evidence?.length) out.evidence = [...f!.evidence];
  return out;
}

/** Whether one offer's condition (product flags ∪ its own) is accepted by the requirement. */
export function offerAccepted(mode: ConditionMode, cand: Candidate, offer: Offer): boolean {
  return conditionIssueFor(mode, offer.listing ? mergeListingFlags(cand.listing, offer.listing) : cand.listing) === undefined;
}

/** One candidate as seen by one requirement (see the module comment). Returns `cand` itself when nothing changes. */
export function withOfferConditions<C extends Candidate>(item: Requirement, cand: C): C {
  if (cand.offers.length === 0) return cand;
  const mode: ConditionMode = item.condition ?? 'new';
  const accepted: Offer[] = [];
  const excluded: Offer[] = [];
  for (const o of cand.offers) (offerAccepted(mode, cand, o) ? accepted : excluded).push(o);
  // the user asked for used / copy listings: the product is evaluated as what its accepted sellers sell
  // (in 'new' / 'any' the accepted offers carry no flag that matters)
  const positive = mode === 'used' || mode === 'replica';
  if (excluded.length === 0 && !(positive && accepted.some((o) => hasFlag(o.listing)))) return cand;
  if (accepted.length > 0) {
    const view: C = excluded.length ? { ...cand, offers: accepted, conditionExcludedOffers: excluded } : { ...cand };
    if (positive) {
      const listing = sellerListing(cand, accepted);
      if (listing) view.listing = listing;
    }
    return view;
  }
  // every offer is set aside: the product reads as flagged by its sellers (its own title flags stay first)
  const listing = sellerListing(cand, cand.offers);
  return listing ? { ...cand, listing } : cand; // none stated anything (e.g. 'replica' mode, unflagged product)
}

/** The product's flags united with what the given sellers' own titles state; undefined when they state nothing. */
function sellerListing(cand: Candidate, offers: readonly Offer[]): ListingFlags | undefined {
  const own = offers.filter((o) => hasFlag(o.listing)).map((o) => o.listing);
  if (own.length === 0) return undefined;
  const merged = mergeListingFlags(cand.listing, ...own);
  return hasFlag(cand.listing) ? merged : { ...merged, fromOffers: true };
}

/** Every candidate of one requirement through `withOfferConditions`. */
export function withOfferConditionsAll<C extends Candidate>(item: Requirement, cands: readonly C[]): C[] {
  return cands.map((c) => withOfferConditions(item, c));
}
