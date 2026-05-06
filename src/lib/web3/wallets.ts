/**
 * EIP-6963 Multi-Wallet Discovery
 *
 * Implements the EIP-6963 standard for wallet discovery, replacing direct
 * `window.ethereum` access. Announced wallets are collected via the
 * `eip6963:announceProvider` event. If no wallets announce (legacy browsers,
 * older extensions), falls back to `window.ethereum`.
 *
 * @module wallets
 * @see https://eips.ethereum.org/EIPS/eip-6963
 */

export interface EIP6963ProviderDetail {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    removeListener(event: string, handler: (...args: unknown[]) => void): void;
    isMetaMask?: boolean;
  };
}

interface AnnounceProviderEvent extends Event {
  detail: EIP6963ProviderDetail;
}

/** In-memory store of announced wallet providers. */
const walletStore: EIP6963ProviderDetail[] = [];

/** Deduplication set keyed by wallet UUID. */
const seenUuids = new Set<string>();

/** Listener reference for cleanup. */
let announceListener: ((e: Event) => void) | null = null;

/**
 * Initialize EIP-6963 wallet discovery.
 * Must be called once, typically on page load. Dispatches `eip6963:requestProvider`
 * to prompt all injected wallets to announce themselves, then waits one tick for
 * responses to populate the store.
 */
export function initWalletDiscovery(): void {
  if (typeof window === 'undefined') return;

  announceListener = (event: Event) => {
    const detail = (event as AnnounceProviderEvent).detail;
    if (seenUuids.has(detail.info.uuid)) return;
    seenUuids.add(detail.info.uuid);
    walletStore.push(detail);
  };

  window.addEventListener('eip6963:announceProvider', announceListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/**
 * Clean up the EIP-6963 listener. Call on page unload or when wallet discovery
 * is no longer needed.
 */
export function destroyWalletDiscovery(): void {
  if (announceListener) {
    window.removeEventListener('eip6963:announceProvider', announceListener);
    announceListener = null;
  }
}

/**
 * Return all discovered wallets. If EIP-6963 found no wallets and a legacy
 * `window.ethereum` provider exists, return a single fallback entry.
 *
 * @returns Array of wallet provider details, sorted by name.
 */
export function getWallets(): EIP6963ProviderDetail[] {
  if (walletStore.length > 0) {
    return [...walletStore].sort((a, b) =>
      a.info.name.localeCompare(b.info.name)
    );
  }

  // Legacy fallback for browsers/extensions that don't support EIP-6963
  const ethereum = (window as unknown as { ethereum?: EIP6963ProviderDetail['provider'] }).ethereum;
  if (ethereum) {
    return [
      {
        info: {
          uuid: 'fallback-legacy',
          name: ethereum.isMetaMask ? 'MetaMask' : 'Browser Wallet',
          icon: '',
          rdns: 'unknown',
        },
        provider: ethereum,
      },
    ];
  }

  return [];
}

/**
 * Check if any wallet provider is available.
 */
export function hasWalletProvider(): boolean {
  return getWallets().length > 0;
}

/**
 * Get a single wallet by name. Useful for testing or forced wallet selection.
 *
 * @param name - The wallet's `info.name` field (case-insensitive).
 * @returns The wallet detail, or `undefined` if not found.
 */
export function getWalletByName(name: string): EIP6963ProviderDetail | undefined {
  const lowerName = name.toLowerCase();
  return getWallets().find((w) => w.info.name.toLowerCase() === lowerName);
}
