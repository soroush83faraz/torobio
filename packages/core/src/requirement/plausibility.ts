/**
 * Listing plausibility (audit F3, docs/AUDIT-suggestions.md): is this listing the KIND of thing that was asked for,
 * and does its price fit its stated sale unit? "Cheapest eligible" is only an honest pick when both hold.
 *
 * Rules (each one structural, explained to the user in Persian, and never a reason to hide a listing — a listing
 * caught here stays in the options list as «جایگزین» / «مشخصات کامل نیست» with the sentence):
 *
 * 1. Title head (other_kind, 'differs'). Persian noun phrases put the head noun first («فیش آداپتور» is a plug,
 *    «کاور ایرپاد» is a cover, «باتری … پاور بانک» is a battery). The head of a title is its first word that names
 *    goods (digits, Latin codes, brand names and listing noise words such as «خرید» are skipped). A head is FOREIGN
 *    to the candidate's category when all of these hold:
 *      - the request does not contain the word and it is not part of the category's own vocabulary (category name
 *        words, hand-written synonyms, sub-kind table below);
 *      - it heads fewer than NATIVE_HEAD_SHARE (5 %) of the category's listings (an established name in the
 *        category heads more: «آداپتور» 8 % of phone chargers, «چراغ» 10 % of floodlights; the measured foreign
 *        heads sit at 0.1–1.3 %; see the audit doc);
 *      - the category where the word heads the most listings is another category («فیش» -> «سایر کابل و تبدیل»).
 * 2. Sub-kinds of mixed categories (other_kind, 'differs'). Some categories hold several product types
 *    («کلید و پریز», «هدفون، هدست و هندزفری»). SUBKINDS lists the title-head words of each type (hand-written
 *    vocabulary, like the synonyms table). When the request names exactly one type, a listing headed by another
 *    type is not what was asked for («پریز برق» -> not «کلید بین راهی»).
 * 3. Sale unit vs price (unit_unclear). For one wire (same section × cores), every offer's price is converted to a
 *    per-metre price by its listing's stated unit (a 100 m roll / 100). The group median is the typical per-metre
 *    price. A roll and a metre differ by ×100 (two decades); an offer more than ×100^(1/3) ≈ ×4.6 away from the
 *    median is outside the third of that distance nearest to its stated unit (UNIT_TOLERANCE): it fits neither unit
 *    or the other one. That offer's price is not used (flag 'unit_mismatch'); when every price of a listing is like
 *    that, the listing's unit is unclear and it is 'incomplete'. Needs ≥ 3 priced offers per group (a median of
 *    fewer has no majority). Cores unknown or a small group: compared with every judged core count of the same
 *    section (out of band for all of them); section unknown: with the listing's own offers (≥ 3).
 */
import { plausibilityCopy } from '../copy/fa';
import { brandByKey, findBrandsInTokens } from '../extract/brands';
import { normalizeFa, tokenizeForSearch } from '../normalize/index';
import type { Candidate, ListingIssue, Offer } from '../types/index';
import { isPricedOffer } from './evaluate';

/** A word that heads at least this share of a category's listings is an established name there (rule 1). */
export const NATIVE_HEAD_SHARE = 0.05;
/** Metres in a roll listing (`sale_unit` 'roll' = «حلقه/کلاف ۱۰۰ متری»). */
export const ROLL_METRES = 100;
/**
 * Rule 3 tolerance: a roll and a metre are ROLL_METRES (×100, two decades) apart. A price is accepted for its stated
 * unit only within the third of that log distance nearest to the typical price (×100^(1/3) ≈ ×4.6); in the middle
 * third it fits neither unit and in the far third it fits the other unit. Both are left out, never guessed.
 */
export const UNIT_TOLERANCE = Math.cbrt(ROLL_METRES);
/** Minimum priced offers per wire group for a median with a majority (rule 3). */
export const MIN_UNIT_GROUP = 3;

/** Spelling fold for head words: «آداپتور» and «اداپتور» are one word. */
export const foldHead = (t: string): string => t.replace(/آ/g, 'ا');

/**
 * Leading words of listing titles that do not name goods, skipped when reading the head: purchase / price / title /
 * model / spec words, number and unit words («چهار کانال», «یک متر کابل»), size modifiers («مینی دوربین»), gauge words («شماره ۲.۵»)
 * and phone product-line / variant names («آیفون ۱۶ پرو» is a phone, not the door-phone category the word also names).
 */
