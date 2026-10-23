/**
 * Question audit on the real market.sqlite (read-only): which questions the engine asks, in what order, and how
 * much each one is worth.
 *
 *   DATABASE_PATH=/abs/path/market.sqlite npx tsx apps/server/scripts/audit-questions.ts [--json out.json]
 *
 * For each request: POST /api/parse -> state (parser items verbatim, as the web app sends it) -> POST /api/resolve.
 * While an item shows a question, every option of it is tried once (one extra /api/resolve per option) to measure
 * its value from the data, independently of the engine's own scoring:
 *   elim%     share of the item's eligible models the option removes (1 - eligible after / eligible before)
 *   spread%   how much the option narrows the eligible price spread: 1 - ln(high/low after) / ln(high/low before)
 * A question's value is the count-weighted mean over its options. The walk then answers the option that keeps the
 * most models (the longest path, i.e. the worst case for the number of questions) and resolves again, until no item
 * asks anything (at most 8 rounds). Counts per item are the number of questions shown along that path.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Api } from '@app/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { planState } from '../src/adapter/engine.js';
import { catalogFor } from '../src/retrieval/catalog.js';

export const QUESTION_AUDIT_REQUESTS: readonly string[] = [
  // CCTV
  '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور',
  'دوربین مداربسته',
  '۸ دوربین تحت شبکه و ان وی آر',
  'دی وی آر ۸ کانال',
  'هارد ۱ ترابایت',
  'آداپتور ۱۲ ولت',
  // phones
  'گوشی سامسونگ A56 با قاب و گلس',
  'گوشی موبایل',
  'قاب گوشی',
  'گلس آیفون ۱۳',
  // laptops
  'لپ تاپ',
  'لپ تاپ ایسوس',
  // cable & wire
  'سیم برق ۲.۵ افشان ۵۰ متر',
  'کابل شبکه',
  // sockets & breakers
  'کلید و پریز',
  'فیوز مینیاتوری',
  // locks / alarms
  'قفل درب',
  'دزدگیر اماکن',
  // networking
  'مودم روتر',
  'سوییچ شبکه ۸ پورت',
  'پچ کورد',
  // printers / ink
  'پرینتر لیزری',
  'کارتریج اچ پی',
  // batteries / UPS
  'یو پی اس',
  'باتری ۱۲ ولت ۷ آمپر',
  // tools
  'دریل شارژی',
  'پیچ گوشتی',
  // lighting
  'لامپ ال ای دی ۱۰ وات',
  'پروژکتور',
];

export interface OptionValue {
  id: string;
  label: string;
  hint?: string;
  eligibleAfter: number;
  elim: number;
  spread: number | null;
}

export interface AskedQuestion {
  round: number;
  id: string;
  kind: string;
  prompt: string;
  why?: string;
  eligibleBefore: number;
  rangeLow?: number;
  rangeHigh?: number;
  options: OptionValue[];
  /** count-weighted mean of the options' elimination share */
  elim: number;
  /** count-weighted mean of the options' price-spread narrowing (null: no price spread before) */
  spread: number | null;
  /** The engine's own score (core questions/next.ts informationValue): unknown-attribute models do not count. */
  engine?: { narrowing: number; spread: number };
  answered: string;
}

export interface ItemAudit {
  request: string;
  itemId: string;
  item: string;
  kind: string;
  questions: AskedQuestion[];
  finalState: string;
  finalEligible?: number;
  /** Why the engine stopped asking (core QuestionStopReason). */
  stopReason?: string;
}

const NOW = new Date('2026-10-21T10:00:00+03:30');

function logSpread(lo?: number, hi?: number): number | null {
  if (lo === undefined || hi === undefined || !(lo > 0) || !(hi > lo)) return null;
  return Math.log(hi / lo);
}

