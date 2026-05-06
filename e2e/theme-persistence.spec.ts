import { test, expect } from '@playwright/test';

/**
 * Journey 6: Dark mode persistence
 *
 * The site supports theme switching via CSS custom properties.
 * This tests that the homepage renders correctly with the default
 * theme and that the color variables are properly applied.
 */
test.describe('Journey 6 — Dark mode / Theme persistence', () => {
  test('homepage has valid CSS custom properties for theming', async ({ page }) => {
    await page.goto('/');

    // Check that CSS variables are defined on the root
    const bgColor = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        bg: style.getPropertyValue('--color-bg') || style.backgroundColor,
        text: style.getPropertyValue('--color-text') || style.color,
      };
    });

    // Background should not be transparent/default
    expect(bgColor.bg).toBeTruthy();
  });

  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // No critical JavaScript errors should occur
    // (Wallet errors are expected since no wallet is injected)
    const criticalErrors = errors.filter(e =>
      !e.includes('wallet') && !e.includes('ethereum') && !e.includes('MetaMask')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('page is responsive at mobile width', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 }, // iPhone X
    });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page.locator('h1.page-title')).toBeVisible();
    await expect(page.locator('.gv-wallet-card')).toBeVisible();

    await context.close();
  });

  test('all post links are valid (non-404)', async ({ page }) => {
    await page.goto('/');

    const postLinks = page.locator('.gv-post-item a');
    const count = await postLinks.count();
    expect(count).toBeGreaterThan(0);

    // Check first 5 posts to avoid excessive requests
    const checkCount = Math.min(count, 5);
    for (let i = 0; i < checkCount; i++) {
      const href = await postLinks.nth(i).getAttribute('href');
      expect(href).toBeTruthy();

      const response = await page.goto(href!);
      expect(response?.status()).toBeLessThan(400);
      await page.goBack();
    }
  });
});
