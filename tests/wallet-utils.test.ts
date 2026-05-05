import { describe, it, expect } from 'vitest';
import { buildUSDCTransferData, USDC_ADDRESS, RECEIVE_WALLET } from '../src/lib/wallet';

describe('Wallet Utilities', () => {
  it('encodes USDC transfer correctly', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    // ERC-20 transfer function selector
    expect(data.startsWith('0xa9059cbb')).toBe(true);
    // Total length: 4 (selector) + 64 (address padded) + 64 (amount padded) = 132 hex chars
    expect(data.length).toBe(138); // 0x prefix + 132
  });

  it('encodes correct recipient address', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    // Address should be padded to 32 bytes (64 hex chars) after selector
    const addressHex = RECEIVE_WALLET.toLowerCase().replace('0x', '').padStart(64, '0');
    expect(data).toContain(addressHex);
  });

  it('encodes correct USDC amount (3 USDC = 3000000 with 6 decimals)', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    const amountHex = (3000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });
});
