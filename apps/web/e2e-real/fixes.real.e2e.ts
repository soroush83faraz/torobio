import { expect, test, type Page } from '@playwright/test';
import { CCTV, expectNoOverflow, expectTouchTargets, settleAllItems, settled, shot, startPlan } from './helpers';

/**
 * Fixes from the independent verification, on the real server and market.sqlite:
 *  G2-1 the dead-end card (nothing matched what was asked) is never a bare badge, and it is the SERVER's `noMatch`
 *       card (reason + relax buttons); the client-derived fallback is NOT accepted any more;
 *  G2-2 listing titles are bidi-isolated («4.2V» is not shown as «V4.2»);
 *  G2-4 the items missing from a total are told apart (پیدا نشد / منتظر انتخاب / بدون قیمت);
 *  G2-5 the offline shell: a reload while the server is down still opens the app and the saved plans;
 *  G3   About numbers come from /api/meta; a conflicted plan shows the amber marker, never the green strip.
 */

/** The dead-end card must be the server's own `noMatch` card: reason, relax buttons, no derived fallback. */
async function expectServerNoMatchCard(page: Page) {
  const card = page.locator('[data-testid="item-card"][data-dead-end="true"]').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const panel = card.getByTestId('no-match');
  await expect(panel).toBeVisible();
  await expect(panel, 'the server sent noMatch (not the derived fallback)').toHaveAttribute('data-source', 'server');
  await expect(panel).toContainText('مورد مطابق خواسته پیدا نشد');
  await expect(panel).not.toContainText('این مورد دقیقاً پیدا نشد');
  await expect(card.getByTestId('no-match-reason')).not.toBeEmpty();
  // never a bare «جایگزین» badge
  await expect(card).not.toContainText('جایگزین');
  expect(await panel.getByTestId('relax').count(), 'the server noMatch offers at least one relax button').toBeGreaterThan(0);
  await expect(panel.getByText('اگر بخواهی، یکی از این قیدها را کنار می‌گذارم:')).toBeVisible();
  return { card, panel };
}

test.describe('G2-1 dead end', () => {
  test('«گوشی سامسونگ A56 زیر ۵۰ میلیون»: the server noMatch card (reason + relax buttons), and a relaxation recomputes', async ({ page }) => {
    // the wire itself carries noMatch with a reason and relaxations
    const planResponse = page.waitForResponse((r) => r.url().endsWith('/api/plan') && r.request().method() === 'POST');
    await startPlan(page, 'گوشی سامسونگ A56 زیر ۵۰ میلیون');
    const wire = (await (await planResponse).json()).data;
    const item = wire.items.find((i: { noMatch?: unknown }) => i.noMatch);
    expect(item, 'the plan response has an item with noMatch').toBeTruthy();
    expect(item.noMatch.reasonFa.length).toBeGreaterThan(5);
    expect(item.noMatch.relax.length).toBeGreaterThan(0);

    await settled(page);
    const { panel } = await expectServerNoMatchCard(page);
    await expect(panel.getByTestId('relax').first()).toBeVisible();
    await expectNoOverflow(page);
    await expectTouchTargets(page);
    await shot(page, '70-dead-end', true);

    // a relaxation applies through the client state and the plan recomputes
    await panel.getByTestId('relax').first().click();
    await settled(page);
    await expect(page.getByRole('button', { name: 'برگردان' })).toBeVisible();
  });

  test('«گوشی آیفون ۱۵ استوک» is not an empty «جایگزین» card either', async ({ page }) => {
    await startPlan(page, 'گوشی آیفون ۱۵ استوک');
    await settled(page);
    const first = page.getByTestId('item-card').first();
    await expect(first).toBeVisible();
    if ((await first.getAttribute('data-state')) === 'alternative' && (await first.locator('[data-testid="item-product"]').count()) === 0) {
      await expectServerNoMatchCard(page);
    } else {
      // the server found a model: then it is shown with a name
      await expect(first.getByTestId('item-product').or(first.getByTestId('no-match'))).toBeVisible();
    }
    await expectNoOverflow(page);
  });
});

test.describe('G2-4 missing items are told apart', () => {
  test('a dead end and a not-found item are listed under «پیدا نشد», separately from the priced item', async ({ page }) => {
    await startPlan(page, 'هارد ۲ ترابایت، برنج هاشمی، گوشی سامسونگ A56 زیر ۵۰ میلیون');
    await page.getByRole('tab', { name: 'برنامه' }).click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const groups = page.getByTestId('missing-groups');
    await expect(groups).toBeVisible();
    const nf = groups.locator('[data-kind="not_found"]');
    await expect(nf).toContainText('پیدا نشد:');
    await expect(nf).toContainText('برنج هاشمی');
    await expect(nf).toContainText('سامسونگ');
    await expect(groups.locator('[data-kind="needs_info"]')).toHaveCount(0);
    await expect(page.getByTestId('plan-view')).not.toContainText('بدون قیمت یا انتخاب');
    await expectNoOverflow(page);
  });
});

