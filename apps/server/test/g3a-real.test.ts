/**
 * G3a regressions on the real market.sqlite (read-only; skipped when absent). Point DATABASE_PATH at it.
 * Repros of the independent verifier's round-3 findings, through /api/parse exactly as the web app calls it:
 *  1. items the parser marks not_in_catalog («مرغ»، «برنج»، «نان»…) were searched by raw text, asked about and,
 *     after «کافیه», auto-picked into a complete total (cat ice cream for «مرغ», a capacitor for «نان»);
 *  2. after choosing a plan variant the item cards showed the base picks while the stops bought other products;
 *  3. questions offered answers that contradict stated items (IP cameras next to a stated DVR) and a plan with a
 *     conflict read as a normal complete plan («جمع ۴ مورد», «ارزان‌ترین ترکیب…»);
 *  4. «فرقی نمی‌کند» on the adapter voltage picked a 4.2 V adapter beside a complete, verified-looking total;
 *  5. seller counts included sellers without a price; the options list counted another pool than the card.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Api } from '@app/core';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../src/config.js';
import { expectCardsMatchLines, expectNoAutoPickConflict, expectPlanInvariants, options, parseToState, plan, resolve, type App } from './contract-helpers.js';
import { makeApp } from './helpers.js';

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(findRepoRoot(process.cwd()), 'data', 'market.sqlite');
const HAS_DB = existsSync(DB_PATH);
const NOW = new Date('2026-10-21T10:00:00+03:30');
const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال و هارد ۲ ترابایت و آداپتور';
const ANALOG = 'c~in~recorder_kind~["xvr","dvr"]';
const IP = 'c~in~recorder_kind~["nvr"]';

/** Food, household and absurd words: none may ever be auto-picked from a pool the parser did not give a category. */
const ABSENT_WORDS = [
  'برنج', 'مرغ', 'شیر', 'پیتزا', 'نان', 'برنج هاشمی', 'ماست پرچرب', 'گوشت چرخ کرده', 'پنیر', 'تخم مرغ', 'سیب زمینی',
  'گوجه فرنگی', 'روغن سرخ کردنی', 'شکر', 'چای', 'قهوه', 'نوشابه', 'ماکارونی', 'عدس', 'خرما', 'کره', 'عسل',
  'مایع ظرفشویی', 'دستمال کاغذی', 'پوشک بچه', 'زیردریایی اتمی', 'قایق موتوری', 'فیل', 'هواپیما', 'اسب', 'کتاب آشپزی',
] as const;

let app: App;
let db: Database.Database;
const itemOf = (p: { items?: Api.ItemResolution[] }, id: string) => p.items!.find((i) => i.itemId === id)!;
const lineOf = (p: Api.PlanResponse, id: string) => p.stops.flatMap((s) => s.lines).find((l) => l.itemId === id);
const settleAll = (s: Api.RequirementStateInput, ids: readonly string[]): Api.RequirementStateInput => ({
  ...s,
  settled: { ...(s.settled ?? {}), ...Object.fromEntries(ids.map((id) => [id, true])) },
});
const categoryOf = (productId: string) => (db.prepare('SELECT category_id AS c FROM products WHERE id = ?').get(Number(productId)) as { c: number }).c;

