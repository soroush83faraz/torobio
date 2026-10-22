import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const CCTV = '۴ دوربین داهوا ۲ مگاپیکسل، ضبط‌کننده ۴ کانال، هارد ۲ ترابایت و آداپتور';

// 390x844 gets the full set; 360x640 only the key screens (keeps the committed PNGs small).
const KEY_360 = new Set(['01-home', '03-list-question', '05-plan', '07-seller-card', '09-market', '15-phone-plan', '17-dead-end']);

async function shot(page: Page, name: string, fullPage = false) {
  const vp = page.viewportSize()!;
  if (vp.width === 360 && !KEY_360.has(name)) return;
  await page.waitForTimeout(250); // let transitions settle
  // full-page captures: un-stick the fixed bar and header so they do not float mid-page
  const style = fullPage
    ? await page.addStyleTag({ content: '[data-testid="action-bar"]{display:none!important}header,.sticky{position:static!important}' })
    : null;
  await page.screenshot({ path: join(SHOTS, `${vp.width}-${name}.png`), fullPage });
  await style?.evaluate((el) => (el as Element).remove());
}

/** No horizontal scroll at this viewport. */
async function expectNoOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/** Interactive controls are at least 48px tall/wide where it matters (buttons, chips, tabs). */
async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const sel = 'button:not([disabled]), [role="tab"], [role="radio"], [role="checkbox"], a[href]';
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).display === 'inline') return; // inline text links inside sentences
      if (r.height < 47.5) out.push(`${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    });
    return out;
  });
  expect(small, 'controls under 48px').toEqual([]);
}

test.describe('Persian RTL smoke journey', () => {
  test('Home -> CCTV -> question -> plan -> checklist -> reload -> resume', async ({ page }) => {
    // ---------- Home
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برای خریدت چی لازم داری؟');
    await expect(page.getByTestId('resume-card')).toHaveCount(0); // first visit
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '01-home');

    // ---------- type the CCTV sentence
    await page.getByLabel('فهرست خریدت را بنویس').fill(CCTV);
    await shot(page, '02-home-typed');
    await page.getByTestId('go').click();
    await expect(page).toHaveURL(/#\/plan\//);

    // ---------- list view with exactly one expanded question
    await expect(page.getByTestId('plan-name')).toHaveText('پروژهٔ دوربین مداربسته');
    await expect(page.getByTestId('saved-indicator')).toHaveText('✓ ذخیره شد روی همین گوشی');
    await expect(page.getByTestId('pending-strip')).toContainText('۱ مورد منتظر پاسخ است');
    await expect(page.getByTestId('question-card')).toHaveCount(1);
    await expect(page.getByTestId('question-card')).toContainText('دوربین‌ها آنالوگ هستند یا تحت شبکه؟');
    // all six states are never needed at once, but suggestions are never called «مدل مشخص»
    await expect(page.locator('[data-testid="item-card"][data-state="suggested"]').first()).toContainText('پیشنهاد');
    await expect(page.locator('[data-testid="item-card"][data-state="exact"]')).toHaveCount(0);
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '03-list-question', true);

    // ---------- answer the questions, one at a time
    await page.getByRole('radio', { name: /آنالوگ/ }).click();
    await expect(page.getByTestId('question-card')).toContainText('کدام برند؟');
    await page.getByRole('radio', { name: 'داهوا' }).click();
    await expect(page.getByTestId('question-card')).toContainText('بودجه');
    await page.getByRole('radio', { name: '۶ تا ۱۴ میلیون' }).click();
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('pending-strip')).toHaveCount(0);
    await shot(page, '04-list-resolved', true);

    // ---------- plan
    await page.getByTestId('primary-action').click(); // «ببین برنامه»
    await expect(page.getByTestId('plan-view')).toBeVisible();
    const total = page.locator('[data-total]').first();
    await expect(total).toHaveAttribute('data-total', 'partial'); // adapter has no price
    await expect(total).toContainText('فقط ۳ از ۴ مورد');
    await expect(page.getByTestId('incomplete-badge')).toHaveText('ناقص');
    await expect(page.getByText('بدون قیمت: آداپتور')).toBeVisible(); // told apart from «پیدا نشد» / «منتظر انتخاب»
    await expect(page.getByTestId('compat-block')).toBeVisible();
    await expect(page.locator('[data-compat="stated"]').first()).toBeVisible();
    await expect(page.locator('[data-compat="assumed"]').first()).toBeVisible();
    await expect(page.locator('[data-compat="unknown"]').first()).toBeVisible();
    // Latin model codes are isolated runs
    await expect(page.locator('bdi[dir="ltr"]').first()).toBeVisible();
    // honesty: no phone numbers anywhere
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/(\+?98|0)?9[0-9۰-۹]{9}|۰۹[۰-۹]{9}|\b0\d{10}\b|تلفن|تماس/);
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '05-plan', true);

    // ---------- time sheet
    await page.getByTestId('visit-chip').click();
    await expect(page.getByRole('dialog', { name: 'کی می‌روی؟' })).toBeVisible();
    await page.getByRole('radio', { name: 'فردا' }).click();
    await page.getByRole('radio', { name: 'عصر' }).click();
    await shot(page, '06-time-sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ---------- seller card with «از فروشنده بپرس»
    await page.getByTestId('show-seller').first().click();
    await expect(page.getByTestId('seller-card')).toBeVisible();
    await shot(page, '07-seller-card');
    await page.keyboard.press('Escape');

    // ---------- checklist
    await page.getByTestId('primary-action').click(); // «شروع خرید»
    await expect(page.getByTestId('market-view')).toBeVisible();
    await page.getByTestId('check').first().click();
    await expect(page.getByTestId('market-line').first()).toHaveAttribute('data-checked', 'true');
    await page.getByTestId('mark-unavailable').nth(1).click();
    // the shop is excluded for that item, the plan is recomputed, and the diff offers «برگرداندن»
    await expect(page.getByTestId('replan-diff')).toBeVisible();
    await expect(page.getByTestId('replan-report')).toContainText('گزارش شما');
    await page.getByRole('button', { name: 'جایگزین‌های دیگر' }).click();
    await expect(page.getByRole('dialog', { name: 'جایگزین‌ها' })).toBeVisible();
    await shot(page, '08-replan-sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('replan-undo').click();
    await expect(page.getByTestId('replan-diff')).toHaveCount(0);
    await expect(page.getByTestId('user-report')).toHaveCount(0);
    await expect(page.getByTestId('market-totals')).toContainText('جمع طبق فهرست');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '09-market', true);

    // ---------- reload: everything is still there
    await page.reload();
    await expect(page.getByTestId('market-view')).toBeVisible();
    await expect(page.getByTestId('market-line').first()).toHaveAttribute('data-checked', 'true');

    // ---------- resume from Home and from the header menu
    await page.getByRole('link', { name: 'رفتن به صفحهٔ اصلی' }).click();
    const resume = page.getByTestId('resume-card');
    await expect(resume).toContainText('پروژهٔ دوربین مداربسته');
    await expect(resume).toContainText('از ۴ مورد آماده');
    await shot(page, '10-home-resume');
    await page.getByRole('button', { name: /ادامه‌ی برنامه/ }).click();
    await expect(page.getByRole('dialog', { name: 'برنامه‌های اخیر' })).toBeVisible();
    await shot(page, '11-resume-menu');
    await page.getByRole('dialog').getByRole('link').first().click();
    await expect(page.getByTestId('plan-name')).toHaveText('پروژهٔ دوربین مداربسته');
  });

  test('laptop miss keeps the item as «پیدا نشد»; about-data sheet; share link imports a copy', async ({ page, context }) => {
    await page.goto('/');
    await page.getByLabel('فهرست خریدت را بنویس').fill('لپ‌تاپ ایسوس و ۲ گلس');
    await page.getByTestId('go').click();
    const miss = page.locator('[data-testid="item-card"][data-state="not_found"]');
    await expect(miss).toContainText('پیدا نشد');
    await expect(miss).toContainText('لپ‌تاپ');
    await expect(miss).toContainText('دسته‌های نزدیک');
    await shot(page, '12-laptop-miss', true);

    await page.getByRole('button', { name: 'درباره‌ی داده‌ها' }).click();
    await expect(page.getByRole('dialog', { name: 'درباره‌ی داده‌ها' })).toContainText('گزارش‌های شما فقط روی همین دستگاه می‌مانند');
    await shot(page, '13-about-data');
    await page.keyboard.press('Escape');

    // share link: copy from the menu, open in a fresh page, expect a copy of the plan
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await page.getByTestId('plan-menu').click();
    await page.getByTestId('menu-copy-link').click();
    await page.bringToFront();
    const link = await page
      .evaluate(() => Promise.race([navigator.clipboard.readText(), new Promise<string>((r) => setTimeout(() => r(''), 3000))]))
      .catch(() => '');
    if (link) {
      expect(link).toMatch(/#\/s\//);
      const page2 = await context.newPage();
      await page2.goto(link);
      await expect(page2.getByTestId('plan-name')).toBeVisible();
      await expect(page2.locator('[data-testid="item-card"][data-state="not_found"]')).toBeVisible();
      await page2.close();
    } else {
      test.info().annotations.push({ type: 'skipped', description: 'clipboard read unavailable; share link covered by unit test' });
    }
  });

  test('dead end (server `noMatch`): amber state, relax buttons, closest model; relaxing resolves it and is undoable', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('فهرست خریدت را بنویس').fill('گوشی آیفون ۱۵ زیر ۵۰ میلیون');
    await page.getByTestId('go').click();
    const card = page.getByTestId('item-card');
    await expect(card).toHaveAttribute('data-dead-end', 'true');
    const panel = card.getByTestId('no-match');
    await expect(panel).toContainText('مورد مطابق خواسته پیدا نشد');
    await expect(card.getByTestId('no-match-reason')).toContainText('آیفون زیر');
    await expect(panel.getByTestId('relax')).toHaveText(['بدون سقف قیمت', 'کارکرده هم باشد']);
    await expect(panel.getByTestId('closest-model')).toHaveCount(1);
    await expect(card).not.toContainText('جایگزین');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '17-dead-end', true);

    await panel.getByTestId('relax').first().click();
    await expect(page.getByTestId('no-match')).toHaveCount(0);
    await expect(page.getByTestId('item-card')).not.toHaveAttribute('data-dead-end', 'true');
    await page.getByRole('button', { name: 'برگردان' }).click();
    await expect(page.getByTestId('no-match')).toBeVisible();

    // pinning the closest model ends the dead end
    await page.getByTestId('pick-closest').click();
    await expect(page.getByTestId('no-match')).toHaveCount(0);
    await expect(page.getByTestId('item-card')).toHaveAttribute('data-state', 'exact');
  });

  test('electrical: wire sale-unit question; phone: complete total and compat', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'برق‌کشی اتاق' }).click();
    await expect(page.getByTestId('question-card')).toContainText('چه سیمی؟');
    await shot(page, '14-electrical-question', true);
    await page.getByRole('radio', { name: 'سیم افشان ۲٫۵' }).click();
    await expect(page.getByTestId('question-card')).toContainText('چطور می‌خری؟');
    await expect(page.getByTestId('question-card')).toContainText('قابل‌مقایسه نیستند');
    await page.getByRole('radio', { name: 'حلقهٔ ۱۰۰ متری' }).click();
    await expect(page.getByTestId('question-card')).toHaveCount(0);
    await expect(page.getByTestId('primary-action')).toHaveText('ببین برنامه');
    await page.getByTestId('primary-action').click();
    await expect(page.locator('[data-total]').first()).toHaveAttribute('data-total', 'complete');

    await page.getByRole('link', { name: 'رفتن به صفحهٔ اصلی' }).click();
    await page.getByRole('button', { name: 'گوشی و کاور و گلس' }).click();
    // nothing to ask -> lands directly on the plan
    await expect(page.getByTestId('plan-view')).toBeVisible();
    await expect(page.getByTestId('primary-action')).toHaveText('شروع خرید');
    await expect(page.locator('[data-testid="stop-line"][data-state="exact"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="stop-line"][data-state="suggested"]')).toHaveCount(2);
    const t = page.locator('[data-total]').first();
    await expect(t).toHaveAttribute('data-total', 'complete');
    await expect(t).toContainText('جمع ۳ مورد');
    await expect(t).toContainText('با مدل‌های پیشنهادی');
    await expectNoOverflow(page);
    await shot(page, '15-phone-plan', true);
  });

  test('Friday evening: closed shops leave the plan, shops without hours are never called closed', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('فهرست خریدت را بنویس').fill(CCTV);
    await page.getByTestId('go').click();
    await page.getByTestId('settle-all').click();
    await expect(page.getByTestId('pending-strip')).toHaveCount(0);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible();
    await expect(page.getByText('پاساژ علاءالدین').first()).toBeVisible();

    await page.getByTestId('visit-chip').click();
    await page.getByRole('radio', { name: 'انتخاب روز' }).click();
    await page.getByRole('radio', { name: /^جمعه/ }).first().click();
    await page.getByRole('radio', { name: 'عصر' }).click();
    await page.getByTestId('apply-visit').click();

    await expect(page.getByTestId('visit-chip')).toContainText('جمعه');
    await expect(page.getByRole('note')).toContainText('در این زمان بسته است');
    await expect(page.getByTestId('stop').filter({ hasText: 'پاساژ علاءالدین' })).toHaveCount(0);
    await expect(page.getByText('ساعت کاری ثبت نشده').first()).toBeVisible();
    await expect(page.getByTestId('stop').filter({ hasText: 'در این زمان بسته است' })).toHaveCount(0); // no closed stop in the plan
    await shot(page, '16-friday-evening', true);
  });
});
