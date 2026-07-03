import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildUnlockCookie, verifyUsdcPayment } from './_lib/paywall';

/**
 * Legacy migration endpoint.
 *
 * Older clients stored a `{ txHash, wallet }` "paid" record in localStorage
 * and call this endpoint to exchange it for a server-signed cookie. The stored
 * record is fully attacker-controlled, so the transaction MUST be re-verified
 * on-chain exactly like `/api/unlock` — otherwise any public successful tx hash
 * could be replayed to bypass the paywall.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { txHash, wallet } = req.body;
  if (!txHash || !wallet) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid format' });
  }

  try {
    // Same full on-chain verification as /api/unlock — never trust the
    // client-supplied localStorage record on its own.
    const result = await verifyUsdcPayment(wallet, txHash);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.setHeader('Set-Cookie', buildUnlockCookie(wallet));
    return res.status(200).json({ migrated: true });
  } catch (err) {
    console.error('Legacy migration error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
