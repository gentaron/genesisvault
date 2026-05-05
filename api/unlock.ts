import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const RECEIVER = (process.env.RECEIVER_ADDRESS || '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c').toLowerCase();
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
const PRICE_USDC = 3000000n; // 3 USDC with 6 decimals

function makeRpcCall(method: string, params: unknown[]) {
  const rpcUrl = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  return fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then(r => r.json());
}

function hmacSign(data: string): string {
  const secret = process.env.PAYWALL_SECRET || 'change-me-in-production';
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

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
    // Step 1: Get transaction receipt
    const receiptResp = await makeRpcCall('eth_getTransactionReceipt', [txHash]);
    const receipt = receiptResp?.result;
    if (!receipt) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Step 2: Verify tx succeeded
    if (receipt.status !== '0x1') {
      return res.status(400).json({ error: 'Transaction failed' });
    }

    // Step 3: Verify tx targets USDC contract
    if (!receipt.to || receipt.to.toLowerCase() !== USDC) {
      return res.status(400).json({ error: 'Not a USDC transaction' });
    }

    // Step 4: Verify confirmations >= 2
    const blockResp = await makeRpcCall('eth_blockNumber', []);
    const currentBlock = BigInt(blockResp?.result || '0x0');
    const txBlock = BigInt(receipt.blockNumber);
    if (currentBlock - txBlock + 1n < 2n) {
      return res.status(400).json({ error: 'Insufficient confirmations (need 2)' });
    }

    // Step 5: Decode ERC-20 Transfer log to verify recipient and amount
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const transferLog = receipt.logs.find((log: any) => {
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
      return res.status(400).json({ error: 'Valid USDC transfer not found in logs' });
    }

    // Step 6: Issue HMAC-signed cookie (30 days)
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = `${wallet.toLowerCase()}.${expiry}`;
    const sig = hmacSign(payload);
    const cookieValue = `${payload}.${sig}`;

    res.setHeader('Set-Cookie', `gv_unlock=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unlock error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
