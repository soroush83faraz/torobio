/**
 * THE attribute mapping: extractor `products.attrs` (domain.key, see packages/core/src/extract/ATTRIBUTES.md)
 * -> engine `ProductAttrs` (closed ATTR_SCHEMA). Table-driven; one row per extractor key.
 *
 * Rules
 * - absent stays absent (unknown is first-class; nothing is guessed);
 * - values whose `_src` is 'spec' (seller/catalogue spec block) are NOT used for evaluation: they go to
 *   `specAttrs` (display only), so a product is never auto-picked on a spec-only value;
 * - every mapped value is validated against ATTR_SCHEMA (enum membership, finite positive numbers).
 */
import type { AttrKey, AttrValue, ProductAttrs } from '@app/core';
import { ATTR_SCHEMA } from '@app/core';

export type ExtractorDomain =
  | 'cctv_camera'
  | 'recorder'
  | 'hdd'
  | 'adapter'
  | 'wire'
  | 'phone'
  | 'phone_accessory'
  | 'charger'
  | 'power_bank'
  | 'headphones'
  | 'lighting'
  | 'switch_socket';

type Raw = Record<string, unknown>;

export interface FieldRule {
  /** extractor key */
  from: string;
  /** engine key */
  to: AttrKey;
  /** value transform; undefined = drop. Receives the whole raw attrs for cross-field rules. */
  map?: (v: unknown, raw: Raw) => AttrValue | undefined;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strList = (v: unknown) => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  return out.length ? out : undefined;
};
const notAdjustable = (f: (v: unknown) => number | undefined) => (v: unknown, raw: Raw) => (raw.variable === true ? undefined : f(v));

/** Brand: constrain on the stable slug (brand_key); the Persian display name stays in products.brand. */
const COMMON: readonly FieldRule[] = [{ from: 'brand_key', to: 'brand', map: str }];

export const ATTR_MAP: Readonly<Record<ExtractorDomain, readonly FieldRule[]>> = {
  cctv_camera: [
    { from: 'mp', to: 'resolution_mp', map: num },
    // 'analog' = known analog family, exact format unknown (still implies an XVR/DVR recorder)
    { from: 'signal', to: 'camera_signal', map: (v) => (['ip', 'ahd', 'hdcvi', 'tvi', 'analog'].includes(v as string) ? (v as string) : undefined) },
    { from: 'form', to: 'camera_form', map: (v) => (v === 'bullet' || v === 'dome' ? v : undefined) },
    // PTZ wins over a body form (the extractor never sets both)
    { from: 'ptz', to: 'camera_form', map: (v) => (v === true ? 'ptz' : undefined) },
  ],
  recorder: [
    { from: 'kind', to: 'recorder_kind', map: (v) => (v === 'nvr' || v === 'xvr' || v === 'dvr' ? v : undefined) },
    { from: 'channels', to: 'channels', map: int },
  ],
  hdd: [
    { from: 'tb', to: 'capacity_tb', map: num },
    { from: 'surveillance', to: 'hdd_surveillance', map: bool },
  ],
  adapter: [
    // an adjustable adapter has no single output: both stay unknown
    { from: 'volts', to: 'voltage_v', map: notAdjustable(num) },
    { from: 'amps', to: 'current_a', map: notAdjustable(num) },
    { from: 'watts', to: 'power_w', map: num },
  ],
  wire: [
    { from: 'section_mm2', to: 'wire_section_mm2', map: num },
    { from: 'cores', to: 'wire_cores', map: int },
    // roll100 -> 'roll' (a 100 m roll); meter -> 'meter'; 'other' (another / unstated roll length) -> unknown
    { from: 'sale_unit', to: 'sale_unit', map: (v) => (v === 'roll100' ? 'roll' : v === 'meter' ? 'meter' : undefined) },
    { from: 'roll_m', to: 'length_m', map: int },
    { from: 'strand', to: 'wire_strand', map: (v) => (v === 'flexible' || v === 'solid' ? v : undefined) },
  ],
  phone: [
    // device-model key convention shared with phone_accessory.fits_models (lower-case, e.g. 'galaxy a56 5g')
    { from: 'model_key', to: 'phone_model', map: (v) => str(v)?.toLowerCase() },
    { from: 'storage_gb', to: 'storage_gb', map: int },
    { from: 'ram_gb', to: 'ram_gb', map: num },
  ],
  phone_accessory: [{ from: 'fits_models', to: 'fits_models', map: (v) => strList(v)?.map((m) => m.toLowerCase()) }],
  // stated power / capacity: evaluated when the user states them («شارژر ۲۵ وات», «پاوربانک ۲۰ هزار»)
  charger: [{ from: 'watts', to: 'power_w', map: num }],
  power_bank: [
    { from: 'mah', to: 'capacity_mah', map: num },
    { from: 'watts', to: 'power_w', map: num },
  ],
  headphones: [],
  lighting: [{ from: 'watts', to: 'power_w', map: num }],
  switch_socket: [],
};

