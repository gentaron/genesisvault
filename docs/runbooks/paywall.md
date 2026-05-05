# Paywall Runbook

## Overview

The Genesis Vault paywall verifies 3 USDC Ethereum payments and grants access via HMAC-signed cookies. This runbook covers operational procedures.

## Required Secrets

| Secret | Location | Description |
|--------|----------|-------------|
| `PAYWALL_SECRET` | Vercel / GitHub Actions | HMAC-SHA256 signing key for cookie tokens |
| `ALCHEMY_API_KEY` | Vercel / GitHub Actions | Alchemy API key for Ethereum RPC calls |
| `RECEIVE_WALLET` | Vercel / GitHub Actions | Ethereum address receiving USDC payments |

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
All existing cookies will be invalidated. Paid users will need to verify their transaction again by visiting the home page and reconnecting their wallet. Consider notifying users before rotation.

## How to Verify a Payment Manually

### Check Transaction on Etherscan
1. Get the `txHash` from the user
2. Visit `https://etherscan.io/tx/{txHash}`
3. Verify:
   - Status: Success
   - To: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC contract)
   - Method: `transfer` (0xa9059cbb)
   - Recipient (decoded from input): matches `RECEIVE_WALLET`
   - Amount: 3 USDC (3,000,000 with 6 decimals)

### Verify via API
```bash
curl -X POST https://your-domain.vercel.app/api/verify-payment \
  -H "Content-Type: application/json" \
  -d '{"txHash":"0x...","wallet":"0x..."}'
```

Expected response:
```json
{"verified":true}
```

## How to Troubleshoot Failed Verifications

### Error: "Transaction not found"
- Transaction hasn't been mined yet (wait 1-2 minutes)
- Wrong network (user sent on testnet, not mainnet)
- Invalid txHash format

### Error: "Invalid transaction"
- Transaction was sent to wrong contract (not USDC)
- Transaction failed/reverted (status 0x0)
- User sent ETH instead of USDC

### Error: "Wrong recipient"
- USDC transfer was sent to wrong address
- Check `RECEIVE_WALLET` environment variable

### Error: "Wrong amount"
- User sent amount other than 3 USDC
- Decimal mismatch (USDC uses 6 decimals: 3000000 = 3 USDC)

## What to Do at 3 AM if the Paywall Breaks

### Step 1: Identify the Symptom

**Users can't unlock content after paying:**
1. Check Vercel function logs: `vercel logs --follow`
2. Look for errors in `/api/verify-payment`
3. Verify `ALCHEMY_API_KEY` is set and valid
4. Verify `PAYWALL_SECRET` hasn't been rotated without redeploying

**All users suddenly see locked content:**
1. Check if `PAYWALL_SECRET` was recently rotated (cookies invalidated)
2. Check Vercel deployment status
3. Temporarily disable paywall: set all content to free (change `FREE_LIMIT` to a high number)

**Payment verification returns 500:**
1. Check Alchemy API status: https://status.alchemy.com
2. Verify `ALCHEMY_API_KEY` quota hasn't been exceeded
3. Check Ethereum mainnet status

### Step 2: Quick Fix (Emergency)

If the API is completely down, the localStorage fallback in the client JS will still work. Users who have already paid and have localStorage set will retain access.

To restore full service:
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
2. Add monitoring/alerting for `/api/verify-payment` error rates
3. Consider adding a health check endpoint
