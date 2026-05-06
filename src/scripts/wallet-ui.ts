/**
 * Wallet UI — Client-side wallet connection and payment flow.
 *
 * This module runs in the browser (bundled by Astro/Vite) and implements:
 * - EIP-6963 multi-wallet discovery and picker UI
 * - viem-based USDC payment (type-safe ABI encoding)
 * - viem-based receipt polling (intelligent backoff)
 * - Chain validation and auto-switch
 * - Account/chain change reactivity
 *
 * Replaces the previous `is:inline` script that used raw `window.ethereum`
 * calls with hand-rolled ABI encoding.
 *
 * @module scripts/wallet-ui
 */

import {
  initWalletDiscovery,
  destroyWalletDiscovery,
  getWallets,
  type EIP6963ProviderDetail,
} from '../lib/web3/wallets';
import {
  payThreeUsdc,
  onAccountsChanged,
  onChainChanged,
  type WalletProvider,
} from '../lib/web3/pay';

// ─── Constants ─────────────────────────────────────────────────
const STORAGE_KEY = 'gv_paid_status';
const FREE_LIMIT = 2;
const MAINNET_CHAIN_ID = '0x1';

// ─── State ─────────────────────────────────────────────────────
let paymentInProgress = false;
let currentProvider: WalletProvider | null = null;
let currentAccount: string | null = null;
let currentCleanupFns: (() => void)[] = [];

// ─── Helpers ───────────────────────────────────────────────────

function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidTxHash(hash: unknown): hash is string {
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash);
}

function isServerPaid(): boolean {
  return document.cookie.indexOf('gv_unlock=') !== -1;
}

function isLocalPaid(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return (
      d.paid === true &&
      isValidTxHash(d.txHash) &&
      isValidAddress(d.wallet) &&
      typeof d.timestamp === 'number' &&
      d.chain === 'ethereum'
    );
  } catch {
    return false;
  }
}

function isPaid(): boolean {
  return isServerPaid() || isLocalPaid();
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Payment Logic ─────────────────────────────────────────────

function showPayError(payBtn: HTMLElement | null, errEl: HTMLElement | null, msg: string): void {
  paymentInProgress = false;
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = '';
  }
  if (payBtn) {
    payBtn.textContent = '3 USDC \u3067\u5168\u30b3\u30f3\u30c6\u30f3\u30c4\u3092\u30a2\u30f3\u30ed\u30c3\u30af';
    payBtn.disabled = false;
  }
}

async function markPaid(wallet: string, txHash: string): Promise<void> {
  if (!isValidTxHash(txHash) || !isValidAddress(wallet)) return;

  try {
    const response = await fetch('/api/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, wallet }),
    });

    const data = await response.json();

    if (data.ok) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          paid: true,
          wallet: wallet.toLowerCase(),
          chain: 'ethereum',
          txHash,
          timestamp: Date.now(),
        })
      );
      applyPaywall();
    } else {
      const payBtn = document.getElementById('btn-pay');
      const errEl = document.getElementById('pay-error');
      showPayError(payBtn, errEl, `\u30b5\u30fc\u30d0\u30fc\u691c\u8a3c\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${data.error || '\u4e0d\u660e\u306a\u30a8\u30e9\u30fc'}`);
    }
  } catch {
    const payBtn = document.getElementById('btn-pay');
    const errEl = document.getElementById('pay-error');
    showPayError(payBtn, errEl, '\u30b5\u30fc\u30d0\u30fc\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3002\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u3092\u78ba\u8a8d\u3057\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
  }
}

async function handlePayment(addr: string): Promise<void> {
  if (paymentInProgress || !currentProvider) return;

  const payBtn = document.getElementById('btn-pay');
  const errEl = document.getElementById('pay-error');
  if (!payBtn || !errEl) return;

  paymentInProgress = true;
  errEl.style.display = 'none';
  payBtn.textContent = '\u51e6\u7406\u4e2d...';
  payBtn.disabled = true;

  try {
    // Step 1: Send the USDC transfer via viem
    payBtn.textContent = '\u30c8\u30e9\u30f3\u30b6\u30af\u30b7\u30e7\u30f3\u9001\u4fe1\u4e2d...';
    const hash = await payThreeUsdc(currentProvider);

    if (!isValidTxHash(hash)) {
      showPayError(payBtn, errEl, '\u30a6\u30a9\u30ec\u30c3\u30c8\u304b\u3089\u7121\u52b9\u306a\u5fdc\u7b54\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f\u3002\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
      return;
    }

    // Step 2: Server-side verification (receipt polling happens server-side via viem)
    payBtn.textContent = '\u30d6\u30ed\u30c3\u30af\u78ba\u8a8d\u4e2d... (\u6570\u5206\u304b\u304b\u308b\u5834\u5408\u304c\u3042\u308a\u307e\u3059)';
    await markPaid(addr, hash);
    paymentInProgress = false;
    applyPaywall();
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        showPayError(payBtn, errEl, '\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f\u3002');
      } else {
        showPayError(payBtn, errEl, err.message);
      }
    } else {
      showPayError(payBtn, errEl, '\u9001\u91d1\u51e6\u7406\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
    }
  }
}

