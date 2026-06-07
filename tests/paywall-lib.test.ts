import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildUnlockCookie,
  hmacVerify,
  verifyUsdcPayment,
  RECEIVER,
  USDC,
  PRICE_USDC,
  TRANSFER_TOPIC,
} from '../api/_lib/paywall';

// ═══════════════════════════════════════════════════════════════
// Shared paywall helpers (api/_lib/paywall.ts)
//
// These exercise the REAL hardened implementation used by every unlock
// path, rather than a replicated copy. They lock in the security fixes:
//   - fail-closed signing/verification when PAYWALL_SECRET is unset
//   - full on-chain USDC verification (closes the legacy bypass)
//   - timing-safe, tamper-resistant cookie verification
// ═══════════════════════════════════════════════════════════════

const WALLET = '0xabcdef1234567890abcdef1234567890abcdef12';

function getCookieHeader(setCookie: string): string {
  // Set-Cookie -> Cookie header (just the name=value pair)
  return setCookie.split(';')[0];
}

describe('paywall lib — cookie signing & verification', () => {
  beforeEach(() => {
    process.env.PAYWALL_SECRET = 'unit-test-secret';
  });
  afterEach(() => {
    process.env.PAYWALL_SECRET = 'unit-test-secret';
  });

  it('round-trips a freshly issued cookie', () => {
    const setCookie = buildUnlockCookie(WALLET);
    expect(setCookie).toContain('gv_unlock=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');

    const result = hmacVerify(getCookieHeader(setCookie));
    expect(result.valid).toBe(true);
    expect(result.wallet).toBe(WALLET.toLowerCase());
  });

  it('rejects a missing cookie', () => {
    expect(hmacVerify(undefined).valid).toBe(false);
    expect(hmacVerify('').valid).toBe(false);
  });

  it('rejects a malformed / garbage cookie', () => {
    expect(hmacVerify('gv_unlock=garbage').valid).toBe(false);
    expect(hmacVerify('other=value').valid).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const cookie = getCookieHeader(buildUnlockCookie(WALLET));
    const tampered = cookie.slice(0, -4) + 'AAAA';
    expect(hmacVerify(tampered).valid).toBe(false);
  });

  it('rejects an expired cookie', () => {
    // Build a cookie with a definitively-past expiry, signed correctly.
    const realNow = Date.now;
    Date.now = () => 1000; // expiry = 1000 + 30d, but we'll move clock forward
    const cookie = getCookieHeader(buildUnlockCookie(WALLET));
    Date.now = () => 1000 + 31 * 24 * 60 * 60 * 1000; // past the 30d expiry
    try {
      expect(hmacVerify(cookie).valid).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects a non-numeric expiry payload', () => {
    // Hand-craft a payload with a bogus expiry but a valid signature shape;
    // signature won't match, so it must be rejected.
    expect(hmacVerify('gv_unlock=' + encodeURIComponent('wallet.notanumber.sig')).valid).toBe(false);
  });

  it('fails closed when PAYWALL_SECRET is unset', () => {
    delete process.env.PAYWALL_SECRET;
    expect(() => buildUnlockCookie(WALLET)).toThrow();
  });

  it('fails closed (verification denies) when PAYWALL_SECRET is the placeholder', () => {
    process.env.PAYWALL_SECRET = 'unit-test-secret';
    const cookie = getCookieHeader(buildUnlockCookie(WALLET));
    // Now degrade the secret to the insecure placeholder.
    process.env.PAYWALL_SECRET = 'change-me-in-production';
    expect(hmacVerify(cookie).valid).toBe(false);
    expect(() => buildUnlockCookie(WALLET)).toThrow();
  });
});

// ─── On-chain verification (closes legacy bypass) ──────────────

describe('paywall lib — verifyUsdcPayment', () => {
  const padAddr = (addr: string) =>
    '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0');

  function transferLog(from: string, to: string, amount: bigint) {
    return {
      topics: [TRANSFER_TOPIC, padAddr(from), padAddr(to)],
      data: '0x' + amount.toString(16).padStart(64, '0'),
      address: USDC,
    };
  }

  function makeReceipt(overrides: Record<string, unknown> = {}) {
    return {
      status: '0x1',
      to: USDC,
      blockNumber: '0xfe', // 254
      logs: [transferLog(WALLET, RECEIVER, PRICE_USDC)],
      ...overrides,
    };
  }

  function mockRpc(receipt: unknown, currentBlock = '0x100' /* 256 */) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body);
        if (body.method === 'eth_getTransactionReceipt') {
          return { json: async () => ({ result: receipt }) } as Response;
        }
        if (body.method === 'eth_blockNumber') {
          return { json: async () => ({ result: currentBlock }) } as Response;
        }
        return { json: async () => ({}) } as Response;
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a confirmed, correctly-addressed USDC payment', async () => {
    mockRpc(makeReceipt());
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(true);
  });

  it('rejects when the transaction receipt is missing', async () => {
    mockRpc(null);
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result).toEqual({ ok: false, status: 404, error: 'Transaction not found' });
  });

  it('rejects a failed transaction (status 0x0)', async () => {
    mockRpc(makeReceipt({ status: '0x0' }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('rejects a transaction not targeting the USDC contract', async () => {
    mockRpc(makeReceipt({ to: '0x' + 'aa'.repeat(20) }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('rejects insufficient confirmations', async () => {
    // tx in current block => 1 confirmation, need >= 2
    mockRpc(makeReceipt({ blockNumber: '0x100' }), '0x100');
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('LEGACY BYPASS GUARD: rejects a successful tx with no valid transfer log', async () => {
    // This is exactly the old unlock-legacy hole: a tx that merely succeeded.
    mockRpc(makeReceipt({ logs: [] }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('rejects a transfer to the wrong recipient', async () => {
    mockRpc(makeReceipt({ logs: [transferLog(WALLET, '0x' + '11'.repeat(20), PRICE_USDC)] }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('rejects a transfer from a wallet other than the claimant', async () => {
    mockRpc(makeReceipt({ logs: [transferLog('0x' + '22'.repeat(20), RECEIVER, PRICE_USDC)] }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('rejects an underpayment (< 3 USDC)', async () => {
    mockRpc(makeReceipt({ logs: [transferLog(WALLET, RECEIVER, PRICE_USDC - 1n)] }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(false);
  });

  it('accepts an overpayment (>= 3 USDC)', async () => {
    mockRpc(makeReceipt({ logs: [transferLog(WALLET, RECEIVER, PRICE_USDC + 1_000_000n)] }));
    const result = await verifyUsdcPayment(WALLET, '0x' + 'ab'.repeat(32));
    expect(result.ok).toBe(true);
  });
});
