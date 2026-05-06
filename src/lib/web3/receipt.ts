/**
 * Server-side receipt polling via viem
 *
 * Uses viem's `waitForTransactionReceipt` with intelligent backoff and
 * RPC error handling. This module is imported only by server-side code
 * (API routes, tests) to keep the client bundle small.
 *
 * @module receipt
 */

import {
  createPublicClient,
  http,
  type Hash,
} from 'viem';
import { mainnet } from 'viem/chains';

/** Minimum block confirmations before considering a tx final. */
const REQUIRED_CONFIRMATIONS = 2;

/** Timeout for receipt polling (2 minutes). */
const RECEIPT_TIMEOUT_MS = 120_000;

/**
 * Wait for a transaction to be confirmed with the required number of
 * block confirmations. Uses viem's `waitForTransactionReceipt` which
 * implements intelligent polling backoff and RPC error handling,
 * replacing the previous 40-attempt × 3s manual poll loop.
 *
 * @param hash - Transaction hash to monitor.
 * @returns `true` if confirmed, `false` if the transaction was reverted.
 */
export async function waitForConfirmation(hash: Hash): Promise<boolean> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(),
  });

  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: REQUIRED_CONFIRMATIONS,
      timeout: RECEIPT_TIMEOUT_MS,
    });

    return receipt.status === 'success';
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error(
        `\u30bf\u30a4\u30e0\u30a2\u30a6\u30c8: \u30c8\u30e9\u30f3\u30b6\u30af\u30b7\u30e7\u30f3\u3092\u624b\u52d5\u3067\u3054\u78ba\u8a8d\u304f\u3060\u3055\u3044\u3002(TX: ${hash.slice(0, 10)}...)`
      );
    }
    throw error;
  }
}

export { REQUIRED_CONFIRMATIONS };
