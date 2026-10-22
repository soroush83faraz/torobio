import { normalizeFa } from '../normalize/index';
import { extractDeviceModels } from './device-models';
import type { ModelCode } from './model-codes';
import { findQuantities, hasWord, parseNum, prep, single } from './numbers';

export type AttrValue = string | number | boolean | string[];
export type Attrs = Record<string, AttrValue>;
/** Where a value came from when it is not read directly from the title. */
export type AttrSource = 'model_code' | 'spec' | 'model_field';

export interface DomainContext {
  /** prep()ed title */
  t: string;
  /** original title */
  title: string;
  codes: ModelCode[];
  brandKey: string | null;
  specs: Map<string, string>;
  modelField: string | null;
  categoryName: string | null;
}

export interface DomainResult {
  attrs: Attrs;
  src: Record<string, AttrSource>;
}

const L = 'a-z\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF';
const word = (alt: string) => new RegExp(`(?<![${L}0-9])(?:${alt})(?![${L}0-9])`);

/** Upper-case raw codes (separators kept) for code-pattern rules. */
function rawCodes(ctx: DomainContext): string[] {
  return ctx.codes.map((c) => c.raw.toUpperCase());
}

/** Merge a title value with a secondary (code/spec) value: conflict => unknown. */
function merge<T extends AttrValue>(
  res: DomainResult,
  key: string,
  fromTitle: T | null | undefined,
  secondary: T | null | undefined,
  secondarySrc: AttrSource,
): void {
  if (fromTitle != null && secondary != null) {
    if (fromTitle === secondary) res.attrs[key] = fromTitle;
    // conflict: leave unknown
    return;
  }
  if (fromTitle != null) res.attrs[key] = fromTitle;
  else if (secondary != null) {
    res.attrs[key] = secondary;
    res.src[key] = secondarySrc;
  }
}

function specValue(ctx: DomainContext, keys: string[]): string | null {
  for (const k of keys) {
    const v = ctx.specs.get(normalizeFa(k));
    if (v) return prep(v);
  }
  return null;
}

// ---------------------------------------------------------------- generic

// «کار کرده» (spaced), «در حد نو / در حد آکبند / مشابه آکبند» (= used, like new), «پک باز شده» (open box)
// were added after measuring misses on the full snapshot; each phrase only ever describes a used item.
const USED_RE = word(
  'استوک|کارکرده|کار کرده|دست دوم|دسته دوم|used|second hand|اوپن باکس|اپن باکس|open box|open-box|openbox|پک باز شده|در حد نو|در حد آکبند|در حد اکبند|مشابه آکبند|مشابه اکبند',
);
// «ریفر» alone is the bazaar short form («سوئیچ سیسکو … ریفر», «هارد … (ریفر)»); «ریفرنس» is another word.
const REFURB_RE = word('ریفربیش|ریفربیشد|رفربیش|ریفر|refurbished|refurb|recertified|ریکاندیشن');
const NEW_RE = word('آکبند|اکبند|نو آکبند|brand new');
/** «آکبند» inside a like-new phrase is not a claim that the item is new. */
const LIKE_NEW_RE = /(?:در حد|مشابه|مثل)\s+(?:نو\s+)?(?:آکبند|اکبند)/g;

export function extractCondition(t: string): string | null {
  const used = USED_RE.test(t);
  const ref = REFURB_RE.test(t);
  if (used && ref) return 'refurbished';
  if (ref) return 'refurbished';
  // «کارکرده و آکبند» (both conditions offered in one listing) stays unknown
  if (used && !NEW_RE.test(t.replace(LIKE_NEW_RE, ' '))) return 'used';
  return null;
}

const REPLICA_RE = word('کپی|های کپی|فیک|fake|replica|copy|غیر اصل|غیراصل|طرح اصلی|کپی درجه یک|high copy|هایکپی');

/**
 * Explicit look-alike / not-original claims that are never a product feature: «اورجینال نیست», «غیر اورجینال»,
 * «اصل نیست», «تقلبی», «مشابه اصل(ی)», «ساخت چین مشابه», «ریپلیکا», clone / imitation.
 */
const LOOKALIKE_RE = word(
  'اورجینال نیست|اصل نیست|اصلی نیست|غیر ?اورجینال|تقلبی|مشابه (?:اصل|اصلی|اورجینال)|ساخت چین مشابه|مشابه ساخت چین|ریپلیکا|clone|imitation|not original',
);

/**
 * «طرح <brand>» = made to look like that brand's product («گوشی طرح اپل», «ایرپاد طرح اپل»). Only a brand / device
 * name right after «طرح» counts: «طرح دار», «طرح گل», «طرح چرم», «طرح ساده», «طرح گوزن» describe a pattern or style.
 */
const BRAND_AFTER_TARH = [
  'اپل|ایفون|آیفون|iphone|apple|ایرپاد|ایرپادز|airpods?|مک بوک|مکبوک',
  'سامسونگ|samsung|گلکسی|گالکسی|galaxy|شیائومی|xiaomi|ردمی|redmi|پوکو|poco|هواوی|هوآوی|huawei|آنر|honor',
  'نوکیا|nokia|سونی|sony|ال ?جی|lg|موتورولا|motorola|ریلمی|realme|اوپو|oppo|وان ?پلاس|oneplus|گوگل|google|پیکسل|pixel',
  'ورتو|vertu|بوز|bose|جی ?بی ?ال|jbl|بیتس|beats|انکر|anker|هارمن',
].join('|');
const TARH_BRAND_RE = new RegExp(`(?<![${L}0-9])طرح\\s+(?:${BRAND_AFTER_TARH})(?![${L}0-9])`);
/** Phones only: «گوشی طرح S26 Ultra», «طرح A15» (a Latin model code right after «طرح»). */
const TARH_MODEL_RE = new RegExp(`(?<![${L}0-9])طرح\\s+[a-z]{1,10}\\s?\\d`);
const TARH_DOMAINS: ReadonlySet<string> = new Set(['phone', 'headphones', 'charger', 'power_bank']);

