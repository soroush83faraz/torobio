/**
 * Mall key resolution across all shops:
 * 1. fold the parsed name (foldMallName), 2. apply the hand-checked alias map
 * (spelling variants of the same building, verified to share coordinates),
 * 3. spatial guard: shops of one name farther than CLUSTER_RADIUS_M from the
 * group's centre form a separate cluster (same name, different building) or,
 * when isolated, get no mall key at all (their building_key falls back to
 * coordinates).
 */

/** fold -> canonical fold. Each line was checked against the shops' coordinates. */
export const MALL_ALIASES: Record<string, string> = {
  // Alaeddin (main building on Jomhouri / Hafez corner)
  'علاالدین': 'علاالدین',
  'علادین': 'علاالدین',
  'علالدین': 'علاالدین',
  'علاالدین1': 'علاالدین',
  'علادین1': 'علاالدین',
  'علالدین1': 'علاالدین',
  // Alaeddin 2 is a different building ~400 m west (near Sheikh Hadi): kept separate
  'علادین2': 'علاالدین2',
  'علالدین2': 'علاالدین2',
  'علادین3': 'علاالدین3',
  'علالدین3': 'علاالدین3',
  'علاالدینارایشی': 'علاالدینارایشی',
  'علادینارایشی': 'علاالدینارایشی',
  'چهارسو': 'چارسو',
  'تجارتجهانی': 'تجارتجهانیفردوسی',
  'مرکزتجارتجهانی': 'تجارتجهانیفردوسی',
  'مرکزتجارتجهانیفردوسی': 'تجارتجهانیفردوسی',
  'جهانیفردوسی': 'تجارتجهانیفردوسی',
  'مرکزتجارتجهانیفردوسیمجتمع': 'تجارتجهانیفردوسی',
  'فرازلالهزار': 'فراز',
  'المینیوم': 'الومینیوم',
  'الومینیم': 'الومینیوم',
  'المینیم': 'الومینیوم',
  'صدیقینژاد': 'صدقینژاد',
  'صدقینژاد': 'صدقینژاد',
  'موبایل': 'موبایلایران',
  'اوپال': 'اپال',
  'شماره3البرز': 'البرز3',
  'شماره3': 'البرز3',
  'درافشان': 'درفشان',
  'واداریسعدی': 'سعدی',
  'الماسسعدی': 'الماس',
  'بزرگاناپتیک': 'بزرگان',
  'جهان': 'جهانالکتریک',
  'الکتریکاتحادیه': 'اتحادیه',
  'بازارالکتریکاتحادیه': 'اتحادیه',
  'نیروصنعت': 'نیروصنعت',
  'شرکا': 'شرکا',
  'کورش': 'کوروش',
  'سرالالهزار': 'سرایلالهزار',
  'پاساژسرایلالهزار': 'سرایلالهزار',
  'گراندهتل': 'گراندهتل',
};

/** Folds that are not a building name. */
const INVALID = new Set(['تجاری', 'اداری', 'تجاریاداری', 'خرید', 'شماره', 'اول', 'دوم', 'جدید', 'قدیم', 'مجتمعتجاری']);

export function canonicalMallFold(fold: string | null): string | null {
  if (!fold) return null;
  const f = MALL_ALIASES[fold] ?? fold;
  if (INVALID.has(f) || f.length < 2 || /^\d$/.test(f)) return null;
  return f;
}

export const CLUSTER_RADIUS_M = 150;
const MIN_CLUSTER = 3;

export function metres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toR = Math.PI / 180;
  const x = (lon2 - lon1) * toR * Math.cos(((lat1 + lat2) / 2) * toR);
  const y = (lat2 - lat1) * toR;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
}

export interface MallMember {
  id: string;
  fold: string;
  raw: string;
  lat: number;
  lon: number;
}

export interface MallAssignment {
  mallKey: string;
  mallName: string;
}

interface Cluster {
  fold: string;
  index: number;
  members: MallMember[];
  lat: number;
  lon: number;
}

/** Secondary clusters this close to another name's primary cluster (prefix-related names) join it. */
export const MERGE_RADIUS_M = 60;
/** An isolated shop this close to a cluster of its own mall name joins it. */
export const ATTACH_RADIUS_M = 600;

