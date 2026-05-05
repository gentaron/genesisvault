# Genesis Vault — Security Threat Model

## Threat: Paywall Bypass via Browser DevTools

### Severity: CRITICAL (pre-fix) → MITIGATED (post-fix)

### Pre-fix state
Article bodies were bundled in the Astro SSG output (`dist/`). The "paywall" was a CSS blur/hide toggled by `localStorage.gv_paid_status`. Any visitor could open DevTools and set this to bypass the gate.

### Post-fix state (Phase δ)
1. Gated article bodies are NOT present in the static build output.
2. Gated bodies are served exclusively via `/api/article/[slug]` which requires a valid HMAC-signed `gv_unlock` cookie.
3. The cookie is HttpOnly (JS-inaccessible), Secure (HTTPS-only), and SameSite=Strict.
4. Payment verification uses on-chain Transfer event decoding (not raw calldata parsing).
5. Cookie expiry: 30 days. After expiry, user must pay again.

### Residual risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Cookie theft via XSS | Low | No user-generated content on site; CSP headers recommended |
| PAYWALL_SECRET leak | CRITICAL if leaked | Secret stored only in Vercel env vars / GitHub Secrets |
| Free Ethereum RPC rate limits | Low | Round-robin between multiple free RPCs possible |
| Gated content in search engine cache | Medium | Add `<meta name="robots" content="noindex">` for gated pages |
| ExportControl bypass (curl/wget) | N/A | Server checks cookie; no cookie = 402 |
