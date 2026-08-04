# Genesis Vault

**思考の種を保管する、静かなデジタル日記**  
Mina Eureka Ernst による個人ブログ

🌐 **サイト**: https://genesisvault.vercel.app

---

## 概要

Genesis Vault は、Mina Eureka Ernst（ミナ・エウレカ・エルンスト）による個人日記ブログです。  
散歩・瞑想・ひとり旅・ジャーナリング・貯金・投資・マインドフルネスをテーマに、  
毎日 **8つのAIエージェント（Liminal Forge）** が記事を自動生成・投稿します。

記事は **Ethereum ウォレット接続（3 USDC）** でフルアクセス可能です。

---

## このリポジトリの歩き方

生成は安く、検証が高い。だからこのリポジトリは「エージェントが速く書けること」より
**「人間が速く判定できること」**を優先して構成されています。触る前に読む場所は4つ。

| 見る場所 | 何が分かるか |
|---------|-------------|
| [`config/pipeline.json`](./config/pipeline.json) | パイプラインの設定すべて（エージェント・プロバイダー・ルーティング・品質閾値）。**設定はここ1枚だけ** |
| [`docs/almanac/`](./docs/almanac/) | 壊してはいけない前提・一度踏んだ罠・ADR/Runbook の索引 |
| [`AGENTS.md`](./AGENTS.md) | AI が従う開発プロトコル（最優先） |
| `bun run verify` | マージしてよいかを決める単一コマンド |
| [`src/lib/pipeline/review.ts`](./src/lib/pipeline/review.ts) | 囲い（審査層）。生成物を落とすか通すかを決める |

```bash
bun run verify         # 設定・記事リント・記憶の鮮度・型・テストを一括検証
bun run verify:quick   # 設定と記事リントのみ（数秒）
```

`verify` は **LLM もネットワークも API キーも使いません**。ローカルと CI で同じ答えが出ることが、
ゲートとして信用できる条件だからです（詳細は [ADR-0015](./docs/adr/0015-workflow-restructure.md)）。

設定を変えたいときは TypeScript を探さないでください。`config/pipeline.json` を編集して
`bun run verify` を実行すれば、スキーマ検証と参照整合性チェックが結果を教えます。

---

## 囲い（審査層）

生成された記事は、執筆とは独立した審査を通ってからでないと公開されません。
設計の出発点は**「見逃しは何も表示しない」**という一点です。
甘い審査はエラーも警告も出さず、全部緑のまま雑なものを外に出します。
誤検知はうるさく、見逃しは静か。だから運用の直感に任せず、構造で防ぎます。

| 層 | 何をするか | LLM | どこで検証されるか |
|----|-----------|-----|------------------|
| 決定論ゲート | 文字数・体裁・プレースホルダー・定型表現・エージェントID | 不要 | `bun run verify`（毎回） |
| 審査役（judge） | 指示への追従・具体性・テーマのすり替え・整合 | 必要 | `bun run gate:eval` |
| 人間 | 最終マージ | — | PR |

### 審査役の5つの防御

1. **審査役には書き手と同等以上のモデルを配る** — 弱い審査役の見逃しは表示されない。設定チェックで機械的に禁止（INV-011）
2. **モデルは観察だけを返し、合否はコードが決める** — 採点者が自分の点数を申告する構造は甘くなる方向にしか壊れない（INV-013）
3. **減点には原稿からの逐語引用が要る** — 実在しない引用は照合して破棄する。この検証はモデルを使わない（INV-014）
4. **veto 項目は加重平均に参加しない** — テーマのすり替えと事実の逆行は一発不合格
5. **審査できなければ通さない（fail-closed）** — 閉じられないゲートは、閉じたことにする（INV-012）

審査役には企画指示と成果物しか渡しません。執筆時の文脈を持たせると、外部審査ではなく自己評価になります。

### ゲート自身を測る

記事の品質は審査役が測ります。では審査役の品質は誰が測るのか——という問いに、
`tests/fixtures/gate/` のゴールデン事例集が答えます。既知の不良と正常な対照群を意図的に置き、
**捕捉率と誤検知を数えられる**ようにしてあります。

```bash
bun run gate:eval        # 審査役の捕捉率・見逃し・捏造引用を測定（APIキー必須）
bun run gate             # 実際の原稿を審査（差し戻し時は .gate-quarantine/ へ隔離）
```

