import { normalizeFa, tokenizeForSearch } from '../normalize/index';
import { findBrandsInTokens, lookupBrandField } from './brands';
import {
  extractAdapter,
  extractCctvCamera,
  extractCharger,
  extractCondition,
  extractReplica,
  extractHdd,
  extractHeadphones,
  extractLighting,
  extractPhone,
  extractPhoneAccessory,
  extractPowerBank,
  extractRecorder,
  extractWire,
  type AttrSource,
  type Attrs,
  type DomainContext,
  type DomainResult,
} from './domain-extractors';
import { domainForCategory, titleBrandAllowed, type Domain } from './domains';
import { extractModelCodes, modelCodeKeys } from './model-codes';
import { prep } from './numbers';

export { extractDeviceModels, deviceModelBase } from './device-models';
export { extractModelCodes, modelCodeKeys, type ModelCode } from './model-codes';
export { BRANDS, findBrandsInTokens, lookupBrandField, brandByKey, type BrandEntry } from './brands';
export { domainForCategory, titleBrandAllowed, DOMAIN_CATEGORIES, type Domain } from './domains';
export { extractPhoneMemory, voltsOf, ampsOf, wattsOf, STANDARD_SECTIONS, extractCondition, extractReplica, extractListingFlags } from './domain-extractors';
export { prep as prepTitle } from './numbers';
export { screenInchOf } from './screen';
export type { Attrs, AttrSource } from './domain-extractors'; // AttrValue is exported by ./types (identical definition)

export interface SpecItem {
  key: string;
  value: string;
  section?: string;
}

export interface ExtractInput {
  title: string;
  categoryName?: string | null;
  /** dataset brand_name field ('null' / '' treated as missing) */
  brandField?: string | null;
  /** dataset model field */
  modelField?: string | null;
  specs?: SpecItem[] | Record<string, string> | null;
  /** set false to ignore specs (used by the labelled accuracy check) */
  useSpecs?: boolean;
}

export interface ExtractResult {
  domain: Domain | null;
  /** display brand (Persian) or null */
  brand: string | null;
  brandKey: string | null;
  /** attributes; absent key = unknown. `_src` maps attribute -> non-title source */
  attrs: Attrs & { _src?: Record<string, AttrSource> };
  /** normalised model codes (primary first, then variants) */
  modelCodes: string[];
}

const EXTRACTORS: Partial<Record<Domain, (ctx: DomainContext) => DomainResult>> = {
  cctv_camera: extractCctvCamera,
  recorder: extractRecorder,
  hdd: extractHdd,
  adapter: extractAdapter,
  wire: extractWire,
  phone: extractPhone,
  phone_accessory: extractPhoneAccessory,
  charger: extractCharger,
  power_bank: extractPowerBank,
  headphones: extractHeadphones,
  lighting: extractLighting,
};

function cleanField(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === 'null' ? null : s;
}

function specMap(specs: ExtractInput['specs']): Map<string, string> {
  const m = new Map<string, string>();
  if (!specs) return m;
  if (Array.isArray(specs)) {
    for (const s of specs) {
      if (!s || typeof s.key !== 'string' || typeof s.value !== 'string') continue;
      const k = normalizeFa(s.key).replace(/[:：]\s*$/, '').trim();
      if (!m.has(k)) m.set(k, s.value);
    }
  } else {
    for (const [k, v] of Object.entries(specs)) if (typeof v === 'string') m.set(normalizeFa(k), v);
  }
  return m;
}

/**
 * Brand: the dataset brand_name field when present; otherwise a lexicon match
 * in the title, but only when exactly one brand is named and the category is
 * not a "made for another device" category.
 */
export function resolveBrand(title: string, brandField: string | null, categoryName: string | null, domain: Domain | null): { brand: string | null; brandKey: string | null; fromTitle: boolean } {
  if (brandField) {
    const e = lookupBrandField(brandField);
    return { brand: e ? e.display : brandField, brandKey: e ? e.key : `fa:${normalizeFa(brandField)}`, fromTitle: false };
  }
  if (!titleBrandAllowed(categoryName, domain)) return { brand: null, brandKey: null, fromTitle: false };
  const hits = findBrandsInTokens(tokenizeForSearch(title));
  const strong = [...new Set(hits.filter((h) => !h.weak).map((h) => h.key))];
  const weak = [...new Set(hits.filter((h) => h.weak).map((h) => h.key))];
  let key: string | null = null;
  if (strong.length === 1 && weak.every((w) => w === strong[0])) key = strong[0] as string;
  else if (strong.length === 0 && weak.length === 1 && domain) key = weak[0] as string;
  if (!key) return { brand: null, brandKey: null, fromTitle: false };
  const hit = hits.find((h) => h.key === key);
  return { brand: hit ? hit.display : null, brandKey: key, fromTitle: true };
}

/** Extract everything we are confident about from one product. */
export function extractProduct(input: ExtractInput): ExtractResult {
  const title = input.title ?? '';
  const categoryName = cleanField(input.categoryName);
  const domain = domainForCategory(categoryName);
  const brandField = cleanField(input.brandField);
  const modelField = cleanField(input.modelField);
  const { brand, brandKey } = resolveBrand(title, brandField, categoryName, domain);
  const codes = extractModelCodes(title);
  const attrs: ExtractResult['attrs'] = {};
  const src: Record<string, AttrSource> = {};
  if (brandKey) attrs.brand_key = brandKey;
  const t = prep(title);
  const ctx: DomainContext = {
    t,
    title,
    codes,
    brandKey,
    specs: input.useSpecs === false ? new Map() : specMap(input.specs),
    modelField,
    categoryName,
  };
  const ex = domain ? EXTRACTORS[domain] : undefined;
  if (ex) {
    const r = ex(ctx);
    Object.assign(attrs, r.attrs);
    Object.assign(src, r.src);
  }
  const cond = extractCondition(t);
  if (cond) attrs.condition = cond;
  // replica: one generic rule for every extraction domain (the domain extractors may also have set it)
  if (extractReplica(t, domain)) attrs.replica = true;
  for (const k of Object.keys(src)) if (!(k in attrs)) delete src[k];
  if (Object.keys(src).length) attrs._src = src;
  return { domain, brand, brandKey, attrs, modelCodes: modelCodeKeys(codes) };
}
