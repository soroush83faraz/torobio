/**
 * Category vote for one item: synonym table + FTS category frequency over the top ~200 hits.
 *
 * score(category) = syn > 0 ? 0.5*syn + 0.5*min(1, 1.5*share) : 0.9*share   (non-synonym categories are
 *                   discounted to 0.45*share when a strong synonym matched, and to 0.2x when incoherent)
 *   syn   = weight of the longest matching synonym term(s) pointing at the category (0..1)
 *   share = weighted fraction of the FTS hits (all categories in the denominator) in that category.
 *           Hits whose extracted attributes CONFLICT with the constraints stated for the winning domain count
 *           0.25 (second stage, "restricted by the stated constraints").
 *
 * The catalog is broad: any category with products can win (laptops, TVs, fridges...). Items outside the
 * extraction domains simply take the generic path later (no extractor, kind 'other'). "Not in catalog" is only
 * reported when no coherent category exists (see voteCategories).
 */
import type { Constraint } from '@app/core';
import type { Db } from '../db.js';
import { mapExtractedAttrs } from './attr-map.js';
import { matchSynonyms, type Lexicon } from './lexicon.js';
import type { CategoryCandidate } from './types.js';

const HIT_LIMIT = 200;
const HITS_SQL =
  'SELECT p.category_id AS cat, p.attrs AS attrs FROM products_fts f JOIN products p ON p.id = f.rowid WHERE products_fts MATCH ? ORDER BY bm25(products_fts) LIMIT 200';

interface Hit {
  cat: number;
  attrs: string | null;
  w: number;
}

export interface VoteInput {
  /** FTS content tokens (nouns, brands, model-ish tokens; numbers and unit words already removed). */
  tokens: string[];
  /** Normalised model-code keys (primary first), lower-cased for the FTS index. */
  codeKeys: string[];
  /** All tokens of the item, for the synonym table. */
  allTokens: string[];
  /** Extra category hints with a synonym-like weight (e.g. a device model implies the phone category). */
  extraSyn?: Map<number, number>;
  /** Tokens that are brand names (they never appear in category names; excluded from the coherence check). */
  brandTokens?: ReadonlySet<string>;
}

export interface VoteResult {
  candidates: CategoryCandidate[];
  accepted: CategoryCandidate[];
  hitCount: number;
  /** Hits that matched a typed model code. */
  codeHitCount: number;
  /** Share of FTS hit mass in categories whose name shares a word with the query (coherence evidence). */
  coherentMass: number;
}

/**
 * Everyday food words whose only name matches in this catalog are homonyms of hardware (شیر = milk / tap or valve,
 * برنج = rice / brass, مرغ = chicken / bird accessories). Alone they are treated as absent; with another word
 * («شیر آب», «شیر برقی») they vote normally.
 */
export const FOOD_HOMONYMS: ReadonlySet<string> = new Set(['شیر', 'برنج', 'مرغ']);

const q = (t: string) => `"${t.replace(/"/g, '""')}"`;

function runFts(db: Db, match: string): { cat: number; attrs: string | null }[] {
  try {
    return db.prepare(HITS_SQL).all(match) as { cat: number; attrs: string | null }[];
  } catch {
    return []; // malformed query or missing FTS table: behave as "no hits"
  }
}

function fetchHits(db: Db, input: VoteInput): { hits: Hit[]; codeHitCount: number } {
  const hits: Hit[] = [];
  let codeHitCount = 0;
  if (input.codeKeys.length > 0) {
    const rows = runFts(db, input.codeKeys.map(q).join(' OR '));
    codeHitCount = rows.length;
    for (const r of rows) hits.push({ ...r, w: 2 });
  }
  const toks = input.tokens.slice(0, 8);
  if (toks.length > 0 && codeHitCount === 0) {
    const and = toks.map((t, i) => (i === toks.length - 1 ? `${q(t)}*` : q(t))).join(' ');
    const rows = runFts(db, and);
    for (const r of rows) hits.push({ ...r, w: 1 });
    if (rows.length < 20 && toks.length > 1) {
      const or = toks.map(q).join(' OR ');
      for (const r of runFts(db, or)) hits.push({ ...r, w: 0.5 });
    }
  }
  return { hits, codeHitCount };
}

