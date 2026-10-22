import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots-real');
mkdirSync(SHOTS, { recursive: true });

export const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';

/** Screenshot names that are also captured at 360 (keeps the committed PNG set small). */
const KEY_360 = new Set([
  '01-home',
  '03-list-question',
  '05-plan',
  '09-market',
  '20-sale-unit-question',
  '30-not-found',
  '60-multishop-plan',
  '61-multishop-market',
  '62-flags-plan',
  '63-condition-note',
  '64-assist-diff',
  '65-assist-degraded',
  '66-assist-simple-mode',
  '73-bidi-stop-line',
  '81-conflict-plan',
  '82-not-found-chips',
  '85-share-fallback',
  '86-share-manual',
]);

/** Small PNG of the current state. Full-page captures un-stick fixed bars and cap the height. */
export async function shot(page: Page, name: string, fullPage = false) {
  const vp = page.viewportSize()!;
  if (vp.width === 360 && !KEY_360.has(name)) return;
  await page.waitForTimeout(300); // let transitions settle
  const style = fullPage
    ? await page.addStyleTag({ content: '[data-testid="action-bar"]{display:none!important}header,.sticky{position:static!important}' })
    : null;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({
    path: join(SHOTS, `${vp.width}-${name}.png`),
    ...(fullPage ? { fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(height, 2600) } } : {}),
  });
  await style?.evaluate((el) => (el as Element).remove());
}

/** No horizontal scroll at this viewport (document or any visible element sticking out). */
export async function expectNoOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth - vw > 0) out.push(`document ${document.documentElement.scrollWidth - vw}px`);
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (el.closest('[aria-hidden="true"], .sr-only, .sr-only-fa')) return;
      if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(r.left)}..${Math.round(r.right)})`);
    });
    return out.slice(0, 6);
  });
  expect(over, 'horizontal overflow').toEqual([]);
}

/** Buttons/tabs are at least 48px high. */
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const sel = 'button:not([disabled]), [role="tab"], [role="radio"], [role="checkbox"], a[href]';
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).display === 'inline') return;
      if (r.height < 47.5) out.push(`${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    });
    return out;
  });
  expect(small, 'controls under 48px').toEqual([]);
}

/** Honesty: no phone numbers anywhere on the page, and no English sentences (Latin runs are model codes only). */
export async function expectNoPhoneNumbers(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/(\+?98|0)?9[0-9۰-۹]{9}|۰۹[۰-۹]{9}|\b0\d{10}\b|تلفن|تماس/);
}

/**
 * What the REAL server says about an item's options pool (/api/options): the page must show exactly this, so tests
 * never hard-code a model count that the data or the engine rules can change.
 */
export async function serverPool(page: Page, text: string, itemIndex = 0): Promise<{ poolLabel: string; eligibleCount: number; shown: number }> {
  const parsed = (await (await page.request.post('/api/parse', { data: { text } })).json()).data;
  const itemId = parsed.items[itemIndex].id;
  const opt = (await (await page.request.post('/api/options', { data: { state: { requirements: parsed.items }, itemId } })).json()).data;
  return { poolLabel: opt.poolLabel, eligibleCount: opt.eligibleCount, shown: opt.models.length };
}

/** Types the text on Home and submits; waits for the working screen. */
export async function startPlan(page: Page, text: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('برای خریدت چی لازم داری؟');
  await page.getByLabel('فهرست خریدت را بنویس').fill(text);
  await page.getByTestId('go').click();
  await expect(page).toHaveURL(/#\/plan\//);
  // first computed state: skeleton gone
  await expect(page.getByTestId('item-card').first().or(page.getByTestId('plan-view'))).toBeVisible({ timeout: 20_000 });
}

/** Waits until no recompute is in flight (aria-busy is removed from the lists). */
export async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Settles every open question with the visible default («همه‌ی موارد: فرقی نمی‌کند»), deterministically: waits for the
 * list to show exactly one of its three strips, then acts on the one that is there (no count()-then-click race).
 */
export async function settleAllItems(page: Page) {
  await settled(page);
  const pending = page.getByTestId('pending-strip');
  const rest = page.getByTestId('all-ready-strip').or(page.getByTestId('missing-strip')).or(page.getByTestId('conflict-strip'));
  await expect(pending.or(rest)).toBeVisible();
  if (await pending.isVisible()) {
    await page.getByTestId('settle-all').click();
    await expect(pending).toHaveCount(0);
  }
  await settled(page);
}

/**
 * Answers the item questions one by one until the primary action says «ببین برنامه». Each attempt is a retried block:
 * it waits for the recompute, clicks through an auto-waiting locator (short timeout, so a card that re-renders or
 * vanishes under the click only costs a retry), and ends only when the button text says nothing is left to answer.
 * Nothing is decided by counting elements that are about to re-render.
 */
export async function answerQuestions(page: Page) {
  const primary = page.getByTestId('primary-action');
  const card = page.getByTestId('question-card');
  await expect(async () => {
    await settled(page);
    if ((await primary.textContent())?.trim() !== 'ببین برنامه') {
      await card.getByTestId('enough').or(card.getByRole('radio').first()).first().click({ timeout: 3_000 });
      await settled(page);
    }
    await expect(primary).toHaveText('ببین برنامه', { timeout: 1_500 });
  }).toPass({ timeout: 60_000 });
}

export type CompatLevel = 'stated' | 'assumed' | 'unknown' | 'conflict';

/** The rows of the «سازگاری» block as shown: the level chip and the sentence. */
export async function compatRows(page: Page): Promise<{ level: CompatLevel; text: string; rule: string }[]> {
  return page.locator('[data-testid="compat-block"] li').evaluateAll((lis) =>
    lis.map((li) => ({
      level: li.querySelector('[data-compat]')!.getAttribute('data-compat') as CompatLevel,
      text: (li.querySelector('p')?.textContent ?? '').replace(/[\u2066-\u2069]/g, ''),
      rule: li.getAttribute('data-rule') ?? '',
    })),
  );
}

/** Asserts the level of the one compat row whose sentence matches `re` (and that exactly one row matches). */
export function expectCompatLevel(rows: { level: CompatLevel; text: string; rule?: string }[], re: RegExp, level: CompatLevel) {
  const hit = rows.filter((r) => re.test(r.text));
  expect(hit.map((r) => `${r.level}: ${r.text}`), `compat row ${re}`).toHaveLength(1);
  expect(hit[0]!.level, `level of «${hit[0]!.text}»`).toBe(level);
}