事例のうち2件は `blindspot`——**決定論では原理的に捕まえられないと分かっている不良**です
（体裁は完璧だが中身が一般論だけの記事／指示と別テーマにすり替わった記事）。
決定論テストはこれらが「通過してしまうこと」を明示的に固定しています。
成功の記録ではなく限界の記録で、審査役が唯一の防波堤であることを可視化するためのものです。

判定は通過分も含めて `docs/gate-runs/YYYY-MM.md` に残ります。
何を落としたかだけ記録しても、見逃しは見つからないためです。

詳細は [ADR-0016](./docs/adr/0016-the-enclosure.md)。

---

## Multi-Agent AI パイプライン

記事生成は以下の8エージェントが順番に担当します：

| ID | エージェント | 役割 |
|----|-------------|------|
| VE-004 | **Vera Holt** (Researcher) | 過去記事から確定事実（貯金額・到達済みマイルストーン等）を抽出 |
| VE-005 | **Nova Harmon** (Balancer) | テーマバランス分析・ジャンル選定 |
| VE-001 | **Lena Strauss** (CEO) | トピック・切り口・タイトルの決定 |
| VE-003 | **Chloe Verdant** (SEO) | タグ・キーワード・メタディスクリプション生成 |
| VE-002 | **Sophia Nightingale** (Writer) | 本文執筆（1,000〜2,000字・日記体） |
| VE-006 | **Iris Koenig** (Editor) | 校正・品質チェック・ペルソナ一貫性確認 |
| VE-007 | **Edda Lindgren** (Summarizer) | 抽出事実を継続性台帳へ統合・逆行禁止ブリーフ生成 |
| VE-008 | **Mira Falk** (Recorder) | 投稿記事の確定事実を台帳へ記録・更新 |

記事が push されたあと、9体目が別工程として走ります。

| ID | エージェント | 役割 |
|----|-------------|------|
| VE-009 | **Runa Vogel** (Briefer) | 公開記事から短尺動画のブリーフを起こし Linear へ渡す |

### 記事 → 動画（Phase μ）

公開した記事は、そのまま短尺動画の企画になります。

```
記事を push
  ▼ VE-009 Runa      記事 → 動画ブリーフ（テーマ / 伝えたいこと / トーン / 尺 / ビジュアル）
  ▼ Linear           Todo + agent-ready で起票
  ▼ VAIZ             ブリーフを claim → 画像・音声・描画 → 同じ Issue に mp4 を添付
```