/** Non-engine listing facts kept for display (used / refurbished / replica). */
export interface ListingFlags {
  condition?: 'used' | 'refurbished';
  replica?: boolean;
}

export interface MappedAttrs {
  /** Engine attributes used for evaluation and compat (title / model code / model field values only). */
  attrs: ProductAttrs;
  /** Spec-block values: display only, never evaluated. */
  specAttrs: ProductAttrs;
  flags: ListingFlags;
}

function validFor(key: AttrKey, v: AttrValue): boolean {
  const spec = ATTR_SCHEMA[key];
  switch (spec.kind) {
    case 'enum':
      return typeof v === 'string' && (spec.values ?? []).includes(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'string':
      return typeof v === 'string' && v.length > 0;
    case 'string_list':
      return Array.isArray(v) && v.length > 0;
  }
}

export function parseAttrsJson(json: string | null | undefined): Raw {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
  } catch {
    return {};
  }
}

/** Map one product's extractor attrs into engine attrs. `domain` = products.domain (NULL = brand only). */
export function mapAttrs(domain: string | null | undefined, raw: Raw): MappedAttrs {
  const src = (raw._src && typeof raw._src === 'object' ? raw._src : {}) as Record<string, unknown>;
  const rules = [...COMMON, ...((domain && ATTR_MAP[domain as ExtractorDomain]) || [])];
  const attrs: Record<string, AttrValue> = {};
  const specAttrs: Record<string, AttrValue> = {};
  for (const r of rules) {
    if (!(r.from in raw) || r.from === '_src') continue;
    const v = r.map ? r.map(raw[r.from], raw) : (raw[r.from] as AttrValue);
    if (v === undefined || !validFor(r.to, v)) continue;
    if (src[r.from] === 'spec') specAttrs[r.to] = v;
    else attrs[r.to] = v;
  }
  const flags: ListingFlags = {};
  if (raw.condition === 'used' || raw.condition === 'refurbished') flags.condition = raw.condition;
  if (raw.replica === true) flags.replica = true;
  return { attrs: attrs as ProductAttrs, specAttrs: specAttrs as ProductAttrs, flags };
}

// ---------------------------------------------------------------------------------------------
// Text-derived attrs (the parser): the same rule table, applied to what the extractors read from the
// user's own sentence instead of a product row. Domain-agnostic: extractor keys are unique across domains.

const RULES_BY_KEY: ReadonlyMap<string, readonly FieldRule[]> = (() => {
  const m = new Map<string, FieldRule[]>();
  for (const rules of Object.values(ATTR_MAP)) {
    for (const r of rules) m.set(r.from, [...(m.get(r.from) ?? []), r]);
  }
  return m;
})();

/** Extractor keys that are listing metadata, not requirements (brand is resolved separately by the parser). */
const TEXT_META_KEYS: ReadonlySet<string> = new Set(['brand_key', 'condition', 'replica', '_src']);

export interface TextAttrEntry {
  /** extractor key */
  from: string;
  /** engine key */
  attr: AttrKey;
  value: AttrValue;
}

/**
 * Map extractor attrs read from free text into engine (attr, value) entries via the SAME rules as `mapAttrs`
 * (single source of truth). Entries keep the input key order (the parser dedupes by attr, first wins).
 * `ignored` = extractor keys with no engine attribute; keys whose value is invalid for the schema are dropped
 * silently (understood, but not a usable claim).
 */
export function mapTextAttrs(raw: Raw, dropKeys: ReadonlySet<string> = new Set()): { entries: TextAttrEntry[]; ignored: string[] } {
  const entries: TextAttrEntry[] = [];
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (TEXT_META_KEYS.has(key) || dropKeys.has(key)) continue;
    const rules = RULES_BY_KEY.get(key);
    if (!rules) {
      ignored.push(key);
      continue;
    }
    for (const r of rules) {
      const v = r.map ? r.map(value, raw) : (value as AttrValue);
      if (v !== undefined && validFor(r.to, v)) entries.push({ from: key, attr: r.to, value: v });
    }
  }
  return { entries, ignored };
}
