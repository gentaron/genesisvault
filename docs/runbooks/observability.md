# Observability Runbook

## 1. Checking Sentry for Errors

1. Go to [sentry.io](https://sentry.io) and log in
2. Select the **Genesis Vault** project
3. Check the **Issues** tab for unresolved errors
4. Key areas to monitor:
   - **Client-side errors**: JavaScript exceptions in the browser
   - **Performance**: Slow page loads (> 3s)
   - **Replays**: Session replays of errors (only captured on error)

**Free tier limits**: 5,000 errors/month. If exceeded, older errors are dropped.

## 2. Reading Plausible Analytics

1. Access the self-hosted Plausible dashboard (URL TBD — configure after deployment)
2. Key metrics to check:
   - **Unique visitors**: Daily/weekly trend
   - **Page views per session**: Engagement indicator
   - **Top pages**: Most-read articles
   - **Referrers**: Where traffic comes from (Nostr relays, direct, search)
   - **Bounce rate**: High bounce rate may indicate content quality issues

**Note**: Plausible is cookie-free and GDPR-compliant. No personal data is collected.

## 3. Rebuilding the Search Index

Run after adding new content or when search results seem stale:

```bash
# Full rebuild (build + search index)
npm run build

# Search index only (if site is already built)
npm run build:search
```

The index is generated in `dist/pagefind/` and served as static files.

**Common issues**:
- `pagefind` not found: Run `npm install` to install devDependencies
- Empty index: Ensure `dist/` contains the built site first

## 4. Healthcheck Failed at 3 AM

The healthcheck cron runs every 6 hours (00:00, 06:00, 12:00, 18:00 UTC).

### If site is DOWN:
1. Check [Vercel dashboard](https://vercel.com) for deployment status
2. Check recent deployments for build errors
3. Check GitHub Actions for failed auto-post jobs
4. Vercel may be experiencing an outage — check [Vercel Status](https://www.vercel-status.com)

### If latest post is missing:
1. Check GitHub Actions for the auto-post workflow run
2. Check Gemini API quota (free tier: 1,000 RPD for flash-lite)
3. Check `.pipeline-state.json` for stuck state — delete it to force a fresh run
4. Manually trigger the auto-post workflow

### If you want to temporarily disable healthcheck:
- The workflow has `workflow_dispatch` disabled by default
- To silence alerts, comment out the cron schedule in `.github/workflows/healthcheck.yml`
