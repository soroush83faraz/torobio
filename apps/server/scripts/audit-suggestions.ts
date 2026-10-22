/**
 * Suggestion-quality audit on the real market.sqlite (read-only).
 *
 *   DATABASE_PATH=/path/to/market.sqlite npx tsx apps/server/scripts/audit-suggestions.ts [--json out.json]
 *
 * For each request: POST /api/parse -> state (parser items verbatim) -> POST /api/resolve. Items still asking a
 * skippable question are settled («کافیه، پیشنهاد بده»), which is what the default suggestion would be; a wire item's
 * mandatory sale-unit question is answered twice (roll and metre) and both are reported. Then POST /api/plan.
 * Per item it prints the picked product, its price and category, the eligible count, the pick's price rank inside
 * the eligible set (1 = cheapest), the eligible median, and heuristic flags for a human reviewer:
 *   cheap10   pick < 1/10 of the eligible median (possible accessory / per-unit confusion)
 *   nohead    the pick's title contains none of the request's own words (after the category vocabulary)
 *   flagged   the pick carries a used / replica flag (must never happen)
 * The flags are review aids, not rules; the engine does not read them.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Api, titleHead, tokenizeForSearch } from '@app/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { planState } from '../src/adapter/engine.js';
import { catalogFor } from '../src/retrieval/catalog.js';

export const AUDIT_REQUESTS: readonly string[] = [
  // CCTV
  'دوربین داهوا ۲ مگاپیکسل',
  '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور',
  'دوربین مداربسته',
  'دوربین هایک ویژن ۵ مگاپیکسل',
  'دوربین بالت تحت شبکه',
  'دوربین دام AHD',
  'دی وی آر ۸ کانال',
  'ان وی آر ۸ کانال',
  'ضبط کننده ۱۶ کانال',
  'هارد ۱ ترابایت',
  'هارد بنفش ۴ ترابایت',
  'آداپتور',
  'آداپتور ۱۲ ولت ۲ آمپر',
  'آداپتور ۱۲ ولت',
  'منبع تغذیه ۱۲ ولت ۱۰ آمپر',
  // wire
  'سیم ۲.۵',
  'سیم برق ۱.۵ افشان',
  'سیم ۴ مفتولی',
  'کابل ۳ در ۲.۵',
  'سیم ۶',
  'سیم برق ۱۰۰ متر',
  'سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز',
  // switches / sockets
  'کلید و پریز',
  'کلید تک پل',
  'پریز برق',
  'کلید دوپل',
  'پریز ارت',
  // lighting
  'پروژکتور ۵۰ وات',
  'پروژکتور ال ای دی ۱۰۰ وات',
  'لامپ ال ای دی ۱۰ وات',
  'چراغ پنلی سقفی',
  'پروژکتور خورشیدی',
  // phones and accessories
  'گوشی سامسونگ A56 با قاب و گلس',
  'گوشی آیفون ۱۳',
  'گوشی شیائومی ردمی نوت ۱۳',
  'گوشی سامسونگ ۲۵۶ گیگ',
  'گوشی موبایل',
  'قاب آیفون ۱۳',
  'گلس سامسونگ A56',
  'محافظ صفحه آیفون ۱۵',
  'شارژر سامسونگ',
  'شارژر ۲۵ وات',
  'کابل شارژ تایپ سی',
  'هندزفری بلوتوثی',
  'هدفون',
  'ایرپاد',
  'پاوربانک ۲۰۰۰۰',
  'پاوربانک',
  // watches
  'ساعت هوشمند',
  'ساعت مچی مردانه',
  'اپل واچ',
  // laptops
  'لپ‌تاپ ایسوس',
  'لپ تاپ لنوو',
  'لپ تاپ',
  // TVs
  'تلویزیون سامسونگ ۵۵ اینچ',
  'تلویزیون ال جی',
  'تلویزیون',
  // shoes
  'کفش ورزشی',
  'کفش مردانه',
  'کتانی نایکی',
];

export interface AuditRow {
  request: string;
  item: string;
  variant?: string;
  kind: string;
  categories: string;
  state: string;
  pickId?: string;
  pickTitle?: string;
  pickCategory?: string;
  price?: number | null;
  eligible: number;
  incomplete: number;
  candidates: number;
  rank?: number;
  median?: number;
  flags: string[];
  inPlan: boolean;
  /** Listings set aside by the plausibility rules: other-kind heads (head×count) and unclear-unit listings. */
  otherKind?: string;
  unitUnclear?: number;
}

const NOW = new Date('2026-10-21T10:00:00+03:30');

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1]! + s[m]!) / 2);
}

