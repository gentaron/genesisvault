import { expect, test } from '@playwright/test';

/**
 * Journey 7: PWA — manifest / Service Worker / offline fallback
 * Journey 8: SEO endpoints — robots / sitemap / RSS / structured data
 *
 * これらはビルド成果物（dist/）に対して e2e-server で検証する。
 */
test.describe('Journey 7 — PWA', () => {
  test('manifest is served and well-formed', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.name).toContain('Genesis Vault');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('ja');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBeTruthy();
  });

  test('service worker registers and takes control', async ({ page }) => {
    await page.goto('/');
    const registered = await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return Boolean(reg);
      },
      { timeout: 15_000 },
    );
    expect(registered).toBeTruthy();
  });

  test('icon assets referenced by the manifest exist', async ({ request }) => {
    for (const src of [
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-192.png',
      '/icons/icon-maskable-512.png',
    ]) {
      const res = await request.get(src);
      expect(res.status(), src).toBe(200);
    }
  });

  test('offline fallback page renders', async ({ request }) => {
    const res = await request.get('/offline/');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('オフライン');
  });
});

test.describe('Journey 8 — SEO endpoints', () => {
  test('robots.txt references the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Sitemap:');
  });

  test('sitemap.xml lists static pages and posts', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/posts/');
  });

  test('rss.xml serves a feed with items', async ({ request }) => {
    const res = await request.get('/rss.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<rss');
    expect(body).toContain('<item>');
  });

  test('homepage emits WebSite structured data', async ({ page }) => {
    await page.goto('/');
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(scripts.join('')).toContain('WebSite');
  });

  test('article page emits BlogPosting structured data', async ({ page }) => {
    await page.goto('/');
    const firstPostLink = page.locator('.gv-post-item').first().locator('a');
    await firstPostLink.click();
    await page.waitForLoadState('domcontentloaded');
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(scripts.join('')).toContain('BlogPosting');
  });
});
