import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildUnlockCookie, verifyUsdcPayment } from './_lib/paywall';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, txHash } = req.body;
  if (!wallet || !txHash) {
    return res.status(400).json({ error: 'Missing wallet or txHash' });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash' });
  }

  try {
    // Full on-chain verification: confirmed USDC transfer from `wallet`
    // to the configured receiver for at least the required price.
    const result = await verifyUsdcPayment(wallet, txHash);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    // Issue HMAC-signed cookie (30 days). Throws if PAYWALL_SECRET is unset.
    res.setHeader('Set-Cookie', buildUnlockCookie(wallet));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unlock error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
