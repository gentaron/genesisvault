import { test, expect } from '@playwright/test';

/**
 * Journey 2: Public article renders full content
 *
 * The newest 2 posts are free. Navigating to a post page
 * should show the full article body with title, date, and content.
 */
test.describe('Journey 2 — Public article renders full content', () => {
  test('navigates to the newest post and renders content', async ({ page }) => {
    await page.goto('/');

    // Click the first (newest) post link
    const firstPostLink = page.locator('.gv-post-item').first().locator('a');
    const href = await firstPostLink.getAttribute('href');
    expect(href).toBeTruthy();

    await firstPostLink.click();
    await page.waitForURL(href!);

    // Verify article page renders
    const articleTitle = page.locator('h1.page-title');
    await expect(articleTitle).toBeVisible();
    await expect(articleTitle).not.toBeEmpty();

    // Verify date is shown
    await expect(page.locator('time')).toBeVisible();

    // Free posts should render body statically
    const postContent = page.locator('#post-content');
    await expect(postContent).toBeVisible();
  });

  test('article has back-to-home link', async ({ page }) => {
    await page.goto('/');

    const firstPostLink = page.locator('.gv-post-item').first().locator('a');
    await firstPostLink.click();
    await page.waitForLoadState('domcontentloaded');

    const homeLink = page.locator('footer a[href="/"]');
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toContainText('Home');
  });

  test('article page has correct meta title', async ({ page }) => {
    await page.goto('/');

    const firstPostLink = page.locator('.gv-post-item').first().locator('a');
    await firstPostLink.click();
    await page.waitForLoadState('domcontentloaded');

    const title = await page.title();
    expect(title).toContain('Genesis Vault');
  });
});