test.describe('G2-2 bidi isolation of listing titles', () => {
  test('«4.2V» keeps its order on the plan stop line, the seller card and the options sheet', async ({ page }) => {
    await startPlan(page, 'آداپتور 4.2V فیش بزرگ');
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const line = page.getByTestId('stop-line').first();
    await expect(line).toContainText('4.2V');

    /** In every isolate showing «4.2V» the digit comes before the «V» on screen (left to right). */
    const expectLtrOrder = async (scope: string) => {
      const bad = await page.evaluate((sel) => {
        const out: string[] = [];
        document.querySelectorAll(`${sel} bdi`).forEach((b) => {
          const node = b.firstChild;
          const text = b.textContent ?? '';
          const at = text.indexOf('4.2V');
          if (!node || node.nodeType !== 3 || at < 0) return;
          const rect = (i: number) => {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + 1);
            return r.getBoundingClientRect();
          };
          const digit = rect(at);
          const v = rect(at + 3);
          if (!(digit.left < v.left)) out.push(`${text} (digit at ${Math.round(digit.left)}, V at ${Math.round(v.left)})`);
          if (b.getAttribute('dir') !== 'ltr') out.push(`${text}: not an ltr isolate`);
        });
        return out;
      }, scope);
      expect(bad, `«4.2V» order in ${scope}`).toEqual([]);
      const count = await page.locator(`${scope} bdi`, { hasText: '4.2V' }).count();
      expect(count, `an isolate shows 4.2V in ${scope}`).toBeGreaterThan(0);
    };

    await expectLtrOrder('[data-testid="stop-line"]');
    // no Latin letter or digit run of the title sits outside an isolate
    const loose = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stop-line"]')!;
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('bdi, svg, button').forEach((n) => n.remove());
      return (clone.textContent ?? '').match(/[A-Za-z]/g)?.length ?? 0;
    });
    expect(loose, 'Latin letters outside <bdi> on the stop line').toBe(0);
    await expectNoOverflow(page);
    await shot(page, '73-bidi-stop-line', true);

    await line.getByTestId('show-seller').click();
    await expect(page.getByTestId('seller-card')).toBeVisible();
    await expectLtrOrder('[data-testid="seller-card"]');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await line.getByRole('button', { name: 'تغییر', exact: true }).click();
    const list = page.getByTestId('options-list');
    await expect(list.locator('article').first()).toBeVisible({ timeout: 15_000 });
    await expectLtrOrder('[data-testid="options-list"]');
    await expectNoOverflow(page);
  });
});

test.describe('G2-5 offline shell', () => {
  // The rest of the suite runs without the service worker (see playwright.real.config.ts); this one needs it.
  test.use({ serviceWorkers: 'allow' });

  async function controlled(page: Page) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>((r) => navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }));
    });
  }

  test('a reload with the network down still opens the app and the saved plan (items from this device); retry works once back', async ({ page, context }) => {
    await startPlan(page, 'آداپتور 4.2V فیش بزرگ');
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await page.goto('/');
    await expect(page.getByTestId('resume-card')).toBeVisible();
    await controlled(page);
    // the shell is cached under a build-named cache; /api is never cached
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
      return { names, urls };
    });
    expect(cached.names.some((n) => n.startsWith('shell-'))).toBe(true);
    expect(cached.urls).toContain('/');
    expect(cached.urls.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))).toBe(true);
    expect(cached.urls.filter((u) => u.startsWith('/api/'))).toEqual([]);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برای خریدت چی لازم داری؟');
    await expect(page.getByTestId('resume-card')).toBeVisible();
    await expect(page.getByTestId('server-down')).toContainText('اتصال به سرور برقرار نیست');

    // the saved plan opens from localStorage; the calculation needs the server, so its items are shown calmly
    await page.getByTestId('resume-card').getByRole('link').first().click();
    await expect(page.getByTestId('plan-name')).toBeVisible();
    await expect(page.getByTestId('saved-items')).toContainText('آداپتور');
    await expectNoOverflow(page);

    await context.setOffline(false);
    await page.getByRole('button', { name: 'دوباره امتحان کن' }).click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('اتصال به سرور برقرار نیست')).toHaveCount(0);
  });

  test('server unreachable (network up): the calm Persian banner shows and clears when it answers again', async ({ page, context }) => {
    await page.goto('/');
    await controlled(page);
    await context.route('**/api/**', (r) => r.abort('connectionrefused'));
    await page.getByLabel('فهرست خریدت را بنویس').fill('هارد ۲ ترابایت');
    await page.getByTestId('go').click();
    await expect(page.getByTestId('server-down')).toContainText('اتصال به سرور برقرار نیست');
    await expectNoOverflow(page);
    await expect(page.getByTestId('parse-error')).toBeVisible();
    await expect(page.getByTestId('go')).toBeEnabled();
    await context.unroute('**/api/**');
    await page.getByTestId('go').click();
    await expect(page).toHaveURL(/#\/plan\//);
    await expect(page.getByTestId('server-down')).toHaveCount(0);
  });
});

