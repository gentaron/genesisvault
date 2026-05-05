# ADR-0006: Test Suite — Vitest 4 + Playwright 1.50

## Status
Accepted

## Context
The project has no automated tests. With multi-agent content generation, paywall logic, and Nostr/IPFS broadcasting, regressions are a real risk. We need a fast feedback loop.

## Decision
### Vitest 4 for unit / integration tests
- **Native ESM**: no babel/webpack transform overhead; matches our `"type": "module"` package.json
- **Vite-compatible**: shares config with Astro's Vite pipeline; path aliases and plugins just work
- **Fast**: cold start < 200ms; watch mode with instant re-runs
- **Built-in assertion library**: `expect()` with TypeScript types; no separate `@types/jest`

### Playwright 1.50 for E2E tests
- **Cross-browser**: Chromium, Firefox, WebKit (though we start with Chromium only)
- **Auto-wait**: waits for elements to be visible/clickable; no flaky `setTimeout` hacks
- **Trace on failure**: records DOM snapshots and network requests on first retry
- **Reliable wallet testing**: can inject `window.ethereum` mock via `page.addInitScript()`

### Test strategy
1. **Unit first**: schema validation, wallet encoding, theme categorization, paywall token logic
2. **Integration next**: content collection loading (would need Astro test utilities)
3. **E2E for critical flows**: wallet connect → pay → unlock, page rendering

## Test files created
| File | Scope |
|------|-------|
| `tests/content-schema.test.ts` | Zod content schema validation |
| `tests/wallet-utils.test.ts` | viem USDC transfer encoding |
| `tests/theme-balance.test.ts` | Theme categorization logic |
| `tests/paywall-logic.test.ts` | HMAC token creation/verification |

## Consequences
- `bun run test` runs all unit tests via Vitest
- `bun run test:e2e` runs Playwright E2E (requires dev server)
- Tests live in `tests/` (unit) and `e2e/` (end-to-end)
- No changes to existing scripts (`auto-post.mjs`, `nostr-broadcast.mjs`, `ipfs-archive.mjs`)
