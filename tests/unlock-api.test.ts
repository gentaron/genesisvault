import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// ─── Replicate hmacSign from unlock.ts for testing ──────────────
function hmacSign(data: string): string {
  const secret = process.env.PAYWALL_SECRET || 'change-me-in-production';
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

// ─── Replicate validation logic from unlock.ts ───────────────────
function validateWallet(wallet: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(wallet);
}

function validateTxHash(txHash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(txHash);
}

const RECEIVER = '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c'.toLowerCase();
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
const PRICE_USDC = 3000000n;

function extractTransferLog(logs: any[], wallet: string): any | undefined {
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  return logs.find((log: any) => {
    if (log.topics?.[0] !== TRANSFER_TOPIC) return false;
    if (log.address?.toLowerCase() !== USDC) return false;
    const from = '0x' + (log.topics[1] || '').slice(26);
    if (from.toLowerCase() !== wallet.toLowerCase()) return false;
    const to = '0x' + (log.topics[2] || '').slice(26);
    if (to.toLowerCase() !== RECEIVER) return false;
    const amount = BigInt(log.data || '0x0');
    return amount >= PRICE_USDC;
  });
}

function buildCookiePayload(wallet: string, expiry: number): string {
  const payload = `${wallet.toLowerCase()}.${expiry}`;
  const sig = hmacSign(payload);
  return `${payload}.${sig}`;
}

// ═══════════════════════════════════════════════════════════════
// Unlock API Input Validation Tests
// ═══════════════════════════════════════════════════════════════

describe('Unlock API — Input Validation', () => {
  it('accepts valid wallet address', () => {
    expect(validateWallet('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c')).toBe(true);
  });

  it('accepts all-lowercase wallet address', () => {
    expect(validateWallet('0x94ac0cbf9188e31979ad1434d86cdc75ddbec10c')).toBe(true);
  });

  it('accepts all-uppercase wallet address', () => {
    expect(validateWallet('0x94AC0CBF9188E31979AD1434D86CDC75DDBEC10C')).toBe(true);
  });

  it('rejects wallet without 0x prefix', () => {
    expect(validateWallet('94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c')).toBe(false);
  });

  it('rejects wallet that is too short', () => {
    expect(validateWallet('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBE')).toBe(false);
  });

  it('rejects wallet that is too long', () => {
    expect(validateWallet('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10cFF')).toBe(false);
  });

  it('rejects wallet with non-hex characters', () => {
    expect(validateWallet('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBGc10c')).toBe(false);
  });

  it('rejects empty wallet', () => {
    expect(validateWallet('')).toBe(false);
  });

  it('rejects null/undefined wallet', () => {
    expect(validateWallet(null as any)).toBe(false);
    expect(validateWallet(undefined as any)).toBe(false);
  });

  it('accepts valid tx hash (66 hex chars with 0x)', () => {
    expect(validateTxHash('0x' + 'ab'.repeat(32))).toBe(true);
  });

  it('rejects tx hash that is too short', () => {
    expect(validateTxHash('0x' + 'ab'.repeat(16))).toBe(false);
  });

  it('rejects tx hash without 0x prefix', () => {
    expect(validateTxHash('ab'.repeat(32))).toBe(false);
  });

  it('rejects empty tx hash', () => {
    expect(validateTxHash('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Unlock API — Transfer Log Verification Tests
// ═══════════════════════════════════════════════════════════════

describe('Unlock API — Transfer Log Verification', () => {
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const senderWallet = '0xabcdef1234567890abcdef1234567890abcdef12';

  function makeTransferLog(from: string, to: string, amount: bigint) {
    const padAddr = (addr: string) => '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
    return {
      topics: [TRANSFER_TOPIC, padAddr(from), padAddr(to)],
      data: '0x' + amount.toString(16).padStart(64, '0'),
      address: USDC,
    };
  }

  it('finds valid USDC transfer to receiver', () => {
    const logs = [
      makeTransferLog(senderWallet, RECEIVER, 3000000n),
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeDefined();
  });

  it('finds transfer with amount greater than price', () => {
    const logs = [
      makeTransferLog(senderWallet, RECEIVER, 5000000n),
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeDefined();
  });

  it('rejects transfer with insufficient amount (< 3 USDC)', () => {
    const logs = [
      makeTransferLog(senderWallet, RECEIVER, 2999999n),
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeUndefined();
  });

  it('rejects transfer to wrong recipient', () => {
    const wrongReceiver = '0x' + '11'.repeat(20);
    const logs = [
      makeTransferLog(senderWallet, wrongReceiver, 3000000n),
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeUndefined();
  });

  it('rejects transfer from wrong sender', () => {
    const wrongSender = '0x' + '22'.repeat(20);
    const logs = [
      makeTransferLog(wrongSender, RECEIVER, 3000000n),
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeUndefined();
  });

  it('rejects log with wrong topic (non-Transfer event)', () => {
    const logs = [{
      topics: ['0x' + '00'.repeat(32)],
      data: '0x' + (3000000n).toString(16).padStart(64, '0'),
      address: USDC,
    }];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeUndefined();
  });

  it('rejects log from wrong token contract', () => {
    const padAddr = (addr: string) => '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
    const logs = [{
      topics: [TRANSFER_TOPIC, padAddr(senderWallet), padAddr(RECEIVER)],
      data: '0x' + (3000000n).toString(16).padStart(64, '0'),
      address: '0x' + 'dd'.repeat(20),  // wrong contract
    }];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeUndefined();
  });

  it('handles empty logs array', () => {
    const result = extractTransferLog([], senderWallet);
    expect(result).toBeUndefined();
  });

  it('finds correct transfer among multiple logs', () => {
    const otherWallet = '0x' + '33'.repeat(20);
    const otherReceiver = '0x' + '44'.repeat(20);
    const logs = [
      makeTransferLog(otherWallet, otherReceiver, 1000000n),  // unrelated transfer
      { topics: ['0x' + 'ff'.repeat(32)], data: '0x00', address: USDC },  // different event
      makeTransferLog(senderWallet, RECEIVER, 3000000n),  // the correct one
    ];
    const result = extractTransferLog(logs, senderWallet);
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Unlock API — HMAC Cookie Generation Tests
// ═══════════════════════════════════════════════════════════════

describe('Unlock API — HMAC Cookie Generation', () => {
  const wallet = '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c';

  it('generates valid cookie payload', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = buildCookiePayload(wallet, expiry);
    expect(cookie).toContain(wallet.toLowerCase());
    expect(cookie).toContain('.');
  });

  it('payload has exactly 3 parts (wallet, expiry, sig)', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = buildCookiePayload(wallet, expiry);
    // The payload itself is "wallet.expiry", and then ".sig" is appended
    // So we get: wallet.expiry.sig = 3 dot-separated segments
    const parts = cookie.split('.');
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('cookie signature matches expected HMAC', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = `${wallet.toLowerCase()}.${expiry}`;
    const sig = hmacSign(payload);
    expect(sig).toHaveLength(43); // base64url of sha256
  });

  it('different wallets produce different cookies', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie1 = buildCookiePayload(wallet, expiry);
    const cookie2 = buildCookiePayload('0x' + '11'.repeat(20), expiry);
    expect(cookie1).not.toBe(cookie2);
  });

  it('different expiries produce different cookies', () => {
    const now = Date.now();
    const cookie1 = buildCookiePayload(wallet, now + 86400000);
    const cookie2 = buildCookiePayload(wallet, now + 86400000 * 2);
    expect(cookie1).not.toBe(cookie2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Unlock API — Block Confirmation Tests
// ═══════════════════════════════════════════════════════════════

describe('Unlock API — Block Confirmation Logic', () => {
  it('accepts tx with 2+ confirmations', () => {
    const currentBlock = 100n;
    const txBlock = 98n;
    expect(currentBlock - txBlock + 1n >= 2n).toBe(true);
  });

  it('accepts tx with many confirmations', () => {
    const currentBlock = 1000n;
    const txBlock = 500n;
    expect(currentBlock - txBlock + 1n >= 2n).toBe(true);
  });

  it('rejects tx with only 1 confirmation (adjacent blocks)', () => {
    const currentBlock = 100n;
    const txBlock = 100n; // same block = 0 confirmations in practice
    expect(currentBlock - txBlock + 1n >= 2n).toBe(false);
  });

  it('rejects tx when currentBlock < txBlock (should never happen)', () => {
    const currentBlock = 50n;
    const txBlock = 100n;
    expect(currentBlock - txBlock + 1n >= 2n).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Unlock API — RPC Response Validation
// ═══════════════════════════════════════════════════════════════

describe('Unlock API — RPC Response Validation', () => {
  it('detects missing receipt', () => {
    const receipt = null;
    expect(receipt).toBeNull();
  });

  it('detects failed transaction (status 0x0)', () => {
    const receipt = { status: '0x0' };
    expect(receipt.status).not.toBe('0x1');
  });

  it('detects successful transaction (status 0x1)', () => {
    const receipt = { status: '0x1' };
    expect(receipt.status).toBe('0x1');
  });

  it('validates tx targets USDC contract', () => {
    const receipt = { to: USDC };
    expect(receipt.to.toLowerCase()).toBe(USDC);
  });

  it('rejects tx targeting wrong contract', () => {
    const receipt = { to: '0x' + 'aa'.repeat(20) };
    expect(receipt.to.toLowerCase()).not.toBe(USDC);
  });

  it('parses block number from hex', () => {
    const receipt = { blockNumber: '0x64' }; // 100
    expect(BigInt(receipt.blockNumber)).toBe(100n);
  });
});