// ─── Wallet Event Reactivity (ε.7) ─────────────────────────────

function setupWalletListeners(provider: WalletProvider): void {
  // Clean up previous listeners
  currentCleanupFns.forEach((fn) => fn());
  currentCleanupFns = [];

  // Account changes
  const removeAccounts = onAccountsChanged(provider, (accounts) => {
    if (!accounts) {
      // User disconnected their wallet — clear state and reset UI
      currentProvider = null;
      currentAccount = null;
      currentCleanupFns.forEach((fn) => fn());
      currentCleanupFns = [];
      renderConnectButton();
    } else if (accounts[0]) {
      currentAccount = accounts[0];
      renderWalletPanel(accounts[0]);
    }
  });
  currentCleanupFns.push(removeAccounts);

  // Chain changes — reload to ensure UI consistency
  const removeChain = onChainChanged(provider, () => {
    location.reload();
  });
  currentCleanupFns.push(removeChain);
}

// ─── UI Rendering ──────────────────────────────────────────────

function renderConnectButton(): void {
  const walletArea = document.getElementById('wallet-area');
  if (!walletArea) return;

  walletArea.innerHTML = `
    <button id="btn-connect" class="gv-btn-connect">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M22 10H18C16.9 10 16 10.9 16 12C16 13.1 16.9 14 18 14H22" />
      </svg>
      \u30a6\u30a9\u30ec\u30c3\u30c8\u3092\u63a5\u7d9a
    </button>
  `;

  document.getElementById('btn-connect')?.addEventListener('click', handleConnectClick);
}

function renderWalletPanel(addr: string): void {
  const walletArea = document.getElementById('wallet-area');
  if (!walletArea) return;

  const short = shortAddress(addr);
  walletArea.innerHTML = `
    <div class="gv-wallet-panel">
      <div class="gv-wallet-info">
        <span class="gv-wallet-dot"></span>
        <span class="gv-wallet-addr">${short}</span>
        <button id="btn-disconnect" class="gv-btn-small">Disconnect</button>
      </div>
      <div class="gv-wallet-card-divider"></div>
      <button id="btn-pay" class="gv-btn-pay">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        3 USDC \u3067\u5168\u30b3\u30f3\u30c6\u30f3\u30c4\u3092\u30a2\u30f3\u30ed\u30c3\u30af
      </button>
      <p id="pay-error" class="gv-error" style="display:none;"></p>
    </div>
  `;

  document.getElementById('btn-disconnect')?.addEventListener('click', () => {
    currentProvider = null;
    currentAccount = null;
    currentCleanupFns.forEach((fn) => fn());
    currentCleanupFns = [];
    renderConnectButton();
  });

  document.getElementById('btn-pay')?.addEventListener('click', () => {
    handlePayment(addr);
  });
}

// ─── Wallet Picker (ε.3) ───────────────────────────────────────

function renderWalletPicker(wallets: EIP6963ProviderDetail[]): void {
  // If only one wallet, connect directly without showing picker
  if (wallets.length === 1) {
    connectToWallet(wallets[0]);
    return;
  }

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'gv-wallet-picker-overlay';
  overlay.className = 'gv-wallet-picker-overlay';
  overlay.innerHTML = `
    <div class="gv-wallet-picker-modal">
      <div class="gv-wallet-picker-header">
        <h3 class="gv-wallet-picker-title">\u30a6\u30a9\u30ec\u30c3\u30c8\u3092\u9078\u629e</h3>
        <button id="gv-wallet-picker-close" class="gv-wallet-picker-close" aria-label="\u9589\u3058\u308b">&times;</button>
      </div>
      <div class="gv-wallet-picker-list">
        ${wallets
          .map(
            (w, i) => `
          <button class="gv-wallet-picker-item" data-wallet-index="${i}">
            ${w.info.icon ? `<img src="${w.info.icon}" alt="${w.info.name}" class="gv-wallet-picker-icon" width="32" height="32" />` : '<div class="gv-wallet-picker-icon-placeholder"></div>'}
            <span class="gv-wallet-picker-name">${w.info.name}</span>
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  document.getElementById('gv-wallet-picker-close')?.addEventListener('click', () => {
    overlay.remove();
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Wallet selection
  overlay.querySelectorAll('.gv-wallet-picker-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number((btn as HTMLElement).dataset.walletIndex);
      overlay.remove();
      if (wallets[idx]) {
        connectToWallet(wallets[idx]);
      }
    });
  });
}