const SKIP_WORDS: ReadonlySet<string> = new Set(
  [
    'خرید', 'قیمت', 'عنوان', 'مشخصات', 'مدل', 'انواع', 'فروش', 'نمایندگی', 'تولید', 'پخش', 'عمده', 'جدید', 'اصلی', 'اورجینال', 'سایز', 'رنگ',
    'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'دوازده', 'شانزده', 'بیست', 'سی', 'چهل', 'صد',
    'مینی', 'میکرو', 'شماره', 'نمره', 'متر', 'متری', 'حلقه', 'کلاف', 'رول', 'عدد', 'عددی', 'جفت',
    'گیگ', 'گیگابایت', 'ترابایت', 'مگاپیکسل', 'وات', 'ولت', 'آمپر', 'امپر', 'اینچ', 'اینچی', 'کانال', 'کاناله',
    'آیفون', 'ایفون', 'گلکسی', 'گالکسی', 'ردمی', 'پوکو', 'پرو', 'مکس', 'پلاس', 'الترا', 'لایت', 'نوت',
  ].flatMap((w) => tokenizeForSearch(w).map(foldHead)),
);

/**
 * Sub-kinds of mixed categories: title-head words of each product type (rule 2). Keyed by category name.
 * Only categories whose name joins DISTINCT product types; categories joining synonyms («سیم و کابل»,
 * «لپ تاپ و نوت بوک», «پاوربانک و شارژر همراه», «کتانی و کفش اسپرت») are deliberately absent.
 */
const SUBKINDS_RAW: ReadonlyArray<readonly [string, readonly (readonly string[])[]]> = [
  ['کلید و پریز', [['کلید', 'دیمر', 'مکانیزم'], ['پریز'], ['دوشاخه', 'شاخه', 'فیش', 'سوکت']]],
  ['هدفون، هدست و هندزفری', [['هدفون'], ['هدست'], ['هندزفری', 'هنذفری', 'هندفری', 'ایرفون'], ['ایرپاد', 'ایربادز', 'ایرباد', 'ایردپاد']]],
  ['ساعت و مچ بند هوشمند', [['ساعت'], ['مچ', 'دستبند']]],
  ['چراغ و پروژکتور خورشیدی', [['چراغ', 'فانوس'], ['پروژکتور', 'پرژکتور', 'نورافکن'], ['لامپ']]],
  ['پروژکتور و وال واشر', [['پروژکتور', 'پرژکتور', 'نورافکن'], ['وال', 'والواشر', 'والواش']]],
  ['کیف و کاور گوشی', [['کیف'], ['قاب', 'کاور', 'گارد', 'کیس']]],
];
const SUBKINDS: ReadonlyMap<string, string[][]> = new Map(
  SUBKINDS_RAW.map(([name, groups]) => [normalizeFa(name), groups.map((g) => g.flatMap((w) => tokenizeForSearch(w).map(foldHead)))]),
);

/** Sub-kind groups of a category (normalised name), or undefined. */
const groupsByName = new Map<string, string[][] | undefined>();
export function subkindGroups(categoryName: string | null | undefined): string[][] | undefined {
  if (!categoryName) return undefined;
  if (!groupsByName.has(categoryName)) groupsByName.set(categoryName, SUBKINDS.get(normalizeFa(categoryName)));
  return groupsByName.get(categoryName);
}

/** All sub-kind words of a category (they count as its vocabulary). */
export function subkindWords(categoryName: string | null | undefined): string[] {
  return (subkindGroups(categoryName) ?? []).flat();
}

/** Titles the marketplace blanked («عنوان حذف‌شده برای انتشار»): the goods cannot be identified. */
const BLANKED_TITLE = /^عنوان حذف/;
export const BLANKED_HEAD = '#blanked';

/**
 * First word of a title that names goods (folded with `foldHead`), or null (only the first five tokens are read).
 * Brand names (all tokens of a multi-word alias), digits, Latin codes and SKIP_WORDS are passed over.
 * A blanked title returns BLANKED_HEAD.
 */