境界は Linear だけです。Genesis Vault は Issue を置くだけ、
[VAIZ](https://github.com/gentaron/VAIZ) は Issue を拾うだけで、互いを知りません。
同じ形式で人間が手書きした Issue も、VAIZ からは区別なく処理されます。

`agent-ready` は無人パイプラインの着手合図なので、貼る前に4つの機械的な制約
（冪等・背圧・決定論検証・転載検出）を全部通します。どれか1つでも欠けたら
Issue を作らずに終わります（INV-017）。

- 設計判断: [ADR-0017](./docs/adr/0017-video-brief-handoff.md)
- 運用手順: [docs/runbooks/video-brief.md](./docs/runbooks/video-brief.md)
- 手で試す: `bun run video:brief:dry`（Linear には触りません）

### 過去記事整合性（継続性サブシステム）

Vera → Edda が過去記事から「継続性台帳」(`data/continuity-ledger.json`) を構築し、
**逆行禁止ブリーフ**を CEO/Writer に注入します。これにより
「貯金300万円達成の記事の後に貯金200万円達成の記事を書く」といった内容の逆行・矛盾を防ぎます。
投稿後は Mira が台帳を更新し、参照源を常に最新に保ちます。

- 継続性の正典ソース: 本パイプラインが生成した日記（`src/content/posts/`）
- 金額は「最高到達点」を正典とし、個人の現実的上限（1億円）超や統計引用は除外

### 参照源（文体・テーマ）

文体サンプル・タイトル・テーマバランスの参照には以下の WXR エクスポートを使います
（`config/pipeline.json` の `references`）。

- `gensnotes_1.md` / `gensnotes_2.md` — 旧ブログ「旧Gens Notes」（レガシー）
- `gensnotes_3.md` / `gensnotes_4.md` / `gensnotes_5.md` — 現行ブログ「Genesis Vault - ミナ・エウレカ」（**現時点の最新参照源**）

**利用可能な無料プロバイダー**（APIキーが設定されたものだけがチェーンに入る）:
- `gemini-2.5-flash-lite` — 15 RPM / 1000 RPD
- `gemini-2.5-flash` — 10 RPM / 250 RPD
- `groq-llama-3.3-70b` — Groq 無料ティア
- `cerebras-llama-3.3-70b` — Cerebras 無料ティア
- `openrouter-free` — OpenRouter 無料モデル
- `huggingface` — HuggingFace Inference API

**ティア制ルーティング（Phase ι）**: エージェントの役割ごとに最適なプロバイダー順・temperature・トークン上限を割り当てます。ルーティング表は `config/pipeline.json` の `routing.byAgent` に、各設定の理由（`why`）付きで宣言されています（実装は `src/lib/ai/routing.ts`、詳細は `docs/adr/0014-tiered-agent-routing.md`）。

| エージェント | ティア | 優先プロバイダー | temp |
|-------------|--------|----------------|------|
| Nova (Balancer) | light | Groq → Cerebras → flash-lite | 0.3 |
| Lena (CEO) | creative | flash → flash-lite → Groq | 0.9 |
| Chloe (SEO) | light | flash-lite → Groq → Cerebras | 0.4 |
| Sophia (Writer) | heavy | flash → flash-lite | 0.85 |
| Iris (Editor) | precision | flash-lite → flash | 0.3 |

軽い分類タスクは高速な無料プロバイダーへ、日本語長文の執筆は最も強い Gemini モデルへ。優先プロバイダーが失敗・未設定の場合は残りのチェーンに自動フォールバックします。生成後は品質ゲート（`src/lib/pipeline/quality-gate.ts`）が文字数・プレースホルダー・AIアーティファクトを検査し、不合格ならテンプレートにフォールバックします。

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
| [OpenRouter](https://openrouter.ai/) | `@openrouter/ai-sdk-provider`。無料モデル3種を順に試行: `meta-llama/llama-3.3-70b-instruct:free` → `qwen/qwen-2.5-72b-instruct:free` → `deepseek/deepseek-chat:free`（ADR-0010）|
| [HuggingFace](https://huggingface.co/) | `@ai-sdk/huggingface`。`Llama-3.3-70B-Instruct`。サーバーレス無料ティア |
| Multi-Agent Pipeline | 8エージェント順次実行（Vera → Nova → Lena → Chloe → Sophia → Iris → Edda → Mira）。名簿と実行順は `config/pipeline.json`、実装は `src/lib/agents/runners.ts` |
| Declarative Config | `config/pipeline.json` が設定の唯一のソース。Zod 検証＋参照整合性チェック（ADR-0015） |
| Article → Video Handoff | VE-009 Runa が記事を動画ブリーフに変換し Linear へ起票。VAIZ が拾って動画にする。境界は Linear のみ（ADR-0017） |
| Structured Outputs | Nova/Lena/Chloe は `generateObject` + Zod スキーマ検証。Sophia/Iris は `generateTextWithFallback` |
| Multi-Provider Fallback | 6プロバイダ8モデルチェーン（OpenRouter内は3モデル分散） + ダイレクト Gemini REST フォールバック。~99.99% 稼働率 |
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
| [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) | マルチウォレット検出（MetaMask, Brave, Coinbase Wallet, Rabby, Frame, Phantom-EVM, Rainbow 等）。`window.ethereum` 直接アクセスは廃止（フォールバックのみ） |
| viem WalletClient | `createWalletClient` + `custom(provider)` による EIP-1193 プロバイダ接続。チェーン検証・自動切替 |
| viem PublicClient | `waitForTransactionReceipt` によるインテリジェントレシートポーリング（2確定、120秒タイムアウト）。旧40回×3秒ポーリングを置換 |
| Server-side Paywall | Vercel Edge Function による HMAC 署名 Cookie 検証（Phase δ） |

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
| [Vitest](https://vitest.dev/) | 4.x。ユニットテスト（件数は `bun run test` で確認）。v8 カバレッジを CI で強制 |
| [@vitest/coverage-v8](https://vitest.dev/guide/coverage) | v8 カバレッジプロバイダー。CI で閾値強制 |
| [happy-dom](https://github.com/capricorn86/happy-dom) | DOM テスト用ランタイム |
| [Playwright](https://playwright.dev/) | 1.50+。E2E テスト（6 ユーザージャーニー）。Chromium 対応 |

### CI/CD・自動化

| 技術 | 詳細 |
|------|------|
| [GitHub Actions](https://github.com/features/actions) | `daily-post.yml`（自動生成）+ `healthcheck.yml` + `ci-verify.yml`（決定論的ゲート）+ `ci-test.yml`（Unit+Coverage）+ `ci-e2e.yml`（Playwright）+ `codeql.yml`（セキュリティスキャン） |
| Spec as Contract | Issue テンプレートが受け入れ条件と非目標を必須化。PR テンプレートは「契約が満たされた証明」を書かせる（ADR-0015） |
| Deterministic Verify | `bun run verify` が LLM 不要・オフラインで設定・記事・記憶・型・テストを検証。CI と同一コマンド |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | v2。CI で Bun を使用 |
| [CodeQL](https://codeql.github.com/) | セキュリティスキャン（JS/TS）。Push/PR + 毎週月曜実行 |
| [Renovate](https://github.com/renovatebot/renovate) | 依存関係の自動更新（パッチ auto-merge） |
| [Vercel](https://vercel.com/) | 自動デプロイ + Edge Functions（ペイウォール検証 API） |
| Conventional Commits | `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` の形式を採用（AGENTS.md で規定） |

### オブザーバビリティ（Phase η）

| 技術 | 詳細 |
|------|------|
| [Sentry](https://sentry.io/) | エラー追跡 + パフォーマンス監視。Free Tier: 5K errors/month, 10% trace sampling。`@sentry/astro` v10 で統合 |
| [Umami](https://umami.is/) | プライバシー重視のアナリティクス（Cookie-free, self-hosted）。Plausible CE から移行（Postgres-onlyでデプロイ簡易化） |
| [Pagefind](https://pagefind.app/) | 静的サイト内全文検索。Cmd+K で検索ダイアログ。ゲート記事の本文は `data-pagefind-ignore` でインデックス除外 |
| Healthcheck | GitHub Actions で6時間ごとにサイト死活監視 + 記事鮮度チェック + ペイウォール検証。失敗時に自動 Issue 作成 |
| Agent Telemetry | `docs/agent-runs/YYYY-MM.md` に毎回のパイプライン実行ログを公開（使用プロバイダ・試行回数・レイテンシ） |
| /status | ビルド時生成のシステムステータスページ（最新記事・総記事数・エージェント実行履歴・監視スタック概要） |
| Scheduled Post Verify | 毎日 12:00/13:00 UTC に自動投稿が正常にコミットされたか検証するワークフロー |

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

### 検証ゲート・生成物の更新

```bash
# マージ可否を決める単一ゲート（LLM・ネットワーク・APIキー不要）
bun run verify
bun run verify:quick     # 設定と記事リントのみ（数秒）

# 生成物の再生成（手編集しないこと）
bun run config:schema    # config/pipeline.schema.json を Zod スキーマから再生成
bun run almanac          # docs/almanac/INDEX.md を ADR/Runbook から再生成
```

`verify` は生成物のドリフト（再生成し忘れ）も検出して失敗します。

### 既存指摘のラチェット

Biome と `astro check` にはリポジトリ発足以来の指摘が残っています。一括修正は
85ファイルの整形差分になりレビュー不能になるため、`config/quality-baseline.json` で
**件数を増やさないこと**だけを機械的に保証しています。触ったファイルだけを直してください。

```bash
bunx biome check --write <実際に変更したファイル>
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

## 関連リポジトリ

| リポジトリ | 説明 |
|-----------|------|
| [gentaron/edu](https://github.com/gentaron/edu) | EDU メインアプリケーション |
| [gentaron/edutext](https://github.com/gentaron/edutext) | ストーリーテキスト (JP/EN) |
| [gentaron/image](https://github.com/gentaron/image) | キャラクター画像 |
| [gentaron/eurekaspace](https://github.com/gentaron/eurekaspace) | EDU 百科事典サイト |
| [gentaron/laylaland](https://github.com/gentaron/laylaland) | Layla キャラクターサイト |
| [gentaron/irisworlds](https://github.com/gentaron/irisworlds) | Iris キャラクターサイト |

## ライセンス

MIT License

---

**著者**: Mina Eureka Ernst（ミナ・エウレカ・エルンスト）  
**サイト**: https://genesisvault.vercel.app  
**コンセプト**: Liminal Forge AI × 静かなデジタル日記
