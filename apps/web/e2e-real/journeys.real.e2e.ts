import { expect, test } from '@playwright/test';
import { CCTV, answerQuestions, compatRows, expectCompatLevel, expectNoOverflow, expectNoPhoneNumbers, expectTouchTargets, settleAllItems, settled, shot, startPlan } from './helpers';

/**
 * Real-data journeys: real server, real market.sqlite, no mocks. Each test starts from an empty browser.
 */

test.describe('J1 CCTV project, end to end', () => {
  test('sentence -> recorder question -> plan -> Friday -> show seller -> checklist -> report -> replan + undo -> reload -> resume', async ({ page }) => {
    // ---------- Home
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('resume-card')).toHaveCount(0);
    await expectNoOverflow(page);
    await shot(page, '01-home');

    await page.getByLabel('فهرست خریدت را بنویس').fill(CCTV);
    await page.getByTestId('go').click();
    await expect(page).toHaveURL(/#\/plan\//);

    // ---------- list: the recorder's compat question comes first and is the only expanded one
    await expect(page.getByTestId('item-card').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('saved-indicator')).toHaveText('✓ ذخیره شد روی همین گوشی');
    await expect(page.getByTestId('pending-strip')).toBeVisible();
    await expect(page.getByTestId('question-card')).toHaveCount(1);
    await expect(page.getByTestId('question-card')).toContainText('آنالوگ‌اند یا تحت شبکه');
    // suggestions are never worded «مدل مشخص»
    await expect(page.locator('[data-testid="item-card"][data-state="exact"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="item-card"][data-state="suggested"]').first()).toContainText('پیشنهاد');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '03-list-question', true);

    // ---------- answer the recorder question, settle the rest
    await page.getByTestId('question-card').getByRole('radio', { name: /آنالوگ/ }).click();
    await settleAllItems(page);
    await expect(page.getByTestId('pending-strip')).toHaveCount(0);
    await shot(page, '04-list-resolved', true);

    // ---------- plan
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible();
    await settled(page);
    const total = page.locator('[data-total]').first();
    await expect(total).toHaveAttribute('data-total', 'complete');
    await expect(total).toContainText('جمع ۴ مورد');
    await expect(total).toContainText('با مدل‌های پیشنهادی');
    await expect(page.getByTestId('stop').first()).toBeVisible();
    await expect(page.getByTestId('compat-block')).toBeVisible();
    // every compatibility line is asserted by its EXPECTED level (not merely «no conflict»):
    //  stated  = both sides say it in their own listing text; assumed = our general rule, unverified;
    //  unknown = an attribute is missing; conflict = the listings contradict. The plan guard repairs every automatic
    //  pick, so for the settled CCTV list nothing is «unknown» or «conflict».
    const compat = await compatRows(page);
    expect(compat.length, 'compat lines of the CCTV plan').toBeGreaterThanOrEqual(5);
    expectCompatLevel(compat, /کاناله برای ۴ دوربین/, 'stated'); // recorder channels vs camera count: from the titles
    expectCompatLevel(compat, /هارد مخصوص ضبط/, 'stated'); // the drive's own title says it is for recording
    expectCompatLevel(compat, /HDCVI.*DVR|AHD.*DVR/, 'assumed'); // analog answer: signal type is our rule
    expectCompatLevel(compat, /SATA/, 'assumed');
    expectCompatLevel(compat, /آداپتور ۱۲ ولت/, 'assumed');
    // The one allowed «unknown» is the adapter-current rule (no listing states a camera's current, so «not
    // verified» is the honest status for several cameras on one adapter); every other row is stated / assumed.
    const ADAPTER_CURRENT = 'camera_adapter_current';
    expect(compat.filter((c) => c.level === 'conflict')).toEqual([]);
    expect(compat.filter((c) => c.level === 'unknown' && c.rule !== ADAPTER_CURRENT)).toEqual([]);
    expect(compat.filter((c) => c.rule === ADAPTER_CURRENT).every((c) => c.level === 'unknown')).toBe(true);
    await expect(page.locator(`[data-testid="compat-block"] li:not([data-rule="${ADAPTER_CURRENT}"]) [data-compat="unknown"]`)).toHaveCount(0);
    await expect(page.locator('[data-compat="conflict"]')).toHaveCount(0);
    await expect(page.locator('bdi[dir="ltr"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="stop-line"][data-state="exact"]')).toHaveCount(0);
    await expectNoPhoneNumbers(page);
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '05-plan', true);

    // ---------- time sheet: Friday
    await page.getByTestId('visit-chip').click();
    await expect(page.getByRole('dialog', { name: 'کی می‌روی؟' })).toBeVisible();
    await page.getByRole('radio', { name: 'انتخاب روز' }).click();
    await page.getByRole('radio', { name: /^جمعه/ }).first().click();
    await shot(page, '06-time-sheet');
    await page.getByTestId('apply-visit').click();
    await expect(page.getByTestId('visit-chip')).toContainText('جمعه');
    await settled(page);
    await expect(page.getByRole('note').filter({ hasText: 'در این زمان بسته است' }).first()).toBeVisible();
    await expect(page.getByTestId('stop').filter({ hasText: 'در این زمان بسته است' })).toHaveCount(0);
    await expectNoOverflow(page);
    await shot(page, '07-plan-friday', true);

    // ---------- show-to-seller card
    await page.getByTestId('show-seller').first().click();
    await expect(page.getByTestId('seller-card')).toBeVisible();
    await expect(page.getByTestId('seller-card')).toContainText('از فروشنده بپرس');
    await expectNoOverflow(page);
    await shot(page, '08-seller-card');
    await page.keyboard.press('Escape');

    // ---------- checklist
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('market-view')).toBeVisible();
    // check a line that is not the camera: the camera row is reported unavailable below
    const checkedLine = () => page.getByTestId('market-line').filter({ hasNotText: 'دوربین' }).first();
    await checkedLine().getByTestId('check').click();
    await expect(checkedLine()).toHaveAttribute('data-checked', 'true');
    await expectNoOverflow(page);
    await shot(page, '09-market', true);

    // ---------- report «موجود نیست» on the camera row -> replan with a diff
    const stopsBefore = await page.getByTestId('stop').allInnerTexts();
    const cameraRow = page.getByTestId('market-line').filter({ hasText: 'دوربین' }).first();
    await cameraRow.getByTestId('mark-unavailable').click();
    const diff = page.getByTestId('replan-diff');
    await expect(diff).toBeVisible();
    await expect(page.getByTestId('replan-report')).toContainText('گزارش شما');
    await expect(page.getByTestId('replan-change').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('changed-tag').first()).toBeVisible();
    await settled(page);
    await expectNoOverflow(page);
    await shot(page, '10-replan-diff', true);
    const stopsAfter = await page.getByTestId('stop').allInnerTexts();
    expect(stopsAfter.join('|')).not.toBe(stopsBefore.join('|'));

    // ---------- undo restores the previous plan
    await page.getByTestId('replan-undo').click();
    await expect(diff).toHaveCount(0);
    await settled(page);
    await expect.poll(async () => (await page.getByTestId('stop').allInnerTexts()).join('|')).toBe(stopsBefore.join('|'));

    // ---------- report again, keep it, reload: the exclusion and the check survive
    await page.getByTestId('market-line').filter({ hasText: 'دوربین' }).first().getByTestId('mark-unavailable').click();
    await expect(page.getByTestId('replan-change').first()).toBeVisible({ timeout: 15_000 });
    await settled(page);
    // the «تغییر کرد» highlight is transient (it belongs to the banner session), the rows are not
    const rows = async () => (await page.getByTestId('stop').allInnerTexts()).join('|').replace(/تغییر کرد\s*/g, '');
    const replanned = await rows();
    await page.reload();
    await expect(page.getByTestId('market-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await expect(page.locator('[data-testid="market-line"][data-checked="true"]')).toHaveCount(1);
    expect(await rows()).toBe(replanned);

    // ---------- resume from Home and from the header menu
    await page.getByRole('link', { name: 'رفتن به صفحهٔ اصلی' }).click();
    const resume = page.getByTestId('resume-card');
    await expect(resume).toBeVisible();
    await expect(resume).toContainText('از ۴ مورد آماده');
    await shot(page, '11-home-resume');
    await page.getByRole('button', { name: /ادامه‌ی برنامه/ }).click();
    await expect(page.getByRole('dialog', { name: 'برنامه‌های اخیر' })).toBeVisible();
    await shot(page, '12-resume-menu');
    await page.getByRole('dialog').getByRole('link').first().click();
    await expect(page.getByTestId('plan-name')).toBeVisible();
    await expect(page.getByTestId('market-view')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('J2 a single specific model', () => {
  test('goes straight to the plan with the sellers of that model', async ({ page }) => {
    await startPlan(page, 'دوربین مداربسته داهوا HAC-HDW1200EMP-A');
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await expect(page.locator('[data-testid="stop-line"][data-state="exact"]')).toHaveCount(1);
    await expect(page.locator('[data-total]').first()).toHaveAttribute('data-total', 'complete');
    await expect(page.locator('bdi[dir="ltr"]').filter({ hasText: 'HAC-HDW1200EMP-A' }).first()).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, '15-single-model', true);

    // the other sellers of this model
    await page.getByRole('button', { name: 'تغییر', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'گزینه‌ها' })).toBeVisible();
    await page.getByRole('tab', { name: 'فروشنده‌ها' }).click();
    await expect(page.getByTestId('options-list').locator('article').first()).toBeVisible({ timeout: 15_000 });
    await expectNoOverflow(page);
    await shot(page, '16-sellers-sheet');
  });
});

test.describe('J3 ambiguous: «سیم برق برای اتاق»', () => {
  test('asks the sale unit, totals nothing until it is answered', async ({ page }) => {
    await startPlan(page, 'سیم برق برای اتاق');
    await expect(page.getByTestId('question-card')).toBeVisible();
    await expect(page.getByTestId('question-card')).toContainText('چطور می‌خری؟');
    // the sale unit has no «فرقی نمی‌کند» and «کافیه» cannot end it
    await expect(page.getByTestId('question-card').getByRole('radio', { name: 'فرقی نمی‌کند' })).toHaveCount(0);
    await expect(page.getByTestId('enough')).toHaveCount(0);
    await expect(page.locator('[data-testid="item-card"][data-state="needs_info"]')).toHaveCount(1);
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '20-sale-unit-question', true);

    // the plan holds no total yet
    await page.getByRole('tab', { name: 'برنامه' }).click();
    await expect(page.getByText('هنوز برنامه‌ای نیست')).toBeVisible();
    await expect(page.locator('[data-total]')).toHaveCount(0);

    await page.getByRole('tab', { name: 'فهرست' }).click();
    await page.getByTestId('question-card').getByRole('radio', { name: /حلقه/ }).click();
    await settled(page);
    // the next question (or the item is ready): keep answering with «کافیه» until nothing is asked
    await answerQuestions(page);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible();
    await settled(page);
    await expect(page.locator('[data-total]').first()).toHaveAttribute('data-total', 'complete');
    await expect(page.getByTestId('stop-line').first()).toContainText('حلقه');
    await expectNoOverflow(page);
    await shot(page, '21-wire-plan', true);
  });
});

test.describe('J4 absent and present categories', () => {
  test('«برنج هاشمی» is honestly not found, with real nearby categories', async ({ page }) => {
    await startPlan(page, 'برنج هاشمی');
    const miss = page.locator('[data-testid="item-card"][data-state="not_found"]');
    await expect(miss).toBeVisible();
    await expect(miss).toContainText('پیدا نشد');
    // no real evidence of anything close: the calm generic list, labelled as what the list holds (never a guess)
    await expect(miss).toContainText('چیزهایی که در این فهرست دارم');
    await expect(miss.getByTestId('nearby-chip').nth(1)).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, '30-not-found', true);
    // the plan view degrades to the empty state instead of a zero total
    await page.getByRole('tab', { name: 'برنامه' }).click();
    await expect(page.getByText('هنوز برنامه‌ای نیست')).toBeVisible();
    await expectNoOverflow(page);
  });

  // The parser marks these as not in the catalog: they stay terminal «پیدا نشد» - never a question, never an
  // auto-picked unrelated product (a «شیر برقی» for «شیر», cat treats for «مرغ»), also after «کافیه» / settle-all.
  for (const word of ['برنج', 'مرغ', 'شیر']) {
    test(`«${word}» stays «پیدا نشد» and is never auto-picked, even after settle-all`, async ({ page }) => {
      await startPlan(page, word);
      await settled(page);
      const card = page.getByTestId('item-card').first();
      await expect(card).toHaveAttribute('data-state', 'not_found');
      await expect(card).toContainText('پیدا نشد');
      await expect(page.getByTestId('question-card')).toHaveCount(0);
      await expect(page.getByTestId('pending-strip')).toHaveCount(0);
      // settle-all / «کافیه» (when any button is offered) changes nothing
      for (const id of ['settle-all', 'enough']) {
        const b = page.getByTestId(id);
        if (await b.count()) await b.first().click();
      }
      await settled(page);
      await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(1);
      await expect(page.getByTestId('item-product')).toHaveCount(0);
      await page.getByRole('tab', { name: 'برنامه' }).click();
      await expect(page.getByText('هنوز برنامه‌ای نیست')).toBeVisible();
      await expect(page.getByTestId('stop-line')).toHaveCount(0);
    });
  }

  test('«برنج، مرغ و شیر» together: three terminal «پیدا نشد» cards, no question, no plan, still after settle-all', async ({ page }) => {
    await startPlan(page, 'برنج، مرغ و شیر');
    await settled(page);
    await expect(page.getByTestId('item-card')).toHaveCount(3);
    await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(3);
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    if (await page.getByTestId('settle-all').count()) await page.getByTestId('settle-all').click();
    await settled(page);
    await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(3);
    await expect(page.getByTestId('item-product')).toHaveCount(0);
    await page.getByRole('tab', { name: 'برنامه' }).click();
    await expect(page.getByTestId('stop-line')).toHaveCount(0);
    await expect(page.locator('[data-total]')).toHaveCount(0);
  });

  test('«لپ‌تاپ ایسوس» is found and no used item is auto-suggested', async ({ page }) => {
    await startPlan(page, 'لپ‌تاپ ایسوس');
    await page.getByRole('tab', { name: 'فهرست' }).click();
    await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(0);
    const card = page.getByTestId('item-card').first();
    const used = /کارکرده|دست دوم|استوک|ریفر|رپلیکا|کپی/;
    // the picked product is never a used one (the card may announce, in its note, that used listings were left out)
    await expect(card.getByTestId('item-product')).not.toContainText(used);
    await page.getByRole('tab', { name: 'برنامه' }).click();
    await expect(page.getByTestId('stop-line').first()).not.toContainText(used);
    await expectNoOverflow(page);
    await shot(page, '31-laptop', true);
  });
});

