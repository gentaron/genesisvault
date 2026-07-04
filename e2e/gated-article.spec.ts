import { expect, test } from '@playwright/test';

/**
 * Journey 3: Gated article shows paywall overlay
 *
 * Posts beyond the newest 2 are gated. The static HTML should
 * show a paywall gate instead of the article body.
 *
 * Note: the homepage intentionally HIDES gated post cards for
 * unpaid visitors (wallet-ui.ts), so we read the third card's href
 * from the DOM and navigate directly instead of clicking it.
 */

async function gotoThirdNewestPost(page: import('@playwright/test').Page) {
  await page.goto('/');
  const thirdPostLink = page.locator('.gv-post-item').nth(2).locator('a');
  const href = await thirdPostLink.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href as string);
  await page.waitForLoadState('domcontentloaded');
}

test.describe('Journey 3 — Gated article shows paywall overlay', () => {
  test('third-newest post shows paywall gate', async ({ page }) => {
    await gotoThirdNewestPost(page);

    // Should show the paywall gate, NOT the post content
    const gateTitle = page.locator('.gv-gate-title');
    await expect(gateTitle).toBeVisible();
    await expect(gateTitle).toContainText('プレミアムコンテンツ');

    // Article body should have the paywall gate div, not post-content
    await expect(page.locator('#article-body')).toBeVisible();
    await expect(page.locator('#post-content')).not.toBeVisible();
  });

  test('gated article has unlock link to homepage', async ({ page }) => {
    await gotoThirdNewestPost(page);

    // "ホームからアンロック" link should point to /
    const unlockLink = page.locator('.gv-btn-connect');
    await expect(unlockLink).toBeVisible();
    const href = await unlockLink.getAttribute('href');
    expect(href).toBe('/');
  });

  test('gated article has noindex meta tag', async ({ page }) => {
    await gotoThirdNewestPost(page);

    // Check for noindex meta tag
    const noindex = page.locator('meta[name="robots"][content*="noindex"]');
    await expect(noindex).toHaveCount(1);
  });
});
