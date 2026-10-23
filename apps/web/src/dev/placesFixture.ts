/**
 * Dev-only fixture for #/dev/places. Mall names, coordinates, shops, floors, units, products, prices and image URLs
 * are taken from the real dataset (Aladdin / Charsou / Amjad / Yegane around Sheikh Hadi, Tejarat-e Jahani on
 * Ferdowsi). The ranking and badges are hand-set to exercise every state of the screen.
 */
import type { PlaceItemLine, PlaceMall, PlacesResponse } from '@app/core/src/api/dto';
import type { Stop } from '../api/types';

const ITEMS = {
  phone: { itemId: 'i1', itemName: 'گوشی شیائومی Redmi 13C' },
  case: { itemId: 'i2', itemName: 'قاب گوشی' },
  charger: { itemId: 'i3', itemName: 'کلگی شارژر' },
  buds: { itemId: 'i4', itemName: 'هندزفری بی‌سیم' },
} as const;

const miss = (k: keyof typeof ITEMS): PlaceItemLine => ({ ...ITEMS[k], covered: false });

function mall(m: Omit<PlaceMall, 'covered' | 'total' | 'totalToman'>): PlaceMall {
  const covered = m.items.filter((i) => i.covered).length;
  const priced = m.items.filter((i) => i.covered && i.unitPrice != null);
  return {
    ...m,
    covered,
    total: m.items.length,
    totalToman: priced.length ? priced.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.qty ?? 1), 0) : null,
  };
}

const ALADDIN = mall({
  id: 'm:علاالدین',
  name: 'پاساژ علاالدین',
  lat: 35.69485,
  lon: 51.41149,
  areaLabel: 'شیخ هادی',
  floors: ['طبقهٔ -۲', 'همکف', 'طبقهٔ ۵'],
  shopCount: 63,
  open: 'open',
  hoursText: 'تا ۲۱:۰۰',
  badges: ['one_stop', 'open_now', 'most_choice'],
  items: [
    {
      ...ITEMS.phone,
      covered: true,
      productName: 'گوشی شیائومی Redmi 13C | حافظه 256 رم 8 گیگابایت',
      imageUrl: 'https://image.torob.com/base/images/ld/nV/ldnVXm0aFuXlAILB.jpg',
      unitPrice: 65_000_000,
      qty: 1,
      shopName: 'سرووش پاکآرا',
      floor: 'همکف',
      unit: 'واحد ۴۲',
      shopsWithItem: 41,
    },
    {
      ...ITEMS.case,
      covered: true,
      productName: 'کاور گوشی سیلیکونی مدل Redmi 13C',
      imageUrl: 'https://image.torob.com/base/images/nu/2-/nu2-8NcU7MVxyVJp.jpg',
      unitPrice: 67_000,
      qty: 2,
      shopName: 'آرانوش آوانوش',
      floor: 'طبقهٔ ۵',
      unit: 'واحد ۵۸۳',
      shopsWithItem: 21,
    },
    {
      ...ITEMS.charger,
      covered: true,
      productName: 'کلگی شارژر کپی 0.7 آمپر',
      imageUrl: 'https://image.torob.com/base/images/4b/2Y/4b2YJ9DxBSZi2rIy.jpg',
      unitPrice: 196_000,
      qty: 1,
      shopName: 'سرویلا سرویسا',
      floor: 'طبقهٔ -۲',
      unit: 'واحد ۱۳۳',
      shopsWithItem: 40,
    },
    {
      ...ITEMS.buds,
      covered: true,
      productName: 'هندزفری بی‌سیم تک گوش HI-FI M5',
      imageUrl: 'https://image.torob.com/base/images/OD/KD/ODKDqZDyyI34iEIN.jpg',
      unitPrice: 206_000,
      qty: 1,
      shopName: 'ماهدیس پاکآرا',
      floor: 'طبقهٔ -۲',
      unit: 'واحد ۱۳۳',
      shopsWithItem: 44,
    },
  ],
});

const TEJARAT = mall({
  id: 'm:تجارتجهانیفردوسی',
  name: 'پاساژ تجارت جهانی',
  lat: 35.70052,
  lon: 51.41965,
  areaLabel: 'فردوسی',
  floors: ['همکف', 'طبقهٔ ۱'],
  shopCount: 9,
  open: 'closed',
  hoursText: 'فردا از ۹:۳۰',
  badges: ['cheapest'],
  items: [
    { ...ITEMS.phone, covered: true, productName: 'گوشی شیائومی Redmi 13C | حافظه 256 رم 8 گیگابایت', imageUrl: 'https://image.torob.com/base/images/ld/nV/ldnVXm0aFuXlAILB.jpg', unitPrice: 64_400_000, qty: 1, shopName: 'آرتین موبایل', floor: 'همکف', unit: 'واحد ۱۲', shopsWithItem: 3 },
    { ...ITEMS.case, covered: true, productName: 'قاب سیلیکونی ساده', unitPrice: 60_000, qty: 2, shopName: 'آرتین موبایل', floor: 'همکف', unit: 'واحد ۱۲', shopsWithItem: 2 },
    { ...ITEMS.charger, covered: true, productName: 'کلگی شارژر سامسونگ', imageUrl: 'https://image.torob.com/base/images/CK/pe/CKpeByM2UnJj5zEx.jpg', unitPrice: 180_000, qty: 1, shopName: 'دیجی‌سل', floor: 'طبقهٔ ۱', unit: 'واحد ۳۴', shopsWithItem: 2 },
    { ...ITEMS.buds, covered: true, productName: 'هندزفری بی‌سیم ساده', unitPrice: 190_000, qty: 1, shopName: 'دیجی‌سل', floor: 'طبقهٔ ۱', unit: 'واحد ۳۴', shopsWithItem: 1 },
  ],
});

