# Genesis Vault

**思考の種を保管する、静かなデジタル日記**  
Mina Eureka Ernst による個人ブログ

🌐 **サイト**: https://genesisvault.vercel.app

---

## 概要

Genesis Vault は、Mina Eureka Ernst（ミナ・エウレカ・エルンスト）による個人日記ブログです。  
散歩・瞑想・ひとり旅・ジャーナリング・貯金・投資・マインドフルネスをテーマに、  
毎日 **5つのGemini AIエージェント（Liminal Forge）** が記事を自動生成・投稿します。

記事は **Ethereum ウォレット接続（3 USDC）** でフルアクセス可能です。

---

## Multi-Agent AI パイプライン

記事生成は以下の5エージェントが順番に担当します：

| ID | エージェント | 役割 |
|----|-------------|------|
| VE-005 | **Nova Harmon** (Balancer) | テーマバランス分析・ジャンル選定 |
| VE-001 | **Lena Strauss** (CEO) | トピック・切り口・タイトルの決定 |
| VE-003 | **Chloe Verdant** (SEO) | タグ・キーワード・メタディスクリプション生成 |
| VE-002 | **Sophia Nightingale** (Writer) | 本文執筆（1,000〜2,000字・日記体） |
| VE-006 | **Iris Koenig** (Editor) | 校正・品質チェック・ペルソナ一貫性確認 |

**使用モデル（優先順）**:
1. `gemini-2.5-flash-lite` — 15 RPM / 1000 RPD（メイン）
2. `gemini-2.5-flash` — 10 RPM / 250 RPD（フォールバック）
3. `groq-llama-3.3-70b` — Groq 無料ティア
4. `cerebras-llama-3.3-70b` — Cerebras 無料ティア
5. `openrouter-free` — OpenRouter 無料モデル
6. `huggingface` — HuggingFace Inference API

---

## 自動投稿

GitHub Actions により **毎日 19:30 MYT（UTC 11:30）** に自動で新記事が投稿されます。

**必要な GitHub Secrets**:
- `GEMINI_API_KEY` — Google Gemini API キー
- `GROQ_API_KEY` — Groq API キー（任意）
- `CEREBRAS_API_KEY` — Cerebras API キー（任意）
- `OPENROUTER_API_KEY` — OpenRouter API キー（任意）
- `HF_TOKEN` — HuggingFace API トークン（任意）
- `PAYWALL_SECRET` — ペイウォール HMAC 署名鍵
- `ALCHEMY_API_KEY` — Ethereum RPC（ペイウォール検証用、任意）
- `RECEIVE_WALLET` — USDC 受取ウォレットアドレス（任意）

手動実行:
```bash
GEMINI_API_KEY=your_key bun run auto-post
```

---

## 技術スタック

### コア・フレームワーク

