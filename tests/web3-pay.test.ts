import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// Web3 Pay — encodeUSDCTransfer & ensureMainnet
// ═══════════════════════════════════════════════════════════════

describe('Web3 Pay — encodeUSDCTransfer', () => {
  it('encodes ERC-20 transfer calldata with correct selector', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const data = encodeUSDCTransfer('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as any, 3);
    expect(data.startsWith('0xa9059cbb')).toBe(true);
  });

  it('encodes 3 USDC correctly (3 * 10^6 = 3000000)', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const data = encodeUSDCTransfer('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as any, 3);
    const amountHex = (3000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });

  it('encodes 1 USDC correctly', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const data = encodeUSDCTransfer('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as any, 1);
    const amountHex = (1000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });

  it('encodes 10 USDC correctly (10 * 10^6 = 10000000)', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const data = encodeUSDCTransfer('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as any, 10);
    const amountHex = (10000000n).toString(16).padStart(64, '0');
    expect(data).toContain(amountHex);
  });

  it('calldata length is 138 chars (0x + 4 + 32 + 32)', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const data = encodeUSDCTransfer('0x94Ac0Cbf9188E31979Ad1434d86Cdc75ddBEc10c' as any, 3);
    expect(data.length).toBe(138);
  });

  it('encodes correct recipient address', async () => {
    const { encodeUSDCTransfer } = await import('../src/lib/web3/pay');
    const addr = '0x1234567890abcdef1234567890abcdef12345678' as any;
    const data = encodeUSDCTransfer(addr, 3);
    const addrHex = '0x1234567890abcdef1234567890abcdef12345678'.toLowerCase().replace('0x', '').padStart(64, '0');
    expect(data).toContain(addrHex);
  });

  it('exports PRICE_USDC = 3', async () => {
    const { PRICE_USDC } = await import('../src/lib/web3/pay');
    expect(PRICE_USDC).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// Web3 Pay — ensureMainnet
// ═══════════════════════════════════════════════════════════════

describe('Web3 Pay — ensureMainnet', () => {
  it('does nothing when already on mainnet (chainId 0x1)', async () => {
    const { ensureMainnet } = await import('../src/lib/web3/pay');
    const mockProvider = {
      request: vi.fn().mockResolvedValue('0x1'),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await expect(ensureMainnet(mockProvider)).resolves.not.toThrow();
    expect(mockProvider.request).toHaveBeenCalledWith({ method: 'eth_chainId' });
  });

  it('switches chain when on wrong network', async () => {
    const { ensureMainnet } = await import('../src/lib/web3/pay');
    const mockProvider = {
      request: vi.fn()
        .mockResolvedValueOnce('0x89')  // polygon
        .mockResolvedValueOnce(null),    // switch success
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await ensureMainnet(mockProvider);
    expect(mockProvider.request).toHaveBeenCalledWith({ method: 'eth_chainId' });
    expect(mockProvider.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }],
    });
  });

  it('throws when chain switch is rejected', async () => {
    const { ensureMainnet } = await import('../src/lib/web3/pay');
    const mockProvider = {
      request: vi.fn()
        .mockResolvedValueOnce('0x89')
        .mockRejectedValueOnce(new Error('User rejected')),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await expect(ensureMainnet(mockProvider)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// Web3 Pay — payThreeUsdc
// ═══════════════════════════════════════════════════════════════

describe('Web3 Pay — payThreeUsdc', () => {
  it('sends transaction and returns hash', async () => {
    const { payThreeUsdc } = await import('../src/lib/web3/pay');
    const expectedHash = '0x' + 'ab'.repeat(32) as any;
    const mockProvider = {
      request: vi.fn()
        .mockResolvedValueOnce('0x1')             // chainId = mainnet
        .mockResolvedValueOnce(['0xABC...123'])   // eth_requestAccounts
        .mockResolvedValueOnce(expectedHash),      // eth_sendTransaction
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const hash = await payThreeUsdc(mockProvider);
    expect(hash).toBe(expectedHash);
  });

  it('calls eth_chainId, eth_requestAccounts, and eth_sendTransaction', async () => {
    const { payThreeUsdc } = await import('../src/lib/web3/pay');
    const mockProvider = {
      request: vi.fn()
        .mockResolvedValueOnce('0x1')
        .mockResolvedValueOnce(['0xABC...123'])
        .mockResolvedValueOnce('0x' + 'cd'.repeat(32)),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await payThreeUsdc(mockProvider);
    expect(mockProvider.request).toHaveBeenCalledTimes(3);
    expect(mockProvider.request).toHaveBeenNthCalledWith(1, { method: 'eth_chainId' });
    expect(mockProvider.request).toHaveBeenNthCalledWith(2, { method: 'eth_requestAccounts' });
    expect(mockProvider.request).toHaveBeenNthCalledWith(3, {
      method: 'eth_sendTransaction',
      params: [{ to: expect.any(String), from: expect.any(String), data: expect.any(String) }],
    });
  });

  it('sends to USDC contract address', async () => {
    const { payThreeUsdc } = await import('../src/lib/web3/pay');
    const mockProvider = {
      request: vi.fn()
        .mockResolvedValueOnce('0x1')
        .mockResolvedValueOnce(['0xABC...123'])
        .mockResolvedValueOnce('0x' + 'cd'.repeat(32)),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await payThreeUsdc(mockProvider);
    const sendCall = mockProvider.request.mock.calls[2];
    expect(sendCall[0].params[0].to).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });
});

// ═══════════════════════════════════════════════════════════════
// Web3 Pay — Event Listeners
// ═══════════════════════════════════════════════════════════════

describe('Web3 Pay — onAccountsChanged', () => {
  it('registers and cleans up accountsChanged listener', async () => {
    const { onAccountsChanged } = await import('../src/lib/web3/pay');
    const handler = vi.fn();
    const mockProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const cleanup = onAccountsChanged(mockProvider, handler);
    expect(mockProvider.on).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
    cleanup();
    expect(mockProvider.removeListener).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
  });

  it('calls handler with null when accounts array is empty', async () => {
    const { onAccountsChanged } = await import('../src/lib/web3/pay');
    const handler = vi.fn();
    const mockProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    onAccountsChanged(mockProvider, handler);
    // Get the registered listener
    const listener = mockProvider.on.mock.calls[0][1];
    listener([]);  // empty accounts = disconnect
    expect(handler).toHaveBeenCalledWith(null);
  });

  it('calls handler with accounts when non-empty', async () => {
    const { onAccountsChanged } = await import('../src/lib/web3/pay');
    const handler = vi.fn();
    const mockProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    onAccountsChanged(mockProvider, handler);
    const listener = mockProvider.on.mock.calls[0][1];
    const accounts = ['0xABC', '0xDEF'];
    listener(accounts);
    expect(handler).toHaveBeenCalledWith(accounts);
  });
});

describe('Web3 Pay — onChainChanged', () => {
  it('registers and cleans up chainChanged listener', async () => {
    const { onChainChanged } = await import('../src/lib/web3/pay');
    const handler = vi.fn();
    const mockProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const cleanup = onChainChanged(mockProvider, handler);
    expect(mockProvider.on).toHaveBeenCalledWith('chainChanged', expect.any(Function));
    cleanup();
    expect(mockProvider.removeListener).toHaveBeenCalledWith('chainChanged', expect.any(Function));
  });

  it('calls handler when chain changes', async () => {
    const { onChainChanged } = await import('../src/lib/web3/pay');
    const handler = vi.fn();
    const mockProvider = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    onChainChanged(mockProvider, handler);
    const listener = mockProvider.on.mock.calls[0][1];
    listener('0x89');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
