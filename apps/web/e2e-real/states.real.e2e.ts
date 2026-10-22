import { expect, test, type Page } from '@playwright/test';
import { CCTV, expectNoOverflow, expectTouchTargets, serverPool, settleAllItems, settled, shot, startPlan } from './helpers';

/** Sheets, long lists, the assistant's chips-only mode, and a slow or dead server, all on real data. */

async function settleAndOpenPlan(page: Page) {
  await settleAllItems(page);
  await expect(page.getByTestId('pending-strip')).toHaveCount(0);
  await page.getByTestId('primary-action').click();
  await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
  await settled(page);
}

test('a long options list is paged, with an honest cap note', async ({ page }) => {
  await startPlan(page, 'آداپتور');
  await settleAndOpenPlan(page);
  await page.getByRole('button', { name: 'تغییر', exact: true }).first().click();
  const list = page.getByTestId('options-list');
  await expect(list.locator('article').first()).toBeVisible({ timeout: 15_000 });
  await expect(list.locator('article')).toHaveCount(8);
  // the header is the server's own pool label (never a client-derived count); the cut is said without a second number
  const pool = await serverPool(page, 'آداپتور');
  expect(pool.poolLabel).toMatch(/مدل/);
  await expect(list.getByTestId('pool-label')).toHaveText(pool.poolLabel.replace(/\u2066|\u2069/g, ''));
  await expect(list).toContainText(/ارزان‌ترین \S+ مورد نشان داده می‌شود/);
  expect(pool.shown).toBeGreaterThan(8);
  await expectNoOverflow(page);
  await shot(page, '50-options-paged');
  await page.getByTestId('show-more').click();
  await expect(list.locator('article')).toHaveCount(16);
  // choosing a model pins it («مدل مشخص») and shows the undo toast
  await list.locator('article').nth(2).getByRole('button').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settled(page);
  await expect(page.locator('[data-testid="stop-line"][data-state="exact"]')).toHaveCount(1);
});

test('assistant: a chip changes the plan (diff banner), free text it cannot act on gets a calm answer', async ({ page }) => {
  await startPlan(page, CCTV);
  await page.getByTestId('question-card').getByRole('radio', { name: /آنالوگ/ }).click();
  await settleAndOpenPlan(page);
  await expect(page.getByTestId('plan-view')).toContainText('۴ توقف');
  await page.getByTestId('open-assistant').click();
  await expect(page.getByRole('dialog', { name: 'تغییر برنامه' })).toBeVisible();
  await expect(page.getByTestId('assist-fewer_stops')).toBeVisible();
  await shot(page, '51-assistant');
  await page.getByTestId('assist-fewer_stops').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('replan-diff')).toBeVisible();
  await expect(page.getByTestId('assist-message')).toContainText('توقف');
  await settled(page);
  await expect(page.getByTestId('stop')).not.toHaveCount(4); // (the switcher lists «۴ توقف» as an option)
  // free text the deterministic assistant does not understand: a calm Persian line listing what it can do, no crash
  await page.getByTestId('open-assistant').click();
  await page.getByRole('textbox', { name: 'تغییر برنامه' }).fill('یک چیز عجیب');
  await page.getByRole('button', { name: 'بفرست' }).click();
  await expect(page.getByRole('dialog')).toContainText('امکانش نیست');
  await expectNoOverflow(page);
});

test('a slow server shows a calm message, a dead one a Persian error with retry', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    await new Promise((r) => setTimeout(r, 3600));
    await route.continue();
  });
  await page.goto('/');
  await page.getByLabel('فهرست خریدت را بنویس').fill(CCTV);
  await page.getByTestId('go').click();
  await expect(page.getByTestId('slow-notice')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('slow-notice')).toContainText('کمی دیر جواب می‌دهد');
  await expectNoOverflow(page);
  await shot(page, '52-slow');
  await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('slow-notice')).toHaveCount(0);

  // dead server on a recompute: the last good data stays, with a retry
  await page.unroute('**/api/plan');
  await page.route('**/api/plan', (route) => route.abort('connectionrefused'));
  await page.getByTestId('settle-all').click();
  await expect(page.getByTestId('refresh-failed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('item-card').first()).toBeVisible();
  await shot(page, '53-refresh-failed');
  await page.unroute('**/api/plan');
  await page.getByTestId('refresh-failed').getByRole('button').click();
  await expect(page.getByTestId('refresh-failed')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('pending-strip')).toHaveCount(0);
});

test('Home: a too-long text gets the server\'s Persian message; typing is never blocked', async ({ page }) => {
  await page.goto('/');
  const box = page.getByLabel('فهرست خریدت را بنویس');
  await box.fill('دوربین '.repeat(100));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('parse-error')).toContainText('کوتاه‌تر');
  await box.fill('هارد ۲ ترابایت');
  await page.getByTestId('go').click();
  await expect(page).toHaveURL(/#\/plan\//);
  await expectTouchTargets(page);
});

test('an old mock-era plans:v1 payload is dropped with a calm notice', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('plans:v1')) return;
    localStorage.setItem(
      'plans:v1',
      JSON.stringify({
        version: 1,
        state: {
          plans: {
            p1: {
              id: 'p1', name: 'قدیمی', createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z', view: 'plan', checks: {}, reports: {},
              requirements: [{ id: 'r1', text: 'دوربین', qty: 1, categoryId: 'camera', categoryLabel: 'دوربین', chips: [] }],
              answers: {}, settled: {}, pins: {}, shopPins: {}, excludedShops: {}, variant: null, visit: { day: 'today', window: 'any' },
            },
          },
          progress: {},
        },
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('legacy-notice')).toContainText('برنامهٔ آزمایشی قبلی');
  await expect(page.getByTestId('resume-card')).toHaveCount(0);
  await shot(page, '54-legacy-notice');
  await page.getByRole('button', { name: 'پنهان‌کردن این یادداشت' }).first().click();
  await expect(page.getByTestId('legacy-notice')).toHaveCount(0);
});
