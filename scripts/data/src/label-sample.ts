/**
 * Developer tool: draw reproducible random samples of titles for labelling.
 *   npx tsx scripts/data/src/label-sample.ts <outDir>
 * Writes <outDir>/<set>.jsonl (one product per line with the current extractor
 * output) — to be labelled BY HAND into scripts/data/labels/<set>.json.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractProduct } from '@app/core';
import { defaultCsvDir, readCsv } from './io';

export const LABEL_SETS: Array<{ set: string; categories: string[]; n: number; seed: number }> = [
  { set: 'cctv-camera', categories: ['دوربین مدار بسته'], n: 80, seed: 11 },
  { set: 'recorder', categories: ['ضبط کننده ویدیویی دوربین\u200Cهای نظارتی و امنیتی'], n: 75, seed: 12 },
  { set: 'hdd', categories: ['هارد دیسک اینترنال'], n: 75, seed: 13 },
  { set: 'adapter', categories: ['آداپتور برق'], n: 75, seed: 14 },
  { set: 'wire', categories: ['سیم و کابل برق ساختمان'], n: 80, seed: 15 },
  { set: 'phone-accessory', categories: ['کیف و کاور گوشی', 'محافظ صفحه نمایش گوشی'], n: 80, seed: 16 },
];

const outDir = process.argv[2] as string;
/** optional: a seed offset and sample size for a held-out set (e.g. `... 100 35`) */
const seedOffset = Number(process.argv[3] ?? 0);
const nOverride = process.argv[4] ? Number(process.argv[4]) : null;
const pools = new Map<string, Array<Record<string, string | null>>>();
for (const s of LABEL_SETS) pools.set(s.set, []);
for await (const p of readCsv(resolve(defaultCsvDir(), 'products.csv'))) {
  for (const s of LABEL_SETS) if (p.category_name && s.categories.includes(p.category_name)) pools.get(s.set)?.push(p);
}
for (const s of LABEL_SETS) {
  const pool = pools.get(s.set) ?? [];
  let seed = s.seed + seedOffset;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const picked = new Set<number>();
  while (picked.size < Math.min(nOverride ?? s.n, pool.length)) picked.add(Math.floor(rnd() * pool.length));
  const lines: string[] = [];
  for (const i of [...picked].sort((a, b) => a - b)) {
    const p = pool[i] as Record<string, string | null>;
    const r = extractProduct({ title: p.persian_title ?? '', categoryName: p.category_name, brandField: p.brand_name, modelField: p.model, useSpecs: false });
    const { _src, brand_key, ...a } = r.attrs as Record<string, unknown>;
    void _src; void brand_key;
    lines.push(JSON.stringify({ title: p.persian_title, category: p.category_name, brand_field: p.brand_name, model_field: p.model, got: a }));
  }
  writeFileSync(resolve(outDir, `${s.set}${seedOffset ? '-holdout' : ''}.jsonl`), `${lines.join('\n')}\n`);
}