/**
 * Replica / look-alike claim read from the title. Only inside extraction domains: on the generic path
 * «کپی» names photocopiers and copy paper. «طرح <brand>» counts in phones, headphones, chargers and power banks
 * (in cases / adapters it names a style or a housing).
 */
export function extractReplica(t: string, domain: string | null): boolean {
  return domainReplicaMatch(t, domain) !== null;
}

function matchOf(re: RegExp, t: string): string | null {
  const m = re.exec(t);
  return m ? m[0].trim() : null;
}

function domainReplicaMatch(t: string, domain: string | null): string | null {
  if (!domain || domain === 'switch_socket' || domain === 'lighting') return null;
  const m = matchOf(REPLICA_RE, t) ?? matchOf(LOOKALIKE_RE, t);
  if (m) return m;
  if (!TARH_DOMAINS.has(domain)) return null;
  return matchOf(TARH_BRAND_RE, t) ?? (domain === 'phone' ? matchOf(TARH_MODEL_RE, t) : null);
}

/**
 * Copy claims that hold on ANY listing, the generic path included (listing text only: product titles and seller
 * titles; the parser keeps the domain-gated rule). Each phrase only ever states a copy: «های کپی» / «هایکپی»,
 * «فول کپی», «کپی درجه یک», «(کپی)» as a bracketed tag, «high copy», «replica». Measured on the 2026-10 snapshot
 * (product and seller titles of every category, photocopier / copy-paper / anti-copy remote categories included):
 * none of these appears in a copier, copy-paper («کپی مکس»), «کپی خور» console or «ضد کپی» listing.
 */
const STRONG_REPLICA_RE = word('های ?کپی|هایکپی|فول کپی|کپی درجه (?:یک|1)|high copy|replica');
const BRACKET_COPY_RE = /\(\s*کپی\s*\)/;

function listingReplicaMatch(t: string, domain: string | null): string | null {
  return domainReplicaMatch(t, domain) ?? matchOf(STRONG_REPLICA_RE, t) ?? matchOf(BRACKET_COPY_RE, t);
}

export interface ListingFlagsHit {
  condition?: 'used' | 'refurbished';
  replica?: true;
  /** The words of the text that state each flag (prep()ed form), e.g. ['های کپی']. */
  evidence: string[];
}

/**
 * Listing condition flags of a listing text (prep()ed product title or seller title) with the words that state
 * them. Absent = not stated in the listing.
 */
export function detectListingFlags(t: string, domain: string | null): ListingFlagsHit {
  const out: ListingFlagsHit = { evidence: [] };
  const c = extractCondition(t);
  if (c === 'used' || c === 'refurbished') {
    out.condition = c;
    const m = c === 'refurbished' ? matchOf(REFURB_RE, t) : matchOf(USED_RE, t);
    if (m) out.evidence.push(m);
  }
  const r = listingReplicaMatch(t, domain);
  if (r !== null) {
    out.replica = true;
    out.evidence.push(r);
  }
  return out;
}

/** Listing condition flags of a title (prep()ed text). Absent = not stated in the listing. */
export function extractListingFlags(t: string, domain: string | null): { condition?: 'used' | 'refurbished'; replica?: true } {
  const { evidence: _e, ...flags } = detectListingFlags(t, domain);
  return flags;
}

// ---------------------------------------------------------------- CCTV camera

const MP_UNITS = 'مگاپیکسلی|مگاپیکسل|مگا پیکسلی|مگا پیکسل|مگاپیگسل|مگ|mp|mpx|megapixel|megapixels';

function mpFromText(t: string): number | null {
  const vals = findQuantities(t, MP_UNITS).map((h) => h.value).filter((v) => v > 0 && v <= 64);
  if (vals.length) return single(vals);
  const alt: number[] = [];
  if (/(?<![a-z0-9])4k(?![a-z0-9])/.test(t)) alt.push(8);
  if (/(?<![0-9])1080p(?![a-z0-9])/.test(t)) alt.push(2);
  if (/(?<![0-9])720p(?![a-z0-9])/.test(t)) alt.push(1);
  return alt.length ? single(alt) : null;
}

const MP_DIGITS = new Set([1, 2, 3, 4, 5, 6, 8]);

function mpFromCodes(ctx: DomainContext): number | null {
  const vals: number[] = [];
  for (const c of rawCodes(ctx)) {
    // Dahua: HFW1200 / HDW1439 / HDBW2431 ... second digit = megapixels
    if (ctx.brandKey === 'dahua' || /(?:^|-)(?:DH|DHI|HAC|IPC)-/.test(c)) {
      const m = c.match(/(?:^|[^A-Z])(?:HFW|HDW|HDBW|HDPW|HUM|PFW|HDCW|EW)(\d)(\d)\d{2}/);
      if (m && MP_DIGITS.has(Number(m[2]))) vals.push(Number(m[2]));
    }
    // Hikvision IP: DS-2CD2143G2 -> 4
    const h = c.match(/(?:^|[^A-Z])DS-?2CD\d[0-9A-Z](\d)/);
    if (h && MP_DIGITS.has(Number(h[1]))) vals.push(Number(h[1]));
    // Hikvision Turbo HD: DS-2CE16D0T -> D = 2MP, H = 5MP, U = 8MP
    const tu = c.match(/(?:^|[^A-Z])DS-?2CE\d{2}([DHU])/);
    if (tu) vals.push({ D: 2, H: 5, U: 8 }[tu[1] as 'D' | 'H' | 'U']);
  }
  return vals.length ? single(vals) : null;
}

