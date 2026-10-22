/**
 * Category -> Requirement.kind: the ONE place that decides which compat role an item plays.
 * Keyed by the dataset category NAME (normalised), because category ids are build artefacts.
 * Only CCTV, phone accessories and wire have engine rules; every other category is 'other'.
 */
import { normalizeFa } from '../normalize/index';
import type { ItemKind } from '../types/index';

const TABLE: ReadonlyArray<readonly [ItemKind, readonly string[]]> = [
  ['camera', ['دوربین مدار بسته', 'دوربین امنیتی خورشیدی', 'دوربین‌های نظارتی و امنیتی', 'دوربین مخفی']],
  ['recorder', ['ضبط کننده ویدیویی دوربین‌های نظارتی و امنیتی', 'ضبط کننده تصویر']],
  // internal drives only; SSDs are not the recorder's surveillance drive
  ['hdd', ['هارد دیسک اینترنال', 'هارد سرور']],
  ['adapter', ['آداپتور برق', 'منبع تغذیه سوییچینگ', 'سایر منبع تغذیه', 'منبع تغذیه']],
  ['wire', ['سیم و کابل برق ساختمان']],
  ['phone', ['گوشی موبایل', 'گوشی شیائومی']],
  // «قاب، شاسی و درب گوشی» is a repair housing, not a case: it stays 'other'
  ['phone_case', ['کیف و کاور گوشی']],
  ['screen_protector', ['محافظ صفحه نمایش گوشی']],
];

const BY_NAME = new Map<string, ItemKind>();
for (const [kind, names] of TABLE) for (const n of names) BY_NAME.set(normalizeFa(n), kind);

/** Kind of one category (by name); 'other' when the category has no rules. */
export function kindForCategoryName(name: string | null | undefined): ItemKind {
  if (!name) return 'other';
  return BY_NAME.get(normalizeFa(name)) ?? 'other';
}

/**
 * Kind of an item searched in several categories: the first category with a rule-bearing kind wins
 * (categories are ordered by relevance by the parser / the vote).
 */
export function kindForCategoryNames(names: readonly (string | null | undefined)[]): ItemKind {
  for (const n of names) {
    const k = kindForCategoryName(n);
    if (k !== 'other') return k;
  }
  return 'other';
}

export const KIND_CATEGORY_TABLE = TABLE;