export async function runQuestionAudit(dbPath: string, requests: readonly string[] = QUESTION_AUDIT_REQUESTS): Promise<ItemAudit[]> {
  const config = {
    ...loadConfig({ NODE_ENV: 'test' }),
    databasePath: dbPath,
    rateLimit: 1_000_000,
    llmApiKey: undefined,
    webDist: path.join(path.dirname(dbPath), 'no-web'),
  };
  const { app, ctx } = await buildApp({ config, now: () => NOW });
  await app.ready();
  const catalog = catalogFor(ctx.db);
  const post = async <T,>(url: string, payload: unknown): Promise<T> => {
    const res = await app.inject({ method: 'POST', url, payload: payload as object });
    if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 300)}`);
    return (res.json() as { data: T }).data;
  };
  const out: ItemAudit[] = [];
  try {
    for (const text of requests) {
      const parsed = await post<Api.ParseResponse>('/api/parse', { text });
      const answers: Record<string, Record<string, string>> = {};
      const base = (): Api.RequirementStateInput => {
        const s: Api.RequirementStateInput = { requirements: parsed.items, answers };
        if (parsed.preference) s.preference = parsed.preference;
        return s;
      };
      const audits = new Map<string, ItemAudit>();
      for (const it of parsed.items)
        audits.set(it.id, { request: text, itemId: it.id, item: it.text, kind: it.kind ?? 'other', questions: [], finalState: '' });
      let r = await post<Api.ResolveResponse>('/api/resolve', { state: base() });
      for (let round = 1; round <= 8; round++) {
        const asking = r.items.filter((it) => it.question);
        if (!asking.length) break;
        // the same item cards /api/resolve shows, for the engine's own score of each question
        const rs = planState(catalog, Api.ResolveRequestSchema.parse({ state: base() }).state, NOW).rs;
        for (const it of asking) {
          const q = it.question!;
          const score = rs.items.find((x) => x.item.id === it.itemId)?.result.question.question?.score;
          const before = it.eligibleCount ?? 0;
          const s0 = logSpread(it.rangeLow, it.rangeHigh);
          const options: OptionValue[] = [];
          for (const o of q.options) {
            if (o.id === 'any') continue;
            const trial = base();
            trial.answers = { ...answers, [it.itemId]: { ...(answers[it.itemId] ?? {}), [q.id]: o.id } };
            const tr = await post<Api.ResolveResponse>('/api/resolve', { state: trial });
            const after = tr.items.find((x) => x.itemId === it.itemId)!;
            const n = after.eligibleCount ?? 0;
            const s1 = logSpread(after.rangeLow, after.rangeHigh) ?? 0;
            const ov: OptionValue = {
              id: o.id,
              label: o.label,
              eligibleAfter: n,
              elim: before > 0 ? 1 - n / before : 0,
              spread: s0 ? 1 - s1 / s0 : null,
            };
            if (o.hint) ov.hint = o.hint;
            options.push(ov);
          }
          const w = options.reduce((a, o) => a + o.eligibleAfter, 0);
          const mean = (f: (o: OptionValue) => number) =>
            w > 0 ? options.reduce((a, o) => a + (o.eligibleAfter / w) * f(o), 0) : options.length ? options.reduce((a, o) => a + f(o), 0) / options.length : 0;
          const best = [...options].sort((a, b) => b.eligibleAfter - a.eligibleAfter)[0];
          const aq: AskedQuestion = {
            round,
            id: q.id,
            kind: q.kind,
            prompt: q.prompt,
            eligibleBefore: before,
            options,
            elim: mean((o) => o.elim),
            spread: s0 ? mean((o) => o.spread ?? 0) : null,
            answered: best ? best.label : 'any',
          };
          if (q.why) aq.why = q.why;
          if (score?.narrowing !== undefined && score.spread !== undefined) aq.engine = { narrowing: score.narrowing, spread: score.spread };
          if (it.rangeLow !== undefined) aq.rangeLow = it.rangeLow;
          if (it.rangeHigh !== undefined) aq.rangeHigh = it.rangeHigh;
          audits.get(it.itemId)!.questions.push(aq);
          answers[it.itemId] = { ...(answers[it.itemId] ?? {}), [q.id]: best ? best.id : 'any' };
        }
        r = await post<Api.ResolveResponse>('/api/resolve', { state: base() });
      }
      const finalRs = planState(catalog, Api.ResolveRequestSchema.parse({ state: base() }).state, NOW).rs;
      for (const it of r.items) {
        const a = audits.get(it.itemId)!;
        a.finalState = it.state;
        const stop = finalRs.items.find((x) => x.item.id === it.itemId)?.result.question.stopReason;
        if (stop) a.stopReason = stop;
        if (it.eligibleCount !== undefined) a.finalEligible = it.eligibleCount;
      }
      out.push(...audits.values());
    }
  } finally {
    await app.close();
  }
  return out;
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const cell = (s: string) => s.replace(/\|/g, '/').replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ');

export function questionAuditMarkdown(rows: readonly ItemAudit[]): string {
  const lines = [
    '| request › item | kind | # | questions in order: measured elim% / spread% [engine narrowing / spread] | options (models after) | final |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const qs =
      r.questions
        .map((q) => `${q.round}. ${q.id} ${pct(q.elim)} / ${pct(q.spread)}${q.engine ? ` [${pct(q.engine.narrowing)} / ${pct(q.engine.spread)}]` : ''}`)
        .join('<br>') || '—';
    const opts =
      r.questions
        .map((q) => q.options.map((o) => `${cell(o.label)} ${o.eligibleAfter}`).join(' · '))
        .join('<br>') || '—';
    const item = r.item === r.request ? r.item : `${r.request} › ${r.item}`;
    lines.push(
      `| ${cell(item)} | ${r.kind} | ${r.questions.length} | ${qs} | ${opts} | ${r.finalState} (${r.finalEligible ?? '—'})${r.stopReason ? ` ${r.stopReason}` : ''} |`,
    );
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'audit-questions.ts'));
if (isMain) {
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? 'data/market.sqlite');
  const rows = await runQuestionAudit(dbPath);
  console.log(questionAuditMarkdown(rows));
  const j = process.argv.indexOf('--json');
  if (j > 0 && process.argv[j + 1]) writeFileSync(process.argv[j + 1]!, JSON.stringify(rows, null, 1));
}
