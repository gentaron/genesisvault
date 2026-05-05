# Paywall Security Fix — Public Disclosure

**Date:** 2026-05-06
**Severity:** Critical
**Status:** Fixed

## Summary

Prior to this fix, the Genesis Vault paywall was bypassable by any visitor with browser developer tools. Article bodies were bundled in the static site output and gated only by a client-side display toggle keyed off `localStorage`.

## Timeline

- **2026-05-05**: Security audit identified the vulnerability during the World-Class Tech Stack Upgrade specification.
- **2026-05-06**: Phase δ implemented. Gated article bodies no longer ship in the static build. Server-side HMAC-signed cookie verification deployed.

## Technical Details

The root cause was Astro SSG bundling all Markdown content into static HTML. The paywall was implemented as:
1. CSS blur filter on gated content
2. `display: none` on gated post cards
3. `localStorage` flag checked by inline JavaScript

All three mechanisms are client-side and therefore bypassable.

The fix:
1. Gated posts do NOT render `<Content />` in the static build
2. Gated bodies are fetched client-side from `/api/article/[slug]`
3. The API endpoint requires a valid HMAC-signed cookie
4. Cookies are issued by `/api/unlock` after on-chain USDC transfer verification
5. Cookies are HttpOnly, Secure, SameSite=Strict

## Impact

No user payment data was compromised. The vulnerability allowed reading gated content without payment; it did not expose wallet private keys or transaction data.

## Credits

Vulnerability identified during the Genesis Vault World-Class Tech Stack Upgrade.
