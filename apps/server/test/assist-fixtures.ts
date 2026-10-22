/** Hand-made assistant facts and a CCTV requirement state (no database) for the assist unit tests. */
import { Api } from '@app/core';
import type { AssistFacts } from '../src/assist/facts.js';
import { chip, item, state } from './scenarios.js';

export function makeFacts(o: Partial<AssistFacts> = {}): AssistFacts {
  return {
    items: [
      { id: 'cam', text: '۴ دوربین داهوا ۲ مگاپیکسل', qty: 4, kind: 'camera', brand: 'dahua', stated: [] },
      { id: 'hdd', text: 'هارد ۲ ترابایت', qty: 1, kind: 'hdd', stated: [] },
    ],
    stops: [
      { shopId: 'shop_a1', shopName: 'فروشگاه الف', buildingKey: 'm:الف', mallKey: 'm:الف', mallName: 'پاساژ الف', itemIds: ['cam'] },
      { shopId: 'shop_c1', shopName: 'فروشگاه خیابانی', buildingKey: 'c:35.7,51.43', mallKey: null, mallName: null, itemIds: ['hdd'] },
    ],
    stopCount: 2,
    totalToman: 9_500_000,
    covered: 2,
    total: 2,
    complete: true,
    reason: 'ارزان‌ترین ترکیب با همین پوشش',
    totalLine: 'جمع ۲ مورد: ۹٫۵ میلیون تومان',
    activeVariant: null,
    visitActive: false,
    alternatives: [{ id: 'stops:1', deltaToman: 800_000, deltaStops: -1 }],
    shopsInBuilding: (bk) => (bk === 'm:الف' ? ['shop_a1', 'shop_a2', 'shop_a3'] : []),
    brandsFor: (id) =>
      id === 'cam'
        ? [
            { key: 'dahua', label: 'داهوا', count: 5 },
            { key: 'hikvision', label: 'هایک ویژن', count: 3 },
          ]
        : [],
    ...o,
  };
}

export function cctvState(extra: Partial<Api.RequirementState> = {}): Api.RequirementState {
  return state(
    [
      item('cam', '۴ دوربین داهوا ۲ مگاپیکسل', {
        qty: 4,
        qtyStated: true,
        categoryIds: [10],
        chips: [chip('brand', 'داهوا', { attr: 'brand', op: 'eq', value: 'dahua' }), chip('mp', '۲ مگاپیکسل', { attr: 'resolution_mp', op: 'eq', value: 2 })],
        modelCode: 'HACHFW1200',
      }),
      item('hdd', 'هارد ۲ ترابایت', { categoryIds: [12], chips: [chip('tb', '۲ ترابایت', { attr: 'capacity_tb', op: 'eq', value: 2 })], budget: { max: 4_000_000 } }),
    ],
    extra,
  );
}

/**
 * The CCTV state as the web stores it: /api/parse items verbatim (`constraints`, `rawText`, no chips), reduced to the
 * camera and the drive. `text` has the quantity phrase stripped, `rawText` is the user's words.
 */
export function parserCctvState(extra: Partial<Api.RequirementStateInput> = {}): Api.RequirementState {
  return Api.RequirementStateSchema.parse({
    requirements: [
      {
        id: 'cam',
        text: 'دوربین داهوا ۲ مگاپیکسل',
        rawText: '۴ دوربین داهوا ۲ مگاپیکسل',
        qty: 4,
        qtyStated: true,
        categoryIds: [10],
        kind: 'camera',
        constraints: [
          { attr: 'resolution_mp', op: 'eq', value: 2, source: 'user' },
          { attr: 'brand', op: 'eq', value: 'dahua', source: 'user' },
        ],
        confidence: 0.71,
        categoryCandidates: [{ id: 10, name: 'دوربین مدار بسته', score: 0.75 }],
        notes: [],
        domain: 'cctv_camera',
        modelCode: 'HACHFW1200',
      },
      {
        id: 'hdd',
        text: 'هارد ۲ ترابایت',
        rawText: 'هارد ۲ ترابایت',
        qty: 1,
        categoryIds: [12],
        kind: 'hdd',
        constraints: [{ attr: 'capacity_tb', op: 'eq', value: 2, source: 'user' }],
        budget: { max: 4_000_000 },
        confidence: 0.85,
        categoryCandidates: [],
        notes: [],
        domain: 'hdd',
      },
    ],
    ...extra,
  });
}
