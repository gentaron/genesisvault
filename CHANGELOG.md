# Changelog

書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従います。

このリポジトリは日次で記事を自動投稿するため、コミット履歴の大半は
`New post: YYYY-MM-DD — …` というコンテンツ追加です。**このファイルはコンテンツを追いません。**
記録するのはパイプライン・審査層・インフラの変更、つまり「仕組みが変わったこと」だけです。
記事一覧はサイト側 (https://genesisvault.vercel.app) を参照してください。

過去分は git ログと ADR から再構成しました。開発フェーズには元の履歴どおり
ギリシャ文字 (…κ, λ, μ) を振っています。

## [Unreleased]

### Removed

- **デッドコード 58 件を削除。** 未使用の変数・import に加えて、実際に死んでいたもの:
  - `src/scripts/wallet-ui.ts` の `currentAccount` — 4 箇所で代入されるが一度も読まれない
    書き込み専用の状態（アドレスは毎回 `renderWalletPanel(addr)` に直接渡している）。
    未使用の `MAINNET_CHAIN_ID` も削除。
  - `src/pages/agents.astro` の `(agent as any).currentVersion = (agent as any).currentVersion;`
    2 行 — `as any` を経由した自己代入で、何もしていなかった。`buildTime` も未使用。
  - `src/lib/pipeline/config.ts` の `chainRank` — 構築されるが参照されない Map。
  - `vitest.config.ts` の `maxForks: '50%'` — Vitest 4 に存在しない設定キーで、
    黙って無視されていた。意図（コア数の 50%）を保ったまま `maxWorkers` に直した。

### Fixed

- **`.mjs` に TypeScript 構文を書いた 2 本のスクリプトが起動すらしなかった問題。**
  `bun run analyze:themes` と `bun run gen:resume` は `node --check` も `bun` も通らない
  構文エラーで即死していた（Bun は拡張子を尊重するので `.mjs` では型を剥がさない）。
  `.mjs` は tsc の対象外でもあるため、型チェックにもかからず誰も気づけなかった。
  両方を `.ts` にリネームし、`package.json` の呼び出しも合わせた。

  `analyze-themes` にはさらに 2 つの欠陥が隠れていた:
  - `ROOT_DIR` が `path.join(__dirname, '..', '..')` でリポジトリの外を指していた
    （他のスクリプトはすべて `'..'` 1 つ）。
  - 型注釈 `{ title: string; tags?: string[] }` から配列の `[]` が落ちていた。

  修正後、`analyze:themes` は 172 記事のテーマバランスを出力する。

- **`biome check --write` がサイトを壊す問題**（`biome.json` の `overrides`）。
  Biome 2.x の Astro 対応は frontmatter しか解析しないため、テンプレートからのみ
  参照される変数と import がすべて「未使用」に見える。`index.astro` の
  `import BaseLayout` は FIXABLE な削除対象として報告されていた — 適用すれば
  ページ全体を包むレイアウトが消える。`{age}` `{formattedDate}` `{sortedPosts}` なども
  `_age` 等へリネームされ、ページは壊れた顔をせず undefined を描画する。
  `**/*.astro` について `noUnusedVariables` / `noUnusedImports` を off にした
  （astro ファイルの未使用チェックは `astro check` 側の責務）。詳細は LM-011。

### Changed

- **`any` をリポジトリ全体から排除（36 件 → 0 件）。** 主なもの:
  - `api/_lib/paywall.ts` — JSON-RPC の応答に `RpcResponse<T>` / `RpcReceipt` / `RpcLog`
    を与え、`makeRpcCall` をジェネリックにした。支払い検証が依存するフィールドが
    型として明示される。
  - `src/lib/ai/generate.ts` — `(error as any).status` を `HttpError` インターフェースに。
  - `src/lib/agents/runners.ts` / `src/lib/pipeline/rules.ts` — リテラル union 配列の
    `includes()` を `any` で回避していた箇所を `readonly string[]` への widening に。
  - `src/pages/agents.astro` — `AgentCard` インターフェースを定義し、代入側・参照側
    双方の `as any` を不要にした。
  - テスト群 — `globalThis as any` を型付きビューに、banned type の `Function` を
    明示的な呼び出しシグネチャに（8 件 → 0 件）。
- 型エラーを 17 件 → 3 件に削減。残り 3 件は `@ai-sdk/*` が `LanguageModelV3` を返すのに
  `ai` v5 の `LanguageModel` が `V2` を指している版ずれで、**コード側では直せない**。
  フォールバック連鎖 5 本のうち 3 本（cerebras / openrouter / huggingface）が該当する。
  依存の更新方針として判断が要る（LM-003）。
- 品質ラチェットを締めた: `biomeErrors` 105 → 94、`astroCheckErrors` 17 → 3。
  残る 94 件は 93 件が純粋な整形（`format` / `organizeImports`）と CSS の parse 1 件。
- `LANDMINES.md` に LM-011（Biome の autofix が Astro を壊す）と
  LM-012（`.mjs` に型を書くと誰にも検査されない）を追加。LM-003 / LM-004 を実態に更新。

### Added

- `LICENSE` (MIT)。README が MIT を宣言していたのに実体がなく、GitHub のライセンス検出も
  効いていなかった状態を解消。Astro / Vercel AI SDK など依存ライブラリとの整合も明示。
- `CONTRIBUTING.md` — 触る前に読む 4 か所、単一ゲート `bun run verify` の不可侵条件
  （LLM もネットワークも API キーも使わない）、lint のラチェット運用の明文化。
- `SECURITY.md` — 非公開報告手順と重大度の目安。脅威モデル本体は `docs/security.md` のまま。
- `CHANGELOG.md` (このファイル)。
- `docs/runbooks/issue-triage.md` — Issue の出どころ別の扱いと、ヘルスチェック Issue の
  ライフサイクル。
- README に「Issue の読み方」節。

### Fixed

- **`linear-write.yml` が YAML として壊れており、一度も実行されていなかった問題。**
  `gh pr create --body` にシェルの複数行文字列を使っていたため、2 行目が列 1 から始まり
  `run: |` のブロックスカラーを終端させていた。結果としてファイル全体が構文エラーになり、
  GitHub は `name:` すら読めない状態だった（ワークフロー一覧での表示名が
  `Linear → Write` ではなくファイルパス `.github/workflows/linear-write.yml` のままだったのが
  その痕跡）。2026-07-29 の追加以降ずっとこの状態。
  本文の改行を `printf` で組み立てる形に変え、PR 本文の内容は変えずに構文を修復した。

- **ヘルスチェックが失敗のたびに新しい Issue を作り続けていた問題。**
  6 時間おきに走るため、1 件の障害が放置されると Issue が無限に積み上がる。実際に 194 件が
  滞留していた（すべて同一障害の再通知）。Issue 本文には "It will be auto-resolved once the
  next healthcheck passes" と書かれていたが、そのクローズ処理は存在しなかった。

  修正後は「未解決の障害 = 最大 1 Issue」に集約し、既存 Issue の本文を最新化する
  （コメントは 24 時間に 1 回まで）。ヘルスチェックが成功した時点で open な healthcheck
  Issue を自動クローズする — 元の本文が約束していた挙動を実装した。
  検査内容 (HTTP 200 / 記事鮮度 36h / ゲート 402) と実行間隔は変更していない。

### Changed

- ヘルスチェックの通知を第三者アクション `dacbd/create-issue-action@main` から公式の
  `actions/github-script@v7` に置き換え。`issues: write` を持つワークフローが、可変ブランチ
  参照 (`@main`) の外部アクションを実行していたため。

## [Phase μ] — 2026-08-04

### Added

- 記事から動画への受け渡しを Linear 経由で開通。記事公開後に動画ブリーフを Linear へ積み、
  `repository_dispatch: video-brief-ready` で [gentaron/VAIZ](https://github.com/gentaron/VAIZ)
  を起動する。VAIZ 側の cron も同じ Issue を拾うため、この連携は高速化であって前提ではない。
- 動画ブリーフ台帳 (GEN-9)。

## [Phase λ] — 2026-07-29

### Changed

- **囲い（審査層）を作り直した。** 見逃しを運用注意ではなく設計で潰す方針に変更。
- Linear ワークフローにレビュー試行回数の概念を追加。

### Added

- Brief Gate スクリプト (`scripts/brief-gate.mjs`) — ドラフトの評価。
- Linear 同期スクリプトと `linear-write.yml`。

## [Phase κ] — 2026-07-28

### Changed

- **宣言的設定・契約仕様・決定論的検証・記憶インフラへの再構成。**
  設定は `config/pipeline.json` の 1 枚に集約され、TypeScript を読まずに変更できるようになった。
  マージ判定は `bun run verify` の単一コマンドに統一 ([ADR-0015](./docs/adr/0015-workflow-restructure.md))。
  `verify` は LLM もネットワークも API キーも使わない — ローカルと CI で同じ答えが出ることが、
  ゲートとして信用できる条件であるため。

### Added

- Linear ↔ GitHub 連携のセットアップ手順と PR テンプレート。

## [2026-07-04]

### Added

- エージェント別の階層ルーティング (tiered routing)、品質ゲートのパイプラインへの接続
  ([ADR-0010](./docs/adr/0010-tiered-routing.md))。
- フロントエンドの整理 — デザイントークン、sticky header、タイポグラフィ。

### Fixed

- e2e-server の cookie パースを prototype pollution から保護し、動的プロパティ書き込みを排除。
- E2E スイートの修復 — `api/` ハンドラをローカルで提供するようにした。
- Biome 2.x の設定スキーマ修正。

## [Phase δ]

### Security

- **ペイウォールの根本修正。** それ以前はゲート記事の本文が静的ビルド出力に含まれており、
  `localStorage` を書き換えるだけで読めた。修正後はゲート本文を `dist/` に含めず、
  HMAC 署名付き `gv_unlock` Cookie (HttpOnly / Secure / SameSite=Strict / 30 日) を要求する
  `/api/article/[slug]` からのみ配信する。支払い検証はオンチェーンの Transfer イベントの
  デコードで行う。詳細は [`docs/security.md`](./docs/security.md)。

## [Phase γ] — 2026-05

### Changed

- エージェントパイプラインを単一スクリプトから TypeScript のモジュール構成へ分解
  (プロバイダ連鎖 / フォールバック付き生成 / テレメトリ / zod スキーマ / エージェントランナー)。
  詳細は [`docs/runbooks/agent-pipeline.md`](./docs/runbooks/agent-pipeline.md)。
