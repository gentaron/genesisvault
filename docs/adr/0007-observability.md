# ADR-0007: Observability Stack

**Status**: Accepted
**Date**: 2026-05-05
**Decision Makers**: gentaron

## Context

Genesis Vault is a static Astro site deployed on Vercel with daily automated post generation.
We need observability without paying for SaaS tools, respecting the zero-cost constraint.

## Decision

We adopt a four-layer observability stack, all free-tier:

### 1. Sentry (Error Tracking + Performance)
- **Free tier**: 5,000 errors/month, performance monitoring at 10% sampling
- **Why**: Catches client-side JS errors, dead links, and API failures in production
- **Integration**: `@sentry/astro` — currently commented out pending compatibility verification
- **DSN**: Set via `SENTRY_DSN` environment variable

### 2. Plausible Analytics (Privacy-Friendly Traffic)
- **Why**: Cookie-free, GDPR-compliant, no personal data collection
- **Self-hosted option**: Can be deployed on Vercel as a serverless function
- **Integration**: Script tag in `BaseLayout.astro` head, pointing to `/js/analytics.js`
- **Currently**: Placeholder path — replace with actual self-hosted endpoint when deployed

### 3. Pagefind (Static Search)
- **Why**: Zero-cost static search index — no external API, no server-side processing
- **Integration**: Runs as a post-build step (`astro build && node scripts/build-search.mjs`)
- **Index location**: `dist/pagefind/` — served as static files

### 4. Healthcheck Cron (Uptime Monitoring)
- **Why**: Catches Vercel downtime and missed auto-posts
- **Frequency**: Every 6 hours via GitHub Actions scheduled workflow
- **Checks**: HTTP 200 status + latest post existence
- **Alerting**: GitHub Actions failure notifications (extendable to Slack/Discord)

## Consequences

- **Positive**: Full observability at zero cost; no vendor lock-in for search; privacy-friendly analytics
- **Negative**: Sentry integration requires compatibility check with Astro 4.x; Plausible self-hosting needs initial setup
- **Risks**: Free tier limits (5K errors/mo) may be exceeded during traffic spikes

## Alternatives Considered

| Tool | Rejected Because |
|------|-----------------|
| Google Analytics | Privacy-invasive, heavy script |
| Algolia Search | $29/mo minimum, overkill for a blog |
| UptimeRobot (paid) | Free tier limited to 50 monitors |