/** Does a stored product (extractor-key attrs JSON) contradict a stated constraint? */
function conflicts(attrsJson: string | null, constraints: Constraint[]): boolean {
  if (!attrsJson || constraints.length === 0) return false;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(attrsJson) as Record<string, unknown>;
  } catch {
    return false;
  }
  const have = new Map<string, unknown>();
  for (const c of mapExtractedAttrs(raw).constraints) have.set(c.attr, c.op === 'in' ? c.values : 'value' in c ? c.value : undefined);
  for (const c of constraints) {
    if (!have.has(c.attr)) continue; // unknown never conflicts
    const v = have.get(c.attr);
    if (c.op === 'eq' && v !== c.value) return true;
    if (c.op === 'contains') continue;
    if (c.op === 'in' && typeof v === 'string' && !c.values.includes(v)) return true;
  }
  return false;
}

function score(
  lex: Lexicon,
  hits: Hit[],
  syn: Map<number, number>,
  weightOf: (h: Hit) => number,
  coverage: (id: number) => number,
  needCoverage: boolean,
  headMatch: (id: number) => boolean,
) {
  const share = new Map<number, number>();
  let total = 0;
  for (const h of hits) {
    const w = weightOf(h);
    total += w;
    share.set(h.cat, (share.get(h.cat) ?? 0) + w);
  }
  if (total > 0) for (const [c, v] of share) share.set(c, v / total);
  const ids = new Set<number>([...syn.keys(), ...[...share].filter(([, s]) => s >= 0.03).map(([c]) => c)]);

  // When the text names a thing the synonym table knows («گوشی», «هارد»), categories with no synonym support are
  // discounted: «گوشی سامسونگ A56» must stay a phone although most FTS hits are phone cases.
  // Exception: a substantial non-synonym category whose NAME covers more of the query than every synonym category
  // («شارژر لپ‌تاپ» vs «شارژر گوشی», «هارد اکسترنال» vs «هارد دیسک اینترنال») overrides the synonym.
  const anyStrongSyn = [...syn.values()].some((w) => w >= 0.7);
  const maxSynCov = Math.max(0, ...[...syn.keys()].map(coverage));
  const topNonSynCov = Math.max(0, ...[...ids].filter((id) => !syn.has(id) && (share.get(id) ?? 0) >= 0.2).map(coverage));
  const override = needCoverage && syn.size > 0 && topNonSynCov > maxSynCov;

  let coherentMass = 0;
  const scored: { id: number; score: number; share: number; coherent: boolean; head: boolean }[] = [];
  for (const id of ids) {
    const s = share.get(id) ?? 0;
    const sy = syn.get(id) ?? 0;
    const coherent = !needCoverage || coverage(id) >= 1;
    if (coherent) coherentMass += s;
    let sc: number;
    if (sy > 0) sc = (0.5 * sy + 0.5 * Math.min(1, 1.5 * s)) * (override ? 0.5 : 1);
    else sc = (anyStrongSyn && !override ? 0.45 : 0.9) * s * (coherent ? 1 : 0.2) * (coherent && headMatch(id) ? 1.4 : 1);
    scored.push({ id, share: s, score: sc, coherent: coherent || sy > 0, head: headMatch(id) });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return { scored, coherentMass };
}

/**
 * `constraintsFor(categoryId)` lets the caller run the domain extractors once the leading category is known; the
 * vote is then recomputed with conflicting hits down-weighted.
 *
 * Coherence (is this really the thing the user named?): a category that is only reached through FTS hits must share
 * at least one exact word with the query (name overlap). «برنج هاشمی» finds brass fittings («اتصالات برنجی») through
 * loose matches but no category name contains the word «برنج», so nothing is accepted. Waived for typed model codes
 * and for queries that consist only of brands / numbers / codes. A diluted generic query («کفش») is accepted
 * when most of the hit mass lies in categories that share its words (leader score is then floored at 0.3).
 */
export function voteCategories(
  db: Db,
  lex: Lexicon,
  input: VoteInput,
  constraintsFor?: (categoryId: number) => Constraint[],
): VoteResult {
  const syn = matchSynonyms(lex, input.allTokens).cats;
  for (const [id, w] of input.extraSyn ?? []) syn.set(id, Math.max(syn.get(id) ?? 0, w));
  const { hits, codeHitCount } = fetchHits(db, input);

  const wordTokens = input.tokens.filter((t) => !/\d/.test(t) && !input.brandTokens?.has(t));
  const needCoverage = codeHitCount === 0 && wordTokens.length > 0;
  if (syn.size === 0 && codeHitCount === 0 && wordTokens.length > 0 && wordTokens.every((t) => FOOD_HOMONYMS.has(t))) {
    return { candidates: [], accepted: [], hitCount: hits.length, codeHitCount, coherentMass: 0 };
  }
  const coverage = (id: number) => {
    const names = lex.nameTokens.get(id);
    return names ? wordTokens.filter((t) => names.has(t)).length : 0;
  };

  const headMatch = (id: number) => needCoverage && wordTokens[0] !== undefined && lex.nameHead.get(id) === wordTokens[0];
  let r = score(lex, hits, syn, (h) => h.w, coverage, needCoverage, headMatch);
  const lead = r.scored.find((s) => lex.scope.has(s.id));
  if (lead && constraintsFor) {
    const constraints = constraintsFor(lead.id);
    const domain = lex.categories.get(lead.id)?.domain;
    if (constraints.length > 0 && domain) {
      r = score(lex, hits, syn, (h) => (lex.categories.get(h.cat)?.domain === domain && conflicts(h.attrs, constraints) ? h.w * 0.25 : h.w), coverage, needCoverage, headMatch);
    }
  }

  const inScope = r.scored.filter((s) => lex.scope.has(s.id));
  // Diluted but coherent generic query: floor the scores of the coherent leaders.
  const diluted = needCoverage && syn.size === 0 && r.coherentMass >= 0.5 && (inScope[0]?.score ?? 0) < 0.3;
  // A diluted query prefers categories named after the query's head noun («لپ تاپ» -> «لپ تاپ و نوت بوک», not its accessories).
  const dilutedPool = diluted ? (inScope.some((s) => s.coherent && s.head) ? inScope.filter((s) => s.head) : inScope.filter((s) => s.coherent)) : inScope;
  const candidates: CategoryCandidate[] = dilutedPool
    .filter((s) => s.score >= (diluted ? 0.05 : 0.12))
    .slice(0, 3)
    .map((s) => ({ id: s.id, name: lex.categories.get(s.id)?.name ?? '', score: Math.round((diluted ? Math.max(s.score, 0.3) : s.score) * 1000) / 1000 }));

  // Accept the leader plus close runners-up: same extraction domain (camera vs solar camera) at >= 50 % of the
  // leader's score, or another domain only when nearly tied (>= 75 %).
  const top = candidates[0]?.score ?? 0;
  const leadDomain = candidates[0] ? lex.categories.get(candidates[0].id)?.domain : undefined;
  const accepted = candidates
    .filter((c, i) => {
      if (i === 0) return c.score >= 0.3;
      const sameDomain = lex.categories.get(c.id)?.domain === leadDomain;
      return c.score >= 0.3 && c.score >= (sameDomain ? 0.5 : 0.75) * top;
    })
    .slice(0, 3);
  // Nothing accepted = "not in catalog": do not leak loosely related categories as if they were suggestions.
  return { candidates: accepted.length ? candidates : [], accepted, hitCount: hits.length, codeHitCount, coherentMass: r.coherentMass };
}
