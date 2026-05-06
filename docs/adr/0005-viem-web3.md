# ADR-0005: viem 2 + EIP-6963 for Web3 Type Safety

## Status
Accepted (updated for Phase epsilon)

## Context
The paywall logic previously used raw `window.ethereum` calls with hand-rolled ERC-20 ABI encoding (`0xa9059cbb` + manual hex padding) and a 40-attempt × 3s manual `eth_getTransactionReceipt` poll. This was fragile, untyped, and only supported MetaMask (via `window.ethereum`).

We need:
1. **Type-safe ABI encoding** — eliminate manual hex concatenation
2. **Multi-wallet support** — EIP-6963 so Brave Wallet, Coinbase Wallet, Rabby, Frame, Phantom-EVM, Rainbow, etc. work without wallet-specific SDKs
3. **Server-side tx verification** — the API route (`/api/unlock`) uses a robust client library
4. **Intelligent receipt polling** — viem's `waitForTransactionReceipt` replaces the manual poll loop

## Decision
### viem 2 over ethers.js v6
- **Tree-shaking**: viem exports individual functions from subpaths (`viem/chains`, `viem/utils`); ethers bundles ~2 MB
- **Type-safe ABI**: `encodeFunctionData()` with `erc20Abi` catches encoding mistakes at compile time — no more `as` casts on user-facing types
- **No heavyweight BigNumber**: viem uses native `bigint`; ethers ships its own BigNumber class
- **Built-in polling**: `waitForTransactionReceipt` handles backoff, RPC errors, and timeout — replacing ~40 lines of manual polling with ~5 lines

### EIP-6963 for multi-wallet discovery
EIP-6963 defines a standard `window.addEventListener('eip6963:announceProvider')` event that all modern wallets emit. This means:
- No wallet-specific SDKs needed
- Users see all installed wallets in a picker modal
- No dependency on `window.ethereum` being injected by a single provider
- `window.ethereum` is kept only as a fallback for legacy extensions

### NOT using @reown/appkit (formerly WalletConnect Web3Modal)
AppKit/Web3Modal adds React dependencies and ~200 KB of JS. Since this is a vanilla JS Astro site, it's too heavy. The EIP-6963 multi-wallet discovery is done with ~80 lines of vanilla TS + viem for type-safe encoding.

### NOT using wagmi
wagmi is a React abstraction layer. We have no React. viem alone covers everything needed: wallet client creation, ABI encoding, chain switching, and receipt polling.

### NOT using ethers v6 or web3.js
- ethers v6: Ships ~2 MB bundle; BigNumber class; weaker tree-shaking
- web3.js: Callback-based API; no tree-shaking; large bundle

## Architecture (Phase epsilon)

```
src/lib/web3/
  wallets.ts     ← EIP-6963 discovery + deduplication
  pay.ts         ← viem WalletClient, encodeFunctionData, waitForTransactionReceipt

src/lib/wallet.ts        ← Server-side helpers (parseTransferLog, backward compat)
src/scripts/wallet-ui.ts ← Client-side bundled script (wallet picker, pay flow)
src/pages/index.astro    ← Uses <script src> to load wallet-ui.ts (not is:inline)
```

### Client-side flow
1. `initWalletDiscovery()` dispatches `eip6963:requestProvider`
2. Wallets announce via `eip6963:announceProvider` events
3. If >1 wallet: modal picker shown; if 1: auto-connect
4. `payThreeUsdc()` creates viem `WalletClient` → validates chain → sends tx
5. `waitForConfirmation()` polls via viem's `waitForTransactionReceipt`
6. Result verified server-side via `/api/unlock`

## Consequences
- `src/lib/web3/pay.ts` provides type-safe `payThreeUsdc()` and `waitForConfirmation()`
- `src/lib/web3/wallets.ts` provides EIP-6963 discovery with `window.ethereum` fallback
- `src/scripts/wallet-ui.ts` replaces the previous `is:inline` script in `index.astro`
- `window.ethereum` direct access removed from production code (only used as EIP-6963 fallback)
- Bundle budget: wallet/payment JS ≤ 30 KB gzipped (verified via `gzip -c`)
- All user-facing types in `src/lib/web3/` have no `as` casts
