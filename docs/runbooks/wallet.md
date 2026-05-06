# Wallet Runbook — Phase epsilon

## Overview

The Genesis Vault wallet system uses **viem 2** for type-safe ABI encoding and **EIP-6963** for multi-wallet discovery. This replaces the previous MetaMask-only, hand-rolled ABI approach.

## Architecture (Phase epsilon)

```
Browser (wallet-ui.ts)
  ├─ EIP-6963: discovers installed wallets via announceProvider events
  ├─ Wallet Picker: modal UI showing all detected wallets
  ├─ viem WalletClient: sends type-safe USDC transfer
  └─ viem PublicClient: polls waitForTransactionReceipt

Server (wallet.ts + pay.ts)
  ├─ /api/unlock: verifies tx, sets HMAC cookie
  ├─ /api/article/[slug]: gated content behind cookie check
  └─ /api/unlock-legacy: migrates pre-phase-delta users
```

## EIP-6963 Multi-Wallet Discovery

### How It Works
1. On page load, `initWalletDiscovery()` dispatches `eip6963:requestProvider`
2. All installed wallets respond with `eip6963:announceProvider` events
3. Each wallet's `detail` includes: `{ uuid, name, icon, rdns }` and a provider
4. Wallets are deduplicated by UUID and sorted alphabetically by name
5. If multiple wallets are found, a picker modal is shown
6. If only one wallet is found, it connects automatically
7. If no wallets announce, falls back to `window.ethereum` (legacy MetaMask path)

### Supported Wallets
Any wallet implementing EIP-6963 works automatically. Known compatible wallets:
- **MetaMask** (11+)
- **Rabby**
- **Coinbase Wallet**
- **Brave Wallet**
- **Frame**
- **Phantom-EVM**
- **Rainbow**

### How to Add a New Wallet
**Do nothing.** EIP-6963 discovery is automatic. When a user installs a new wallet that supports EIP-6963, it will appear in the picker on their next visit.

### How to Deprecate the window.ethereum Fallback
Once EIP-6963 reaches saturation (all major wallets support it), remove the fallback block in `src/lib/web3/wallets.ts`:
```ts
// Remove this block:
const ethereum = (window as any).ethereum;
if (ethereum) { ... }
```
Monitor wallet connection failure rates before deprecating.

## How to Update the Receiver Address

### Option 1: Environment Variable (recommended)
Set `PUBLIC_RECEIVER_ADDRESS` in Vercel environment variables:
1. Vercel Dashboard → Project → Settings → Environment Variables
2. Add `PUBLIC_RECEIVER_ADDRESS` = `0xYourNewAddress`
3. Redeploy

### Option 2: Code Change
Update `RECEIVER_ADDRESS` in `src/lib/web3/pay.ts`:
```ts
const RECEIVER_ADDRESS: Address = '0xYourNewAddress';
```
CI redeploy required.

### Impact
Existing payment cookies remain valid. New payments go to the new address.

## viem-Based Payment Flow

### Transfer Encoding
```ts
import { encodeFunctionData, erc20Abi } from 'viem';

const data = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [receiverAddress, parseUnits('3', 6)],
});
```
This is type-safe: wrong function name or argument types cause compile errors.

### Chain Validation
Before sending, viem checks the wallet's chain ID. If not Ethereum mainnet (1), it prompts the wallet to switch chains. This provides better UX than a confusing "tx failed" error.

### Receipt Polling
```ts
const receipt = await client.waitForTransactionReceipt({
  hash,
  confirmations: 2,
  timeout: 120_000,
});
```
viem's polling backs off intelligently and handles RPC errors, replacing the previous 40-attempt × 3s manual loop.

## Account & Chain Change Reactivity

### accountsChanged
When the user switches accounts in their wallet, the UI updates immediately:
- If accounts array is empty → wallet disconnected, UI resets to connect button
- If accounts array changes → UI updates to show new address

### chainChanged
When the user switches chains, the page reloads to ensure UI consistency with the new network state.

## Bundle Size Management

The wallet/payment bundle must stay ≤ 30 KB gzipped. To audit:
```bash
bun run build
gzip -c dist/_astro/wallet*.js | wc -c
```

If over budget, use viem subpath imports:
```ts
import { mainnet } from 'viem/chains';        // Only chain config
import { parseUnits } from 'viem/utils';        // Only utility functions
import { encodeFunctionData } from 'viem';      // Core encoding
```
Avoid importing the entire `viem` namespace or `viem/actions`.

## Troubleshooting

### Wallet not appearing in picker
- Ensure the wallet extension is installed and enabled
- Check if the wallet supports EIP-6963 (most modern wallets do as of 2026)
- If the wallet is older, it may only support `window.ethereum` injection

### "Ethereum mainnetに切り替えてください" error
- User is on a different chain (Polygon, Arbitrum, etc.)
- The wallet should show a chain switch prompt
- If the user rejects the switch, this error is shown

### Payment succeeds but content stays locked
- Check `/api/unlock` logs for verification errors
- Verify the `PAYWALL_SECRET` matches between Vercel and GitHub Actions
- The tx may need more confirmations — wait a few seconds

### Previous sections in this runbook remain valid
See above sections for:
- PAYWALL_SECRET rotation
- Manual payment verification
- RPC connectivity checks
- Emergency rollback procedures
