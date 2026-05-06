/**
 * Wallet utilities — Server-side & shared helpers
 *
 * This module provides server-safe wallet utilities used by API routes
 * and tests. The client-side payment flow (EIP-6963 discovery, viem
 * wallet client, receipt polling) lives in `src/lib/web3/pay.ts` and
 * `src/scripts/wallet-ui.ts`.
 *
 * @module wallet
 */

import { createPublicClient, http, type Address, type Hash } from 'viem';
import { mainnet } from 'viem/chains';
import { parseAbi, encodeFunctionData } from 'viem';

// Re-export new modular types for backward compatibility
export { USDC_ADDRESS, RECEIVER_ADDRESS as RECEIVE_WALLET, PRICE_USDC } from './web3/pay';
export type { WalletProvider } from './web3/pay';

// ─── Constants ─────────────────────────────────────────────────
const USDC_DECIMALS = 6n;
const REQUIRED_CONFIRMATIONS = 2;

// ─── ERC-20 Transfer Event (server-side paywall verification) ──
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;

/**
 * Parse an ERC-20 Transfer event log to extract from, to, and value.
 * Used by the server-side paywall to verify USDC transfers on-chain.
 */
export function parseTransferLog(log: { topics: string[]; data: string }): { from: Address; to: Address; value: bigint } | null {
  if (log.topics[0] !== ERC20_TRANSFER_TOPIC) return null;
  const from = ('0x' + log.topics[1].slice(26)) as Address;
  const to = ('0x' + log.topics[2].slice(26)) as Address;
  const value = BigInt(log.data);
  return { from, to, value };
}

export const USDC_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * Encode a USDC `transfer(to, amount)` calldata using viem's typed ABI.
 *
 * @deprecated Use `encodeUSDCTransfer` from `src/lib/web3/pay.ts` instead.
 * This export is kept for backward compatibility with existing tests and API routes.
 */
export function buildUSDCTransferData(to: Address, amount: number): `0x${string}` {
  const rawAmount = BigInt(amount) * 10n ** USDC_DECIMALS;
  return encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [to, rawAmount],
  });
}

export { USDC_DECIMALS, REQUIRED_CONFIRMATIONS };
