import { normalizeFa, type Domain, type ItemKind } from '@app/core';

export interface KindInfo {
  kind: ItemKind;
  /** Extraction domain when the category has one (also set for wire, whose kind is 'wire'). */
  domain?: string;
}

/**
 * Category name rules -> ItemKind (the role of an item in the compatibility rules).
 *   cctv_camera -> camera, recorder -> recorder, hdd -> hdd, adapter -> adapter, phone -> phone, wire -> wire
 *   phone_accessory: «کیف و کاور گوشی» -> phone_case; «محافظ صفحه نمایش گوشی» -> screen_protector;
 *                    other accessory categories (lens protector, frames, batteries, repair glass) -> other.
 * `other` is also the answer for every category outside the extraction domains.
 */
export function kindForCategory(name: string, domain: Domain | null): KindInfo {
  const n = normalizeFa(name);
  switch (domain) {
    case 'cctv_camera':
      return { kind: 'camera' };
    case 'recorder':
      return { kind: 'recorder' };
    case 'hdd':
      return { kind: 'hdd' };
    case 'adapter':
      return { kind: 'adapter' };
    case 'phone':
      return { kind: 'phone' };
    case 'wire':
      return { kind: 'wire', domain: 'wire' };
    case 'phone_accessory':
      if (/^کیف و کاور گوشی/.test(n)) return { kind: 'phone_case' };
      if (/^محافظ صفحه نمایش گوشی/.test(n)) return { kind: 'screen_protector' };
      return { kind: 'other' };
    default:
      return { kind: 'other' };
  }
}