describe.skipIf(!HAS_DB)('G3a on market.sqlite', () => {
  beforeAll(async () => {
    app = (await makeApp({ databasePath: DB_PATH, rateLimit: 1_000_000 }, { now: () => NOW })).app;
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  });
  afterAll(async () => {
    db?.close();
    await app?.close();
  });

  it('1. absent items are terminal «پیدا نشد»: never searched, asked or picked, even after «کافیه»; never counted', async () => {
    let absent = 0;
    for (const word of ABSENT_WORDS) {
      const { parsed, state } = await parseToState(app, word);
      const ids = parsed.items.map((i) => i.id);
      for (const s of [state, settleAll(state, ids)]) {
        const r = await resolve(app, s);
        const p = await plan(app, s);
        expectPlanInvariants(p);
        for (const it of parsed.items) {
          const card = itemOf(r, it.id);
          if (it.categoryIds.length === 0) {
            absent++;
            expect(card.state, `${word}: ${card.product?.name}`).toBe('not_found');
            expect(card.product).toBeUndefined();
            expect(card.question).toBeUndefined();
            expect(card.candidateCount).toBe(0);
            expect(card.nearbyCategories!.length).toBeGreaterThan(0);
            expect(card.nearbyCategoryIds).toHaveLength(card.nearbyCategories!.length);
            expect(card.nearbyLabelFa).toBeTruthy();
            expect(lineOf(p, it.id)).toBeUndefined();
            expect(p.coverage.missing.map((m) => m.itemId)).toContain(it.id);
          } else if (card.product) {
            // an item the parser did place is only ever picked from its own categories (category-coherent pool)
            expect(it.categoryIds, `${word}: ${card.product.name}`).toContain(categoryOf(card.product.id));
          }
        }
      }
    }
    expect(absent).toBeGreaterThanOrEqual(2 * 25);
  });

  it('1b. «برنج» in a CCTV list + «کافیه» everywhere: the rest is planned, the total says «فقط ۴ از ۵ مورد» and «پیدا نشد: برنج»', async () => {
    const { parsed, state } = await parseToState(app, '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت، برنج و آداپتور');
    const rice = parsed.items.find((i) => i.text.includes('برنج'))!;
    expect(rice.categoryIds).toEqual([]);
    const s = settleAll(state, parsed.items.map((i) => i.id));
    for (const variant of [null, 'fewest'] as const) {
      const p = await plan(app, { ...s, variant });
      expectPlanInvariants(p);
      expectCardsMatchLines(p);
      expect(itemOf(p, rice.id)).toMatchObject({ state: 'not_found' });
      expect(itemOf(p, rice.id).product).toBeUndefined();
      expect(lineOf(p, rice.id)).toBeUndefined();
      expect(p.complete).toBe(false);
      expect(p.totalLine).toMatch(/^فقط ۴ از ۵ مورد/);
      expect(p.missingLine).toContain('پیدا نشد: برنج');
    }
  });

  it('1c. «مرغ» + «کافیه»: no question, no pick, no plan; picking a suggested category makes it a normal item', async () => {
    const { parsed, state } = await parseToState(app, 'مرغ');
    const id = parsed.items[0]!.id;
    const r = await resolve(app, settleAll(state, [id]));
    const card = itemOf(r, id);
    expect(card).toMatchObject({ state: 'not_found', reason: '«مرغ» در فهرست این بازار پیدا نشد.' });
    const p = await plan(app, settleAll(state, [id]));
    expect(p.stops).toEqual([]);
    expect(p.totalToman).toBe(0);
    // the user taps a suggested category: only then is it searched (inside that category)
    const cat = card.nearbyCategoryIds![0]!;
    const picked: Api.RequirementStateInput = { ...state, requirements: [{ ...parsed.items[0]!, categoryIds: [cat] }] };
    const r2 = itemOf(await resolve(app, picked), id);
    expect(r2.state).not.toBe('not_found');
    expect(r2.categoryIds).toEqual([cat]);
  });

  it('2. the item cards show what the selected plan buys: 5 scenarios x every variant (property)', async () => {
    const scenarios: { text: string; answers?: Record<number, Record<string, string>> }[] = [
      { text: CCTV, answers: { 1: { recorder_kind: ANALOG } } },
      { text: 'سیم برق ۲/۵ افشان ۵۰ متر، کلید و پریز، پروژکتور ۵۰ وات', answers: { 0: { sale_unit: 'c~eq~sale_unit~"roll"' } } },
      { text: 'گوشی سامسونگ A56 با قاب و گلس' },
      { text: '۸ دوربین هایک ویژن، دی وی آر ۸ کانال، هارد ۴ ترابایت، آداپتور ۱۲ ولت ۵ آمپر' },
      { text: 'شارژر ۲۵ وات، کابل شارژ تایپ سی، پاوربانک ۲۰۰۰۰، هندزفری بلوتوثی' },
    ];
    let lines = 0;
    let differs = 0;
    for (const sc of scenarios) {
      const { parsed, state } = await parseToState(app, sc.text);
      const answers: Record<string, Record<string, string>> = {};
      for (const [i, a] of Object.entries(sc.answers ?? {})) answers[parsed.items[Number(i)]!.id] = a;
      const s = settleAll({ ...state, answers }, parsed.items.map((i) => i.id));
      const base = await plan(app, s);
      const variants = [null, 'fewest', ...base.alternatives.map((a) => a.id)];
      expect(variants.length).toBeGreaterThan(2);
      for (const variant of variants) {
        const sv = { ...s, variant };
        const p = await plan(app, sv);
        expectPlanInvariants(p);
        expectCardsMatchLines(p);
        // /api/resolve for the same state shows the same cards
        const r = await resolve(app, sv);
        for (const it of p.items!) {
          expect(itemOf(r, it.itemId).product?.id).toBe(it.product?.id);
          expect(itemOf(r, it.itemId).unitPrice).toBe(it.unitPrice);
        }
        for (const l of p.stops.flatMap((x) => x.lines)) {
          lines++;
          if (l.productId !== itemOf(base, l.itemId).product?.id) differs++;
        }
      }
    }
    // the variants really do buy other products than the base plan (what made the cards lie before)
    expect(lines).toBeGreaterThan(40);
    expect(differs).toBeGreaterThan(0);
  });

  it('3a. questions never offer an answer that contradicts a stated item', async () => {
    // a stated DVR: walk the camera's questions; the signal question never offers IP
    const walk = async (text: string): Promise<Api.Question[]> => {
      const { parsed, state } = await parseToState(app, text);
      const cam = parsed.items.find((i) => i.kind === 'camera')!.id;
      const asked: Api.Question[] = [];
      let s: Api.RequirementStateInput = { ...state, answers: {} };
      for (let i = 0; i < 6; i++) {
        const q = itemOf(await resolve(app, s), cam).question;
        if (!q) break;
        asked.push(q);
        // take the first option (the most common value) to move to the next question
        s = { ...s, answers: { ...s.answers, [cam]: { ...(s.answers?.[cam] ?? {}), [q.id]: q.options[0]!.id } } };
      }
      return asked;
    };
    const dvr = await walk('۴ دوربین، دی وی آر ۴ کانال');
    const sigQ = dvr.find((q) => q.id === 'camera_signal');
    expect(sigQ, 'the signal question is still asked next to a DVR').toBeTruthy();
    expect(sigQ!.options.map((o) => o.id).join(' ')).not.toContain('"ip"');
    expect(sigQ!.options.some((o) => o.id.includes('hdcvi') || o.id.includes('ahd') || o.id.includes('analog'))).toBe(true);
    // a stated NVR leaves a single family: no signal question with analog options
    for (const q of await walk('۴ دوربین، ان وی آر ۴ کانال')) {
      if (q.id === 'camera_signal') for (const o of q.options) expect(o.id).not.toMatch(/ahd|hdcvi|tvi|analog/);
    }
    // the recorder answered «تحت شبکه»: the cameras are never offered an analog signal
    const { parsed, state } = await parseToState(app, CCTV);
    const s: Api.RequirementStateInput = { ...state, answers: { i2: { recorder_kind: IP } } };
    const camQ = itemOf(await resolve(app, s), parsed.items[0]!.id).question;
    if (camQ?.id === 'camera_signal') for (const o of camQ.options) expect(o.id).not.toMatch(/ahd|hdcvi|tvi|analog/);
    const p = await plan(app, s);
    expect(p.compat.some((c) => c.level === 'conflict')).toBe(false);
  });

  it('3b. a stated contradiction is said in Persian; the plan carries hasConflict, the marker, no superlative', async () => {
    const { parsed, state } = await parseToState(app, '۴ دوربین تحت شبکه و دی وی آر ۸ کانال و آداپتور');
    const [cam, rec] = parsed.items.map((i) => i.id) as [string, string];
    const r = await resolve(app, state);
    expect(itemOf(r, cam).conflictNote).toContain('دی وی آر ۸ کانال');
    expect(itemOf(r, rec).conflictNote).toContain('دوربین تحت شبکه');
    for (const q of [itemOf(r, cam).question, itemOf(r, rec).question]) {
      // nothing that deepens it: no camera signal / recorder kind question
      expect(['camera_signal', 'recorder_kind']).not.toContain(q?.id);
    }
    for (const variant of [null, 'fewest'] as const) {
      const p = await plan(app, settleAll({ ...state, variant }, parsed.items.map((i) => i.id)));
      expectNoAutoPickConflict(p);
      expectCardsMatchLines(p);
      expect(p.hasConflict).toBe(true);
      expect(p.totalMarker).toBe('ناسازگاری دارد');
      expect(p.totalLine).toMatch(/ — ناسازگاری دارد$/);
      expect(p.reason).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین/);
      const line = p.compat.find((c) => c.level === 'conflict')!;
      expect(line.fromUserChoice).toBe(true);
      expect(line.text).toContain('(از انتخاب‌های خودت)');
    }
    // a plan without any conflict keeps the plain line and says hasConflict: false
    const clean = await plan(app, settleAll((await parseToState(app, 'هارد ۲ ترابایت')).state, ['i1']));
    expect(clean.hasConflict).toBe(false);
    expect(clean.totalMarker).toBeUndefined();
    expect(clean.totalLine).toMatch(/^جمع ۱ مورد: [^—]+$/);
  });

  it('4. «فرقی نمی‌کند» on the adapter voltage: the choice is kept, the line says the assumption is lifted, no verified feel', async () => {
    const { state } = await parseToState(app, CCTV);
    const s: Api.RequirementStateInput = {
      ...state,
      answers: { i2: { recorder_kind: ANALOG }, i4: { voltage_v: 'any', current_a: 'any', budget: 'any' } },
      settled: { i1: true, i2: true, i3: true },
    };
    const p = await plan(app, s);
    expectPlanInvariants(p);
    expectCardsMatchLines(p);
    // the cheapest listing-stated voltage on this snapshot is the 4.2 V «آداپتور 4.2V فیش بزرگ 500 میلی آمپر»
    const adSpecs = (await options(app, s, 'i4', lineOf(p, 'i4')!.productId)).models.find((m) => m.productId === lineOf(p, 'i4')!.productId)?.specs ?? [];
    expect(adSpecs.some((x) => x.startsWith('۱۲ ولت'))).toBe(false);
    const ad = p.compat.find((c) => c.ruleId === 'camera_adapter_12v')!;
    expect(ad).toMatchObject({ level: 'unknown', assumptionLifted: true, levelLabel: 'فرض عمومی کنار گذاشته شد؛ تأیید نشده' });
    expect(p.compatUnverified).toBe(true);
    expect(p.hasConflict).toBe(false);
    expect(p.complete).toBe(true);
    expect(p.totalMarker).toBe('بدون تأیید سازگاری');
    expect(p.totalLine).toMatch(/^جمع ۴ مورد: .+ — بدون تأیید سازگاری$/);
    expect(p.reason).not.toMatch(/ارزان‌ترین|کم‌توقف‌ترین/);
    // the same plan with 12 V chosen: verified-as-assumed, no marker
    const s12: Api.RequirementStateInput = { ...s, answers: { ...s.answers, i4: { voltage_v: 'c~eq~voltage_v~12' } }, settled: { ...s.settled, i4: true } };
    const p12 = await plan(app, s12);
    expect(p12.compat.find((c) => c.ruleId === 'camera_adapter_12v')).toMatchObject({ level: 'assumed' });
    expect(p12.compatUnverified).toBeUndefined();
    expect(p12.totalMarker).toBeUndefined();
    // the user's explicit choice is kept: the adapter is planned (not dropped, not re-asked)
    expect(itemOf(p, 'i4').state).toBe('suggested');
    expect(itemOf(p, 'i4').question).toBeUndefined();
  });

  it('5. seller counts are priced sellers; the options list counts the same pool as the card', async () => {
    const { parsed, state } = await parseToState(app, 'سیم مفتولی ۱.۵');
    const id = parsed.items[0]!.id;
    const s: Api.RequirementStateInput = { ...state, answers: { [id]: { sale_unit: 'c~eq~sale_unit~"roll"' } } };
    const card = itemOf(await resolve(app, s), id);
    const o = await options(app, s, id);
    expect(o.eligibleCount).toBe(card.eligibleCount);
    expect(o.modelTotal).toBe(card.eligibleCount);
    expect(o.models.filter((m) => m.fit === 'eligible').length).toBe(Math.min(card.eligibleCount!, 40));
    expect(o.poolLabel).toContain('مدل مطابق خواسته');
    // sellerCount = shops with a usable price for the product (as labelled)
    const priced = (pid: string) =>
      (db.prepare('SELECT COUNT(DISTINCT shop_id) AS n FROM offers WHERE product_id = ? AND price IS NOT NULL AND price_flag IS NULL').get(Number(pid)) as { n: number }).n;
    expect(card.sellerCount).toBeLessThanOrEqual(priced(card.product!.id));
    expect(card.sellerCountLabel).toBe(`${new Intl.NumberFormat('fa-IR').format(card.sellerCount!)} فروشنده با قیمت`);
    for (const m of o.models.filter((x) => x.priceLow > 0)) expect(m.sellerCountLabel).toContain('با قیمت');
  });
});