const SIG_IP = word('ip|آی پی|آیپی|ای پی|تحت شبکه|شبکه|network|ipc|نتورک|poe|پو ای');
// Latin format tags are often glued to Persian words or digits in seller titles («بالتAHD», «AHD2MP», «AHDمدل»,
// «HDAHD»): they only need a Latin/digit-free boundary on the letters side, never a Persian one.
const LAT_L = 'a-z';
const SIG_AHD = new RegExp(`(?<![${LAT_L}])(?:hd)?ahd(?![${LAT_L}])|(?<![${L}0-9])(?:ای اچ دی|ایی اچ دی|ای\\.?اچ\\.?دی)(?![${L}0-9])`);
const SIG_CVI = new RegExp(`(?<![${LAT_L}])(?:hd[- ]?)?cvi(?![${LAT_L}])|(?<![${L}0-9])(?:اچ دی سی وی آی|سی وی آی|اچ دی سیوی آی)(?![${L}0-9])`);
const SIG_TVI = new RegExp(`(?<![${LAT_L}])(?:hd[- ]?)?tvi(?![${LAT_L}])|(?<![${L}0-9])(?:اچ دی تی وی آی|تی وی آی|توربو|turbo ?hd)(?![${L}0-9])`);
const SIG_ANALOG = word('آنالوگ|انالوگ|analog|analogue|cvbs');

/** Analog formats that sit inside the generic «analog» family (specific beats generic, never the reverse). */
const ANALOG_SPECIFIC = new Set(['ahd', 'hdcvi', 'tvi']);

interface SignalText { value: string | null; /** only the generic word «آنالوگ» (no named format) */ genericOnly: boolean; conflict: boolean }

function signalFromText(t: string): SignalText {
  const ip = SIG_IP.test(t);
  const analogTypes: string[] = [];
  if (SIG_AHD.test(t)) analogTypes.push('ahd');
  if (SIG_CVI.test(t)) analogTypes.push('hdcvi');
  if (SIG_TVI.test(t)) analogTypes.push('tvi');
  const analogWord = SIG_ANALOG.test(t);
  if (ip && (analogTypes.length || analogWord)) return { value: null, genericOnly: false, conflict: true };
  if (ip) return { value: 'ip', genericOnly: false, conflict: false };
  if (analogTypes.length === 1) return { value: analogTypes[0] as string, genericOnly: false, conflict: false };
  if (analogTypes.length > 1) return { value: 'analog', genericOnly: false, conflict: false };
  if (analogWord) return { value: 'analog', genericOnly: true, conflict: false };
  return { value: null, genericOnly: false, conflict: false };
}

function signalFromCodes(ctx: DomainContext): string | null {
  const vals: string[] = [];
  for (const c of rawCodes(ctx)) {
    if (/(?:^|-)IPC(?:-|\d|[A-Z])/.test(c) || /(?:^|[^A-Z])DS-?2(?:CD|DE|DF|XS)/.test(c)) vals.push('ip');
    else if (/(?:^|-)HAC-/.test(c)) vals.push(ctx.brandKey === 'dahua' || /^DH/.test(c) ? 'hdcvi' : 'analog');
    else if (/(?:^|[^A-Z])DS-?2CE/.test(c) || /(?:^|-)UAC-/.test(c) || /^UVC-/.test(c)) vals.push('analog');
  }
  const u = [...new Set(vals)];
  return u.length === 1 ? (u[0] as string) : null;
}

/**
 * Transmission: title and model code agree => that value. The code only knows the analog family for many series
 * (Hikvision `DS-2CE`, Uniview `UAC-`): a format the title names (TVI / AHD / HDCVI) then wins, and a title that
 * says just «آنالوگ» is refined by a code convention (Dahua `HAC-` = HDCVI). Two different named formats, or
 * IP against analog, stay unknown.
 */
function mergeSignal(res: DomainResult, sigT: SignalText, sigC: string | null): void {
  if (sigT.conflict) return;
  const tv = sigT.value;
  if (tv != null && sigC != null && tv !== sigC) {
    if (sigC === 'analog' && ANALOG_SPECIFIC.has(tv)) { res.attrs.signal = tv; return; }
    if (sigT.genericOnly && ANALOG_SPECIFIC.has(sigC)) { res.attrs.signal = sigC; res.src.signal = 'model_code'; return; }
    // several named formats in the title (AHD/TVI/CVI): the family is certain, a code convention would pick one of them
    if (tv === 'analog' && ANALOG_SPECIFIC.has(sigC)) { res.attrs.signal = 'analog'; return; }
    return;
  }
  merge(res, 'signal', tv, sigC, 'model_code');
}

const PTZ_RE = word('اسپید دام|اسپیددام|اسپید|speed dome|speeddome|ptz|چرخشی|گردان|پی تی زد|پان تیلت');
const WIFI_RE = word('وای فای|وایفای|wi-fi|wifi|بی سیم|بیسیم|وایرلس|wireless');
const SIM_RE = word('سیم کارتی|سیمکارتی|سیم کارت|سیمکارت|4g|lte');
const BULLET_RE = word('بولت|بالت|bullet');
const DOME_RE = word('دام|dome|دوم');