test.describe('J5 share link', () => {
  test('copy the link, open it in a fresh browser: an editable copy of the plan appears', async ({ page, browser }) => {
    await startPlan(page, 'گوشی سامسونگ Galaxy A56، قاب و گلس');
    await settleAllItems(page);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    // capture what the app writes to the clipboard (reading the system clipboard needs page focus)
    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string };
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (text: string) => {
        w.__copied = text;
        await orig(text).catch(() => undefined);
      };
    });
    await page.getByTestId('plan-menu').click();
    await page.getByTestId('menu-copy-link').click();
    await expect(page.getByText('پیوند برنامه کپی شد.')).toBeVisible();
    const link = (await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)) ?? '';
    expect(link).toMatch(/#\/s\//);
    expect(link.length).toBeLessThan(2500); // parser diagnostics are not carried

    const vp = page.viewportSize()!;
    const other = await browser.newContext({ viewport: vp, locale: 'fa-IR', timezoneId: 'Asia/Tehran', hasTouch: true, isMobile: true });
    try {
      const p2 = await other.newPage();
      await p2.goto(link);
      await expect(p2.getByTestId('plan-name')).toBeVisible({ timeout: 20_000 });
      // the shared answers (the settled items) arrive with it: it opens on the plan
      await expect(p2.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
      await p2.getByRole('tab', { name: /^فهرست/ }).click();
      await expect(p2.getByTestId('item-card').first()).toBeVisible({ timeout: 20_000 });
      await expect(p2.getByTestId('item-card')).toHaveCount(3);
      // the phone model flows to the case and the glass as inherited chips
      await expect(p2.getByTestId('item-card').nth(1)).toContainText('A56');
      await expect(p2.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(0);
      await p2.getByRole('tab', { name: /^برنامه/ }).click();
      await expect(p2.getByTestId('stop-line')).toHaveCount(3, { timeout: 15_000 });
      await expect(p2.locator('[data-total]').first()).toHaveAttribute('data-total', 'complete');
      await expectNoOverflow(p2);
      await shot(p2, '40-share-import', true);
      // a copy: checks and reports were not carried over
      await p2.getByRole('tab', { name: 'در بازارم' }).click();
      await expect(p2.locator('[data-testid="market-line"][data-checked="true"]')).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});
