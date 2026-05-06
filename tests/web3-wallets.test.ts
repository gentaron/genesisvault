import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// EIP-6963 Wallet Discovery — initWalletDiscovery
// ═══════════════════════════════════════════════════════════════

describe('EIP-6963 Wallet Discovery — initWalletDiscovery', () => {
  beforeEach(() => {
    // Reset module state by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers announceProvider listener', async () => {
    const addEventListener = vi.fn();
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener,
      dispatchEvent,
    };

    const { initWalletDiscovery } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    expect(addEventListener).toHaveBeenCalledWith(
      'eip6963:announceProvider',
      expect.any(Function)
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eip6963:requestProvider' })
    );
  });

  it('collects announced wallets and deduplicates by UUID', async () => {
    const listeners: Map<string, Function> = new Map();
    const addEventListener = vi.fn((event: string, handler: Function) => {
      listeners.set(event, handler);
    });
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener,
      dispatchEvent,
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    // Simulate two wallets announcing
    const announceListener = listeners.get('eip6963:announceProvider')!;
    announceListener({
      detail: {
        info: { uuid: 'wallet-1', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
        provider: { request: vi.fn() },
      },
    });
    announceListener({
      detail: {
        info: { uuid: 'wallet-2', name: 'WalletConnect', icon: '', rdns: 'com.walletconnect' },
        provider: { request: vi.fn() },
      },
    });

    const wallets = getWallets();
    expect(wallets).toHaveLength(2);
  });

  it('ignores duplicate announcements by UUID', async () => {
    const listeners: Map<string, Function> = new Map();
    const addEventListener = vi.fn((event: string, handler: Function) => {
      listeners.set(event, handler);
    });
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener,
      dispatchEvent,
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    const announceListener = listeners.get('eip6963:announceProvider')!;
    const detail = {
      info: { uuid: 'same-wallet', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
      provider: { request: vi.fn() },
    };
    announceListener({ detail });
    announceListener({ detail }); // duplicate

    const wallets = getWallets();
    expect(wallets).toHaveLength(1);
  });

  it('no-op when window is undefined (SSR)', async () => {
    delete (globalThis as any).window;
    const { initWalletDiscovery } = await import('../src/lib/web3/wallets');
    expect(() => initWalletDiscovery()).not.toThrow();
  });

  it('sorts wallets by name alphabetically', async () => {
    const listeners: Map<string, Function> = new Map();
    const addEventListener = vi.fn((event: string, handler: Function) => {
      listeners.set(event, handler);
    });
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener,
      dispatchEvent,
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    const announceListener = listeners.get('eip6963:announceProvider')!;
    announceListener({
      detail: {
        info: { uuid: 'z', name: 'Zebra Wallet', icon: '', rdns: 'z' },
        provider: { request: vi.fn() },
      },
    });
    announceListener({
      detail: {
        info: { uuid: 'a', name: 'Alpha Wallet', icon: '', rdns: 'a' },
        provider: { request: vi.fn() },
      },
    });

    const wallets = getWallets();
    expect(wallets[0].info.name).toBe('Alpha Wallet');
    expect(wallets[1].info.name).toBe('Zebra Wallet');
  });
});

// ═══════════════════════════════════════════════════════════════
// EIP-6963 Wallet Discovery — destroyWalletDiscovery
// ═══════════════════════════════════════════════════════════════

describe('EIP-6963 Wallet Discovery — destroyWalletDiscovery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('removes the announceProvider listener', async () => {
    const listeners: Map<string, Function> = new Map();
    const addEventListener = vi.fn((event: string, handler: Function) => {
      listeners.set(event, handler);
    });
    const removeEventListener = vi.fn();
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener,
      removeEventListener,
      dispatchEvent,
    };

    const { initWalletDiscovery, destroyWalletDiscovery } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    destroyWalletDiscovery();

    expect(removeEventListener).toHaveBeenCalledWith(
      'eip6963:announceProvider',
      expect.any(Function)
    );
  });

  it('does not throw when called without init', async () => {
    const { destroyWalletDiscovery } = await import('../src/lib/web3/wallets');
    expect(() => destroyWalletDiscovery()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// EIP-6963 Wallet Discovery — getWallets fallback
// ═══════════════════════════════════════════════════════════════

describe('EIP-6963 Wallet Discovery — getWallets fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('falls back to window.ethereum if no EIP-6963 wallets announced', async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent,
      ethereum: {
        request: vi.fn(),
        isMetaMask: true,
      },
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    // No announce events fired

    const wallets = getWallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0].info.name).toBe('MetaMask');
    expect(wallets[0].info.uuid).toBe('fallback-legacy');
  });

  it('uses "Browser Wallet" name for non-MetaMask providers', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      ethereum: {
        request: vi.fn(),
      },
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    const wallets = getWallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0].info.name).toBe('Browser Wallet');
  });

  it('returns empty array when no wallets available', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      // no ethereum property
    };

    const { initWalletDiscovery, getWallets } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();

    const wallets = getWallets();
    expect(wallets).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// EIP-6963 Wallet Discovery — hasWalletProvider
// ═══════════════════════════════════════════════════════════════

describe('EIP-6963 Wallet Discovery — hasWalletProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns true when wallets are available', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      ethereum: { request: vi.fn() },
    };

    const { initWalletDiscovery, hasWalletProvider } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    expect(hasWalletProvider()).toBe(true);
  });

  it('returns false when no wallets available', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    const { initWalletDiscovery, hasWalletProvider } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    expect(hasWalletProvider()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// EIP-6963 Wallet Discovery — getWalletByName
// ═══════════════════════════════════════════════════════════════

describe('EIP-6963 Wallet Discovery — getWalletByName', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('finds wallet by exact name (case-insensitive)', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      ethereum: { request: vi.fn(), isMetaMask: true },
    };

    const { initWalletDiscovery, getWalletByName } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    const wallet = getWalletByName('metamask');
    expect(wallet).toBeDefined();
    expect(wallet!.info.name).toBe('MetaMask');
  });

  it('returns undefined for non-existent wallet', async () => {
    (globalThis as any).window = {
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      ethereum: { request: vi.fn() },
    };

    const { initWalletDiscovery, getWalletByName } = await import('../src/lib/web3/wallets');
    initWalletDiscovery();
    const wallet = getWalletByName('NonExistent Wallet');
    expect(wallet).toBeUndefined();
  });
});
