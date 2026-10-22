import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { deviceModelBase, extractProduct } from '@app/core';
import { REPO_ROOT } from './io';

export const LABELS_DIR = resolve(REPO_ROOT, 'scripts/data/labels');

interface LabelItem {
  title: string;
  category: string;
  brand_field: string | null;
  model_field: string | null;
  expected: Record<string, unknown>;
}
interface LabelSet {
  set: string;
  labelled_by: string;
  attributes: string[];
  items: LabelItem[];
}

export interface AttrStats {
  set: string;
  attr: string;
  /** items where the label states a value */
  labelled: number;
  correct: number;
  /** extractor value differs from the labelled value */
  wrong: number;
  /** extractor states a value the title does not establish (label: unknown) */
  unsupported: number;
  /** label states a value, extractor left it unknown */
  missed: number;
  precision: number;
  coverage: number;
  errors: Array<{ title: string; expected: unknown; got: unknown; kind: 'wrong' | 'unsupported' }>;
}

const eq = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

export function loadLabelSets(dir = LABELS_DIR): LabelSet[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as LabelSet);
}

/** Evaluate the title extractors (specs are not used: labels are read from titles). */
export function evaluate(sets = loadLabelSets()): AttrStats[] {
  const out: AttrStats[] = [];
  for (const s of sets) {
    for (const attr of s.attributes) {
      const st: AttrStats = { set: s.set, attr, labelled: 0, correct: 0, wrong: 0, unsupported: 0, missed: 0, precision: 1, coverage: 1, errors: [] };
      let claims = 0;
      for (const it of s.items) {
        const r = extractProduct({ title: it.title, categoryName: it.category, brandField: it.brand_field, modelField: it.model_field, useSpecs: false });
        const got = (r.attrs as Record<string, unknown>)[attr];
        const exp = it.expected[attr];
        if (Array.isArray(exp) || Array.isArray(got)) {
          // list attribute (fits_models): element-wise; a network variant («… 5g») matches its base
          const e = (Array.isArray(exp) ? exp : []) as string[];
          const g = (Array.isArray(got) ? got : []) as string[];
          const eb = new Set(e.map(deviceModelBase));
          const gb = new Set(g.map(deviceModelBase));
          st.labelled += eb.size;
          for (const x of gb) {
            claims++;
            if (eb.has(x)) st.correct++;
            else if (eb.size) { st.wrong++; st.errors.push({ title: it.title, expected: e, got: g, kind: 'wrong' }); }
            else { st.unsupported++; st.errors.push({ title: it.title, expected: e, got: g, kind: 'unsupported' }); }
          }
          for (const x of eb) if (!gb.has(x)) st.missed++;
          continue;
        }
        if (exp !== undefined) st.labelled++;
        if (got === undefined) {
          if (exp !== undefined) st.missed++;
          continue;
        }
        claims++;
        if (exp === undefined) { st.unsupported++; st.errors.push({ title: it.title, expected: null, got, kind: 'unsupported' }); }
        else if (eq(exp, got)) st.correct++;
        else { st.wrong++; st.errors.push({ title: it.title, expected: exp, got, kind: 'wrong' }); }
      }
      st.precision = claims ? st.correct / claims : 1;
      st.coverage = st.labelled ? st.correct / st.labelled : 1;
      out.push(st);
    }
  }
  return out;
}

export function formatReport(stats: AttrStats[]): string {
  const lines: string[] = [];
  lines.push('set              attr          labelled correct wrong unsupp missed  precision coverage');
  for (const s of stats) {
    lines.push(
      `${s.set.padEnd(16)} ${s.attr.padEnd(13)} ${String(s.labelled).padStart(8)} ${String(s.correct).padStart(7)} ${String(s.wrong).padStart(5)} ${String(s.unsupported).padStart(6)} ${String(s.missed).padStart(6)}  ${(100 * s.precision).toFixed(1).padStart(8)}% ${(100 * s.coverage).toFixed(1).padStart(7)}%`,
    );
  }
  const errs = stats.flatMap((s) => s.errors.map((e) => ({ ...e, set: s.set, attr: s.attr })));
  if (errs.length) {
    lines.push('', 'Errors (wrong = differs from label; unsupported = value claimed where the title does not establish one):');
    for (const e of errs) lines.push(`  [${e.kind}] ${e.set}.${e.attr}: expected ${JSON.stringify(e.expected)} got ${JSON.stringify(e.got)} — ${e.title.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
  return lines.join('\n');
}