export function extractCctvCamera(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  const mpT = mpFromText(t);
  const mpC = mpFromCodes(ctx);
  merge(res, 'mp', mpT, mpC, 'model_code');
  // camera spec blocks are seller-written and inconsistent (PLAN B1.2): no spec fallback for mp/signal
  // (the title itself naming both IP and an analog format is unknown, whatever the code says)
  mergeSignal(res, signalFromText(t), signalFromCodes(ctx));
  const codePtz = rawCodes(ctx).some((c) => /(?:^|[^A-Z])DS-?2(?:DE|DF)/.test(c) || /(?:^|-)SD\d[0-9A-Z]/.test(c));
  if (PTZ_RE.test(t)) res.attrs.ptz = true;
  else if (codePtz) { res.attrs.ptz = true; res.src.ptz = 'model_code'; }
  if (WIFI_RE.test(t)) res.attrs.wifi = true;
  if (SIM_RE.test(t)) res.attrs.sim = true;
  const bullet = BULLET_RE.test(t);
  const dome = DOME_RE.test(t.replace(/اسپید ?دام|speed ?dome/g, ' '));
  if (bullet !== dome && !res.attrs.ptz) res.attrs.form = bullet ? 'bullet' : 'dome';
  if (/(?<![a-z\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])(?:خورشیدی|solar)(?![a-z\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(t) || ctx.categoryName === 'دوربین امنیتی خورشیدی') res.attrs.solar = true;
  if (REPLICA_RE.test(t)) res.attrs.replica = true;
  return res;
}

// ---------------------------------------------------------------- recorder

const KIND_NVR = word('nvr|ان وی آر|ان وی ار|انویار|ان وي آر');
const KIND_XVR = word('xvr|ایکس وی آر|ایکس وی ار|hvr|uvr|یو وی آر|یو وی ار|هایبرید|hybrid|تریبرید|pentabrid|پنتابرید');
const KIND_DVR = word('dvr|دی وی آر|دی وی ار|دیویار|hcvr|دی وی');

function kindFromText(t: string): string | null {
  if (KIND_XVR.test(t)) return 'xvr';
  const n = KIND_NVR.test(t);
  const d = KIND_DVR.test(t);
  if (n && !d) return 'nvr';
  if (d && !n) return 'dvr';
  // «رکوردر ... شبکه», «ضبط کننده تحت شبکه»: a network video recorder
  if (!n && !d && word('تحت شبکه|شبکه|network').test(t) && !word('ahd|آنالوگ|analog|hd-?cvi|tvi').test(t)) return 'nvr';
  return null;
}

function kindFromCodes(ctx: DomainContext): string | null {
  const vals: string[] = [];
  for (const c of rawCodes(ctx)) {
    if (/(?:^|[^A-Z])(?:XVR|UVR|HVR)/.test(c)) vals.push('xvr');
    else if (/(?:^|[^A-Z])HCVR/.test(c)) vals.push('dvr');
    else if (/(?:^|[^A-Z])NVR/.test(c)) vals.push('nvr');
    else if (/(?:^|[^A-Z])DS-?[79]\d{3}N/.test(c) || /(?:^|[^A-Z])TC-?R3\d{3}/.test(c)) vals.push('nvr');
    else if (/(?:^|[^A-Z])I?DS-?7\d{3}H/.test(c) || /(?:^|[^A-Z])DVR\d/.test(c)) vals.push('dvr');
  }
  const u = [...new Set(vals)];
  return u.length === 1 ? (u[0] as string) : null;
}

const CHANNEL_UNITS = 'کاناله|کانال|ch|channel|channels|چنل|چنله';
const CH_OK = (v: number) => Number.isInteger(v) && v >= 1 && v <= 256;

function channelsFromText(t: string): number | null {
  // «4 و 8 کانال», «4/8/16 کانال», «4، 8 کانال»: several products or options
  if (new RegExp(`\\d+\\s*(?:و|/|،|,|-)\\s*\\d+\\s*(?:${CHANNEL_UNITS})(?![${L}])`).test(t)) return null;
  const vals = findQuantities(t, CHANNEL_UNITS).map((h) => h.value).filter(CH_OK);
  return vals.length ? single(vals) : null;
}

function channelsFromCodes(ctx: DomainContext): number | null {
  const vals: number[] = [];
  for (const c of rawCodes(ctx)) {
    let m = c.match(/(?:^|[^A-Z])(?:XVR|NVR|HCVR)\d{2}(\d{2})(?![0-9])/) ?? c.match(/(?:^|[^A-Z])(?:XVR|NVR)\d[A-Z](\d{2})(?![0-9])/);
    if (!m) m = c.match(/(?:^|[^A-Z])I?DS-?[79]\d(\d{2})(?![0-9])/);
    if (!m) m = c.match(/(?:^|[^A-Z])TC-?R31(\d{2})(?![0-9])/);
    if (!m) m = c.match(/(?:^|[^A-Z])UVR-?B(\d{2})(?![0-9])/);
    if (m) {
      const v = Number(m[1]);
      if (CH_OK(v)) vals.push(v);
    }
  }
  return vals.length ? single(vals) : null;
}

export function extractRecorder(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const kc = kindFromCodes(ctx);
  const kt = kindFromText(ctx.t);
  // a manufacturer model code is more reliable than the seller's wording
  if (kc) { res.attrs.kind = kc; if (kt !== kc) res.src.kind = 'model_code'; }
  else if (kt) res.attrs.kind = kt;
  const chT = channelsFromText(ctx.t);
  const chC = channelsFromCodes(ctx);
  merge(res, 'channels', chT, chC, 'model_code');
  if (chT == null && chC == null) {
    const v = specValue(ctx, ['تعداد کانال']);
    if (v) {
      const m = v.match(/^(\d{1,3})\s*(?:کانال|ch)?$/);
      if (m && CH_OK(Number(m[1]))) { res.attrs.channels = Number(m[1]); res.src.channels = 'spec'; }
    }
  }
  return res;
}

// ---------------------------------------------------------------- HDD

const TB_UNITS = 'ترابایت|ترابایتی|ترا بایت|ترا|tb|tera|terabyte';
const GB_UNITS = 'گیگابایت|گیگابایتی|گیگ|gb|giga';

function tbFromText(t: string): number | null {
  const tb = findQuantities(t, TB_UNITS).map((h) => h.value).filter((v) => v > 0 && v <= 30);
  const gb = findQuantities(t, GB_UNITS).map((h) => h.value).filter((v) => v >= 80 && v <= 4000).map((v) => v / 1000);
  const all = [...tb, ...gb];
  return all.length ? single(all) : null;
}

function tbFromCodes(ctx: DomainContext): number | null {
  const vals: number[] = [];
  for (const c of rawCodes(ctx)) {
    const wd = c.match(/(?:^|[^A-Z])WD(\d{2,4})([A-Z]{3,5})/);
    if (wd) {
      const n = wd[1] as string;
      if (n.length === 2 && n[1] === '0' && n[0] !== '0') vals.push(Number(n[0]));
      else if (n.length === 3 && n[2] === '1') vals.push(Number(n.slice(0, 2)));
      else if (n.length === 4 && n.endsWith('003') && n[0] !== '0') vals.push(Number(n[0]));
    }
    const st = c.match(/(?:^|[^A-Z])ST(\d{3,5})([A-Z]{2})/);
    if (st) {
      const gb = Number(st[1]);
      if ([500, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000, 24000].includes(gb)) vals.push(gb / 1000);
    }
  }
  return vals.length ? single(vals) : null;
}

const SURV_RE = word('بنفش|purple|پرپل|پورپل|skyhawk|sky hawk|اسکای هاوک|اسکایهاوک|surveillance|سورویلنس|سرویلنس|نظارتی|مخصوص دوربین|مخصوص دی وی آر|مخصوص dvr|مخصوص nvr|s300|av-gp|avgp');
const LINES: Array<[string, RegExp]> = [
  ['purple', word('بنفش|purple|پرپل|پورپل')],
  ['skyhawk', word('skyhawk|sky hawk|اسکای هاوک|اسکایهاوک')],
  ['blue', word('آبی|ابی|blue')],
  ['red', word('قرمز|red')],
  ['gold', word('گلد|طلایی|gold')],
  ['black', word('مشکی|black')],
  ['green', word('سبز|green')],
  ['barracuda', word('باراکودا|barracuda')],
  ['ironwolf', word('آیرون ولف|ایرون ولف|ironwolf|iron wolf')],
  ['exos', word('اگزوز|اکسوس|exos')],
  ['ultrastar', word('ultrastar|اولتراستار')],
];
const SURV_LINES = new Set(['purple', 'skyhawk']);

function lineFromCodes(ctx: DomainContext): string | null {
  const vals: string[] = [];
  for (const c of rawCodes(ctx)) {
    if (/(?:^|[^A-Z])WD\d{2,4}PUR[A-Z]/.test(c)) vals.push('purple');
    else if (/(?:^|[^A-Z])WD\d{2,4}EF[A-Z]{2}/.test(c)) vals.push('red');
    else if (/(?:^|[^A-Z])WD\d{2,4}(?:EZ|AZ)[A-Z]{2}/.test(c)) vals.push('blue');
    else if (/(?:^|[^A-Z])WD\d{2,4}F[RY]YZ|(?:^|[^A-Z])WD\d{2,4}KRYZ/.test(c)) vals.push('gold');
    else if (/(?:^|[^A-Z])WD\d{2,4}FZ[BE]X/.test(c)) vals.push('black');
    else if (/(?:^|[^A-Z])ST\d{3,5}VX/.test(c)) vals.push('skyhawk');
    else if (/(?:^|[^A-Z])ST\d{3,5}(?:VN|NT)/.test(c)) vals.push('ironwolf');
    else if (/(?:^|[^A-Z])ST\d{3,5}DM/.test(c)) vals.push('barracuda');
    else if (/(?:^|[^A-Z])ST\d{3,5}NM/.test(c)) vals.push('exos');
  }
  const u = [...new Set(vals)];
  return u.length === 1 ? (u[0] as string) : null;
}

export function extractHdd(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  const tbT = tbFromText(t);
  const tbC = tbFromCodes(ctx);
  merge(res, 'tb', tbT, tbC, 'model_code');
  if (tbT == null && tbC == null) {
    const v = specValue(ctx, ['ظرفيت', 'ظرفیت']);
    if (v) {
      const s = tbFromText(v);
      if (s != null) { res.attrs.tb = s; res.src.tb = 'spec'; }
    }
  }
  const lines = LINES.filter(([, re]) => re.test(t)).map(([k]) => k);
  // «آبی/قرمز...» are colour words; only trust them when exactly one line is named
  const lineT = lines.length === 1 ? (lines[0] as string) : null;
  const lineC = lineFromCodes(ctx);
  merge(res, 'line', lineT, lineC, 'model_code');
  const line = res.attrs.line as string | undefined;
  if (SURV_RE.test(t) && (line == null || SURV_LINES.has(line))) res.attrs.surveillance = true;
  else if (line != null) {
    res.attrs.surveillance = SURV_LINES.has(line);
    if (res.src.line) res.src.surveillance = res.src.line;
  }
  const ssd = word('ssd|اس اس دی|nvme|m.2').test(t) || ctx.categoryName === 'حافظه SSD';
  const hddWord = word('hdd|اچ دی دی|هارد دیسک|هارددیسک').test(t);
  // every named line (Purple, Red, SkyHawk, IronWolf, ...) is a spinning-disk line
  const hddLine = res.attrs.line != null || lines.length > 0;
  if (ssd && !hddWord && !hddLine) res.attrs.ssd = true;
  else if ((hddWord || hddLine) && !ssd) res.attrs.ssd = false;
  const ff35 = /(?<![0-9])3[.,/]5(?:\s*(?:اینچ|inch|"|in))?(?![0-9])/.test(t) && /اینچ|inch|"|سایز|3[.,/]5 ?in/.test(t);
  const ff25 = (/(?<![0-9])2[.,/]5(?:\s*(?:اینچ|inch|"|in))?(?![0-9])/.test(t) && /اینچ|inch|"|سایز/.test(t)) || word('لپ تاپ|لپتاپ|لپ تاپی|laptop|notebook|نوت بوک').test(t);
  if (ff35 && !ff25) res.attrs.form_factor = '3.5';
  else if (ff25 && !ff35) res.attrs.form_factor = '2.5';
  return res;
}

// ---------------------------------------------------------------- adapters / power

const VOLT_UNITS = 'ولتی|ولت|vdc|vac|v|volt|volts';
const AMP_UNITS = 'آمپری|آمپر|امپر|امپری|a|amp|amps|ampere';
const MILLIAMP_UNITS = 'میلی آمپر|میلی امپر|میلیآمپر|میلیامپر|ma';
const WATT_UNITS = 'واتی|وات|w|watt|watts';

export function voltsOf(t: string): number | null {
  const vals = findQuantities(t, VOLT_UNITS, { words: false }).map((h) => h.value).filter((v) => v > 0 && v <= 400);
  const low = vals.filter((v) => v < 100);
  // mains input (110/220/230/240) is not the output voltage
  const use = low.length ? low : [];
  return use.length ? single(use) : null;
}

export function ampsOf(t: string): number | null {
  const ma = findQuantities(t, MILLIAMP_UNITS, { words: false }).map((h) => h.value / 1000);
  const tNoMa = t.replace(new RegExp(`(\\d)\\s*(?:${MILLIAMP_UNITS})`, 'g'), '$1 ');
  const a = findQuantities(tNoMa, AMP_UNITS, { words: false }).map((h) => h.value);
  const vals = [...ma, ...a].filter((v) => v > 0 && v <= 100);
  return vals.length ? single(vals) : null;
}

export function wattsOf(t: string): number | null {
  const vals = findQuantities(t, WATT_UNITS, { words: false }).map((h) => h.value).filter((v) => v > 0 && v <= 5000);
  return vals.length ? single(vals) : null;
}

/** «3 تا 12 ولت», «3-12V», «3 to 12V»: an adjustable output, not one voltage. */
const VOLT_RANGE_RE = /(?<![0-9.])\d+(?:[.,/]\d+)?\s*(?:v|ولت)?\s*(?:تا|-|–|to|الی|~)\s*\d+(?:[.,/]\d+)?\s*(?:v|ولت|volt)(?![a-z\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/;

export function extractAdapter(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  const variable = VOLT_RANGE_RE.test(t) || word('متغیر|قابل تنظیم|variable|adjustable').test(t);
  if (variable) res.attrs.variable = true;
  const v = variable ? null : voltsOf(t);
  const a = ampsOf(t);
  if (v != null) res.attrs.volts = v;
  else if (!variable) {
    const s = specValue(ctx, ['ولتاژ خروجی']);
    const sv = s ? voltsOf(s) ?? (/^\d+(?:[./]\d+)?$/.test(s) ? parseNum(s) : null) : null;
    if (sv != null && sv > 0 && sv < 100) { res.attrs.volts = sv; res.src.volts = 'spec'; }
  }
  if (a != null) res.attrs.amps = a;
  else {
    const s = specValue(ctx, ['جریان خروجی', 'شدت جریان خروجی']);
    const sa = s ? ampsOf(s) : null;
    if (sa != null) { res.attrs.amps = sa; res.src.amps = 'spec'; }
  }
  const w = wattsOf(t);
  if (w != null) res.attrs.watts = w;
  if (word('poe|پو ای').test(t)) res.attrs.poe = true;
  return res;
}

export function extractCharger(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const w = wattsOf(ctx.t);
  if (w != null) res.attrs.watts = w;
  if (REPLICA_RE.test(ctx.t)) res.attrs.replica = true;
  return res;
}

export function extractPowerBank(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  const mah = findQuantities(t, 'میلی آمپر ساعت|میلی امپر ساعت|میلیآمپر ساعت|میلی آمپرساعت|mah|میلی آمپر|میلی امپر|میلیآمپر', { words: false }).map((h) => h.value);
  const thousand = [...t.matchAll(/(?<![0-9.])(\d{1,2})\s*هزار(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g)].map((m) => Number(m[1]) * 1000);
  const vals = [...mah, ...thousand].filter((v) => v >= 1000 && v <= 100000);
  const s = vals.length ? single(vals) : null;
  if (s != null) res.attrs.mah = s;
  const w = wattsOf(t);
  if (w != null) res.attrs.watts = w;
  if (REPLICA_RE.test(t)) res.attrs.replica = true;
  return res;
}

const WIRELESS_RE = word('بلوتوث|بلوتوثی|bluetooth|بی سیم|بیسیم|وایرلس|wireless|tws|ایرپاد|airpods|airpod|ایربادز|earbuds|buds|بادز|گردنی بلوتوثی');
const WIRED_RE = word('سیمی|باسیم|با سیم|wired|aux|جک 3.5');

export function extractHeadphones(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const wl = WIRELESS_RE.test(ctx.t);
  const wd = WIRED_RE.test(ctx.t);
  if (wl && !wd) res.attrs.wireless = true;
  else if (wd && !wl) res.attrs.wireless = false;
  if (REPLICA_RE.test(ctx.t)) res.attrs.replica = true;
  return res;
}

export function extractLighting(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const w = wattsOf(ctx.t);
  if (w != null) res.attrs.watts = w;
  return res;
}

// ---------------------------------------------------------------- building wire

export const STANDARD_SECTIONS = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630];
const SECT = new Set(STANDARD_SECTIONS);
const isCore = (v: number) => Number.isInteger(v) && v >= 1 && v <= 5;

/** Control/instrument cables: «24×1», «7×1.5» (6..61 cores of a standard section). */
function controlCable(a: number, b: number): [number, number] | null {
  const many = (v: number) => Number.isInteger(v) && v >= 6 && v <= 61 && !SECT.has(v);
  if (many(a) && SECT.has(b) && b <= 2.5) return [a, b];
  if (many(b) && SECT.has(a) && a <= 2.5) return [b, a];
  return null;
}

function pairToCoresSection(a: number, b: number, singleWire: boolean): [number, number] | null {
  if (a === b) return SECT.has(a) && isCore(a) ? [a, a] : null;
  const ab = isCore(a) && SECT.has(b); // a cores x b mm2
  const ba = isCore(b) && SECT.has(a);
  if (ab && !ba) return [a, b];
  if (ba && !ab) return [b, a];
  if (ab && ba && singleWire) return a === 1 ? [1, b] : b === 1 ? [1, a] : null;
  return null;
}

export function extractWire(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  const singleWire = /^سیم(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(t) && !/^سیم (?:سیار|کشی)/.test(t);
  // «3×95+50», «3 در 70 به علاوه 35»: a cable with a reduced neutral — no single section
  const multiAny = /\d\s*\+\s*\d|به ?علاوه/.test(t);
  const results: Array<[number, number]> = [];
  let multiSection = multiAny;
  const pairRe = /(?<![\d.,/+])(\d+(?:[.,/]\d+)?)\s*(?:\*|×|x|در|ضرب|✕|×)\s*(\d+(?:[.,/]\d+)?)(?![\d.,/])(\s*\+)?/g;
  for (const m of t.matchAll(pairRe)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
    if (m[3] || /\+\s*$/.test(before)) { multiSection = true; continue; }
    const a = parseNum(m[1] as string);
    const b = parseNum(m[2] as string);
    if (a == null || b == null) continue;
    const r = pairToCoresSection(a, b, singleWire) ?? controlCable(a, b);
    if (r) results.push(r);
    else results.push([NaN, NaN]);
  }
  const awg = word('awg').test(t);
  if (!multiSection && !awg && results.length) {
    const uniq = new Set(results.map(([c, s]) => `${c}x${s}`));
    if (uniq.size === 1 && !Number.isNaN(results[0]![0])) {
      res.attrs.cores = results[0]![0];
      res.attrs.section_mm2 = results[0]![1];
    }
  } else if (!multiSection && !awg && results.length === 0) {
    // single number: «سیم ۲/۵», «سایز ۲۵», «نمره ۱/۵», «1.5 میلیمتر»
    const singles: number[] = [];
    for (const m of t.matchAll(/(?:سایز|نمره|سطح مقطع|مقطع)\s*:?\s*(\d+(?:[.,/]\d+)?)(?![\d.,/x*\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g)) {
      const v = parseNum(m[1] as string);
      if (v != null) singles.push(v);
    }
    for (const h of findQuantities(t, 'میلیمتر مربع|میلی متر مربع|mm2|mm²|میلیمتر|میلی متر|mm', { words: false })) singles.push(h.value);
    if (singleWire) {
      const m = t.match(/^سیم(?:\s+(?:برق|افشان|مفتولی|خشک|نایلونی|مسی|ارت|تک رشته|افشون))*\s+(\d+(?:[.,/]\d+)?)(?![\d.,/x*\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/);
      if (m) { const v = parseNum(m[1] as string); if (v != null) singles.push(v); }
    }
    const s = single(singles.filter((v) => SECT.has(v)));
    if (s != null && singles.every((v) => v === s)) {
      res.attrs.section_mm2 = s;
      if (singleWire) res.attrs.cores = 1;
    }
  }
  if (res.attrs.section_mm2 == null && !multiSection && results.length === 0) {
    const v = specValue(ctx, ['سطح مقطع', 'سایز']);
    if (v) {
      const hs = findQuantities(v, 'میلیمتر مربع|میلی متر مربع|mm2|mm²|میلیمتر|میلی متر', { words: false }).map((h) => h.value);
      const s = hs.length ? single(hs) : null;
      if (s != null && SECT.has(s)) { res.attrs.section_mm2 = s; res.src.section_mm2 = 'spec'; }
    }
  }
  if (res.attrs.cores == null) {
    const c = findQuantities(t, 'رشته ای|رشته', {}).map((h) => h.value).filter(isCore);
    const s = c.length ? single(c) : null;
    if (s != null) res.attrs.cores = s;
  }
  // sale unit
  const rolls: number[] = [];
  for (const m of t.matchAll(/(?<![\d.,/])(\d+)\s*متر(?:ی)?(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 4), m.index ?? 0);
    if (/(?:\*|×|x|در)\s*$/.test(before)) continue;
    const n = Number(m[1]);
    if (n === 1) rolls.push(1);
    else if (n >= 2 && n <= 2000) rolls.push(n);
  }
  if (/(?:حلقه|کلاف|رول) ?(?:صد|یکصد) ?متر/.test(t) || /صد ?متری/.test(t)) rolls.push(100);
  const perMeter = /(?<![\d\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])(?:قیمت متری|فروش متری|واحد فروش متر|به صورت متری|متری(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])|یک متر(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])|هر متر|متر طول|متراژ دلخواه|برش دلخواه|طول دلخواه)/.test(t.replace(/\d+\s*متری/g, ' '));
  const rollWord = /(?<![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])(?:حلقه|کلاف|قرقره|رول)(?![\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/.test(t);
  const lens = [...new Set(rolls)];
  const meterSignal = perMeter || lens.includes(1);
  const rollLens = lens.filter((n) => n > 1);
  if (meterSignal && (rollLens.length || rollWord)) {
    // both «metre» and «roll» stated: unknown
  } else if (meterSignal) {
    res.attrs.sale_unit = 'meter';
  } else if (rollLens.length === 1) {
    res.attrs.roll_m = rollLens[0] as number;
    res.attrs.sale_unit = rollLens[0] === 100 ? 'roll100' : 'other';
  } else if (rollLens.length === 0 && rollWord) {
    res.attrs.sale_unit = 'other';
  }
  if (res.attrs.sale_unit == null && rollLens.length === 0 && !meterSignal && !rollWord) {
    const v = specValue(ctx, ['متراژ']);
    if (v) {
      if (/^(?:کلاف )?100 ?متر(?:ی)?$/.test(v)) { res.attrs.sale_unit = 'roll100'; res.attrs.roll_m = 100; res.src.sale_unit = 'spec'; }
      else if (/^(?:به صورت متری|1 ?متر(?:ی)?|یک متر)$/.test(v)) { res.attrs.sale_unit = 'meter'; res.src.sale_unit = 'spec'; }
    }
  }
  const cu = word('مسی|مس|copper|cu').test(t);
  const al = word('آلومینیوم|آلومینیومی|الومینیوم|الومینیومی|آلمینیوم|aluminium|aluminum').test(t);
  if (word('cca').test(t)) { /* copper-clad aluminium: leave unknown */ }
  else if (cu && !al) res.attrs.conductor = 'copper';
  else if (al && !cu) res.attrs.conductor = 'aluminium';
  const flex = word('افشان|افشون|نایلونی|flexible|فلکسیبل|قابل انعطاف').test(t);
  const solid = word('مفتولی|مفتول|خشک|تک مفتول').test(t);
  if (flex && !solid) res.attrs.strand = 'flexible';
  else if (solid && !flex) res.attrs.strand = 'solid';
  return res;
}

// ---------------------------------------------------------------- phones

const STORAGE_OK = new Set([2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]);
const RAM_OK = new Set([0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 18, 24]);

function unitFactor(u: string | undefined): number | null {
  if (!u) return null;
  if (/^(?:ترابایت|ترا|tb)$/.test(u)) return 1024;
  if (/^(?:گیگابایت|گیگ|gb)$/.test(u)) return 1;
  if (/^(?:مگابایت|مگ|mb)$/.test(u)) return 1 / 1024;
  return null;
}

export function extractPhoneMemory(t: string): { storage_gb?: number; ram_gb?: number } {
  const U = '(ترابایت|ترا|tb|گیگابایت|گیگ|gb|مگابایت|mb)?';
  const out: { storage_gb?: number; ram_gb?: number } = {};
  const sm = t.match(new RegExp(`(?:حافظه داخلی|حافظه|ظرفیت)\\s*:?\\s*(\\d{1,4})\\s*${U}(?![a-z\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF])`));
  const rm = t.match(new RegExp(`(?:رم|ram)\\s*:?\\s*(\\d{1,2}(?:[./]\\d)?)\\s*${U}(?![a-z\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF])`)) ??
    t.match(new RegExp(`(\\d{1,2})\\s*(گیگابایت|گیگ|gb)\\s*(?:رم|ram)(?![a-z\\u0620-\\u064A\\u066E-\\u06D3\\u06FA-\\u06FF])`));
  let sVal: number | null = sm ? Number(sm[1]) : null;
  let sUnit = sm?.[2];
  let rVal: number | null = rm ? parseNum(rm[1] as string) : null;
  let rUnit = rm?.[2];
  if (sVal != null && rVal != null) {
    // «حافظه 128 رم 4 گیگابایت»: the trailing unit applies to both
    if (!sUnit && rUnit) sUnit = rUnit;
  }
  if (sVal == null) {
    // «256 گیگابایت» / «1 ترابایت» without a label
    const hits = [...t.matchAll(/(?<![a-z0-9.])(\d{1,4})\s*(ترابایت|ترا|tb|گیگابایت|گیگ|gb)(?![a-z\u0620-\u064A\u066E-\u06D3\u06FA-\u06FF])/g)]
      .filter((m) => !(rm && m.index === rm.index))
      .map((m) => (Number(m[1]) * (unitFactor(m[2]) ?? 0)));
    const big = [...new Set(hits.filter((v) => v >= 16))];
    if (big.length === 1) { sVal = big[0] as number; sUnit = 'gb'; }
    if (rVal == null) {
      const small = [...new Set(hits.filter((v) => v > 0 && v <= 24 && RAM_OK.has(v)))];
      if (small.length === 1 && big.length === 1 && rm == null) { rVal = small[0] as number; rUnit = 'gb'; }
    }
  }
  if (sVal != null) {
    const f = unitFactor(sUnit);
    if (f != null && f >= 1) {
      const gb = sVal * f;
      if (STORAGE_OK.has(gb)) out.storage_gb = gb;
    }
  }
  if (rVal != null) {
    const f = unitFactor(rUnit ?? sUnit);
    if (f === 1 && RAM_OK.has(rVal)) out.ram_gb = rVal;
  }
  return out;
}

export function extractPhone(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const t = ctx.t;
  Object.assign(res.attrs, extractPhoneMemory(t));
  const models = extractDeviceModels(ctx.title, ctx.brandKey);
  if (models.length === 1) res.attrs.model_key = models[0] as string;
  else if (models.length === 0 && ctx.modelField) {
    const mf = extractDeviceModels(ctx.modelField, ctx.brandKey);
    if (mf.length === 1) { res.attrs.model_key = mf[0] as string; res.src.model_key = 'model_field'; }
  }
  const g5 = word('5g').test(t);
  const g4 = word('4g|lte').test(t);
  if (g5 && !g4) res.attrs.network = '5g';
  else if (g4 && !g5) res.attrs.network = '4g';
  if (extractReplica(t, 'phone')) res.attrs.replica = true;
  return res;
}

export function extractPhoneAccessory(ctx: DomainContext): DomainResult {
  const res: DomainResult = { attrs: {}, src: {} };
  const models = extractDeviceModels(ctx.title, ctx.brandKey);
  // the dataset model field is sometimes wrong (a different model than the title): only a fallback
  if (models.length === 0 && ctx.modelField && !/^authentic-base/.test(ctx.modelField)) {
    for (const m of extractDeviceModels(ctx.modelField, ctx.brandKey)) {
      if (!models.includes(m)) { models.push(m); res.src.fits_models = 'model_field'; }
    }
  }
  if (models.length) res.attrs.fits_models = models;
  return res;
}
