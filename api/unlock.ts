import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildUnlockCookie, verifyUsdcPayment, isAllowedWallet } from './_lib/paywall';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet, txHash } = req.body;
  if (!wallet) {
    return res.status(400).json({ error: 'Missing wallet' });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  // Whitelisted wallet: unlock without payment
  if (isAllowedWallet(wallet)) {
    try {
      res.setHeader('Set-Cookie', buildUnlockCookie(wallet));
    } catch (err) {
      console.error('Cookie signing failed (PAYWALL_SECRET misconfigured?):', err);
      return res.status(500).json({ error: 'Server configuration error: PAYWALL_SECRET not set' });
    }
    return res.status(200).json({ ok: true, method: 'whitelist' });
  }

  // Non-whitelisted wallets: require USDC payment
  if (!txHash) {
    return res.status(400).json({ error: 'Missing txHash' });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash' });
  }

  try {
    const result = await verifyUsdcPayment(wallet, txHash);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    res.setHeader('Set-Cookie', buildUnlockCookie(wallet));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unlock error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
