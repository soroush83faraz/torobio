import { expect, test, type Page } from '@playwright/test';
import { CCTV, expectNoOverflow, expectTouchTargets, settleAllItems, settled, shot, startPlan } from './helpers';

/**
 * Follow-ups on real data: multi-shop stops, condition flags + the condition note, and the assistant's
 * state handling (diff banner, undo, no-change, choices, degraded). Real server, real market.sqlite.
 */

/** CCTV with every question left at its visible default: the plan has a stop with two shops. */
async function cctvPlan(page: Page) {
  await startPlan(page, CCTV);
  await settleAllItems(page);
  await page.getByTestId('primary-action').click();
  await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
  await settled(page);
}

const stopsText = async (page: Page) => (await page.getByTestId('stop').allInnerTexts()).join('|').replace(/تغییر کرد\s*/g, '');

test.describe('F1 multi-shop stops', () => {
  test('a stop is a building with one block per shop; numbering equals the cards shown', async ({ page }) => {
    await cctvPlan(page);
    const stops = page.getByTestId('stop');
    const multi = page.locator('[data-testid="stop"][data-shop-count="2"]').first();
    // G1a: the compat guard moved the real CCTV picks, so the plan may now be one shop per stop; the multi-shop
    // block is asserted whenever the real plan has one (the mock-data tests cover it unconditionally)
    const hasMulti = (await multi.count()) > 0;
    if (hasMulti) {
      await expect(multi).toBeVisible();
      await expect(multi.getByTestId('shop-count')).toHaveText('۲ مغازه');
      await expect(multi.getByTestId('stop-subtotal')).toContainText('جمع این توقف');
      await expect(multi.getByTestId('stop-shop')).toHaveCount(2);
      // every shop block has its own hours and its own lines
      for (const shop of await multi.getByTestId('stop-shop').all()) {
        await expect(shop).toContainText('ساعت کار');
        await expect(shop.getByTestId('stop-line').first()).toBeVisible();
      }
    } else {
      await expect(page.getByTestId('stop-shop')).toHaveCount(await stops.count());
    }
    // stop numbering = the number of cards, in order
    const n = await stops.count();
    await expect(page.getByTestId('plan-view')).toContainText(`${new Intl.NumberFormat('fa-IR').format(n)} توقف`);
    await expect(page.getByTestId('stop-number')).toHaveText(Array.from({ length: n }, (_, i) => new Intl.NumberFormat('fa-IR').format(i + 1)));
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '60-multishop-plan', true);

    // checklist: same grouping, reports keep the shop
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('market-view')).toBeVisible();
    if (hasMulti) {
      const mmulti = page.locator('[data-testid="stop"][data-shop-count="2"]').first();
      await expect(mmulti.getByTestId('stop-shop')).toHaveCount(2);
    }
    await expect(page.getByTestId('stop-number')).toHaveText(Array.from({ length: n }, (_, i) => new Intl.NumberFormat('fa-IR').format(i + 1)));
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '61-multishop-market', true);

    if (hasMulti) {
      const mmulti = page.locator('[data-testid="stop"][data-shop-count="2"]').first();
      // the show-to-seller card names the shop of THAT line, not the first shop of the stop
      const second = mmulti.getByTestId('stop-shop').nth(1);
      const shopName = (await second.locator('p').first().innerText()).replace(/[«»]/g, '').replace('مغازهٔ', '').trim();
      await second.getByTestId('show-seller').first().click();
      await expect(page.getByTestId('seller-card')).toContainText(shopName);
    }
  });
});

/**
 * The «کم‌توقف‌تر» alternative that removes the most stops: the server lists them by stop count, the first one is the
 * single-building plan («N توقف کمتر» with N = stops - 1). The result is asserted: exactly one stop.
 */
async function chooseFewestStops(page: Page) {
  const radio = page.getByRole('radio', { name: /کم‌توقف‌تر/ }).first();
  await expect(radio).toBeVisible();
  await radio.click();
  await settled(page);
  await expect(page.getByTestId('stop')).toHaveCount(1);
}

/** Product name on each plan stop line, by item id (the «۴ × » quantity prefix removed). */
async function stopProducts(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of await page.getByTestId('stop-line').all()) {
    out[(await line.getAttribute('data-item'))!] = (await line.getByTestId('stop-product').innerText()).replace(/^[۰-۹0-9٬,]+\s*×\s*/, '').trim();
  }
  return out;
}