test.describe('G3-3 About sheet numbers come from /api/meta', () => {
  test('both shop counts (all shops in the data, and those with price listings), products, date and areas match the server', async ({ page, request }) => {
    const meta = (await (await request.get('/api/meta')).json()).data;
    const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
    expect(meta.counts.shops).toBeGreaterThan(meta.counts.shops_with_offers);
    await page.goto('/');
    await page.getByRole('button', { name: 'درباره‌ی داده‌ها' }).click();
    const sheet = page.getByRole('dialog', { name: 'درباره‌ی داده‌ها' });
    await expect(sheet).toBeVisible();
    // «۶٬۴۷۶ مغازه در داده هست؛ ۳٬۷۹۲ مورد از آن‌ها فهرست قیمت دارند · ۲۲۵٬۹۰۳ کالا»
    await expect(sheet).toContainText(`${fa(meta.counts.shops)} مغازه در داده هست`);
    await expect(sheet).toContainText(`${fa(meta.counts.shops_with_offers)} مورد از آن‌ها فهرست قیمت دارند`);
    await expect(sheet).toContainText(`${fa(meta.counts.products)} کالا`);
    await expect(sheet).not.toContainText(`${fa(meta.counts.shops_with_offers)} مغازه ·`);
    // the snapshot date and the areas are the server's too; the 10% is attributed to the organisers
    await expect(sheet).toContainText(meta.snapshotDateFa);
    await expect(sheet).toContainText(meta.areas.join('، '));
    await expect(sheet).toContainText('طبق اعلام برگزارکننده حدود ۱۰٪');
    // every number in the sheet is one of those (plus the organisers' ten percent)
    const text = await sheet.innerText();
    const allowed = new Set([meta.counts.shops, meta.counts.shops_with_offers, meta.counts.products].map(fa));
    const date = new Set<string>(meta.snapshotDateFa.match(/[۰-۹]+/g) ?? []);
    const unexplained = (text.match(/[۰-۹][۰-۹٬]*/g) ?? []).filter((n) => !allowed.has(n) && !date.has(n) && n !== '۱۰');
    expect(unexplained, 'unexplained numbers in the About sheet').toEqual([]);
    await expectNoOverflow(page);
    await shot(page, '13-about-data');
  });
});

test.describe('G3-5 a conflicted plan', () => {
  test('hasConflict: amber «ناسازگاری دارد» next to the total, the engine line as given, never the green all-ready strip', async ({ page }) => {
    const LINE = 'جمع ۴ مورد: ۲۰٫۳ میلیون تومان · ناسازگاری دارد';
    await page.route('**/api/plan', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.data.hasConflict = true;
      body.data.totalLine = LINE;
      await route.fulfill({ response: res, json: body });
    });
    await startPlan(page, CCTV);
    // list: answer everything; with a conflict the strip is amber, not the green «همهٔ موارد آماده است»
    await settleAllItems(page);
    await expect(page.getByTestId('conflict-strip')).toContainText('ناسازگاری دارد');
    await expect(page.getByTestId('all-ready-strip')).toHaveCount(0);
    await expect(page.getByText('همهٔ موارد آماده است')).toHaveCount(0);

    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('plan-view')).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const total = page.locator('[data-total]').first();
    await expect(total).toHaveAttribute('data-conflict', 'true');
    await expect(total.getByTestId('total-line')).toHaveText(LINE);
    const chip = total.getByTestId('conflict-chip');
    await expect(chip).toHaveText('ناسازگاری دارد');
    await expectNoOverflow(page);
    await expectTouchTargets(page);

    // and the checklist total carries it too
    await page.getByTestId('primary-action').click();
    await expect(page.getByTestId('market-view')).toBeVisible();
    await expect(page.getByTestId('market-totals').getByTestId('conflict-chip')).toBeVisible();
  });
});