const CHARSOU = mall({
  id: 'm:چارسو',
  name: 'پاساژ چارسو',
  lat: 35.6948,
  lon: 51.41226,
  areaLabel: 'شیخ هادی',
  floors: ['طبقهٔ ۱', 'طبقهٔ ۲'],
  shopCount: 26,
  open: 'open',
  hoursText: 'تا ۲۱:۱۵',
  badges: ['open_now'],
  items: [
    miss('phone'),
    { ...ITEMS.case, covered: true, productName: 'کاور طرح عروسکی', imageUrl: 'https://image.torob.com/base/images/iW/I1/iWI1FAiMWUxd5L_s.jpg', unitPrice: 180_000, qty: 2, shopName: 'نیکیسا آوین', floor: 'طبقهٔ ۲', unit: 'واحد D66', shopsWithItem: 12 },
    { ...ITEMS.charger, covered: true, productName: 'کلگی شارژر سامسونگ', imageUrl: 'https://image.torob.com/base/images/CK/pe/CKpeByM2UnJj5zEx.jpg', unitPrice: 350_000, qty: 1, shopName: 'ویسا پاکنوش', floor: 'طبقهٔ ۲', unit: 'واحد ۱۲', shopsWithItem: 15 },
    { ...ITEMS.buds, covered: true, productName: 'هندزفری سامسونگ SAMSUNG TUNED BY AKG', imageUrl: 'https://image.torob.com/base/images/eC/8H/eC8HUIv35jut9PLW.jpg', unitPrice: 400_000, qty: 1, shopName: 'ویسا پاکنوش', floor: 'طبقهٔ ۲', unit: 'واحد ۱۲', shopsWithItem: 26 },
  ],
});

const AMJAD = mall({
  id: 'm:امجد',
  name: 'پاساژ امجد',
  lat: 35.69484,
  lon: 51.41288,
  areaLabel: 'شیخ هادی',
  floors: ['طبقهٔ ۱'],
  shopCount: 2,
  open: 'open',
  hoursText: 'تا ۱۸:۰۰',
  badges: [],
  items: [
    miss('phone'),
    miss('case'),
    { ...ITEMS.charger, covered: true, productName: 'شارژر ۲ آمپر', imageUrl: 'https://image.torob.com/base/images/0S/5b/0S5bSoUq7WupazcN.jpg', unitPrice: 750_000, qty: 1, shopName: 'نویلا آذروش', floor: 'طبقهٔ ۱', unit: 'واحد ۴۰', shopsWithItem: 2 },
    miss('buds'),
  ],
});

const YEGANE = mall({
  id: 'm:یگانه',
  name: 'پاساژ یگانه',
  lat: 35.69562,
  lon: 51.40718,
  areaLabel: 'شیخ هادی',
  floors: ['طبقهٔ ۵'],
  shopCount: 1,
  open: 'unknown',
  badges: [],
  items: [
    miss('phone'),
    miss('case'),
    miss('charger'),
    { ...ITEMS.buds, covered: true, productName: 'هدست با سیم لاجیتک مدل H110', imageUrl: 'https://image.torob.com/base/images/5U/Gj/5UGjNNAFpefpnZ3j.jpg', unitPrice: 2_200_000, qty: 1, shopName: 'نییرا نیکوان', floor: 'طبقهٔ ۵', unit: 'واحد ۵۰۱', shopsWithItem: 2 },
  ],
});

export const FULL: PlacesResponse = {
  malls: [ALADDIN, TEJARAT, CHARSOU, AMJAD, YEGANE],
  bestId: ALADDIN.id,
  headline: 'همهٔ ۴ مورد در پاساژ علاالدین هست',
};

/** Nobody has the phone: the best mall covers 3 of 4. */
function dropPhone(m: PlaceMall): PlaceMall {
  return mall({ ...m, badges: m.badges.filter((b) => b !== 'one_stop'), items: m.items.map((i) => (i.itemId === 'i1' ? miss('phone') : i)) });
}
export const PARTIAL: PlacesResponse = {
  malls: [ALADDIN, CHARSOU, TEJARAT, AMJAD, YEGANE].map(dropPhone),
  bestId: ALADDIN.id,
};

export const EMPTY: PlacesResponse = { malls: [], bestId: null };

/** Ordered plan stops with coordinates (only the fields the route uses are meaningful). */
export const STOPS = [ALADDIN, CHARSOU, TEJARAT].map(
  (m, i) =>
    ({
      id: `s${i + 1}`,
      index: i + 1,
      mall: m.name,
      shopId: '',
      shopName: '',
      address: '',
      hoursText: '',
      open: m.open,
      lines: [],
      lat: m.lat,
      lon: m.lon,
    }) satisfies Stop,
);
