/** Developer tool: list parsed mall folds with counts and spatial spread. */
import { resolve } from 'node:path';
import { parseAddress } from './clean/address';
import { defaultCsvDir, readCsv } from './io';

type G = { n: number; lat: number[]; lon: number[]; raws: Map<string, number> };
const groups = new Map<string, G>();
let total = 0, withMall = 0, withFloor = 0, withUnit = 0;
for await (const s of readCsv(resolve(defaultCsvDir(), 'shops.csv'))) {
  total++;
  const p = parseAddress(s.address);
  if (p.floor) withFloor++;
  if (p.unit) withUnit++;
  if (!p.mallFold) continue;
  withMall++;
  const g: G = groups.get(p.mallFold) ?? { n: 0, lat: [], lon: [], raws: new Map() };
  g.n++;
  g.lat.push(Number(s.lat));
  g.lon.push(Number(s.lon));
  g.raws.set(p.mallRaw as string, (g.raws.get(p.mallRaw as string) ?? 0) + 1);
  groups.set(p.mallFold, g);
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] as number;
const dist = (a: number, b: number, c: number, d: number) => {
  const R = 6371000, toR = Math.PI / 180;
  const x = (d - b) * toR * Math.cos(((a + c) / 2) * toR), y = (c - a) * toR;
  return Math.sqrt(x * x + y * y) * R;
};
console.log({ total, withMall, withFloor, withUnit, folds: groups.size });
const rows = [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, Number(process.argv[2] ?? 150));
for (const [k, g] of rows) {
  const mla = med(g.lat), mlo = med(g.lon);
  const ds = g.lat.map((la, i) => dist(mla, mlo, la, g.lon[i] as number)).sort((a, b) => a - b);
  const p90 = Math.round(ds[Math.floor(ds.length * 0.9)] as number);
  const raws = [...g.raws].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, c]) => `${r}(${c})`).join(' | ');
  console.log(`${g.n}\t${k}\t${mla.toFixed(5)},${mlo.toFixed(5)}\tp90=${p90}m\t${raws}`);
}
