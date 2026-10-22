/**
 * Conflict / honesty sweep on the real market.sqlite (read-only), in process (app.inject, no network).
 *
 *   DATABASE_PATH=/path/to/market.sqlite npx tsx apps/server/scripts/sweep-conflicts.ts [--json out.json]
 *
 * 40 shopping lists (CCTV, phones, chargers...) x 6 answer strategies x 2 plan variants. Each walk parses the list,
 * then repeatedly asks /api/plan and answers every open question by the strategy (settle = «کافیه، پیشنهاد بده»,
 * skip = leave it, first / last / any («فرقی نمی‌کند») / random option), up to 8 rounds; every plan is checked.
 * Then every plan alternative of the final state is opened as a variant and checked the same way.
 *
 * Per plan it counts:
 *   conflictPlans          plans with at least one compat line at level 'conflict'
 *   completeWithConflict   ... whose coverage is complete
 *   unmarked               conflict (or lifted 12 V assumption) beside a total line WITHOUT the marker, or without
 *                          `hasConflict` / `compatUnverified`  -> must be 0
 *   autoConflict           a conflict line not marked as the user's own choice (`fromUserChoice`) -> must be 0
 *   superlative            a conflicting / unverified plan whose reason says «ارزان‌ترین» / «کم‌توقف‌ترین» -> must be 0
 *   listPlanMismatch       an item card whose product / price differs from the product on its stop line -> must be 0
 *   totalMismatch          totalToman != sum of the line totals -> must be 0
 *   absentPicked           an item the parser marked not_in_catalog that has a product or a stop line -> must be 0
 * The script exits 1 when a must-be-0 counter is not 0.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const SWEEP_LISTS: readonly string[] = [
  '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور',
  '۸ دوربین هایک ویژن، دی وی آر ۸ کانال، هارد ۴ ترابایت، آداپتور ۱۲ ولت ۵ آمپر',
  '۲ دوربین تحت شبکه، ان وی آر ۴ کانال، سوییچ POE، کابل شبکه ۵۰ متر',
  'دوربین مداربسته، آداپتور، کابل',
  '۴ دوربین، آداپتور ۱۲ ولت، ۴ فیش BNC، کابل ۱۰۰ متر',
  'دوربین بالت ۵ مگاپیکسل و آداپتور',
  'ضبط کننده ۱۶ کانال و هارد ۶ ترابایت',
  '۶ دوربین دام، XVR ۸ کانال، هارد ۱ ترابایت، منبع تغذیه',
  'دوربین وای فای و کارت حافظه ۶۴ گیگ',
  'دوربین داهوا، ضبط کننده، آداپتور ۲ آمپر',
  'آداپتور دوربین و دوربین آنالوگ',
  '۳ دوربین IP و آداپتور POE',
  'دوربین مداربسته ۴ عدد و منبع تغذیه ۱۰ آمپر',
  'NVR هشت کانال و ۸ دوربین تحت شبکه و هارد',
  'دوربین و آداپتور ۵ ولت',
  'دوربین ۲ مگاپیکسل، دی وی آر، آداپتور ۱ آمپر، هارد',
  'گوشی سامسونگ A15، قاب، گلس، شارژر',
  'گوشی شیائومی ردمی نوت ۱۳ و شارژر ۳۳ وات و کابل تایپ سی',
  'آیفون ۱۳ و شارژر ۲۰ وات و کابل لایتنینگ',
  'شارژر فست ۲۵ وات سامسونگ و کابل تایپ سی',
  'پاوربانک ۲۰۰۰۰ و کابل',
  'هندزفری بلوتوث و شارژر',
  'گوشی سامسونگ، کارت حافظه ۱۲۸، گلس',
  'شارژر و کابل و قاب برای گوشی شیائومی',
  'هدفون بی سیم و پاوربانک و شارژر دیواری',
  'تبلت سامسونگ و کیف و گلس',
  'ساعت هوشمند و شارژر',
  'شارژر ماشین و کابل میکرو',
  'گوشی ۵ میلیونی و قاب و هندزفری',
  'آداپتور لپ تاپ ۱۹ ولت و کیف لپ تاپ',
  'دوربین مداربسته ۸ عدد، آداپتور ۱۲ ولت، کابل ۲۰۰ متر، ضبط کننده ۸ کانال، هارد ۲ ترابایت',
  'مودم و آداپتور',
  'روتر و آداپتور ۹ ولت',
  'دوربین، آداپتور، آداپتور',
  'دو دوربین سقفی و یک آداپتور ۱۲ ولت ۲ آمپر',
  'ده دوربین و منبع تغذیه سوئیچینگ',
  'دوربین هایک ویژن ۴ مگاپیکسل و ان وی آر',
  'گوشی آیفون ۱۵ و شارژر و کابل',
  'گوشی سامسونگ A55 و شارژر ۴۵ وات',
  'اسپیکر بلوتوث و کابل AUX و شارژر',
  // stated contradictions and absent items (user-induced conflicts must be marked; absent items never picked)
  '۴ دوربین تحت شبکه و دی وی آر ۸ کانال و آداپتور',
  '۴ دوربین AHD و ان وی آر ۴ کانال',
  '۴ دوربین داهوا، برنج و آداپتور',
  'مرغ و شیر و نان و دوربین',
];

const STRATEGIES = ['settle', 'skip', 'first', 'last', 'any', 'random'] as const;
type Strategy = (typeof STRATEGIES)[number];
const NOW = new Date('2026-10-21T10:00:00+03:30');
const SUPERLATIVE = /ارزان‌ترین ترکیب|کم‌توقف‌ترین|نزدیک‌ترین ترکیب/;
const MARKER = /ناسازگاری دارد|بدون تأیید سازگاری/;

export interface SweepCounts {
  plans: number;
  conflictPlans: number;
  completeWithConflict: number;
  liftedPlans: number;
  unmarked: number;
  autoConflict: number;
  superlative: number;
  listPlanMismatch: number;
  listPlanLines: number;
  totalMismatch: number;
  absentPicked: number;
  httpErrors: number;
}

export interface SweepViolation {
  kind: keyof SweepCounts;
  list: string;
  strategy: string;
  variant: string | null;
  detail: string;
}

/** Deterministic PRNG (mulberry32) so the 'random' strategy is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SweepResult {
  counts: SweepCounts;
  violations: SweepViolation[];
  /** Conflict plans per list and strategy («list › strategy» -> count), with one example line each. */
  conflictsBy: Record<string, { n: number; example: string }>;
}