export function titleHead(title: string): string | null {
  const all = tokenizeForSearch(title.slice(0, 48)); // the head is among the first words (cost: one pass over every title)
  if (BLANKED_TITLE.test(all.slice(0, 2).join(' '))) return BLANKED_HEAD;
  const toks = all.slice(0, 5);
  const brand = new Set<number>();
  for (const h of findBrandsInTokens(toks, { includeNonTitle: true })) {
    brand.add(h.tokenIndex);
    // a multi-token alias («هایک ویژن») covers its following tokens too
    for (const al of brandByKey(h.key)?.aliasTokens ?? []) {
      if (al.every((t, j) => toks[h.tokenIndex + j] === t)) al.forEach((_, j) => brand.add(h.tokenIndex + j));
    }
  }
  for (let i = 0; i < toks.length; i++) {
    const t = foldHead(toks[i]!);
    if (brand.has(i) || t.length < 2 || /\d/.test(t) || /^[a-z]/.test(t) || SKIP_WORDS.has(t)) continue;
    return t;
  }
  return null;
}

/** Title-head counts over the market (listings with offers). */
export interface HeadStats {
  count(categoryId: number, head: string): number;
  total(categoryId: number): number;
  /** Category where `head` heads the most listings (ties: lower id). */
  home(head: string): number | undefined;
  /** Head of a counted listing (by product id), computed once; undefined = not counted (compute it). */
  headOf(productId: number): string | null | undefined;
}

/** Incremental HeadStats (the server feeds the listings over several event-loop turns). */
export function headStatsBuilder(): { add(row: { id?: number; title: string; categoryId: number }): void; build(): HeadStats } {
  const heads = new Map<number, string | null>();
  const byCat = new Map<number, Map<string, number>>();
  const totals = new Map<number, number>();
  const byHead = new Map<string, Map<number, number>>();
  return {
    add(r) {
      totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) + 1);
      const h = titleHead(r.title);
      if (r.id !== undefined) heads.set(r.id, h);
      if (!h) return;
      const m = byCat.get(r.categoryId) ?? new Map<string, number>();
      m.set(h, (m.get(h) ?? 0) + 1);
      byCat.set(r.categoryId, m);
      const n = byHead.get(h) ?? new Map<number, number>();
      n.set(r.categoryId, (n.get(r.categoryId) ?? 0) + 1);
      byHead.set(h, n);
    },
    build() {
      const home = new Map<string, number>();
      for (const [h, m] of byHead) {
        let best: [number, number] | null = null;
        for (const [c, n] of m) if (!best || n > best[1] || (n === best[1] && c < best[0])) best = [c, n];
        if (best) home.set(h, best[0]);
      }
      return {
        count: (c, h) => byCat.get(c)?.get(h) ?? 0,
        total: (c) => totals.get(c) ?? 0,
        home: (h) => home.get(h),
        headOf: (id) => heads.get(id),
      };
    },
  };
}

export function buildHeadStats(rows: Iterable<{ id?: number; title: string; categoryId: number }>): HeadStats {
  const b = headStatsBuilder();
  for (const r of rows) b.add(r);
  return b.build();
}

/** What the request names, for rules 1 and 2. */
export interface KindContext {
  /** Tokens of the item text (tokenizeForSearch, folded with foldHead). */
  requestTokens: ReadonlySet<string>;
  /** The word the request uses for the thing (shown in sentences), or null. */
  requested: string | null;
  /** The item's categories. */
  categoryIds: ReadonlySet<number>;
  /** Category-name tokens + synonym-term tokens + sub-kind words of the item's categories (folded). */
  vocabulary: ReadonlySet<string>;
  categoryName(id: number): string | undefined;
  stats: HeadStats;
}

/** Rules 1 and 2 for one listing; null when the title names the requested kind (or nothing can be read). */
export function kindIssue(title: string, categoryId: number, ctx: KindContext, productId?: number): ListingIssue | null {
  const cached = productId === undefined ? undefined : ctx.stats.headOf(productId);
  const head = cached === undefined ? titleHead(title) : cached;
  if (!head) return null;
  if (head === BLANKED_HEAD) return { code: 'other_kind', fit: 'incomplete', text: plausibilityCopy.blankedTitle };
  const groups = subkindGroups(ctx.categoryName(categoryId));
  if (groups) {
    const asked = groups.filter((g) => g.some((w) => ctx.requestTokens.has(w)));
    const own = groups.find((g) => g.includes(head));
    if (asked.length === 1 && own && own !== asked[0]) {
      const word = asked[0]!.find((w) => ctx.requestTokens.has(w))!;
      return { code: 'other_kind', fit: 'differs', text: plausibilityCopy.siblingHead(head, word) };
    }
    if (own) return null;
  }
  if (ctx.requestTokens.has(head) || ctx.vocabulary.has(head)) return null;
  const total = ctx.stats.total(categoryId);
  if (total === 0 || ctx.stats.count(categoryId, head) >= NATIVE_HEAD_SHARE * total) return null;
  const home = ctx.stats.home(head);
  if (home === undefined || home === categoryId || ctx.categoryIds.has(home)) return null;
  const homeName = ctx.categoryName(home);
  if (!homeName) return null;
  return { code: 'other_kind', fit: 'differs', text: plausibilityCopy.foreignHead(head, homeName, ctx.requested) };
}