test.describe('F1b multi-shop stop, deterministic (CCTV, fewest stops)', () => {
  test('«کم‌توقف‌تر» puts every shop of the list into one building; each shop block and its seller card agree', async ({ page }) => {
    await cctvPlan(page);
    await chooseFewestStops(page);
    const stop = page.getByTestId('stop');
    const shops = stop.getByTestId('stop-shop');
    const k = await shops.count();
    expect(k, 'the single-stop plan holds several shops').toBeGreaterThanOrEqual(2);
    await expect(stop.getByTestId('shop-count')).toHaveText(`${new Intl.NumberFormat('fa-IR').format(k)} مغازه`);
    await expect(stop.getByTestId('stop-subtotal')).toContainText('جمع این توقف');
    await expectNoOverflow(page);

    const seen = new Set<string>();
    for (let i = 0; i < k; i++) {
      const shop = shops.nth(i);
      const shopId = (await shop.getAttribute('data-shop'))!;
      expect(seen.has(shopId), 'a shop appears once').toBe(false);
      seen.add(shopId);
      const name = (await shop.getByTestId('shop-name').innerText()).replace(/[«»]/g, '').replace('مغازهٔ', '').trim();
      expect(name.length).toBeGreaterThan(1);
      for (const line of await shop.getByTestId('stop-line').all()) {
        const product = (await line.getByTestId('stop-product').innerText()).replace(/^[۰-۹0-9٬,]+\s*×\s*/, '').trim();
        await line.getByTestId('show-seller').click();
        const card = page.getByTestId('seller-card');
        await expect(card).toBeVisible();
        // the card names THIS line's shop and THIS line's product, not the first shop of the building
        await expect(card.getByTestId('seller-shop')).toContainText(name);
        await expect(card.getByTestId('seller-product')).toContainText(product);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('seller-card')).toHaveCount(0);
      }
    }
    // the checklist keeps the grouping, and its seller card names the shop of the pressed line too
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('market-view')).toBeVisible();
    const mshops = page.getByTestId('stop').getByTestId('stop-shop');
    expect(await mshops.count()).toBe(k);
    const last = mshops.nth(k - 1);
    const lastName = (await last.getByTestId('shop-name').innerText()).replace(/[«»]/g, '').replace('مغازهٔ', '').trim();
    await last.getByTestId('show-seller').first().click();
    await expect(page.getByTestId('seller-card').getByTestId('seller-shop')).toContainText(lastName);
  });
});

test.describe('F1c variant vs list consistency', () => {
  test('after «کم‌توقف‌تر», every list card shows the product that the stop line buys', async ({ page }) => {
    await cctvPlan(page);
    // default plan first: list and plan agree
    const check = async (label: string) => {
      const bought = await stopProducts(page);
      expect(Object.keys(bought).length, `${label}: lines`).toBe(4);
      await page.getByRole('tab', { name: /^فهرست/ }).click();
      await settled(page);
      for (const [itemId, name] of Object.entries(bought)) {
        const card = page.locator(`[data-testid="item-card"][data-item="${itemId}"]`);
        await expect(card.getByTestId('item-product'), `${label}: list card of ${itemId}`).toHaveText(name);
      }
      await page.getByRole('tab', { name: /^برنامه/ }).click();
      await settled(page);
    };
    await check('default plan');
    await chooseFewestStops(page);
    await check('fewest-stops variant');
  });
});

test.describe('F2 condition flags and the condition note', () => {
  test('a pinned-by-text used phone carries the «نکته» chip on the plan row, the seller card and the options', async ({ page }) => {
    await startPlan(page, 'گوشی آیفون ۱۳ استوک');
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const line = page.getByTestId('stop-line').first();
    await expect(line.getByTestId('flag-note')).toContainText('نکته');
    await expect(line.getByTestId('flag-note')).toContainText('کارکرده');
    await expectNoOverflow(page);
    await shot(page, '62-flags-plan', true);

    await line.getByTestId('show-seller').click();
    await expect(page.getByTestId('seller-card').getByTestId('flag-note')).toContainText('کارکرده');
    await expectNoOverflow(page);
    await shot(page, '66-flags-seller-card');
    await page.keyboard.press('Escape');

    await line.getByRole('button', { name: 'تغییر', exact: true }).click();
    const list = page.getByTestId('options-list');
    await expect(list.locator('article').first()).toBeVisible({ timeout: 15_000 });
    await expect(list.getByTestId('flag-note').first()).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, '67-flags-options');
  });

  test('excluded used listings are announced on the item, with an action that accepts them', async ({ page }) => {
    await startPlan(page, 'گوشی سامسونگ');
    await page.getByRole('tab', { name: /^فهرست/ }).click();
    await settled(page);
    const note = page.getByTestId('condition-note');
    await expect(note).toContainText('کارکرده یا کپی نمایش داده نشد');
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '63-condition-note', true);
    await page.getByTestId('include-condition').click();
    await settled(page);
    // accepted: the note is gone or smaller, and the undo toast is there
    await expect(page.getByText('آگهی‌های کارکرده و کپی هم حساب شدند')).toBeVisible();
    await expect(page.getByTestId('include-condition')).toHaveCount(0);
  });
});

