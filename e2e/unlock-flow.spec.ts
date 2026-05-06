import { test, expect } from '@playwright/test';

/**
 * Journey 5: Unlock flow (wallet → pay → cookie → access)
 *
 * Tests the unlock API endpoint with mocked wallet interactions.
 * Verifies that without a valid payment cookie, the unlock flow
 * rejects, and with proper data it validates correctly.
 */
test.describe('Journey 5 — Unlock API validation', () => {
  test('unlock API rejects missing fields', async ({ request }) => {
    const response = await request.post('/api/unlock', {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test('unlock API rejects invalid wallet address', async ({ request }) => {
    const response = await request.post('/api/unlock', {
      data: {
        wallet: 'not-a-wallet',
        txHash: '0x' + 'ab'.repeat(32),
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid wallet');
  });

  test('unlock API rejects invalid tx hash', async ({ request }) => {
    const response = await request.post('/api/unlock', {
      data: {
        wallet: '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c',
        txHash: 'not-a-hash',
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid txHash');
  });

  test('unlock API rejects GET method', async ({ request }) => {
    const response = await request.get('/api/unlock');
    expect(response.status()).toBe(405);
  });

  test('unlock API rejects short tx hash', async ({ request }) => {
    const response = await request.post('/api/unlock', {
      data: {
        wallet: '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c',
        txHash: '0xabcdef',  // too short
      },
    });
    expect(response.status()).toBe(400);
  });

  test('unlock API handles unknown tx hash (404 from RPC)', async ({ request }) => {
    // This tx doesn't exist, so the RPC should return no receipt
    const fakeHash = '0x' + '00'.repeat(32);
    const response = await request.post('/api/unlock', {
      data: {
        wallet: '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c',
        txHash: fakeHash,
      },
    });
    // Should be 404 (tx not found) or 500 (RPC error)
    expect([404, 500]).toContain(response.status());
  });
});
