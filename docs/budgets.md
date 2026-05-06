# Bundle Budget — Genesis Vault

## Current Measurements (Phase epsilon)

### Wallet / Web3 Bundle
| Module | Raw Size | Gzipped | Budget | Status |
|--------|----------|---------|--------|--------|
| wallet-ui (client) | 41.9 KB | 14.0 KB | ≤ 30 KB | PASS |

### How to Measure
```bash
cd /home/z/my-project/repos/genesisvault
bun run build
for f in dist/_astro/index.astro_astro_type_script_index_0_lang.*.js; do
  echo "$f: $(gzip -c "$f" | wc -c) bytes gzipped"
done
```

### Tree-Shaking Strategy (Applied)
The client bundle stays small by:
1. Using viem only for ABI encoding (`encodeFunctionData` + `parseAbi`) — tree-shakeable
2. Raw EIP-1193 provider calls for tx sending and chain switching — no viem WalletClient
3. Receipt polling via server-side viem PublicClient — not in client bundle
4. EIP-6963 discovery is pure vanilla JS — zero external dependencies

### If Over Budget
- Use `viem/chains` subpath for chain config
- Use `viem/utils` for specific utilities
- Avoid `createWalletClient` / `createPublicClient` in client code
- Move more logic to server-side API routes
