import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

function hmacSign(data: string): string {
  const secret = process.env.PAYWALL_SECRET || 'change-me-in-production';
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

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
    const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
    }).then(r => r.json());
    const receipt = resp?.result;
    if (!receipt || receipt.status !== '0x1') {
      return res.status(400).json({ error: 'Transaction not found or failed' });
    }

    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = `${wallet.toLowerCase()}.${expiry}`;
    const sig = hmacSign(payload);
    const cookieValue = `${payload}.${sig}`;

    res.setHeader('Set-Cookie', `gv_unlock=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`);
    return res.status(200).json({ migrated: true });
  } catch (err) {
    console.error('Legacy migration error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
