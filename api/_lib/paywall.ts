/**
 * Shared paywall verification helpers for the Vercel API routes.
 *
 * Centralising this logic ensures every unlock path (`/api/unlock`,
 * `/api/unlock-legacy`) performs the SAME on-chain verification and that
 * cookie signing/verification uses one hardened implementation. Files
 * prefixed with `_` are treated by Vercel as non-route helpers.
 *
 * @module api/_lib/paywall
 */

import crypto from 'crypto';

// ─── Constants ─────────────────────────────────────────────────
export const RECEIVER = (
  process.env.RECEIVER_ADDRESS || '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c'
).toLowerCase();
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
export const PRICE_USDC = 3000000n; // 3 USDC with 6 decimals
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

// ─── Secret handling (fail closed) ─────────────────────────────

/**
 * Resolve the HMAC secret used to sign/verify unlock cookies.
 *
 * Throws if the secret is missing or left at an insecure placeholder so that
 * the paywall never falls back to a publicly-known signing key. Callers must
 * handle the thrown error (issue → 500, verify → treat as invalid).
 */
function getPaywallSecret(): string {
  const secret = process.env.PAYWALL_SECRET;
  if (!secret || secret === 'change-me-in-production') {
    throw new Error('PAYWALL_SECRET is not configured');
  }
  return secret;
}

function hmacSign(data: string): string {
  return crypto.createHmac('sha256', getPaywallSecret()).update(data).digest('base64url');
}

/** Constant-time string comparison that never throws on length mismatch. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Cookie issue / verify ─────────────────────────────────────

/**
 * Build the `Set-Cookie` header value for a freshly unlocked wallet.
 * Throws if the signing secret is not configured (fail closed).
 */
export function buildUnlockCookie(wallet: string): string {
  const expiry = Date.now() + COOKIE_MAX_AGE_SEC * 1000;
  const payload = `${wallet.toLowerCase()}.${expiry}`;
  const sig = hmacSign(payload);
  const cookieValue = `${payload}.${sig}`;
  return `gv_unlock=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SEC}`;
}

/**
 * Verify a `gv_unlock` cookie. Returns `{ valid: false }` for any tampered,
 * expired, malformed, or unsignable cookie. Fails closed if the signing
 * secret is missing.
 */
export function hmacVerify(cookieHeader: string | undefined): { valid: boolean; wallet?: string } {
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

  let expected: string;
  try {
    expected = hmacSign(payload);
  } catch {
    // Secret not configured → deny access rather than trust an unsigned cookie.
    return { valid: false };
  }

  if (!timingSafeEqualStr(sig, expected)) return { valid: false };

  const parts = payload.split('.');
  if (parts.length !== 2) return { valid: false };
  const [wallet, expiry] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return { valid: false };

  return { valid: true, wallet };
}

// ─── On-chain payment verification ─────────────────────────────

function makeRpcCall(method: string, params: unknown[]) {
  const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  return fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then(r => r.json());
}

export type VerifyResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Fully verify that `txHash` is a confirmed USDC transfer of at least
 * `PRICE_USDC` from `wallet` to the configured `RECEIVER`.
 *
 * This is the single source of truth for payment verification and MUST be
 * used by every endpoint that issues an unlock cookie. Checks performed:
 *   1. receipt exists
 *   2. transaction succeeded (status 0x1)
 *   3. transaction targeted the USDC contract
 *   4. at least 2 block confirmations
 *   5. an ERC-20 Transfer log from `wallet` → `RECEIVER` for >= PRICE_USDC
 */
export async function verifyUsdcPayment(wallet: string, txHash: string): Promise<VerifyResult> {
  const receiptResp = await makeRpcCall('eth_getTransactionReceipt', [txHash]);
  const receipt = receiptResp?.result;
  if (!receipt) {
    return { ok: false, status: 404, error: 'Transaction not found' };
  }

  if (receipt.status !== '0x1') {
    return { ok: false, status: 400, error: 'Transaction failed' };
  }

  if (!receipt.to || receipt.to.toLowerCase() !== USDC) {
    return { ok: false, status: 400, error: 'Not a USDC transaction' };
  }

  const blockResp = await makeRpcCall('eth_blockNumber', []);
  const currentBlock = BigInt(blockResp?.result || '0x0');
  const txBlock = BigInt(receipt.blockNumber);
  if (currentBlock - txBlock + 1n < 2n) {
    return { ok: false, status: 400, error: 'Insufficient confirmations (need 2)' };
  }

  const transferLog = (receipt.logs || []).find((log: any) => {
    if (log.topics?.[0] !== TRANSFER_TOPIC) return false;
    if (log.address?.toLowerCase() !== USDC) return false;
    const from = '0x' + (log.topics[1] || '').slice(26);
    if (from.toLowerCase() !== wallet.toLowerCase()) return false;
    const to = '0x' + (log.topics[2] || '').slice(26);
    if (to.toLowerCase() !== RECEIVER) return false;
    const amount = BigInt(log.data || '0x0');
    return amount >= PRICE_USDC;
  });

  if (!transferLog) {
    return { ok: false, status: 400, error: 'Valid USDC transfer not found in logs' };
  }

  return { ok: true };
}