test.describe('F3 assistant applies the server newState', () => {
  test('a chip changes the plan: diff banner, «تغییر کرد» rows, undo restores', async ({ page }) => {
    await cctvPlan(page);
    const before = await stopsText(page);
    await page.getByTestId('open-assistant').click();
    await page.getByTestId('assist-fewer_stops').click();
    // the sheet closes only because something changed
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const banner = page.getByTestId('replan-diff');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('assist-message')).toContainText('توقف');
    await expect(page.getByTestId('replan-stops')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('assist-degraded')).toHaveCount(0);
    await settled(page);
    await expect(page.getByTestId('changed-tag').first()).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, '64-assist-diff', true);
    expect(await stopsText(page)).not.toBe(before);

    await page.getByTestId('replan-undo').click();
    await expect(banner).toHaveCount(0);
    await settled(page);
    await expect.poll(() => stopsText(page)).toBe(before);
  });

  test('«ارزان‌تر» when already cheapest: the sheet stays with the server sentence, no diff', async ({ page }) => {
    await cctvPlan(page);
    await page.getByTestId('open-assistant').click();
    await page.getByTestId('assist-cheaper').click();
    await expect(page.getByTestId('assist-result')).toContainText('ارزان‌ترین');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('replan-diff')).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test('«بدون این مغازه» from the plan header asks which shop (choices), then applies it', async ({ page }) => {
    await cctvPlan(page);
    const before = await stopsText(page);
    await page.getByTestId('open-assistant').click();
    await page.getByTestId('assist-without_shop').click();
    const choices = page.getByTestId('assist-choice');
    await expect(choices.first()).toBeVisible();
    expect(await choices.count()).toBeGreaterThan(1);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectTouchTargets(page);
    await shot(page, '68-assist-choices');
    await choices.first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('replan-diff')).toBeVisible();
    await settled(page);
    expect(await stopsText(page)).not.toBe(before);
    await page.getByTestId('replan-undo').click();
    await settled(page);
    await expect.poll(() => stopsText(page)).toBe(before);
  });

  test('opened from a shop card: the shop is the context, one tap on the chip removes it', async ({ page }) => {
    await cctvPlan(page);
    const shop = page.getByTestId('stop-shop').nth(1);
    const shopId = await shop.getAttribute('data-shop');
    expect(shopId).toBeTruthy();
    await shop.getByTestId('without-shop').click();
    await expect(page.getByTestId('assist-context')).toBeVisible();
    await page.getByTestId('assist-without_shop').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('replan-diff')).toBeVisible();
    await settled(page);
    await expect(page.locator(`[data-testid="stop-shop"][data-shop="${shopId}"]`)).toHaveCount(0);
  });

  test('degraded server answer: the calm line shows, in the sheet and on the banner', async ({ page }) => {
    await cctvPlan(page);
    // the server's own answer, marked degraded (as it does when the LLM is configured but unusable)
    await page.route('**/api/assist', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.data.degraded = true;
      await route.fulfill({ response: res, json: body });
    });
    await page.getByTestId('open-assistant').click();
    await page.getByTestId('assist-fewer_stops').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('assist-degraded')).toHaveText('دستیار هوشمند فعلاً در دسترس نیست؛ پاسخ ساده نمایش داده شد');
    await expectNoOverflow(page);
    await shot(page, '65-assist-degraded', true);

    // not changed + degraded: the sheet stays and shows the same line above the sentence
    await page.getByTestId('replan-undo').click();
    await settled(page);
    await page.getByTestId('open-assistant').click();
    await page.getByRole('textbox', { name: 'تغییر برنامه' }).fill('یک چیز عجیب');
    await page.getByRole('button', { name: 'بفرست' }).click();
    await expect(page.getByTestId('assist-result')).toBeVisible();
    await expect(page.getByTestId('assist-degraded')).toBeVisible();
  });

  test('server unreachable: the chips-only fallback is marked degraded and still applies', async ({ page }) => {
    await cctvPlan(page);
    await page.route('**/api/assist', (route) => route.abort('connectionrefused'));
    await page.getByTestId('open-assistant').click();
    await page.getByTestId('assist-fewer_stops').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('replan-diff')).toBeVisible();
    await expect(page.getByTestId('assist-degraded')).toBeVisible();
  });
});