async function connectToWallet(wallet: EIP6963ProviderDetail): Promise<void> {
  try {
    const accounts = (await wallet.provider.request({
      method: 'eth_requestAccounts',
    })) as string[];

    if (!accounts || accounts.length === 0) return;

    const addr = accounts[0];
    if (!isValidAddress(addr)) {
      alert('\u30a6\u30a9\u30ec\u30c3\u30c8\u304b\u3089\u7121\u52b9\u306a\u30a2\u30c9\u30ec\u30b9\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f\u3002');
      return;
    }

    currentProvider = wallet.provider as WalletProvider;
    currentAccount = addr;
    renderWalletPanel(addr);
    setupWalletListeners(wallet.provider as WalletProvider);
  } catch (err: unknown) {
    if (err instanceof Error && err.code !== 4001) {
      alert('\u30a6\u30a9\u30ec\u30c3\u30c8\u63a5\u7d9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
    }
  }
}

function handleConnectClick(): void {
  const wallets = getWallets();
  if (wallets.length === 0) {
    alert('MetaMask\u306a\u3069\u306eEthereum\u5bfe\u5fdc\u30a6\u30a9\u30ec\u30c3\u30c8\u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u304f\u3060\u3055\u3044\u3002');
    return;
  }

  renderWalletPicker(wallets);
}

// ─── Paywall Logic ─────────────────────────────────────────────

function applyPaywall(): void {
  const paid = isPaid();
  const items = document.querySelectorAll('.gv-post-item');
  let lockedCount = 0;

  items.forEach((item, i) => {
    if (!paid && i >= FREE_LIMIT) {
      (item as HTMLElement).style.display = 'none';
      lockedCount++;
    } else {
      (item as HTMLElement).style.display = '';
    }
  });

  const lockedSection = document.getElementById('locked-section');
  const lockedCountEl = document.getElementById('locked-count');
  if (!paid && lockedCount > 0 && lockedSection && lockedCountEl) {
    lockedCountEl.textContent = String(lockedCount);
    lockedSection.style.display = '';
  } else if (lockedSection) {
    lockedSection.style.display = 'none';
  }

  const walletArea = document.getElementById('wallet-area');
  if (paid && walletArea) {
    walletArea.innerHTML = `
      <div class="gv-wallet-paid">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        \u5168\u30b3\u30f3\u30c6\u30f3\u30c4\u30a2\u30af\u30bb\u30b9\u6e08\u307f
      </div>
    `;
  }
}

// ─── Legacy Migration ──────────────────────────────────────────

function attemptLegacyMigration(): void {
  if (isServerPaid() || !isLocalPaid()) return;

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored?.txHash && stored?.wallet) {
      fetch('/api/unlock-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: stored.txHash, wallet: stored.wallet }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.migrated) {
            localStorage.removeItem(STORAGE_KEY);
            applyPaywall();
          }
        })
        .catch(() => {
          /* silently fail */
        });
    }
  } catch {
    /* silently fail */
  }
}

// ─── Initialization ────────────────────────────────────────────

function init(): void {
  // Initialize EIP-6963 wallet discovery
  initWalletDiscovery();

  // Set up connect button handler
  renderConnectButton();

  // Sync server cookie → localStorage cache
  if (isServerPaid() && !isLocalPaid()) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        paid: true,
        wallet: '',
        chain: 'ethereum',
        txHash: '',
        timestamp: Date.now(),
        serverVerified: true,
      })
    );
  }

  // Legacy migration
  attemptLegacyMigration();

  // Apply paywall visibility
  applyPaywall();

  // Cleanup on page unload
  document.addEventListener('astro:before-swap', () => {
    destroyWalletDiscovery();
    currentCleanupFns.forEach((fn) => fn());
  });
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
