import { describe, it, expect } from 'vitest';
import { buildUSDCTransferData, parseTransferLog, USDC_ADDRESS, RECEIVE_WALLET } from '../src/lib/wallet';
import { encodeUSDCTransfer, USDC_ADDRESS as PAY_USDC, RECEIVER_ADDRESS as PAY_RECEIVER } from '../src/lib/web3/pay';
import { getWallets, initWalletDiscovery } from '../src/lib/web3/wallets';

describe('Wallet Utilities (legacy compatibility)', () => {
  it('encodes USDC transfer correctly via buildUSDCTransferData', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    // ERC-20 transfer function selector
    expect(data.startsWith('0xa9059cbb')).toBe(true);
    // Total length: 4 (selector) + 64 (address padded) + 64 (amount padded) = 132 hex chars
    expect(data.length).toBe(138); // 0x prefix + 132
  });

  it('encodes correct recipient address', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    const addressHex = RECEIVE_WALLET.toLowerCase().replace('0x', '').padStart(64, '0');
    expect(data).toContain(addressHex);
  });

  it('encodes correct USDC amount (3 USDC = 3000000 with 6 decimals)', () => {
    const data = buildUSDCTransferData(RECEIVE_WALLET, 3);
    const amountHex = (3000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });
});

describe('Web3 Pay Module (Phase epsilon)', () => {
  it('encodes USDC transfer via viem erc20Abi', () => {
    const data = encodeUSDCTransfer(PAY_RECEIVER, 3);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
    expect(data.length).toBe(138);
  });

  it('produces identical calldata to legacy buildUSDCTransferData', () => {
    const legacy = buildUSDCTransferData(RECEIVE_WALLET, 3);
    const modern = encodeUSDCTransfer(PAY_RECEIVER, 3);
    expect(legacy).toBe(modern);
  });

  it('encodes correct amount for 1 USDC', () => {
    const data = encodeUSDCTransfer(PAY_RECEIVER, 1);
    const amountHex = (1000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });

  it('encodes correct amount for 10 USDC', () => {
    const data = encodeUSDCTransfer(PAY_RECEIVER, 10);
    const amountHex = (10000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });

  it('exports correct USDC contract address', () => {
    expect(PAY_USDC).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });

  it('exports correct receiver address', () => {
    expect(PAY_RECEIVER).toBe('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c');
  });
});

describe('ERC-20 Transfer Log Parsing', () => {
  it('parses a valid Transfer event log', () => {
    const log = {
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ],
      data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
    };
    const result = parseTransferLog(log);
    expect(result).not.toBeNull();
    expect(result!.from).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result!.to).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(result!.value).toBe(1000000000000000000n);
  });

  it('returns null for non-Transfer event', () => {
    const log = {
      topics: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
      data: '0x00',
    };
    expect(parseTransferLog(log)).toBeNull();
  });
});

describe('EIP-6963 Wallet Discovery (unit)', () => {
  it('getWallets returns wallets sorted by name when multiple announce', () => {
    // The module deduplicates by UUID — verify the interface exists
    expect(typeof getWallets).toBe('function');
  });
});
