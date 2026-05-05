import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const HMAC_SECRET = process.env.PAYWALL_SECRET || 'genesis-vault-hmac-secret-change-me';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { txHash, wallet } = req.body;

  if (!txHash || !wallet) {
    return res.status(400).json({ error: 'Missing txHash or wallet' });
  }

  // Validate input formats
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: 'Invalid txHash format' });
  }
  if (typeof wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet format' });
  }

  // Verify transaction on Ethereum mainnet
  try {
    const alchemyKey = process.env.ALCHEMY_API_KEY || '';
    const receipt = await fetch(
      `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        }),
      }
    ).then(r => r.json());

    if (!receipt.result) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = receipt.result;
    const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();

    // Verify: tx was sent to USDC contract, status success
    if (tx.to?.toLowerCase() !== USDC_CONTRACT || tx.status !== '0x1') {
      return res.status(400).json({ error: 'Invalid transaction' });
    }

    // Verify: recipient is our wallet
    const input = tx.input || '';
    if (input.length < 138) {
      return res.status(400).json({ error: 'Invalid transaction data' });
    }
    const recipient = '0x' + input.slice(34, 74);
    const EXPECTED_RECEIVER = (process.env.RECEIVE_WALLET || '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c').toLowerCase();
    if (recipient.toLowerCase() !== EXPECTED_RECEIVER) {
      return res.status(400).json({ error: 'Wrong recipient' });
    }

    // Verify: amount is 3 USDC (6 decimals = 3000000)
    const amountHex = '0x' + input.slice(74, 138);
    const amount = BigInt(amountHex);
    if (amount !== 3000000n) {
      return res.status(400).json({ error: 'Wrong amount' });
    }

    // Create signed token (HMAC-SHA256)
    const tokenPayload = JSON.stringify({
      paid: true,
      wallet: wallet.toLowerCase(),
      txHash,
      exp: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year validity
    });
    const token = Buffer.from(tokenPayload).toString('base64url');
    const sig = crypto.createHmac('sha256', HMAC_SECRET)
      .update(token)
      .digest('base64url');

    const cookie = `${token}.${sig}`;
    res.setHeader('Set-Cookie', `gv_token=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`);
    return res.status(200).json({ verified: true });

  } catch (err) {
    console.error('Payment verification error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
