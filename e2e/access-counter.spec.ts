import { expect, test } from '@playwright/test';

/**
 * Access counter — behaviour without KV credentials.
 *
 * CI has no counter database, which is also the state of any checkout that
 * has not linked one. The contract in that state is "no counter, no noise":
 * the endpoint reports `enabled: false` and the footer widget never appears —
 * it must not fall back to showing a fabricated 0.
 */
test.describe('Access counter', () => {
  test('endpoint reports the counter as disabled when no KV is configured', async ({ request }) => {
    const res = await request.post('/api/views', { data: { path: '/' } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  test('endpoint rejects a path it would refuse to turn into a key', async ({ request }) => {
    const res = await request.post('/api/views', { data: { path: 'https://evil.example.com/x' } });
    expect(res.status()).toBe(400);
  });

  test('widget stays hidden and renders no placeholder number', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gv-counter')).toBeHidden();
    await expect(page.locator('#gv-counter-total')).toHaveText('—');
  });
});
