import { test, expect } from '@playwright/test';

/**
 * Journey 3: Gated article shows paywall overlay
 *
 * Posts beyond the newest 2 are gated. The static HTML should
 * show a paywall gate instead of the article body.
 */
test.describe('Journey 3 — Gated article shows paywall overlay', () => {
  test('third-newest post shows paywall gate', async ({ page }) => {
    await page.goto('/');

    // Find the third post (index 2) — this should be gated
    const postItems = page.locator('.gv-post-item');
    const thirdPostLink = postItems.nth(2).locator('a');
    await thirdPostLink.click();
    await page.waitForLoadState('domcontentloaded');

    // Should show the paywall gate, NOT the post content
    const gateTitle = page.locator('.gv-gate-title');
    await expect(gateTitle).toBeVisible();
    await expect(gateTitle).toContainText('プレミアムコンテンツ');

    // Article body should have the paywall gate div, not post-content
    await expect(page.locator('#article-body')).toBeVisible();
    await expect(page.locator('#post-content')).not.toBeVisible();
  });

  test('gated article has unlock link to homepage', async ({ page }) => {
    await page.goto('/');

    const postItems = page.locator('.gv-post-item');
    const thirdPostLink = postItems.nth(2).locator('a');
    await thirdPostLink.click();
    await page.waitForLoadState('domcontentloaded');

    // "ホームからアンロック" link should point to /
    const unlockLink = page.locator('.gv-btn-connect');
    await expect(unlockLink).toBeVisible();
    const href = await unlockLink.getAttribute('href');
    expect(href).toBe('/');
  });

  test('gated article has noindex meta tag', async ({ page }) => {
    await page.goto('/');

    const postItems = page.locator('.gv-post-item');
    const thirdPostLink = postItems.nth(2).locator('a');
    await thirdPostLink.click();
    await page.waitForLoadState('domcontentloaded');

    // Check for noindex meta tag
    const noindex = page.locator('meta[name="robots"][content*="noindex"]');
    await expect(noindex).toHaveCount(1);
  });
});
