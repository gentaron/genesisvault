# ADR-0006: Test Strategy — Vitest 4 + Playwright 1.50

## Status
Updated (Phase ζ)

## Context
Phase α established initial Vitest + Playwright scaffolding (ADR-0006 v1). Phase ζ upgrades the test infrastructure to enterprise-grade with coverage enforcement, CI gates, and comprehensive E2E coverage.

## Decision

### Vitest 4 for unit/integration tests
- **Native ESM**: matches `"type": "module"` package.json; no babel transform overhead
- **Vite-compatible**: shares config with Astro's Vite pipeline
- **Fast**: cold start < 200ms; watch mode with instant re-runs
- **v8 coverage**: zero-config, accurate instrumentation with `@vitest/coverage-v8`
- **Fork pool**: isolates test files for parallel execution without shared state

### Coverage thresholds (enforced in CI)
| Path | Lines | Functions | Branches | Statements |
|------|-------|-----------|----------|------------|
| Global | ≥80% | ≥80% | ≥75% | ≥85% |
| `src/lib/` | ≥85% | ≥85% | ≥75% | ≥85% |

**Exclusions** (require runtime context not available in test):
- `src/content/config.ts` — requires `astro:content` virtual module
- `api/*.ts` — Vercel API handlers; logic tested via replication tests
- `src/lib/agents/runners.ts` — calls live AI providers
- `src/lib/ai/generate.ts` — calls AI SDK + Gemini REST
- `src/lib/web3/receipt.ts` — calls Ethereum RPC
- `scripts/*.mjs` — main entry points with `process.exit()`

### Playwright 1.50+ for E2E tests
- **6 critical user journeys** covering the entire user flow
- Chromium-only (single browser to minimize CI cost)
- Trace on first retry, screenshots on failure
- GitHub Actions reporter for CI integration

### Test inventory

#### Unit tests (192 tests, 12 files)
| File | Tests | Scope |
|------|-------|-------|
| `wallet-utils.test.ts` | 12 | ERC-20 encoding, transfer log parsing, wallet discovery |
| `paywall-logic.test.ts` | 4 | HMAC token creation/verification |
| `paywall-server.test.ts` | 11 | Server-side cookie verification, USDC amount validation |
| `content-schema.test.ts` | 4 | Zod content schema validation |
| `theme-balance.test.ts` | 3 | Theme categorization |
| `ai-fallback-chain.test.ts` | 28 | Agent schemas, theme balance, fallback generation |
| `unlock-api.test.ts` | 37 | Input validation, transfer log extraction, block confirmations |
| `article-api.test.ts` | 28 | Cookie verification, markdown parsing, free post logic |
| `web3-pay.test.ts` | 18 | USDC encoding, chain switching, event listeners |
| `web3-wallets.test.ts` | 14 | EIP-6963 discovery, dedup, fallback, cleanup |
| `ai-providers.test.ts` | 9 | Provider chain construction, ordering, metadata |
| `scripts-logic.test.ts` | 24 | Nostr frontmatter parsing, key validation, relay URLs, NIP-23 tags |

#### E2E tests (22 tests, 6 files)
| File | Tests | Journey |
|------|-------|---------|
| `homepage.spec.ts` | 3 | Homepage renders with posts |
| `public-article.spec.ts` | 3 | Public article renders full content |
| `gated-article.spec.ts` | 3 | Gated article shows paywall overlay |
| `paywall-bypass.spec.ts` | 3 | Paywall bypass fails (402) |
| `unlock-flow.spec.ts` | 6 | Unlock API validation |
| `theme-persistence.spec.ts` | 4 | Theme / responsive / link validity |

### CI gates
- **ci-test.yml**: Unit tests + coverage on push/PR to main
- **ci-e2e.yml**: Playwright E2E on push/PR to main
- **codeql.yml**: Weekly security scan + on push/PR
- **renovate.json**: Automated dependency updates (patch auto-merge)

## Consequences
- `bun run test` — runs all 192 unit tests (~1.5s)
- `bun run test:coverage` — runs tests with coverage report
- `bun run test:ci` — CI-optimized: verbose output + coverage
- `bun run test:e2e` — runs 22 E2E tests (requires dev server)
- Coverage thresholds are enforced: CI fails if coverage drops below targets
- All tests pass in < 2 seconds (unit) or < 5 minutes (E2E)
