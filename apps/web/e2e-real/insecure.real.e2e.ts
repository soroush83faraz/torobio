import { expect, test } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { expectNoOverflow, expectTouchTargets, settleAllItems, settled, shot, startPlan } from './helpers';

/**
 * The deployed build is served over PLAIN HTTP (no TLS yet): no navigator.clipboard, no service worker, no Web Share.
 * http://127.0.0.1 counts as a secure context, so this suite opens the same server through the machine's LAN IP, which
 * is an insecure origin, and proves that sharing and the offline notice still tell the truth there.
 */
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const origin = lanIp ? `http://${lanIp}:${process.env.E2E_REAL_PORT}` : '';

test.describe('insecure origin (plain HTTP over the LAN IP)', () => {
  test.skip(!lanIp, 'no non-loopback IPv4 address on this machine');
  test.use({ baseURL: origin, permissions: [] });

  test('the origin really is insecure: no clipboard API, no service worker', async ({ page }) => {
    await page.goto('/');
    const env = await page.evaluate(() => ({ secure: window.isSecureContext, clipboard: typeof navigator.clipboard, sw: 'serviceWorker' in navigator }));
    expect(env).toEqual({ secure: false, clipboard: 'undefined', sw: false });
  });

  test('share link: shown in a selectable field, copied by hand, and it imports on a fresh browser', async ({ page, browser }) => {
    await startPlan(page, 'گوشی سامسونگ Galaxy A56، قاب و گلس');
    await settleAllItems(page);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);

    await page.getByTestId('plan-menu').click();
    await page.getByTestId('menu-copy-link').click();

    // the link is on screen, whole and selected; there is no «copy failed» message and no pointer to the address bar
    const field = page.getByTestId('share-url');
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('readonly', '');
    const link = await field.inputValue();
    expect(link).toMatch(/^http:\/\/.+#\/s\/.{20,}/);
    expect(link).not.toContain('#/plan/');
    expect(link.length).toBeLessThan(2500);
    const selected = await field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
    expect(selected, 'the whole link starts out selected').toBe(link);
    await expect(page.getByTestId('share-help')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('کپی نشد');
    await expect(page.locator('body')).not.toContainText('نوار آدرس');
    await expect(page.getByTestId('share-select-all')).toHaveText('انتخاب همه');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '85-share-fallback');

    // «انتخاب همه» re-selects after the selection was lost
    await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
    await page.getByTestId('share-select-all').click();
    expect(await field.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBe(link.length);

    // "copied by hand" = the text of that field pasted into a fresh browser's address bar
    const vp = page.viewportSize()!;
    const other = await browser.newContext({ viewport: vp, locale: 'fa-IR', timezoneId: 'Asia/Tehran', hasTouch: true, isMobile: true });
    try {
      const p2 = await other.newPage();
      await p2.goto(link);
      await expect(p2.getByTestId('plan-name')).toBeVisible({ timeout: 20_000 });
      await expect(p2.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
      await p2.getByRole('tab', { name: /^فهرست/ }).click();
      await expect(p2.getByTestId('item-card')).toHaveCount(3, { timeout: 20_000 });
      await expect(p2.getByTestId('item-card').nth(1)).toContainText('A56');
      await expect(p2.locator('body')).not.toContainText('روی این دستگاه پیدا نشد');
    } finally {
      await other.close();
    }
  });

  test('a browser that refuses even execCommand: the instruction and the selected link, nothing about «copy failed»', async ({ page }) => {
    await page.addInitScript(() => {
      document.execCommand = () => false;
    });
    await startPlan(page, 'گوشی سامسونگ Galaxy A56، قاب و گلس');
    await settleAllItems(page);
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await page.getByTestId('plan-menu').click();
    await page.getByTestId('menu-copy-link').click();
    await expect(page.getByTestId('share-help')).toContainText('«انتخاب همه» را بزن');
    await expect(page.getByTestId('share-url')).toHaveValue(/#\/s\//);
    await expect(page.locator('body')).not.toContainText('کپی نشد');
    await expect(page.locator('body')).not.toContainText('نوار آدرس');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '86-share-manual');
  });

  test('offline notice does not promise a reload that only a service worker could deliver', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await context.setOffline(true);
    const notice = page.getByTestId('offline-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('اتصال به سرور برقرار نیست؛ برنامه‌های ذخیره‌شده روی همین دستگاه می‌مانند');
    await expect(notice).not.toContainText('باز می‌شوند');
    await expectNoOverflow(page);
    await context.setOffline(false);
    await expect(notice).toHaveCount(0);
  });
});
