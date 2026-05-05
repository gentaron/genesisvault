import { createPublicClient, http, type Address, type Hash } from 'viem';
import { mainnet } from 'viem/chains';
import { parseAbi, encodeFunctionData } from 'viem';

// USDC contract on Ethereum mainnet
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const RECEIVE_WALLET = '0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as Address;
const USDC_AMOUNT = 3n; // 3 USDC
const USDC_DECIMALS = 6n;
const REQUIRED_CONFIRMATIONS = 2;

// ERC-20 Transfer event topic (used in server-side paywall verification)
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

export function buildUSDCTransferData(to: Address, amount: number): `0x${string}` {
  const rawAmount = BigInt(amount) * 10n ** USDC_DECIMALS;
  return encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [to, rawAmount],
  });
}

export async function waitForConfirmation(txHash: Hash, maxAttempts = 40, intervalMs = 3000): Promise<boolean> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(),
  });

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (receipt) {
      if (receipt.status === 'reverted') return false;
      const currentBlock = await client.getBlockNumber();
      if (currentBlock - receipt.blockNumber + 1n >= BigInt(REQUIRED_CONFIRMATIONS)) {
        return true;
      }
    }
  }
  return false;
}

export async function getChainId(): Promise<number> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(),
  });
  return client.getChainId();
}

export { USDC_ADDRESS, RECEIVE_WALLET, USDC_AMOUNT, USDC_DECIMALS };
