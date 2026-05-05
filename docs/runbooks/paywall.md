# Paywall Runbook

## Overview

The Genesis Vault paywall verifies 3 USDC Ethereum payments and grants access via HMAC-signed cookies. This runbook covers operational procedures for the Phase δ implementation.

## Architecture (Phase δ)

```
Browser → POST /api/unlock (verify tx, set cookie)
Browser → GET /api/article/[slug] (return body if cookie valid)
Browser → POST /api/unlock-legacy (migrate old localStorage users)
```

## Required Secrets

| Secret | Location | Description |
|--------|----------|-------------|
| `PAYWALL_SECRET` | Vercel / GitHub Actions | HMAC-SHA256 signing key for `gv_unlock` cookie |
| `ETH_RPC_URL` | Vercel / GitHub Actions | Ethereum RPC URL (defaults to publicnode.com) |
| `RECEIVER_ADDRESS` | Vercel / GitHub Actions | Ethereum address receiving USDC payments |

## How to Rotate PAYWALL_SECRET

### Step 1: Generate New Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Update Vercel
1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Update `PAYWALL_SECRET` with the new value
3. Redeploy: `vercel --prod`

### Step 3: Update GitHub Actions
1. Go to GitHub → Repo → Settings → Secrets and variables → Actions
2. Update `PAYWALL_SECRET`

### Impact
All existing `gv_unlock` cookies will be invalidated. Paid users will need to re-verify their transaction by visiting the home page and reconnecting their wallet. The `/api/unlock-legacy` endpoint will automatically re-migrate users who still have localStorage entries.

## How to Verify a Payment Manually

### Check Transaction on Etherscan
1. Get the `txHash` from the user
2. Visit `https://etherscan.io/tx/{txHash}`
3. Verify:
   - Status: Success
   - To: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC contract)
   - In the "Logs" section: Transfer event with `from` = user wallet, `to` = `RECEIVER_ADDRESS`, `value` = 3000000 (3 USDC)

### Verify via API
```bash
curl -X POST https://your-domain.vercel.app/api/unlock \
  -H "Content-Type: application/json" \
  -d '{"txHash":"0x...","wallet":"0x..."}'
```

Expected response:
```json
{"ok":true}
```
Check the `Set-Cookie` header in the response for the `gv_unlock` cookie.

## How to Troubleshoot Failed Verifications

### Error: "Transaction not found"
- Transaction hasn't been mined yet (wait 1-2 minutes)
- Wrong network (user sent on testnet, not mainnet)
- Invalid txHash format

### Error: "Transaction failed"
- Transaction was reverted on-chain (status 0x0)
- User may have insufficient gas or USDC balance

### Error: "Not a USDC transaction"
- Transaction was sent to wrong contract (not USDC)
- User sent ETH instead of USDC

### Error: "Insufficient confirmations (need 2)"
- Transaction was just mined; wait a few seconds for second confirmation
- Try again after ~15 seconds

### Error: "Valid USDC transfer not found in logs"
- USDC transfer was sent to wrong recipient address
- Amount was less than 3 USDC
- Check `RECEIVER_ADDRESS` environment variable

### Error: "Payment required" (402 on /api/article/[slug])
- User's `gv_unlock` cookie is missing or expired
- Cookie was set with different `PAYWALL_SECRET` (after rotation)
- User needs to pay again or re-verify via `/api/unlock-legacy`

## How to Debug a Failed Unlock

### Step 1: Check the cookie exists
```bash
# In browser DevTools → Application → Cookies
# Look for gv_unlock cookie
```

### Step 2: Check the cookie format
The cookie should be: `wallet_lowercase.timestamp.hmac_signature`
Example: `0xabc...123.1746528000000.aBcDeF...`

### Step 3: Check RPC connectivity
```bash
curl -X POST https://ethereum-rpc.publicnode.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

### Step 4: Check server logs
```bash
vercel logs --follow
```

## Legacy Migration Procedure

Users who paid before Phase δ may have payment data in `localStorage` (`gv_paid_status`). The migration flow:

1. On page load, `index.astro` checks: `!isServerPaid() && isLocalPaid()`
2. If true, it POSTs to `/api/unlock-legacy` with the stored `txHash` and `wallet`
3. The server verifies the transaction on-chain (simpler check than `/api/unlock`)
4. If valid, server sets `gv_unlock` cookie, client clears `localStorage`
5. On next page load, user is authenticated via cookie

### Manual migration (if auto-migration fails)
Users can re-verify by connecting their wallet and visiting the home page. The payment transaction is still valid on-chain; they just need to re-trigger the verification.

## What to Do at 3 AM if the Paywall Breaks

### Step 1: Identify the Symptom

**Users can't unlock content after paying:**
1. Check Vercel function logs: `vercel logs --follow`
2. Look for errors in `/api/unlock`
3. Verify `PAYWALL_SECRET` is set and matches between Vercel and GitHub Actions
4. Verify `ETH_RPC_URL` is reachable

**All users suddenly see locked content:**
1. Check if `PAYWALL_SECRET` was recently rotated (cookies invalidated)
2. Check Vercel deployment status
3. Users will be auto-migrated on next visit if they have localStorage entries

**Gated article page shows gate UI but fetch returns 402:**
1. Check that user has `gv_unlock` cookie
2. Check that cookie hasn't expired (30 days)
3. Verify `PAYWALL_SECRET` hasn't changed since cookie was issued

**Payment verification returns 500:**
1. Check Ethereum RPC status
2. Verify `ETH_RPC_URL` is accessible
3. Check Ethereum mainnet status

### Step 2: Quick Fix (Emergency)

If the API is completely down, free articles (newest 2) are still statically served and accessible. To restore full service:

```bash
# Check recent deployments
vercel ls

# Rollback to last working deployment
vercel rollback <deployment-url>
```

### Step 3: Notify Users

If extended downtime is expected:
1. Post a notice on the blog (free content area)
2. Update the paywall card text to indicate maintenance

### Step 4: Post-Incident

1. Document root cause in this runbook
2. Add monitoring/alerting for `/api/unlock` error rates
3. Consider adding a health check endpoint