export async function runSweep(dbPath: string, lists: readonly string[] = SWEEP_LISTS): Promise<SweepResult> {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), databasePath: dbPath, rateLimit: 1_000_000, llmApiKey: undefined, webDist: path.join(path.dirname(dbPath), 'no-web') };
  const { app } = await buildApp({ config, now: () => NOW });
  await app.ready();
  const counts: SweepCounts = {
    plans: 0,
    conflictPlans: 0,
    completeWithConflict: 0,
    liftedPlans: 0,
    unmarked: 0,
    autoConflict: 0,
    superlative: 0,
    listPlanMismatch: 0,
    listPlanLines: 0,
    totalMismatch: 0,
    absentPicked: 0,
    httpErrors: 0,
  };
  const violations: SweepViolation[] = [];
  const conflictsBy: SweepResult['conflictsBy'] = {};
  const random = rng(7);
  const post = async <T,>(url: string, payload: unknown): Promise<T> => {
    const res = await app.inject({ method: 'POST', url, payload: payload as object });
    if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 200)}`);
    return (res.json() as { data: T }).data;
  };

  const check = (list: string, strategy: string, variant: string | null, p: Api.PlanResponse, absent: ReadonlySet<string>) => {
    counts.plans++;
    const v = (kind: keyof SweepCounts, detail: string) => {
      counts[kind]++;
      violations.push({ kind, list, strategy, variant, detail });
    };
    const conflicts = p.compat.filter((c) => c.level === 'conflict');
    const lifted = p.compat.filter((c) => c.assumptionLifted);
    const total = p.totalLine ?? '';
    if (conflicts.length) {
      counts.conflictPlans++;
      if (p.complete) counts.completeWithConflict++;
      const key = `${list} › ${strategy}`;
      conflictsBy[key] = { n: (conflictsBy[key]?.n ?? 0) + 1, example: conflictsBy[key]?.example ?? `${total} | ${conflicts[0]!.text}` };
      if (!p.hasConflict || (p.stops.length > 0 && !MARKER.test(total))) v('unmarked', `${total} | ${conflicts[0]!.text}`);
      for (const c of conflicts) if (!c.fromUserChoice) v('autoConflict', c.text);
    }
    if (lifted.length) {
      counts.liftedPlans++;
      if (!p.compatUnverified || (p.stops.length > 0 && !MARKER.test(total))) v('unmarked', `${total} | ${lifted[0]!.text}`);
    }
    if ((conflicts.length || lifted.length) && SUPERLATIVE.test(p.reason)) v('superlative', p.reason);
    let sum = 0;
    const lineOf = new Map<string, Api.StopLine>();
    for (const s of p.stops) for (const l of s.lines) {
      lineOf.set(l.itemId, l);
      if (l.lineTotal !== null) sum += l.lineTotal;
    }
    if (sum !== p.totalToman) v('totalMismatch', `${sum} != ${p.totalToman}`);
    for (const it of p.items ?? []) {
      const l = lineOf.get(it.itemId);
      if (absent.has(it.itemId) && (it.product || l)) v('absentPicked', `${it.itemId} ${it.product?.name ?? l?.productName}`);
      if (!l) continue;
      counts.listPlanLines++;
      if (it.product?.id !== l.productId || it.unitPrice !== l.unitPrice || it.state !== l.state)
        v('listPlanMismatch', `${it.itemId}: card ${it.product?.id}/${it.unitPrice}/${it.state} vs line ${l.productId}/${l.unitPrice}/${l.state}`);
    }
  };

  const walk = async (list: string, strategy: Strategy, variant: string | null) => {
    const parsed = await post<Api.ParseResponse>('/api/parse', { text: list });
    const absent = new Set(parsed.items.filter((i) => i.categoryIds.length === 0).map((i) => i.id));
    const state: Api.RequirementStateInput & { answers: Record<string, Record<string, string>>; settled: Record<string, boolean> } = {
      requirements: parsed.items,
      answers: {},
      settled: {},
    };
    if (variant) state.variant = variant;
    let p = await post<Api.PlanResponse>('/api/plan', { state });
    for (let step = 0; step < 8; step++) {
      check(list, strategy, variant, p, absent);
      let changed = false;
      for (const it of p.items ?? []) {
        const q = it.question;
        if (!q || !['needs_info', 'suggested', 'alternative'].includes(it.state)) continue;
        if (state.answers[it.itemId]?.[q.id] !== undefined) continue;
        const setAnswer = (id: string) => {
          state.answers[it.itemId] = { ...(state.answers[it.itemId] ?? {}), [q.id]: id };
          changed = true;
        };
        if (q.skippable === false && (strategy === 'settle' || strategy === 'skip')) {
          if (q.options[0]) setAnswer(q.options[0].id);
          continue;
        }
        if (strategy === 'settle') {
          if (!state.settled[it.itemId]) {
            state.settled[it.itemId] = true;
            changed = true;
          }
          continue;
        }
        if (strategy === 'skip') continue;
        const ids = q.options.map((o) => o.id);
        if (!ids.length) continue;
        const pick =
          strategy === 'first'
            ? ids[0]!
            : strategy === 'last'
              ? ids.length > 1
                ? ids[ids.length - 2]!
                : ids[0]!
              : strategy === 'any'
                ? ids.includes('any')
                  ? 'any'
                  : ids[ids.length - 1]!
                : ids[Math.floor(random() * ids.length)]!;
        setAnswer(pick);
      }
      if (!changed) break;
      p = await post<Api.PlanResponse>('/api/plan', { state });
    }
    // every alternative of the final state, as the variant the user would tap
    if (!variant) {
      for (const alt of p.alternatives) {
        const pv = await post<Api.PlanResponse>('/api/plan', { state: { ...state, variant: alt.id } });
        check(list, strategy, alt.id, pv, absent);
      }
    }
  };

  try {
    for (const list of lists)
      for (const strategy of STRATEGIES)
        for (const variant of [null, 'fewest']) {
          try {
            await walk(list, strategy, variant);
          } catch (e) {
            counts.httpErrors++;
            violations.push({ kind: 'httpErrors', list, strategy, variant, detail: String(e).slice(0, 200) });
          }
        }
  } finally {
    await app.close();
  }
  return { counts, violations, conflictsBy };
}

export const MUST_BE_ZERO: readonly (keyof SweepCounts)[] = ['unmarked', 'autoConflict', 'superlative', 'listPlanMismatch', 'totalMismatch', 'absentPicked', 'httpErrors'];

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'sweep-conflicts.ts'));
if (isMain) {
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? 'data/market.sqlite');
  const { counts, violations, conflictsBy } = await runSweep(dbPath);
  console.log(JSON.stringify(counts, null, 1));
  console.log('conflict plans by list › strategy (all must be the user\'s own choices, marked):');
  for (const [k, v] of Object.entries(conflictsBy)) console.log(`  ${v.n}\t${k}\t${v.example}`);
  const seen = new Set<string>();
  for (const v of violations) {
    const key = `${v.kind}|${v.list}|${v.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`${v.kind}\t${v.list}\t${v.strategy}\t${v.variant ?? '-'}\t${v.detail}`);
  }
  const j = process.argv.indexOf('--json');
  if (j > 0 && process.argv[j + 1]) writeFileSync(process.argv[j + 1]!, JSON.stringify({ counts, violations, conflictsBy }, null, 1));
  const bad = MUST_BE_ZERO.filter((k) => counts[k] > 0);
  if (bad.length) {
    console.error(`FAIL: ${bad.map((k) => `${k}=${counts[k]}`).join(', ')}`);
    process.exitCode = 1;
  }
}