export async function runAudit(dbPath: string, requests: readonly string[] = AUDIT_REQUESTS): Promise<AuditRow[]> {
  const config = { ...loadConfig({ NODE_ENV: 'test' }), databasePath: dbPath, rateLimit: 1_000_000, llmApiKey: undefined, webDist: path.join(path.dirname(dbPath), 'no-web') };
  const { app, ctx } = await buildApp({ config, now: () => NOW });
  await app.ready();
  const catalog = catalogFor(ctx.db);
  const cats = catalog.categories();
  const post = async <T,>(url: string, payload: unknown): Promise<T> => {
    const res = await app.inject({ method: 'POST', url, payload: payload as object });
    if (res.statusCode !== 200) throw new Error(`${url} ${res.statusCode} ${res.body.slice(0, 300)}`);
    return (res.json() as { data: T }).data;
  };
  const rows: AuditRow[] = [];
  try {
    for (const text of requests) {
      const parsed = await post<Api.ParseResponse>('/api/parse', { text });
      const base: Api.RequirementStateInput = { requirements: parsed.items };
      if (parsed.preference) base.preference = parsed.preference;
      // settle every item that asks a skippable question; wire unit questions branch into variants
      let r = await post<Api.ResolveResponse>('/api/resolve', { state: base });
      const settled: Record<string, boolean> = {};
      for (const it of r.items) if (it.state === 'needs_info' && it.question?.skippable !== false) settled[it.itemId] = true;
      const wireQ = r.items.filter((it) => it.question?.id === 'sale_unit');
      const variants: { name?: string; answers: Record<string, Record<string, string>> }[] = [];
      if (wireQ.length) {
        for (const unit of ['roll', 'meter'] as const) {
          const answers: Record<string, Record<string, string>> = {};
          for (const w of wireQ) {
            const o = w.question!.options.find((x) => x.id === `c~eq~sale_unit~"${unit}"`);
            if (o) answers[w.itemId] = { sale_unit: o.id };
          }
          variants.push({ name: unit, answers });
        }
      } else variants.push({ answers: {} });
      for (const v of variants) {
        const state: Api.RequirementStateInput = { ...base, settled, answers: v.answers };
        r = await post<Api.ResolveResponse>('/api/resolve', { state });
        const p = await post<Api.PlanResponse>('/api/plan', { state });
        const planned = new Set(p.stops.flatMap((s) => s.lines.map((l) => l.itemId)));
        // the same item cards /api/resolve and /api/plan show (after the plan's compatibility guard)
        const rs = planState(catalog, Api.ResolveRequestSchema.parse({ state }).state, NOW).rs;
        for (const it of r.items) {
          const ri = rs.items.find((x) => x.item.id === it.itemId)!;
          const evals = ri.result.resolution.evaluations;
          const eligPrices = evals.filter((e) => e.fit === 'eligible' && e.minPrice !== null).map((e) => e.minPrice!);
          const dto = parsed.items.find((x) => x.id === it.itemId)!;
          const row: AuditRow = {
            request: text,
            item: dto.text,
            kind: it.kind ?? 'other',
            categories: (it.categoryIds ?? []).map((id) => cats.get(id)?.name ?? String(id)).join(' | '),
            state: it.state,
            eligible: ri.result.resolution.counts.eligible,
            incomplete: ri.result.resolution.counts.incomplete,
            candidates: ri.result.resolution.counts.candidates,
            flags: [],
            inPlan: planned.has(it.itemId),
          };
          if (v.name) row.variant = v.name;
          const heads = new Map<string, number>();
          let unclear = 0;
          for (const e of evals) {
            if (e.issues?.includes('other_kind')) {
              const h = titleHead(ri.byId.get(e.productId)!.product.title) ?? '?';
              heads.set(h, (heads.get(h) ?? 0) + 1);
            }
            if (e.issues?.includes('unit_unclear')) unclear++;
          }
          if (heads.size) row.otherKind = [...heads].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}×${n}`).join(' ');
          if (unclear) row.unitUnclear = unclear;
          const med = median(eligPrices);
          if (med !== undefined) row.median = med;
          if (it.product) {
            const c = ri.byId.get(Number(it.product.id));
            row.pickId = it.product.id;
            row.pickTitle = it.product.name;
            row.pickCategory = c ? (cats.get(c.product.categoryId)?.name ?? '') : '';
            row.price = it.unitPrice ?? null;
            if (row.price != null) row.rank = eligPrices.filter((x) => x < row.price!).length + 1;
            if (row.price != null && med && row.price * 10 < med) row.flags.push('cheap10');
            if (it.productFlags?.length) row.flags.push('flagged');
            // request words beyond the category vocabulary and numbers
            const own = tokenizeForSearch(dto.text, { dropStopwords: true }).filter((t) => !/^\d+$/.test(t));
            const title = new Set(tokenizeForSearch(it.product.name));
            if (own.length && !own.some((t) => title.has(t))) row.flags.push('nohead');
          }
          rows.push(row);
        }
      }
    }
  } finally {
    await app.close();
  }
  return rows;
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const cell = (s: string | undefined) => (s ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 90);

export function toMarkdown(rows: readonly AuditRow[]): string {
  const out = ['| # | request › item | state | pick (price) | pick category | elig/incompl/cand | rank | eligible median | flags |', '|---|---|---|---|---|---|---|---|---|'];
  rows.forEach((r, i) => {
    const item = r.item === r.request ? r.item : `${r.request} › ${r.item}`;
    out.push(
      `| ${i + 1} | ${cell(item)}${r.variant ? ` [${r.variant}]` : ''} | ${r.state} | ${cell(r.pickTitle)} (${fmt(r.price)}) | ${cell(r.pickCategory)} | ${r.eligible}/${r.incomplete}/${r.candidates} | ${r.rank ?? '—'} | ${fmt(r.median)} | ${r.flags.join(' ') || ''} |`,
    );
  });
  out.push('', '#### Listings set aside by the plausibility rules (per item)', '', '| # | item | other-kind title heads (count) | unit unclear |', '|---|---|---|---|');
  rows.forEach((r, i) => {
    if (r.otherKind || r.unitUnclear) out.push(`| ${i + 1} | ${cell(r.item)}${r.variant ? ` [${r.variant}]` : ''} | ${r.otherKind ?? ''} | ${r.unitUnclear ?? ''} |`);
  });
  return out.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'audit-suggestions.ts'));
if (isMain) {
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? 'data/market.sqlite');
  const rows = await runAudit(dbPath);
  console.log(toMarkdown(rows));
  const j = process.argv.indexOf('--json');
  if (j > 0 && process.argv[j + 1]) writeFileSync(process.argv[j + 1]!, JSON.stringify(rows, null, 1));
}
