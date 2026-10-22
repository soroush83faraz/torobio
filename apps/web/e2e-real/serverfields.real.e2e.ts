import { expect, test } from '@playwright/test';
import { expectNoOverflow, expectTouchTargets, settleAllItems, settled, shot, startPlan } from './helpers';

/**
 * G4: the server's marker / note / label fields and the clickable not-found categories, on real data
 * (real server, real market.sqlite).
 */

const CONTRADICTION = 'دوربین تحت شبکه و دی وی آر ۴ کانال';

test.describe('G4 contradictory list: marker, notes, no green strip', () => {
  test('«دوربین تحت شبکه و دی وی آر ۴ کانال» is marked on the list, the plan and the market, never green', async ({ page }) => {
    await startPlan(page, CONTRADICTION);
    // nothing is left to ask, so the app opens on the plan; the list is one tab away
    await page.getByRole('tab', { name: 'فهرست' }).click();
    await settleAllItems(page);

    // list: amber strip with the server marker; the green «all ready» strip never shows
    const strip = page.getByTestId('conflict-strip');
    await expect(strip).toContainText('ناسازگاری دارد');
    await expect(page.getByTestId('all-ready-strip')).toHaveCount(0);
    // both cards say what contradicts what (the server's conflictNote), and the seller count says what it counts
    const notes = page.getByTestId('conflict-note');
    await expect(notes).toHaveCount(2);
    await expect(notes.first()).toContainText('جور نیست');
    await expect(page.getByTestId('seller-count').first()).toContainText('فروشنده');
    await expectNoOverflow(page);
    await shot(page, '80-conflict-list', true);

    // plan: amber chip beside the total, the line is not a normal green one
    await page.getByTestId('primary-action').click();
    const plan = page.getByTestId('plan-view');
    await expect(plan).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const total = plan.locator('[data-total]').first();
    await expect(total).toHaveAttribute('data-conflict', 'true');
    await expect(total.getByTestId('conflict-chip')).toHaveText('ناسازگاری دارد');
    // the marker is said once on the total (the chip), not twice (chip + the line's own copy)
    expect(((await total.innerText()).match(/ناسازگاری دارد/g) ?? []).length).toBe(1);
    // the conflicting compat row is the user's own choice, and says so once
    const own = plan.getByTestId('compat-block').getByTestId('from-user-choice');
    await expect(own).toHaveText('از انتخاب‌های خودت');
    await expect(plan.getByTestId('compat-block')).toContainText('ناسازگار');
    await expectNoOverflow(page);
    await shot(page, '81-conflict-plan', true);

    // market view carries the same chip
    await page.getByRole('tab', { name: 'در بازارم' }).click();
    await expect(page.getByTestId('market-totals').getByTestId('conflict-chip')).toHaveText('ناسازگاری دارد');
    await expectNoOverflow(page);
  });
});

test.describe('G4 not-found categories are tappable', () => {
  test('«برنج»: server heading, tap a category, the item becomes a normal item, undo brings the card back', async ({ page }) => {
    await startPlan(page, 'برنج');
    await settled(page);
    const card = page.getByTestId('item-card').first();
    await expect(card).toHaveAttribute('data-state', 'not_found');
    // heading = the server's label (popular categories, not a guess about rice)
    const info = await (
      await page.request.post('/api/resolve', {
        data: { state: { requirements: (await (await page.request.post('/api/parse', { data: { text: 'برنج' } })).json()).data.items } },
      })
    ).json();
    const label = info.data.items[0].nearbyLabelFa as string;
    expect(label).toBeTruthy();
    await expect(card).toContainText(label);
    const chips = card.getByTestId('nearby-chip');
    expect(await chips.count()).toBeGreaterThan(1);
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '82-not-found-chips', true);

    // tap the first suggested category: the same item (text and quantity kept) now has a product or a question
    const name = (await chips.first().innerText()).trim();
    await chips.first().click();
    await settled(page);
    await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(0);
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card').first().locator('h3').first()).toHaveText('برنج');
    await expect(page.getByTestId('nearby-chip')).toHaveCount(0);
    await expect(page.getByText('مورد به دستهٔ انتخاب‌شده رفت')).toBeVisible();
    expect(name.length).toBeGreaterThan(0);

    // undo: back to the terminal «پیدا نشد» with the chips
    await page.getByRole('button', { name: 'برگردان' }).click();
    await settled(page);
    await expect(page.locator('[data-testid="item-card"][data-state="not_found"]')).toHaveCount(1);
    await expect(page.getByTestId('nearby-chip').first()).toBeVisible();
  });
});
