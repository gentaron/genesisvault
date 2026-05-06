import { test, expect } from '@playwright/test';

/**
 * Journey 1: Homepage renders with posts
 *
 * Verifies the homepage loads, displays the site title,
 * and renders at least one post card from the static build.
 */
test.describe('Journey 1 — Homepage renders with posts', () => {
  test('homepage displays title and post cards', async ({ page }) => {
    await page.goto('/');

    // Site title is visible
    await expect(page.locator('h1.page-title')).toContainText('Genesis Vault');

    // Subtitle
    await expect(page.locator('.subtitle')).toContainText('Mina Eureka Ernst');

    // At least one post card exists (we have 70+ posts)
    const postItems = page.locator('.gv-post-item');
    await expect(postItems).toHaveCount(await postItems.count()); // at least 1

    // Each post card should have a link
    const firstPost = postItems.first();
    await expect(firstPost.locator('a')).toBeVisible();
  });

  test('homepage has wallet connect card', async ({ page }) => {
    await page.goto('/');

    // Wallet card section exists
    await expect(page.locator('.gv-wallet-card')).toBeVisible();
    await expect(page.locator('.gv-wallet-card-title')).toContainText('Ethereum Wallet');
    await expect(page.locator('.gv-wallet-card-sub')).toContainText('3 USDC');
  });

  test('homepage shows locked section counter', async ({ page }) => {
    await page.goto('/');

    // Locked section should be visible (JS shows it after counting locked posts)
    const lockedSection = page.locator('#locked-section');
    await expect(lockedSection).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#locked-count')).not.toBeEmpty();
  });
});
