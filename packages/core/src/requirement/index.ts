export {
  evaluateConstraint,
  evaluateCandidate,
  evaluateCandidates,
  compareEvals,
  conditionIssue,
  conditionIssueFor,
  deviceModelKey,
  deviceModelsMatch,
  isPricedOffer,
  minValidPrice,
  modelCodeMatches,
  normToken,
  priceWithinBudget,
} from './evaluate';
export { classifyItem, INCOMPLETE_SPECS_LABEL, saleUnitOpen } from './classify';
export { mergeListingFlags, offerAccepted, offerOwnFlags, withOfferConditions, withOfferConditionsAll } from './offers';
export { noMatchCauses, noMatchSummary } from './nomatch';
export type { NoMatchCause, NoMatchSummary } from './nomatch';
export { compatScope, resolveItem, resolveItems } from './resolve';
export type { ItemResult, ListResult } from './resolve';
export {
  buildHeadStats,
  headStatsBuilder,
  foldHead,
  BLANKED_HEAD,
  kindIssue,
  subkindGroups,
  subkindWords,
  titleHead,
  withKindIssues,
  withWireUnitCheck,
  MIN_UNIT_GROUP,
  NATIVE_HEAD_SHARE,
  ROLL_METRES,
  UNIT_TOLERANCE,
} from './plausibility';
export type { HeadStats, KindContext } from './plausibility';
