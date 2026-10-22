/**
 * Developer tool: print extractor output for products of one category.
 *   npx tsx scripts/data/src/explore.ts "<category name>" [limit] [--only-missing attr] [--grep text]
 */
import { extractProduct } from '@app/core';
import { argValue, defaultCsvDir, readCsv } from './io';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const cat = args[0] as string;
const limit = Number(args[1] ?? 50);
const onlyMissing = argValue(args, '--only-missing');
const grep = argValue(args, '--grep');
const csvDir = argValue(args, '--csv-dir') ?? defaultCsvDir();
let n = 0;
const cov = new Map<string, number>();
let total = 0;
for await (const p of readCsv(resolve(csvDir, 'products.csv'))) {
  if (p.category_name !== cat) continue;
  const specs = p.specs ? JSON.parse(p.specs) : null;
  const r = extractProduct({ title: p.persian_title ?? '', categoryName: p.category_name, brandField: p.brand_name, modelField: p.model, specs });
  total++;
  for (const k of Object.keys(r.attrs)) cov.set(k, (cov.get(k) ?? 0) + 1);
  if (onlyMissing && onlyMissing in r.attrs) continue;
  if (grep && !(p.persian_title ?? '').includes(grep)) continue;
  if (n++ < limit) console.log(`${p.persian_title}\n   => ${r.brand ?? '-'} ${JSON.stringify(r.attrs)} ${r.modelCodes.slice(0, 3).join(',')}`);
}
console.log('total', total, Object.fromEntries([...cov].map(([k, v]) => [k, `${Math.round((100 * v) / total)}%`])));
