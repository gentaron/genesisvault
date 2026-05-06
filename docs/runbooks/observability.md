# Observability Runbook

Phase η — Full observability stack operational guide.

## 1. Sentry Error Tracking

### Configuration

Sentry is integrated via `@sentry/astro` v10 with three config files:
- `sentry.client.config.ts` — Browser-side error capture
- `sentry.server.config.ts` — Server-side error capture
- `src/lib/sentry-script.ts` — Node.js script capture (auto-post pipeline)

The integration is enabled in `astro.config.mjs`. Source maps are uploaded on build
via the Sentry Vite plugin.

### Required Environment Variables

| Variable | Where to Set | Description |
|----------|-------------|-------------|
| `PUBLIC_SENTRY_DSN` | Vercel/CF env, `.env` | Sentry project DSN |
| `SENTRY_AUTH_TOKEN` | GitHub Secrets only | Source maps upload auth token |
| `PUBLIC_GIT_SHA` | CI auto-set | Release tracking |

### Checking for Errors

1. Go to [sentry.io](https://sentry.io) and log in
2. Select the **Genesis Vault** project
3. Check the **Issues** tab for unresolved errors
4. Key areas to monitor:
   - **Client-side errors**: JavaScript exceptions in the browser
   - **Performance**: Slow page loads (> 3s) — sampled at 10%
   - **Server errors**: API route failures

### Alert Rules (configure in Sentry dashboard)

- Unique exception in `src/lib/ai/**` → email (AI pipeline failure)
- Unique exception in `api/**` → email (paywall/API failure)
- New issue with > 5 events in 1 hour → email (spike detection)

### Free Tier Limits

- 5,000 errors/month
- 10% trace sampling (reduces performance overhead)
- Session replays disabled for privacy

---

## 2. Umami Analytics

### Setup (First Time)

1. Deploy Umami CE on Vercel/Railway/Fly.io (free Postgres: Neon, Supabase)
2. Create a website in Umami dashboard, note the `websiteId`
3. Set `PUBLIC_UMAMI_WEBSITE_ID` and `PUBLIC_UMAMI_HOST` in Vercel/CF environment
4. Rebuild and deploy — the analytics script will activate automatically

### Key Metrics

- **Unique visitors**: Daily/weekly trend
- **Page views per session**: Engagement indicator
- **Top pages**: Most-read articles
- **Referrers**: Where traffic comes from (Nostr relays, direct, social)
- **Bounce rate**: High bounce rate may indicate content quality issues

### Privacy

- Cookie-free option available (configure in Umami settings)
- No personal data collected
- GDPR-compliant by default
- Self-hosted = full data ownership

---

## 3. Pagefind Search

### Rebuilding the Index

```bash
# Full rebuild (build + search index)
bun run build

# Search index only (if site is already built)
bun run build:search
```

### How It Works

- Runs as post-build step via `scripts/build-search.mjs`
- Index generated in `dist/pagefind/` — served as static files
- Lazy-loaded when user presses Cmd+K or clicks search icon
- Gated article bodies excluded via `data-pagefind-ignore` attribute

### Verifying Gated Content Exclusion

1. Build the site: `bun run build`
2. Search the Pagefind index for a phrase known to be in a gated article body
3. The phrase must NOT appear in results (only metadata/summary is indexed)

### Troubleshooting

- `pagefind` not found: `bun install`
- Empty index: Ensure `dist/` contains the built site first
- Search dialog won't open: Check browser console for script errors
- Results not loading: Check `dist/pagefind/` exists in the deployment

---

## 4. Healthcheck Workflow

### Schedule

Runs every 6 hours at :30 past the hour (00:30, 06:30, 12:30, 18:30 UTC).
The :30 offset avoids collision with the 11:30 UTC daily post schedule.

### What It Checks

1. **Homepage reachable**: HTTP 200 from `genesisvault.vercel.app`
2. **Article freshness**: Latest post < 36 hours old
3. **Paywall gate**: Gated article API returns HTTP 402 unauthenticated

### On Failure

- GitHub issue auto-created with diagnostic details
- Issue labeled `healthcheck` and `bug`
- Assigned to `gentaron`

### Manually Triggering

1. Go to Actions → Healthcheck → "Run workflow"
2. Or use the GitHub API: `POST /repos/gentaron/genesisvault/actions/workflows/healthcheck.yml/dispatches`

### Temporarily Disabling

Comment out the `schedule` trigger in `.github/workflows/healthcheck.yml`.
The `workflow_dispatch` trigger allows manual runs while disabled.

---

## 5. Agent Telemetry

### Public Log

The daily pipeline writes a summary to `docs/agent-runs/YYYY-MM.md` after each run.
This file is committed to the repository and visible to the public.

### Format

```
2026-05-06 11:30:23 UTC
- VE-005 Nova: gemini-flash-lite, 1 attempt, 1.2s
- VE-001 Lena: gemini-flash-lite, 1 attempt, 2.4s
- VE-003 Chloe: gemini-flash, 1 attempt, 1.8s (fallback)
- VE-002 Sophia: groq-llama-70b, 2 attempts, 3.1s (fallback)
- VE-006 Iris: gemini-flash-lite, 1 attempt, 1.5s
Total: 10.0s | Article: src/content/posts/2026-05-06-article-slug.md
```

### Raw Telemetry

Detailed per-attempt data is in `logs/agent-runs.jsonl` (gitignored, CI-local only).
Fields: timestamp, agentId, agentName, provider, attempts, latencyMs, success, tokenUsage, errors.
