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

---

## 自動投稿

GitHub Actions により **毎日 19:30 MYT（UTC 11:30）** に自動で新記事が投稿されます。

**必要な GitHub Secrets**:
- `GEMINI_API_KEY` — Google Gemini API キー

手動実行:
```bash
GEMINI_API_KEY=your_key npm run auto-post
```

---

## 技術スタック

### コア・フレームワーク

| 技術 | バージョン | 役割 |
|------|-----------|------|
| [Astro](https://astro.build/) | ^4.16.0 | 静的サイトジェネレーター（SSG）。Islands Architecture でHTML先行出力・ゼロJSを基本とする |
| [TypeScript](https://www.typescriptlang.org/) | ^5.6.0 | 型安全な開発。`astro/tsconfigs/strict` を継承し JSX は `react-jsx` を採用 |
| [ES Modules](https://nodejs.org/api/esm.html) | — | `"type": "module"` によりパッケージ全体で ESM を使用 |

### Astro インテグレーション

| パッケージ | バージョン | 役割 |
|-----------|-----------|------|
| [@astrojs/mdx](https://docs.astro.build/en/guides/integrations-guide/mdx/) | ^3.1.0 | `.mdx` ファイルサポート。Markdown 内に React コンポーネント等を埋め込み可能 |
| [@astrojs/check](https://docs.astro.build/en/guides/integrations-guide/check/) | ^0.9.0 | Astro 向け TypeScript 型チェッカー |

### コンテンツ管理

| 技術 | 詳細 |
|------|------|
| [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) | `src/content/posts/` 以下の Markdown ファイルを Zod スキーマで型検証 |
| [Zod](https://zod.dev/) | Astro 内蔵。`title`, `date`, `mood`, `weather`, `tags`, `description`, `keywords`, `agents` 等のフィールドを定義 |
| [Shiki](https://shiki.style/) | コードブロックのシンタックスハイライト。テーマ: `github-light`、行折返し有効 |

### スタイリング

| 技術 | 詳細 |
|------|------|
| カスタム CSS | CSS Custom Properties（`--color-*`）によるデザインシステム。ライト/ダークモード切替 |
| CSS Animations | `@keyframes` による `shimmer` / `pulse-ring` / `float` の3種定義 |
| CSS Dark Mode | `.dark` クラス切替。`localStorage` に `color-theme` を保存し永続化 |
| [Google Fonts](https://fonts.google.com/) | Noto Serif JP（見出し用）+ Noto Sans JP（本文用）。ウェイト: 300/400/500/600/700 |
| Glassmorphism | `backdrop-filter: blur(12px)` をウォレットカード等で使用 |
| レスポンシブデザイン | `@media (max-width: 640px)` でモバイル対応 |

### AI パイプライン（Multi-Agent System）

| 技術 | 詳細 |
|------|------|
| [Google Gemini API](https://ai.google.dev/) | Generative Language API（`v1beta/models/{model}:generateContent`） |
| gemini-2.5-flash-lite | メインモデル。15 RPM / 1000 RPD（無料ティア最優先） |
| gemini-2.5-flash | サブモデル。10 RPM / 250 RPD（高品質が必要な場合） |
| gemini-2.0-flash | フォールバックモデル |
| Multi-Agent Pipeline | 5エージェントが順次実行（Nova → Lena → Chloe → Sophia → Iris） |
| Exponential Backoff | `RETRY_BASE_DELAY_MS = 10s`、最大3回リトライ。HTTP 429（Rate Limit）に自動対応 |
| XML/CDATA パーサー | 旧ブログ（gensnotes）から RSS `<item>` / `<content:encoded>` / `<title>` を正規表現で抽出 |
| テーマバランス分析 | 9カテゴリのキーワードマッチング＋スコアリング。直近20記事の傾向を考慮 |

### Web3 / ブロックチェーン

| 技術 | 詳細 |
|------|------|
| [Ethereum Mainnet](https://ethereum.org/) | Chain ID: `0x1`。ウォレット接続・送金確認に使用 |
| [USDC (ERC-20)](https://www.circle.com/usdc) | コントラクト: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`。3 USDC のペイウォール決済 |
| [MetaMask Provider API](https://docs.metamask.io/) | `window.ethereum` を使用。`eth_requestAccounts` / `eth_sendTransaction` / `eth_getTransactionReceipt` / `eth_blockNumber` / `eth_chainId` |
| ERC-20 Transfer | `transfer(address,uint256)` の ABI エンコード（`0xa9059cbb`）を直接構築し送信 |
| トランザクション Polling | `eth_getTransactionReceipt` を3秒間隔で最大40回（約2分）ポーリングし、2ブロック確定を確認 |
| localStorage Paywall | 支払い完了後に `gv_paid_status` にトランザクションハッシュ・ウォレットアドレス・タイムスタンプを保存 |

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

### CI/CD・自動化

| 技術 | 詳細 |
|------|------|
| [GitHub Actions](https://github.com/features/actions) | 毎日 19:30 MYT（UTC 11:30）に `daily-post.yml` で自動記事生成＋コミット＆プッシュ |
| [actions/checkout](https://github.com/actions/checkout) | v4 |
| [actions/setup-node](https://github.com/actions/setup-node) | v4 / Node.js 20 |
| [Vercel](https://vercel.com/) | GitHub連携による自動デプロイ。`https://genesisvault.vercel.app` |
| Conventional Commits | `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` の形式を採用（AGENTS.md で規定） |

### 開発ツール・規約

| 技術 | 詳細 |
|------|------|
| Node.js 20 | ランタイム。GitHub Actions およびローカル開発で使用 |
| npm | パッケージマネージャー |
| AGENTS.md | AI 開発プロトコル。デッドロック防止・反復キャップ・エラー分類・品質ゲート等を規定 |
| MIT License | オープンソースライセンス |

---

## 開発環境のセットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview
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
