<!-- 自動生成ファイル。手で編集しないこと。再生成: `bun run almanac` -->

# INDEX — ADR と Runbook

このリポジトリで「なぜそうなっているか」を探すときの入口。
設計判断は ADR、壊れたときの手順は Runbook にある。

## ADR — 設計判断の記録（17件）

不可逆な決定と、その理由。新しい ADR は次の番号を使うこと（番号の重複は `bun run verify` で失敗する）。

| # | タイトル | Status | Date |
|---|---------|--------|------|
| 0001 | [ADR 0001: Foundation (Phase α)](../adr/0001-foundation-alpha.md) | Accepted | 2026-05-05 |
| 0002 | [ADR 0002: Tailwind CSS v4 Design System (Phase β)](../adr/0002-tailwind-beta.md) | Accepted | 2026-05-05 |
| 0003 | [ADR-0003: AI Fallback Chain via Vercel AI SDK 5 (Phase γ)](../adr/0003-ai-fallback-chain.md) | Accepted | 2026-05-06 |
| 0004 | [ADR-0004: Paywall Security — Astro API Routes + HMAC-Signed Cookies (Phase δ)](../adr/0004-paywall-security.md) | Superseded (Phase δ replaces original implementation) | 2026-05-06 (updated) |
| 0005 | [ADR-0005: viem 2 + EIP-6963 for Web3 Type Safety](../adr/0005-viem-web3.md) | Accepted (updated for Phase epsilon) | — |
| 0006 | [ADR-0006: Test Suite — Vitest 4 + Playwright 1.50](../adr/0006-test-suite.md) | Accepted | — |
| 0007 | [ADR-0007: Observability Stack](../adr/0007-observability.md) | Accepted (Phase η — Implemented) | 2026-05-05 (drafted), 2026-05-06 (implemented) |
| 0008 | [ADR-0008: Agent Pipeline Hardening](../adr/0008-agent-hardening.md) | Accepted | 2026-05-05 |
| 0009 | [ADR-0009: Prompt Versioning](../adr/0009-prompt-versioning.md) | Accepted | 2026-05-06 |
| 0010 | [ADR-0010: OpenRouter Tier Diversification (Phase γ.2)](../adr/0010-provider-diversification.md) | Accepted | 2026-07-03 |
| 0011 | [ADR-0011: AI Slop Detection in the Quality Gate](../adr/0011-ai-slop-detection.md) | Accepted | 2026-07-03 |
| 0012 | [ADR-0012: Test Strategy — Vitest 4 + Playwright 1.50](../adr/0012-test-strategy.md) | Updated (Phase ζ) | — |
| 0013 | [ADR-0013: Pipeline State Machine](../adr/0013-pipeline-state-machine.md) | Accepted | 2026-05-06 |
| 0014 | [ADR-0014 — Phase ι: ティア制エージェントルーティングと品質ゲート配線](../adr/0014-tiered-agent-routing.md) | Accepted | 2026-07-04 |
| 0015 | [ADR-0015: ワークフロー再構成 — 宣言的設定・契約としての仕様・決定論的検証・記憶インフラ（Phase κ）](../adr/0015-workflow-restructure.md) | Accepted | 2026-07-28 |
| 0016 | [ADR-0016: 囲い（審査層）— 見逃しを設計で潰す（Phase λ）](../adr/0016-the-enclosure.md) | Accepted | 2026-07-29 |
| 0017 | [ADR-0017: 記事から動画への受け渡し — Linear を境界にする（Phase μ）](../adr/0017-video-brief-handoff.md) | Accepted | 2026-08-04 |

## Runbook — 手順書（8件）

壊れたとき・運用するときに読むもの。

| 手順書 | Status |
|--------|--------|
| [Agent Pipeline Runbook](../runbooks/agent-pipeline.md) | — |
| [Incident Response Runbook](../runbooks/incident-response.md) | — |
| [Observability Runbook](../runbooks/observability.md) | — |
| [Paywall Runbook](../runbooks/paywall.md) | — |
| [Pipeline Recovery Runbook](../runbooks/pipeline-recovery.md) | — |
| [Testing Runbook](../runbooks/testing.md) | — |
| [Runbook: 記事 → Linear → 動画](../runbooks/video-brief.md) | — |
| [Wallet Runbook — Phase epsilon](../runbooks/wallet.md) | — |

## その他の記憶

| ファイル | 中身 |
|---------|------|
| [INVARIANTS.md](./INVARIANTS.md) | 壊してはいけない前提と、その守り方 |
| [LANDMINES.md](./LANDMINES.md) | 一度踏んだ罠と回避策 |
| [../lore-tech-mapping.md](../lore-tech-mapping.md) | 世界観と実装の対応 |
| [../budgets.md](../budgets.md) | 無料枠の予算管理 |
| [../security.md](../security.md) | セキュリティ方針 |
