# ADR-0007: Observability Stack

**Status**: Accepted (Phase η — Implemented)
**Date**: 2026-05-05 (drafted), 2026-05-06 (implemented)
**Decision Makers**: gentaron

## Context

Genesis Vault is a static Astro site deployed on Cloudflare Pages with daily automated
post generation via a 5-agent AI pipeline. It must run autonomously while Gentaro sleeps,
which means failures must be detected and reported without human intervention.

Current failure modes before Phase η:
- Daily auto-post fails silently — detected only when Gentaro checks the site
- Paywall transaction errors go unnoticed until users report them (or don't)
- No site analytics — no visibility into traffic, referrers, or engagement
- No on-site search — 80+ articles with poor discoverability
- No systematic health monitoring

Constraints:
- **Zero cost**: All tools must be free-tier viable
- **Privacy**: Must align with Mina's brand (no Google Analytics, no cookies)
- **Simplicity**: Minimal operational overhead, no credit card on file

## Decision

We adopt a four-layer observability stack, all zero-cost:

### 1. Sentry (Error Tracking + Performance)

**Free tier**: 5,000 errors/month, 10% trace sampling, source maps upload.

**Why Sentry over alternatives**:

| Tool | Free Tier | Rejected Because |
|------|-----------|------------------|
| **Sentry** | 5K errors/mo, traces, source maps | **Selected** — best free tier for JS/TS projects |
| Datadog | 5 host-days, no APM free tier | $23/host/mo after trial; overkill for a blog |
| Bugsnag | 2K errors/mo (legacy) | Free tier severely limited; JS support weaker |
| Rollbar | 5K errors/mo | Comparable, but Sentry has better Astro integration |

**Integration**: `@sentry/astro` v10 enabled in `astro.config.mjs`. Client config in
`sentry.client.config.ts`, server config in `sentry.server.config.ts`, script config
in `src/lib/sentry-script.ts` (for Node.js auto-post pipeline). Source maps uploaded
via the Sentry Vite plugin on build.

**Alert rules** (configure in Sentry dashboard):
- Unique exception in `src/lib/ai/**` → email Gentaro (AI pipeline failure)
- Unique exception in `src/pages/api/**` or `api/**` → email Gentaro (paywall/API failure)
- Spike in error count → email Gentaro
- 402 responses are **not** alerted — normal paywall traffic

**Privacy**: Session replays disabled (`replaysSessionSampleRate: 0`). No PII captured.

### 2. Umami Analytics (Privacy-Friendly Traffic)

**Free tier**: Self-hosted, unlimited sites, unlimited events.

**Why Umami over alternatives**:

| Tool | Free Tier | Rejected Because |
|------|-----------|------------------|
| **Umami** | Unlimited (self-hosted) | **Selected** — Postgres only, simple deployment |
| Plausible CE | Self-hosted, but needs Clickhouse | Clickhouse on free tier is complex; >2h setup estimate |
| PostHog | 1M events/mo | Cloud-hosted; free tier generous but requires account |
| Google Analytics | Unlimited | Privacy-invasive, heavy script (~50KB), cookie-based |

**Decision rule**: Plausible CE requires both Postgres AND Clickhouse. Umami requires
only Postgres (available free from Neon, Supabase, or Vercel Postgres). Umami wins on
deployment simplicity while providing equivalent analytics for Genesis Vault's scale.

**Integration**: Lazy-loaded via `/js/analytics.js` proxy script in `BaseLayout.astro`.
The script checks for `data-umami-id` attribute on `<html>`. If not set, it silently
no-ops — no network requests, no console warnings. Configured via `PUBLIC_UMAMI_WEBSITE_ID`
and `PUBLIC_UMAMI_HOST` environment variables.

**Privacy**: Cookie-free option available. No personal data collected. GDPR-compliant
by default. Self-hosted means full data ownership.

### 3. Pagefind (Static Client-Side Search)

**Free tier**: Fully free, MIT-licensed, zero runtime cost.

**Why Pagefind over alternatives**:

| Tool | Free Tier | Rejected Because |
|------|-----------|------------------|
| **Pagefind** | Unlimited (static) | **Selected** — build-time index, zero server cost |
| Algolia | 1K requests/mo (free) | $29/mo minimum for real usage; requires API key |
| Meilisearch | Self-hosted free | Needs dedicated server; overkill for a blog |
| FlexSearch | Client-side only | No pre-built UI; more integration work |

**Integration**: Runs as post-build step (`node scripts/build-search.mjs`). Index output
at `dist/pagefind/`. Search UI lazy-loaded via Cmd+K shortcut or nav button.

**Critical privacy requirement**: Gated article bodies are excluded from the index via
`data-pagefind-ignore` attribute. Only free (public) articles are searchable. Summary
and metadata are indexed for gated posts, but the body content is not.

### 4. Healthcheck Workflow (Active Monitoring)

**Free tier**: GitHub Actions (2,000 min/month free).

**Implementation**: `.github/workflows/healthcheck.yml` runs every 6 hours:
1. HTTP 200 check on homepage
2. Latest article freshness (< 36 hours old)
3. Gated article API returns 402 unauthenticated
4. Auto-creates GitHub issue on failure (with `dacbd/create-issue-action`)

**Additional**: `.github/workflows/scheduled-post-verify.yml` runs at 12:00 and 13:00 UTC
to verify the daily post (scheduled at 11:30 UTC) was committed on time. Checks post
existence, frontmatter completeness, and content quality.

## Consequences

**Positive**:
- Full observability at zero cost — error tracking, analytics, search, health monitoring
- No vendor lock-in for search (Pagefind is static files)
- Privacy-friendly analytics (cookie-free, self-hosted)
- Automatic failure detection with GitHub issue creation
- Public transparency via `docs/agent-runs/YYYY-MM.md` telemetry log
- /status page for at-a-glance system health

**Negative**:
- Umami requires separate deployment and Postgres provisioning
- Sentry free tier limited to 5K errors/month (mitigated by 10% trace sampling)
- Healthcheck false-positives possible during the 30-min window after daily post schedule

**Risks and mitigations**:
| Risk | Mitigation |
|------|-----------|
| Sentry quota exceeded (5K/mo) | Drop tracing, keep error-only; `ignoreErrors` for 402 paywall |
| Umami deployment complexity | Documented in runbook; alternative: skip analytics entirely |
| Pagefind index size growth | ~2-5 MB for 2,200 articles; acceptable |
| Healthcheck false-positives | 30-min buffer after 11:30 UTC post schedule |
| GitHub Actions rate limits | 4 workflows total well within 2,000 min/month |

## Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │         Genesis Vault                │
                    │                                      │
  Visitor ──────── │  ┌──────┐  ┌──────┐  ┌──────────┐  │
  (browser)        │  │Sentry│  │Umami │  │ Pagefind  │  │
                   │  │client│  │script│  │ (static)  │  │
                   │  └──┬───┘  └──┬───┘  └──────────┘  │
                   │     │         │                      │
  Auto-post ────── │  ┌──┴───┐    │                      │
  (GitHub Actions) │  │Sentry│    │                      │
                   │  │Node  │    │                      │
                   │  └──┬───┘    │                      │
                   │     │         │                      │
  Healthcheck ──── │  ┌──┴─────────┴──────────┐          │
  (GitHub Actions) │  │ GitHub Issue (failure) │          │
                   │  └────────────────────────┘          │
                   └─────────────────────────────────────┘
```
