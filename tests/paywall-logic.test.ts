import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

const HMAC_SECRET = 'test-secret-key';

function createSignedToken(wallet: string, txHash: string): string {
  const payload = Buffer.from(JSON.stringify({
    paid: true,
    wallet: wallet.toLowerCase(),
    txHash,
    exp: Date.now() + 365 * 24 * 60 * 60 * 1000,
  })).toString('base64url');

  const sig = createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): boolean {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  const expected = createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.paid === true && data.exp > Date.now();
  } catch {
    return false;
  }
}

describe('Paywall Token Verification', () => {
  it('accepts valid signed token', () => {
    const token = createSignedToken('0xABC...123', '0xdef456');
    expect(verifyToken(token)).toBe(true);
  });

  it('rejects tampered token', () => {
    const token = createSignedToken('0xABC...123', '0xdef456');
    const tampered = token.slice(0, -10) + 'TAMPERED';
    expect(verifyToken(tampered)).toBe(false);
  });

  it('rejects expired token', () => {
    const payload = Buffer.from(JSON.stringify({
      paid: true,
      wallet: '0xabc',
      exp: Date.now() - 1000, // expired
    })).toString('base64url');
    const sig = createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
    expect(verifyToken(`${payload}.${sig}`)).toBe(false);
  });

  it('rejects malformed token', () => {
    expect(verifyToken('not-a-token')).toBe(false);
    expect(verifyToken('only.one.part')).toBe(false);
    expect(verifyToken('')).toBe(false);
  });
});
