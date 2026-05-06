# Testing Runbook

## Quick Reference

| Command | Description |
|---------|-------------|
| `bun run test` | Run all 192 unit tests |
| `bun run test:watch` | Watch mode — re-runs on file change |
| `bun run test:coverage` | Run tests + generate coverage report |
| `bun run test:ci` | CI mode: verbose + coverage |
| `bun run test:e2e` | Run 22 E2E Playwright tests |
| `bun run test:e2e:ui` | Playwright UI mode (interactive) |
| `npx playwright test --list` | List E2E tests without running |
| `npx playwright show-report` | Open Playwright HTML report |

## Unit Tests

### Architecture
- **Framework**: Vitest 4 with v8 coverage provider
- **Location**: `tests/**/*.test.ts`
- **Environment**: Node.js (no browser runtime needed)
- **Pool**: Fork pool (50% max forks) for isolation
- **Total**: 192 tests across 12 files

### Test Categories

#### Critical Path Tests (must never regress)
| File | What it tests |
|------|---------------|
| `paywall-logic.test.ts` | HMAC token creation, tamper detection, expiry |
| `paywall-server.test.ts` | Server-side cookie verification |
| `unlock-api.test.ts` | Wallet/txHash validation, transfer log extraction |
| `article-api.test.ts` | Cookie verification, markdown-to-HTML, free post logic |
| `web3-pay.test.ts` | USDC calldata encoding, chain switching, event listeners |
| `web3-wallets.test.ts` | EIP-6963 discovery, dedup, fallback, cleanup |

#### Schema & Data Tests
| File | What it tests |
|------|---------------|
| `content-schema.test.ts` | Zod content schema validation |
| `ai-fallback-chain.test.ts` | Agent schemas (Nova/Lena/Chloe), theme balance, fallback |
| `wallet-utils.test.ts` | ERC-20 encoding, legacy compat |

#### Integration & Script Tests
| File | What it tests |
|------|---------------|
| `ai-providers.test.ts` | Provider chain construction with env vars |
| `scripts-logic.test.ts` | Nostr frontmatter parsing, key validation, relay URLs |

### Coverage Thresholds
| Path | Lines | Functions | Branches | Statements |
|------|-------|-----------|----------|------------|
| Global | ≥80% | ≥80% | ≥75% | ≥85% |

Coverage is enforced in CI. If it drops, the build fails.

### Coverage Exclusions
Files excluded because they require runtime context:
- `src/content/config.ts` — needs Astro virtual module
- `api/*.ts` — Vercel API handlers (logic tested via replication)
- `src/lib/agents/runners.ts` — calls live AI providers
- `src/lib/ai/generate.ts` — calls AI SDK
- `src/lib/web3/receipt.ts` — calls Ethereum RPC
- `scripts/*.mjs` — main entry points with side effects

## E2E Tests

### Architecture
- **Framework**: Playwright 1.50+
- **Location**: `e2e/**/*.spec.ts`
- **Browser**: Chromium only
- **Total**: 22 tests across 6 files

### User Journeys
1. **Homepage**: Renders title, posts, wallet card, locked counter
2. **Public Article**: Navigates to newest post, renders body
3. **Gated Article**: Shows paywall gate, noindex meta, unlock link
4. **Paywall Bypass**: API returns 402 without cookie, rejects bad methods
5. **Unlock Flow**: Validates wallet/txHash input, handles missing/invalid data
6. **Theme/Responsive**: CSS variables, console errors, mobile viewport, link validity

### Running E2E Locally
```bash
# Build + start preview server (Playwright auto-starts it)
bun run test:e2e

# Or manually:
bun run build
bun run preview &
npx playwright test

# Interactive mode:
bun run test:e2e:ui
```

## CI Pipelines

### ci-test.yml (Unit Tests)
- Triggers: push/PR to main
- Runs: `bun run test:ci` (coverage + verbose)
- Uploads: coverage artifact (7 day retention)

### ci-e2e.yml (E2E Tests)
- Triggers: push/PR to main
- Builds site, installs Chromium
- Runs: `npx playwright test`
- Uploads: Playwright report + traces on failure

### codeql.yml (Security)
- Triggers: push/PR to main, weekly Monday scan
- Languages: JavaScript/TypeScript
- Queries: security-extended

### renovate.json (Dependencies)
- Schedule: weekly
- Auto-merge: patch updates, devDependencies
- Grouped: astro, vitest, playwright, web3, ai-sdk, tailwind

## Troubleshooting

### Tests fail after dependency update
```bash
bun install
bun run test
```

### Coverage dropped unexpectedly
Check `tests/` for files that test the affected source. If new code was added, add corresponding tests.

### E2E tests fail with timeout
Increase `webServer.timeout` in `playwright.config.ts`. Default is 120s.

### E2E tests fail on specific post
Posts may have been added/removed. Check that the "3rd newest" post assumption still holds.

### Playwright browser not found
```bash
npx playwright install chromium
npx playwright install-deps
```
