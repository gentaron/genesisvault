# ADR-0004: Paywall Security — Astro API Routes + HMAC-Signed Cookies (Phase δ)

**Status:** Superseded (Phase δ replaces original implementation)
**Date:** 2026-05-06 (updated)
**Deciders:** Genesis Vault Engineering

## Context

The Genesis Vault paywall charges 3 USDC for full content access. The original implementation had two critical security flaws:

### Vulnerability 1: Client-Side Only Verification
Payment status was stored in `localStorage` (`gv_paid_status`). Any user could open DevTools → Application → localStorage → set `gv_paid_status` to `{"paid":true,...}` to bypass the paywall entirely.

### Vulnerability 2: Content in Static HTML
Astro SSG bundles ALL markdown content into static HTML at build time. Gated content was present in the page source, just hidden by CSS (`blur` + `display:none`). Anyone viewing page source could read all content.

## Decision

Implement a server-side content gate using Astro API routes (`prerender = false`) + HMAC-signed cookies, with gated bodies excluded from the static build entirely.

### Architecture

```
┌─────────────┐     POST /api/unlock              ┌──────────────────┐
│   Browser   │ ─────────────────────────────────→ │ Astro API Route  │
│  (MetaMask) │                                    │ (verify ERC-20   │
│             │ ←──── Set-Cookie: gv_unlock=... ── │ Transfer event)  │
└─────────────┘                                    └──────────────────┘
      │
      │ GET /api/article/[slug]
      ↓
┌──────────────────┐     ┌──────────────────┐
│ Astro API Route  │ ──→ │ HMAC cookie      │
│ (read .md file,  │     │ verification     │
│  return HTML)    │     └──────────────────┘
└──────────────────┘
```

### Components

1. **`/api/unlock`** (POST) — Verifies Ethereum transaction via ERC-20 Transfer event log, creates HMAC-signed cookie
2. **`/api/article/[slug]`** (GET) — Checks cookie, reads markdown file, returns article body HTML
3. **`/api/unlock-legacy`** (POST) — Migrates existing localStorage users to cookie-based auth
4. **`gv_unlock` cookie** — HttpOnly, Secure, SameSite=Strict, 30-day expiry

### Why Astro API Routes Instead of Vercel Edge Functions

- **Single deploy target**: Astro API routes (`export const prerender = false`) run as server functions on any adapter (Vercel, Netlify, Cloudflare). No separate `api/` directory with `@vercel/node` needed.
- **Simpler build**: No dual build pipeline (Astro SSG + Vercel Functions). Everything is one Astro project.
- **Better DX**: TypeScript support, access to Astro content collections, consistent file structure.

### Why `prerender = false` (Server/Edge Rendering)

- API routes must run at request time to check cookies and read files dynamically.
- Vercel renders these as Edge Functions automatically when `output: 'server'` or `hybrid` is configured.
- This is the standard Astro 5 pattern for dynamic endpoints.

### Why Transfer Event Log Decoding Instead of Calldata Parsing

The old `verify-payment` endpoint parsed raw calldata (`input` field) to extract recipient and amount. This is fragile:
- Calldata can vary (different USDC implementations, function signatures)
- Token contracts may use `transferFrom` or `transfer` with different selectors
- Event logs are the canonical, EVM-standard way to verify ERC-20 transfers

The new `/api/unlock` decodes `Transfer(address indexed from, address indexed to, uint256 value)` event topics from the receipt logs. This is reliable and standards-compliant.

### Why 30-Day Cookie Expiry (Not 1 Year)

- 3 USDC is a one-time payment, not a lifetime subscription.
- 30 days encourages users to revisit and re-engage.
- Shorter expiry limits the window if `PAYWALL_SECRET` is somehow compromised.
- Users can re-verify using their original transaction hash.

### Why `gv_unlock` Instead of `gv_token` (Cookie Name Change)

- Clear semantic distinction: `unlock` implies access to gated content.
- Breaking change is intentional: forces migration path via `/api/unlock-legacy`.
- Prevents confusion between old `gv_token` (JSON payload, base64url) and new `gv_unlock` (plain text payload, HMAC).

## Security Analysis

### What's Fixed

| Vulnerability | Before | After |
|--------------|--------|-------|
| Client-side paywall bypass | Trivial (localStorage edit) | Requires forging HMAC cookie (impossible without server secret) |
| Content in HTML source | **CRITICAL** — all bodies in `dist/` | **Fixed** — gated bodies excluded from static build |
| Cookie tampering | N/A | HMAC-SHA256 signature verification |
| Token forgery | N/A | Secret key required (server-side only) |
| XSS token theft | N/A | HttpOnly flag prevents JS access |

### What Remains

| Residual Risk | Severity | Mitigation |
|--------------|----------|------------|
| Cookie replay across devices | Low | User would need to extract cookie (HttpOnly helps) |
| PAYWALL_SECRET exposure | Critical | Must be Vercel env var, never committed |
| Free Ethereum RPC rate limits | Low | Multiple RPC endpoints, fallback logic |
| Search engine caching gated content | Medium | `<meta name="robots" content="noindex">` on gated posts |

## Consequences

- **Positive**: Paywall can no longer be bypassed by editing localStorage
- **Positive**: Gated content is NOT in static HTML — DevTools inspection reveals nothing
- **Positive**: Server-side HMAC verification adds cryptographic security
- **Positive**: No database dependency (works on Vercel free tier)
- **Positive**: Transfer event log decoding is more robust than calldata parsing
- **Positive**: Legacy users are migrated transparently via `/api/unlock-legacy`
- **Negative**: Requires Vercel deployment (API routes need a server runtime)
- **Negative**: Cookie expiry means users must re-verify every 30 days
- **Negative**: Breaking change for existing users (mitigated by legacy migration)
