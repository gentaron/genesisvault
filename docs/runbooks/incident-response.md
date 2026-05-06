# Incident Response Runbook

## When Something Breaks at 3 AM

This document covers the immediate response procedures for all failure modes
detected by the Phase η observability stack.

---

## 1. Healthcheck Failed

**Detection**: GitHub issue auto-created by `.github/workflows/healthcheck.yml`
**Frequency**: Every 6 hours (00:30, 06:30, 12:30, 18:30 UTC)

### 1a. Site is DOWN (HTTP non-200)

1. Check [Cloudflare Pages status](https://www.cloudflarestatus.com/)
2. Check recent deployments in the Cloudflare dashboard
3. Check GitHub Actions for failed builds
4. If Cloudflare is having an outage: wait. Nothing to do.
5. If a deployment failed: check the build logs for errors
6. Manual recovery: `git pull && bun run build && bun run deploy`

### 1b. Latest Article is Stale (> 36h old)

1. Check the [daily-post workflow](https://github.com/gentaron/genesisvault/actions/workflows/daily-post.yml)
2. If the workflow failed:
   - Check AI provider API keys (rate limits exceeded?)
   - Check `.pipeline-state.json` for stuck state — delete it and re-run
   - Manually trigger the workflow: "Run workflow" button
3. If the workflow didn't run at all:
   - Check GitHub Actions status page for platform issues
   - Verify the cron schedule is still active

### 1c. Paywall Gate Returning Non-402

1. Check Vercel serverless function logs for `/api/article/`
2. Verify `PAYWALL_SECRET` environment variable is set
3. Check recent deployments — a deployment may have changed the API code
4. Test manually: `curl -s -o /dev/null -w "%{http_code}" https://genesisvault.vercel.app/api/article/2026-05-01-walking-meditation`

---

## 2. Sentry Alert Fired

**Detection**: Email notification from Sentry (free tier alerts)

### 2a. AI Pipeline Exception (`src/lib/ai/**`)

This is the most common and most critical alert. It means the daily auto-post
pipeline encountered an error that the fallback chain couldn't handle.

**Immediate actions**:
1. Open the Sentry issue and read the stack trace
2. Check which provider failed (usually Gemini rate limit)
3. Check the [daily-post workflow run](https://github.com/gentaron/genesisvault/actions/workflows/daily-post.yml)
4. If it's a transient rate limit: the pipeline should have fallen back. If it didn't,
   check `logs/agent-runs.jsonl` for the specific error
5. Manual fix: trigger the daily-post workflow manually

**Common causes**:
| Error | Cause | Fix |
|-------|-------|-----|
| `429 Too Many Requests` | Gemini RPD exceeded | No fix needed — fallback chain handles it |
| `500 Internal Server Error` | Provider outage | No fix needed — fallback chain handles it |
| `FALLBACK_EXHAUSTED` | All 6 providers failed | Check all API keys; manual re-run |
| `Pipeline validation failed` | AI returned malformed output | Re-run; fallback template should activate |

### 2b. API Exception (`api/**` or `src/pages/api/**`)

1. Check the Sentry issue for the specific endpoint and error
2. Common causes:
   - **unlock API**: Invalid HMAC signature → possible `PAYWALL_SECRET` mismatch
   - **article API**: Missing or expired cookie → normal 402 behavior (should be ignored)
   - **unlock-legacy API**: Edge case in migration logic
3. If `PAYWALL_SECRET` is compromised: rotate it immediately (see paywall runbook)

### 2c. Client-Side Exception

1. Check the Sentry issue for the browser, OS, and URL
2. Common causes:
   - `wallet-ui.ts`: Web3 provider not available → normal for non-Web3 browsers
   - Pagefind load failure → CDN issue, usually transient
3. If it's a new error affecting multiple users: investigate and fix promptly

---

## 3. Daily Post Didn't Ship

**Detection**: Scheduled-post-verify workflow creates a GitHub issue

### Recovery steps:

```bash
# 1. Check for stuck pipeline state
cat .pipeline-state.json
# If exists and dated today: delete it
rm .pipeline-state.json

# 2. Dry-run to test the pipeline
DRY_RUN=true bun scripts/auto-post.mjs

# 3. If dry-run succeeds, run for real
bun scripts/auto-post.mjs

# 4. Commit and push
git add src/content/posts/*.md docs/agent-runs/
git commit -m "Manual post: $(date +'%Y-%m-%d') — Multi-Agent AI Pipeline"
git push
```

### If the pipeline keeps failing:

1. Check AI provider rate limits:
   - Gemini: 1,000 RPD (flash-lite), 250 RPD (flash)
   - Groq: ~14,400 RPD
   - All free-tier providers share a "daily budget" that resets at midnight Pacific
2. If all providers are exhausted: the fallback template will be used automatically
3. If the fallback template is also failing: check `src/lib/agents/shared.ts` for
   `FALLBACK_BODIES` — at least one must exist

---

## 4. Search (Pagefind) Not Working

**Symptoms**: Cmd+K shows "検索インデックスの読み込みに失敗しました"

**Recovery**:

```bash
# Full rebuild (build + search index)
bun run build

# Search index only (if site is already built)
bun run build:search
```

**Common causes**:
- `dist/` directory doesn't exist or is stale
- `pagefind` binary not found: `bun install` to restore devDependencies
- Pagefind output path changed: check `scripts/build-search.mjs`

---

## 5. Analytics (Umami) Not Recording

**Symptoms**: Umami dashboard shows no data

**Recovery**:
1. Check `PUBLIC_UMAMI_WEBSITE_ID` and `PUBLIC_UMAMI_HOST` env vars are set
2. Check Umami instance is running: `curl https://your-umami.example.com/api/heartbeat`
3. Check browser console for script load errors
4. Verify the analytics script is in the page source: look for `/js/analytics.js`

---

## 6. Emergency Contacts

| Channel | When to Use |
|---------|-------------|
| GitHub Issues | Auto-created by healthcheck — triage and resolve |
| Sentry Dashboard | Error investigation and trend analysis |
| [Cloudflare Status](https://www.cloudflarestatus.com/) | Platform outage checking |
| Manual workflow trigger | When automated recovery fails |

---

## Post-Incident Checklist

After resolving any incident:

- [ ] Verify the fix: run healthcheck manually (`workflow_dispatch`)
- [ ] Check Sentry for new errors in the last hour
- [ ] Update this runbook if the incident revealed a gap
- [ ] If a new failure mode was discovered, add Sentry alert rule
- [ ] Close the auto-created GitHub issue with resolution notes
