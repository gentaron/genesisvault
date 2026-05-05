# ADR-0004: Paywall Security — Vercel Edge Functions + HMAC-Signed Cookies

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** Genesis Vault Engineering

## Context

The Genesis Vault paywall charges 3 USDC for full content access. The original implementation had two critical security flaws:

### Vulnerability 1: Client-Side Only Verification
Payment status was stored in `localStorage` (`gv_paid_status`). Any user could open DevTools → Application → localStorage → set `gv_paid_status` to `{"paid":true,...}` to bypass the paywall entirely.

### Vulnerability 2: Content in Static HTML
Astro SSG bundles ALL markdown content into static HTML at build time. Gated content was present in the page source, just hidden by CSS (`blur` + `display:none`). Anyone viewing page source could read all content.

## Decision

Implement a server-side verification layer using Vercel Edge Functions + HMAC-signed cookies, while keeping SSG for performance.

### Architecture

```
┌─────────────┐     POST /api/verify-payment     ┌──────────────────┐
│   Browser   │ ─────────────────────────────────→ │ Vercel Edge Func │
│  (MetaMask) │                                    │ (verify tx on    │
│             │ ←──── Set-Cookie: gv_token=... ── │  Ethereum + HMAC)│
└─────────────┘                                    └──────────────────┘
      │
      │ GET /api/gated-content/[slug]
      ↓
┌──────────────────┐     ┌──────────────────┐
│ Vercel Edge Func │ ──→ │ HMAC cookie      │
│ (check cookie +  │     │ verification     │
│  return status)  │     └──────────────────┘
└──────────────────┘
```

### Components

1. **`/api/verify-payment`** (POST) — Verifies Ethereum transaction on-chain, creates HMAC-signed cookie
2. **`/api/gated-content/[slug]`** (GET) — Checks cookie signature, returns locked/unlocked status
3. **`gv_token` cookie** — HttpOnly, Secure, SameSite=Lax, 1-year expiry

### Why HMAC-Signed Cookies (Not Database)

- **Stateless**: No database needed, no connection pooling, no schema migrations
- **Fast**: Verification is a single HMAC computation (microseconds)
- **Deployable**: Works on Vercel free tier (serverless, no persistent storage)
- **Secure**: Cookie is HttpOnly (inaccessible to JS), Secure (HTTPS only), and signature prevents forgery

### Why NOT Moving All Content Behind Auth

- **SSG benefits preserved**: Free articles (first 2) are still statically generated for maximum performance
- **SEO preserved**: Search engines can crawl free content
- **CDN-friendly**: Static pages cache on edge, only paywall API needs dynamic computation

## Security Analysis

### What's Fixed

| Vulnerability | Before | After |
|--------------|--------|-------|
| Client-side paywall bypass | Trivial (localStorage edit) | Requires forging HMAC cookie (impossible without server secret) |
| Cookie tampering | N/A | HMAC-SHA256 signature verification |
| Token forgery | N/A | Secret key required (server-side only) |
| XSS token theft | N/A | HttpOnly flag prevents JS access |

### What Remains

| Residual Risk | Severity | Mitigation |
|--------------|----------|------------|
| Gated content in HTML source | **Medium** | Future: load gated content via API instead of SSG |
| Cookie replay across devices | Low | User would need to extract cookie (HttpOnly helps) |
| PAYWALL_SECRET exposure | Critical | Must be Vercel env var, never committed |
| ALCHEMY_API_KEY exposure | High | Must be Vercel env var, rate limits apply |

### Future Hardening (Out of Scope)

1. **On-demand content loading**: Load gated body text via `/api/gated-content/[slug]` instead of embedding in static HTML
2. **Token revocation**: Add a server-side blocklist for compromised tokens
3. **Rate limiting**: Add rate limits to `/api/verify-payment` to prevent abuse
4. **Content encryption**: Encrypt gated content in the HTML with a key from the API

## Consequences

- **Positive**: Paywall can no longer be bypassed by editing localStorage
- **Positive**: Server-side HMAC verification adds cryptographic security
- **Positive**: No database dependency (works on Vercel free tier)
- **Positive**: Backward-compatible — existing localStorage cache still works as fallback
- **Negative**: Gated content still readable in HTML source (documented, future fix)
- **Negative**: Requires Vercel deployment (API routes won't work with pure static hosting)
- **Negative**: Requires ALCHEMY_API_KEY for on-chain verification (free tier available)
