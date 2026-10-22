/** Hand-made and synthetic fixtures shared by the U3 tests. No dependency on normalize/extract. */
import type {
  Candidate,
  Constraint,
  ItemKind,
  ProductAttrs,
  Requirement,
  Shop,
  WeeklyHours,
} from '../../types/index';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export function shuffle<T>(r: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function shop(
  id: string,
  buildingKey: string,
  lat: number | null,
  lon: number | null,
  hours: WeeklyHours | null = null,
  extra: Partial<Shop> = {},
): Shop {
  return { id, name: `مغازه ${id}`, lat, lon, buildingKey, hours, ...extra };
}

let offerSeq = 0;
/** offers: [shopId, price|null][] */
export function cand(
  id: number,
  attrs: ProductAttrs,
  offers: ReadonlyArray<readonly [string, number | null]>,
  extra: { title?: string; modelCodes?: string[]; categoryId?: number } = {},
): Candidate {
  return {
    product: {
      id,
      title: extra.title ?? `کالا ${id}`,
      categoryId: extra.categoryId ?? 1,
      brand: attrs.brand ?? null,
      modelCodes: extra.modelCodes ?? [],
    },
    attrs,
    offers: offers.map(([shopId, price]) => ({ id: `o${id}-${shopId}-${offerSeq++}`, productId: id, shopId, price })),
  };
}

export function req(
  id: string,
  text: string,
  constraints: Constraint[] = [],
  extra: Partial<Requirement> & { kind?: ItemKind } = {},
): Requirement {
  return { id, text, qty: 1, categoryIds: [1], constraints, ...extra };
}

export const user = <C extends Omit<Constraint, 'source'>>(c: C) => ({ ...c, source: 'user' }) as Constraint;

// ---------------------------------------------------------------------------
// Realistic CCTV scenario (Alaeddin / Charsou area, hand-made)
// ---------------------------------------------------------------------------

const SAT_TO_THU = (shift: [number, number]): WeeklyHours => ({
  sat: [shift], sun: [shift], mon: [shift], tue: [shift], wed: [shift], thu: [shift],
});

export const CCTV_SHOPS: Shop[] = [
  shop('A1', 'm:alaeddin', 35.69012, 51.41921, { ...SAT_TO_THU([600, 1140]), fri: [] }, { mallKey: 'm:alaeddin', mallName: 'پاساژ علاءالدین', floor: '6', unit: '622' }),
  shop('A2', 'm:alaeddin', 35.69018, 51.41930, null, { mallKey: 'm:alaeddin', mallName: 'پاساژ علاءالدین' }),
  shop('C1', 'm:charsou', 35.69110, 51.41850, { ...SAT_TO_THU([540, 1260]), fri: [[600, 840]] }, { mallKey: 'm:charsou', mallName: 'پاساژ چارسو', floor: '2' }),
  shop('S1', 'c:35.6895,51.4201', 35.68950, 51.42010, { ...SAT_TO_THU([600, 1200]), fri: [] }),
];

export function cctvItems(): Requirement[] {
  return [
    req('cam', '۴ دوربین داهوا ۲ مگاپیکسل', [user({ attr: 'brand', op: 'eq', value: 'Dahua' }), user({ attr: 'resolution_mp', op: 'eq', value: 2 })], { kind: 'camera', qty: 4, qtyStated: true }),
    req('rec', 'ضبط‌کننده ۴ کانال', [user({ attr: 'channels', op: 'eq', value: 4 })], { kind: 'recorder' }),
    req('hdd', 'هارد ۲ ترابایت', [user({ attr: 'capacity_tb', op: 'eq', value: 2 })], { kind: 'hdd' }),
    req('ad', 'آداپتور', [], { kind: 'adapter' }),
  ];
}

export function cctvCandidates(): Record<string, Candidate[]> {
  return {
    cam: [
      cand(101, { brand: 'Dahua', resolution_mp: 2, camera_signal: 'ahd' }, [['A1', 2_500_000], ['C1', 2_450_000]], { modelCodes: ['HAC-HDW1200CLQP'] }),
      cand(102, { brand: 'Dahua', resolution_mp: 2 }, [['S1', 2_300_000]]),
      cand(103, { brand: 'Dahua', resolution_mp: 5, camera_signal: 'ahd' }, [['A1', 3_200_000]]),
      cand(104, { brand: 'Hikvision', resolution_mp: 2, camera_signal: 'tvi' }, [['C1', 2_000_000]]),
      cand(105, { brand: 'Dahua' }, [['A2', 1_900_000]]),
    ],
    rec: [
      cand(201, { brand: 'Dahua', recorder_kind: 'xvr', channels: 4 }, [['A1', 6_500_000]], { modelCodes: ['DH-XVR1B04-I'] }),
      cand(202, { brand: 'Dahua', recorder_kind: 'xvr', channels: 4 }, [['S1', 6_200_000]]),
      cand(203, { brand: 'Dahua', recorder_kind: 'nvr', channels: 4 }, [['C1', 7_000_000]]),
      cand(204, { brand: 'Dahua', recorder_kind: 'xvr', channels: 8 }, [['C1', 9_000_000]]),
      cand(205, { brand: 'Dahua', channels: 4 }, [['A2', 5_000_000]]),
    ],
    hdd: [
      cand(301, { brand: 'WD', capacity_tb: 2, hdd_surveillance: true }, [['A1', 3_000_000]]),
      cand(302, { brand: 'Seagate', capacity_tb: 2 }, [['C1', 2_800_000]]),
      cand(303, { brand: 'WD', capacity_tb: 1 }, [['S1', 1_500_000]]),
    ],
    ad: [
      cand(401, { voltage_v: 12, current_a: 2 }, [['A1', 300_000]]),
      cand(402, { voltage_v: 12 }, [['C1', 250_000], ['S1', null]]),
      cand(403, {}, [['S1', 200_000]]),
    ],
  };
}