/**
 * Assign mall keys. Returns shop id -> assignment (shops without one are absent).
 * Cluster 1 of a name keeps key "m:<fold>", further clusters "m:<fold>#2"...
 * A secondary cluster whose centre is within MERGE_RADIUS_M of the primary
 * cluster of a prefix-related name («علاالدین» shops pinned at «علاالدین2») is
 * merged into that cluster.
 */
export function resolveMalls(members: MallMember[]): { assign: Map<string, MallAssignment>; dropped: number; clusters: number; merged: number; attached: number } {
  const byFold = new Map<string, MallMember[]>();
  for (const m of members) {
    const list = byFold.get(m.fold) ?? [];
    list.push(m);
    byFold.set(m.fold, list);
  }
  const clusters: Cluster[] = [];
  const droppedMembers: MallMember[] = [];
  let dropped = 0;
  for (const [fold, list] of byFold) {
    let rest = list;
    let ci = 0;
    while (rest.length) {
      // seed = the member with most neighbours within the radius (robust to several clusters),
      // then one refinement around the median of that neighbourhood
      let seed = rest[0] as MallMember;
      let best = -1;
      for (const a of rest) {
        let n = 0;
        for (const b of rest) if (metres(a.lat, a.lon, b.lat, b.lon) <= CLUSTER_RADIUS_M) n++;
        if (n > best) { best = n; seed = a; }
      }
      const near = rest.filter((r) => metres(seed.lat, seed.lon, r.lat, r.lon) <= CLUSTER_RADIUS_M);
      const cLat = median(near.map((r) => r.lat));
      const cLon = median(near.map((r) => r.lon));
      const inC = rest.filter((r) => metres(cLat, cLon, r.lat, r.lon) <= CLUSTER_RADIUS_M);
      const outC = rest.filter((r) => metres(cLat, cLon, r.lat, r.lon) > CLUSTER_RADIUS_M);
      if (inC.length === 0 || (ci > 0 && inC.length < MIN_CLUSTER) || ci >= 5) {
        dropped += rest.length;
        droppedMembers.push(...rest);
        break;
      }
      ci++;
      clusters.push({ fold, index: ci, members: inC, lat: median(inC.map((r) => r.lat)), lon: median(inC.map((r) => r.lon)) });
      rest = outC;
      if (rest.length && rest.length < MIN_CLUSTER) {
        dropped += rest.length;
        droppedMembers.push(...rest);
        break;
      }
    }
  }
  // a shop pinned a few hundred metres from its named mall (sloppy map pin) joins that mall;
  // farther away it is treated as a different / unknown building (no key)
  let attached = 0;
  for (const m of droppedMembers) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      if (c.fold !== m.fold) continue;
      const d = metres(c.lat, c.lon, m.lat, m.lon);
      if (d < bestD) { best = c; bestD = d; }
    }
    if (best && bestD <= ATTACH_RADIUS_M) { best.members.push(m); attached++; dropped--; }
  }
  // merge secondary clusters into a nearby primary cluster of a prefix-related name
  const primaries = clusters.filter((c) => c.index === 1);
  let merged = 0;
  const target = new Map<Cluster, Cluster>();
  for (const c of clusters) {
    if (c.index === 1) continue;
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const p of primaries) {
      if (p.fold === c.fold) continue;
      if (!(p.fold.startsWith(c.fold) || c.fold.startsWith(p.fold))) continue;
      const d = metres(p.lat, p.lon, c.lat, c.lon);
      if (d <= MERGE_RADIUS_M && d < bestD) { best = p; bestD = d; }
    }
    if (best) { target.set(c, best); merged++; }
  }
  const finalMembers = new Map<Cluster, MallMember[]>();
  for (const c of clusters) {
    const t = target.get(c) ?? c;
    const list = finalMembers.get(t) ?? [];
    list.push(...c.members);
    finalMembers.set(t, list);
  }
  const assign = new Map<string, MallAssignment>();
  for (const [c, list] of finalMembers) {
    const key = `m:${c.fold}${c.index > 1 ? `#${c.index}` : ''}`;
    const counts = new Map<string, number>();
    for (const r of list) counts.set(r.raw, (counts.get(r.raw) ?? 0) + 1);
    const name = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] as string;
    for (const r of list) assign.set(r.id, { mallKey: key, mallName: name });
  }
  return { assign, dropped, clusters: finalMembers.size, merged, attached };
}