| 技術 | バージョン | 役割 |
|------|-----------|------|
| [Astro](https://astro.build/) | 5.18.1 | 静的サイトジェネレーター（SSG）。Content Layer API、View Transitions ネイティブ対応 |
| [TypeScript](https://www.typescriptlang.org/) | ^5.8.0 | 型安全な開発。`astro/tsconfigs/strict` を継承 |
| [Bun](https://bun.sh/) | 1.3.12 | ランタイム兼パッケージマネージャー。高速な依存関係インストール・実行 |
| [ES Modules](https://nodejs.org/api/esm.html) | — | `"type": "module"` によりパッケージ全体で ESM を使用 |

### Astro インテグレーション

| パッケージ | バージョン | 役割 |
|-----------|-----------|------|
| [@astrojs/mdx](https://docs.astro.build/en/guides/integrations-guide/mdx/) | 4.3.14 | `.mdx` ファイルサポート。Markdown 内にコンポーネントを埋め込み可能 |
| [@astrojs/check](https://docs.astro.build/en/guides/integrations-guide/check/) | 0.9.9 | Astro 向け TypeScript 型チェッカー |

### コンテンツ管理

| 技術 | 詳細 |
|------|------|
| [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) | `src/content/posts/` 以下の Markdown ファイルを Zod スキーマで型検証 |
| [Zod](https://zod.dev/) | ^4.4.3。`title`, `date`, `mood`, `weather`, `tags`, `description`, `keywords`, `agents` 等のフィールドを定義 |
| [Shiki](https://shiki.style/) | コードブロックのシンタックスハイライト。テーマ: `github-light`、行折返し有効 |
| [Pagefind](https://pagefind.app/) | 静的サイト内全文検索。ビルド時にインデックス生成 |

### スタイリング

| 技術 | 詳細 |
|------|------|
| [Tailwind CSS](https://tailwindcss.com/) | v4。`@theme` ディレクティブでデザイントークンを定義 |
| [Google Fonts](https://fonts.google.com/) | Noto Serif JP（見出し用）+ Noto Sans JP（本文用）。ウェイト: 300/400/500/600/700 |
| CSS Custom Properties | `--color-*` によるデザインシステム。Tailwind `@theme` に統合 |
| CSS Animations | `@keyframes` による `shimmer` / `pulse-ring` / `float` の3種（Tailwind `@theme` にも登録） |
| CSS Dark Mode | `.dark` クラス切替。`localStorage` に `color-theme` を保存し永続化 |
| Glassmorphism | `backdrop-filter: blur(12px)` をウォレットカード等で使用 |
| レスポンシブデザイン | `@media (max-width: 640px)` でモバイル対応 |

### AI パイプライン（Multi-Agent System）

| 技術 | 詳細 |
|------|------|
| [Vercel AI SDK](https://sdk.vercel.ai/) | v5。統合プロバイダーインターフェース。`generateObject`（構造化出力）+ `generateText`（自由テキスト）|
| [Google Gemini API](https://ai.google.dev/) | `@ai-sdk/google`。`gemini-2.5-flash-lite`（メイン）+ `gemini-2.5-flash`（サブ）|
| [Groq](https://groq.com/) | `@ai-sdk/groq`。`llama-3.3-70b-versatile`。30 RPM / 14400 RPD 無料ティア |
| [Cerebras](https://cerebras.ai/) | `@ai-sdk/cerebras`。`llama-3.3-70b`。30 RPM 無料ティア |
| [OpenRouter](https://openrouter.ai/) | `@openrouter/ai-sdk-provider`。`meta-llama/llama-3.3-70b-instruct:free`。20 RPM 無料 |
| [HuggingFace](https://huggingface.co/) | `@ai-sdk/huggingface`。`Llama-3.3-70B-Instruct`。サーバーレス無料ティア |
| Multi-Agent Pipeline | 5エージェント順次実行（Nova → Lena → Chloe → Sophia → Iris）。`src/lib/agents/runners.ts` に分離 |
| Structured Outputs | Nova/Lena/Chloe は `generateObject` + Zod スキーマ検証。Sophia/Iris は `generateTextWithFallback` |
| Multi-Provider Fallback | 6プロバイダチェーン + ダイレクト Gemini REST フォールバック。~99.99% 稼働率 |
| Agent Telemetry | `logs/agent-runs.jsonl` にプロバイダ名・試行回数・レイテンシ・成功/失敗を記録 |
| Dry Run Mode | `bun run gen:dry` でファイル書き込みなしのパイプラインテスト |
| Idempotency | 同日の重複ポスト生成を防止。`.pipeline-state.json` でステート管理 |
| Resume from Failure | パイプライン中断時に最後の成功ステップから再開可能 |
| テーマバランス分析 | 9カテゴリのキーワードマッチング＋スコアリング。直近20記事の傾向を考慮 |

### Web3 / ブロックチェーン

| 技術 | 詳細 |
|------|------|
| [Ethereum Mainnet](https://ethereum.org/) | Chain ID: `0x1`。ウォレット接続・送金確認に使用 |
| [USDC (ERC-20)](https://www.circle.com/usdc) | コントラクト: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`。3 USDC のペイウォール決済 |
| [viem](https://viem.sh/) | 2.x。型安全な ABI エンコード・デコード。Tree-shakeable（~6kB） |
| [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) | マルチウォレット検出対応（MetaMask, Brave, Coinbase Wallet 等） |
| [MetaMask Provider API](https://docs.metamask.io/) | `window.ethereum` を使用 |
| Server-side Paywall | Vercel Edge Function による HMAC 署名 Cookie 検証（Phase δ） |
| トランザクション Polling | `eth_getTransactionReceipt` を3秒間隔で最大40回ポーリングし、2ブロック確定を確認 |

### Nostr（分散型ソーシャルプロトコル）

| 技術 | 詳細 |
|------|------|
| [nostr-tools](https://github.com/nbd-wtf/nostr-tools) | ^2.10.0。`SimplePool` / `finalizeEvent` / `verifyEvent`（`nostr-tools/pure` サブパス） |
| [NIP-23](https://github.com/nostr-protocol/nips/blob/master/23.md) | Long-form Content（kind: 30023）。`d` / `title` / `published_at` / `summary` / `t` タグを使用 |
| WebSocket リレー | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.snort.social`, `wss://relay.nostr.band` |
| イベント署名 | `secp256k1` による Nostr イベント署名と検証 |

### IPFS（分散型ストレージ）

| 技術 | 詳細 |
|------|------|
| [Pinata API](https://www.pinata.cloud/) | IPFS ピニングサービス（Free Tier: 1GB）。`/pinning/pinFileToIPFS` エンドポイント |
| CIDv1 | `pinataOptions.cidVersion: 1` でコンテンツアドレス指定 |
| IPFS Gateway | `ipfs.io` / `gateway.pinata.cloud` 経由でアーカイブ参照 |

### テスト

| 技術 | 詳細 |
|------|------|
| [Vitest](https://vitest.dev/) | 4.x。ユニットテスト（スキーマ検証・ウォレット・テーマバランス・ペイウォールロジック） |
| [Playwright](https://playwright.dev/) | 1.50+。E2E テスト（ウォレットフロー・ゲート描画）。Chromium 対応 |

### CI/CD・自動化

| 技術 | 詳細 |
|------|------|
| [GitHub Actions](https://github.com/features/actions) | `daily-post.yml`（毎日 19:30 MYT 自動生成）+ `healthcheck.yml`（6時間ごと） |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | v2。CI で Bun を使用 |
| [Vercel](https://vercel.com/) | 自動デプロイ + Edge Functions（ペイウォール検証 API） |
| Conventional Commits | `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` の形式を採用（AGENTS.md で規定） |

### オブザーバビリティ

| 技術 | 詳細 |
|------|------|
| [Sentry](https://sentry.io/) | Free Tier: 5K errors/month。クライアントサイドエラー追跡 |
| [Plausible](https://plausible.io/) | プライバシー重視のアナリティクス（Cookie-free） |
| Pagefind | 静的サイト内全文検索インデックス |

### 開発ツール・規約

| 技術 | 詳細 |
|------|------|
| [Biome](https://biomejs.dev/) | 2.x。Linter + Formatter。ESLint + Prettier の25倍高速。単一設定ファイル |
| [Bun](https://bun.sh/) | 1.3.12。パッケージマネージャー兼ランタイム |
| AGENTS.md | AI 開発プロトコル。デッドロック防止・反復キャップ・エラー分類・品質ゲート・パイプライン監視 |
| MIT License | オープンソースライセンス |

---

## 開発環境のセットアップ

```bash
# 依存関係のインストール
bun install

# 開発サーバー起動
bun run dev

# ビルド（Pagefind検索インデックス付き）
bun run build

# プレビュー
bun run preview

# テスト
bun run test

# リント
bun run lint

# フォーマット
bun run format
```

---

## 記事の書き方

`src/content/posts/` に Markdown ファイルを作成します：

```markdown
---
title: 記事のタイトル
date: 2026-04-26
mood: "🌿 平和"
weather: "☀️"
tags: ["ジャーナリング", "散歩", "マインドフルネス"]
description: "SEO向けの説明文"
keywords: ["キーワード1", "キーワード2"]
agents:
  balancer: "VE-005 Nova Harmon"
  ceo: "VE-001 Lena Strauss"
  seo: "VE-003 Chloe Verdant"
  writer: "VE-002 Sophia Nightingale"
  editor: "VE-006 Iris Koenig"
---

ここに本文を書きます...
```

---

## コンテンツテーマ

Mina のペルソナに基づくテーマ：

- 散歩・自然・日常の気づき
- 瞑想・マインドフルネス
- プチ旅行・ひとり旅
- ジャーナリング・内省・自己成長
- 読書・書評
- 貯金・家計管理・投資（暗号通貨・株式ETF）
- 独身ライフ・自由な時間の使い方

---

## デプロイ

1. GitHub にプッシュ
2. Vercel で新規プロジェクト作成
3. リポジトリを選択して自動デプロイ
4. GitHub Secrets に `GEMINI_API_KEY` を設定

---

## ライセンス

MIT License

---

**著者**: Mina Eureka Ernst（ミナ・エウレカ・エルンスト）  
**サイト**: https://genesisvault.vercel.app  
**コンセプト**: Liminal Forge AI × 静かなデジタル日記