/** Candidates with rules 1–2 applied (a new object only where an issue was found). */
export function withKindIssues<C extends Candidate>(cands: readonly C[], ctx: KindContext): C[] {
  return cands.map((c) => {
    const issue = kindIssue(c.product.title, c.product.categoryId, ctx, c.product.id);
    return issue ? { ...c, issues: [...(c.issues ?? []), issue] } : c;
  });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Rule 3 over the candidates of a wire category: offers whose price contradicts the listing's sale unit lose their
 * price (priceFlag 'unit_mismatch'); a listing with no consistent price left gets an 'unit_unclear' issue.
 * Candidates without section, cores or a roll / metre unit are not judged.
 */
export function withWireUnitCheck<C extends Candidate>(cands: readonly C[]): C[] {
  const unitOf = (c: Candidate) => (c.attrs.sale_unit === 'roll' || c.attrs.sale_unit === 'meter' ? c.attrs.sale_unit : null);
  const sectionOf = (c: Candidate) => (unitOf(c) && typeof c.attrs.wire_section_mm2 === 'number' ? c.attrs.wire_section_mm2 : null);
  const groupOf = (c: Candidate) => {
    const s = sectionOf(c);
    return s !== null && typeof c.attrs.wire_cores === 'number' ? `${s}x${c.attrs.wire_cores}` : null;
  };
  const perMetre = (c: Candidate, o: Offer & { price: number }) => (c.attrs.sale_unit === 'roll' ? o.price / ROLL_METRES : o.price);
  const prices = new Map<string, number[]>();
  for (const c of cands) {
    const g = groupOf(c);
    if (!g) continue;
    const list = prices.get(g) ?? [];
    for (const o of c.offers) if (isPricedOffer(o)) list.push(perMetre(c, o));
    prices.set(g, list);
  }
  const typical = new Map<string, number>();
  for (const [g, list] of prices) if (list.length >= MIN_UNIT_GROUP) typical.set(g, median(list));
  // typical per-metre prices of every judged core count of a section (for listings whose own group is not judged)
  const bySection = new Map<number, number[]>();
  for (const [g, p] of typical) {
    const s = Number(g.split('x')[0]);
    bySection.set(s, [...(bySection.get(s) ?? []), p]);
  }
  return cands.map((c) => {
    if (!unitOf(c)) return c;
    const section = sectionOf(c) ?? -1;
    const g = groupOf(c);
    const own = g ? typical.get(g) : undefined;
    // own group judged: compare with its typical price; otherwise (cores unknown / too few offers) only a price out of
    // band for EVERY judged core count of the same section is caught; failing that, the listing's own offers (>= 3)
    const own3 = c.offers.filter(isPricedOffer).map((o) => perMetre(c, o));
    const band =
      own !== undefined
        ? [own, own]
        : bySection.has(section)
          ? [Math.min(...bySection.get(section)!), Math.max(...bySection.get(section)!)]
          : own3.length >= MIN_UNIT_GROUP
            ? [median(own3), median(own3)]
            : null;
    if (!band) return c;
    let changed = false;
    let consistent = 0;
    const offers = c.offers.map((o) => {
      if (!isPricedOffer(o)) return o;
      const x = perMetre(c, o);
      if (x * UNIT_TOLERANCE < band[0]! || x > band[1]! * UNIT_TOLERANCE) {
        changed = true;
        return { ...o, price: null, priceFlag: 'unit_mismatch' as const };
      }
      consistent++;
      return o;
    });
    if (!changed) return c;
    const out: C = { ...c, offers };
    if (consistent === 0) {
      out.issues = [...(c.issues ?? []), { code: 'unit_unclear', fit: 'incomplete', text: plausibilityCopy.unitUnclear(unitOf(c)!) }];
    }
    return out;
  });
}
