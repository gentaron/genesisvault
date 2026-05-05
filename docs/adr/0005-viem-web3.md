# ADR-0005: viem for Web3 Type Safety

## Status
Accepted

## Context
The paywall logic in `src/pages/index.astro` (lines 83–340 inline script) uses raw `window.ethereum` calls with hand-rolled ERC-20 ABI encoding (`0xa9059cbb` + manual hex padding). This is fragile, untyped, and only supports MetaMask (via `window.ethereum`).

We need:
1. **Type-safe ABI encoding** — eliminate manual hex concatenation
2. **Multi-wallet support** — EIP-6963 so Brave Wallet, Coinbase Wallet, Rabby, etc. work
3. **Server-side tx verification** — the API route (`api/verify-payment/route.ts`) should use a robust client library

## Decision
### viem 2 over ethers.js v6
- **Tree-shaking**: viem exports individual functions; ethers bundles ~2 MB
- **Type-safe ABI**: `parseAbi()` + `encodeFunctionData()` catch encoding mistakes at compile time
- **No heavyweight BigNumber**: viem uses native `bigint`; ethers ships its own BigNumber class
- **EIP-6963 support**: viem ships `walletRepositories` helpers for multi-wallet discovery

### EIP-6963 for multi-wallet discovery
EIP-6963 defines a standard `window.addEventListener('eip6963:announceProvider')` event that all modern wallets emit. This means:
- No wallet-specific SDKs needed
- Users see all installed wallets in a picker
- No dependency on `window.ethereum` being injected by a single provider

### NOT using @reown/appkit (formerly WalletConnect Web3Modal)
AppKit/Web3Modal adds React dependencies and ~200 KB of JS. Since this is a vanilla JS Astro site with `<script is:inline>` blocks, it's too heavy. The EIP-6963 multi-wallet discovery can be done with ~50 lines of vanilla JS + viem for type-safe encoding.

## Consequences
- `src/lib/wallet.ts` provides `buildUSDCTransferData()`, `waitForConfirmation()`, and type-safe ABI constants
- Inline scripts remain untouched for now; migration to use viem client-side can happen in a future phase
- The API payment verification route (`api/verify-payment/route.ts`) will import from `src/lib/wallet.ts` for server-side validation
