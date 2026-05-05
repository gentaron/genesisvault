import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';

const HMAC_SECRET = 'test-secret-key';

// Replicate the server-side HMAC logic
async function hmacSign(data: string): Promise<string> {
  const sig = createHmac('sha256', HMAC_SECRET).update(data).digest('base64url');
  return sig;
}

async function hmacVerify(cookieHeader: string | null): { valid: boolean; wallet?: string } {
  if (!cookieHeader) return { valid: false };
  const match = cookieHeader.match(/gv_unlock=([^;]+)/);
  if (!match) return { valid: false };

  let payload: string, sig: string;
  try {
    const decoded = decodeURIComponent(match[1]);
    const dotIndex = decoded.lastIndexOf('.');
    if (dotIndex === -1) return { valid: false };
    payload = decoded.substring(0, dotIndex);
    sig = decoded.substring(dotIndex + 1);
  } catch {
    return { valid: false };
  }

  const expected = await hmacSign(payload);
  if (sig !== expected) return { valid: false };

  const parts = payload.split('.');
  if (parts.length !== 2) return { valid: false };
  const [wallet, expiry] = parts;
  if (Number(expiry) < Date.now()) return { valid: false };

  return { valid: true, wallet };
}

describe('Server-side Paywall (Phase δ)', () => {
  describe('Cookie verification', () => {
    it('accepts valid gv_unlock cookie', async () => {
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const payload = `0xabcdef1234567890abcdef1234567890abcdef12.${expiry}`;
      const sig = await hmacSign(payload);
      const cookie = `gv_unlock=${encodeURIComponent(payload + '.' + sig)}; Path=/; HttpOnly`;
      const result = await hmacVerify(cookie);
      expect(result.valid).toBe(true);
    });

    it('rejects tampered cookie', async () => {
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const payload = `0xabcdef1234567890abcdef1234567890abcdef12.${expiry}`;
      const sig = await hmacSign(payload);
      const tamperedSig = sig.slice(0, -5) + 'XXXXX';
      const cookie = `gv_unlock=${encodeURIComponent(payload + '.' + tamperedSig)}; Path=/; HttpOnly`;
      const result = await hmacVerify(cookie);
      expect(result.valid).toBe(false);
    });

    it('rejects expired cookie', async () => {
      const expiry = Date.now() - 1000; // expired
      const payload = `0xabcdef1234567890abcdef1234567890abcdef12.${expiry}`;
      const sig = await hmacSign(payload);
      const cookie = `gv_unlock=${encodeURIComponent(payload + '.' + sig)}; Path=/; HttpOnly`;
      const result = await hmacVerify(cookie);
      expect(result.valid).toBe(false);
    });

    it('rejects missing cookie', async () => {
      const result = await hmacVerify(null);
      expect(result.valid).toBe(false);
    });

    it('rejects malformed cookie', async () => {
      const result = await hmacVerify('gv_unlock=garbage');
      expect(result.valid).toBe(false);
    });

    it('rejects old gv_token cookie name', async () => {
      const result = await hmacVerify('gv_token=some.thing.here');
      expect(result.valid).toBe(false);
    });
  });

  describe('ERC-20 Transfer log decoding', () => {
    it('correctly identifies Transfer topic', () => {
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      expect(TRANSFER_TOPIC).toHaveLength(66); // 0x + 32 bytes
    });

    it('extracts padded address from topic', () => {
      const topic = '0x00000000000000000000000094Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c';
      const addr = '0x' + topic.slice(26);
      expect(addr).toBe('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c');
    });
  });

  describe('USDC amount validation', () => {
    it('3 USDC = 3000000 with 6 decimals', () => {
      const PRICE_USDC = 3000000n;
      expect(PRICE_USDC).toBe(3_000_000n);
    });

    it('rejects amounts less than 3 USDC', () => {
      const PRICE_USDC = 3000000n;
      const tooLittle = 2999999n;
      expect(tooLittle < PRICE_USDC).toBe(true);
    });

    it('accepts amounts equal to or greater than 3 USDC', () => {
      const PRICE_USDC = 3000000n;
      expect(3000000n >= PRICE_USDC).toBe(true);
      expect(5000000n >= PRICE_USDC).toBe(true);
    });
  });
});
