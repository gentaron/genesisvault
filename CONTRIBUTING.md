# CONTRIBUTING — Genesis Vault

このリポジトリの前提は README の一行に尽きます。

> 生成は安く、検証が高い。

したがって貢献の評価軸も「速く書いたか」ではなく **「人間が速く判定できる形で出したか」** です。
以下はその判定を速くするための決まりごとです。

まず [AGENTS.md](./AGENTS.md) を読んでください。AI が触る場合は AGENTS.md が最優先で、
このファイルはその補足です。

---

## 触る前に読む 4 か所

README の「このリポジトリの歩き方」と同じです。順番も同じ。

1. [`config/pipeline.json`](./config/pipeline.json) — 設定はここ 1 枚だけ
2. [`docs/almanac/`](./docs/almanac/) — 壊してはいけない前提 (INVARIANTS)、踏んだ罠 (LANDMINES)、ADR/Runbook 索引
3. [`AGENTS.md`](./AGENTS.md) — 開発プロトコル
4. [`src/lib/pipeline/review.ts`](./src/lib/pipeline/review.ts) — 囲い（審査層）

**設定を変えたいときに TypeScript を探さないでください。** `config/pipeline.json` を編集して
`bun run verify` を回せば、スキーマ検証と参照整合性チェックが答えを返します。

## 単一のゲート

```bash
bun run verify        # 設定・記事リント・記憶の鮮度・型・テストを一括検証
bun run verify:quick  # 設定と記事リントのみ（数秒）
```

`verify` が通ることがマージの条件です。この 1 コマンドで足りるように作ってあるので、
「CI では通るがローカルでは分からない」状態を作る変更は入れないでください。

`verify` は **LLM もネットワークも API キーも使いません**。ローカルと CI で同じ答えが出ることが、
ゲートとして信用できる唯一の条件だからです ([ADR-0015](./docs/adr/0015-workflow-restructure.md))。
この性質を壊す変更 — `verify` の経路に `fetch` や API キー依存を持ち込む変更 — は却下されます。

その他:

```bash
bun run test          # vitest
bun run test:e2e      # playwright
bun run lint          # biome check
bun run gate          # ドラフト評価（囲い）の単体実行
```

## Lint はラチェット運用

Biome / `astro check` には既存の指摘が残っています。一括修正すると 85 ファイル規模の
整形差分になり、レビューが成立しません。そこで **触ったファイルだけ直す** 運用にしています。

- 自分が編集したファイルの指摘は消してから出す
- **触っていないファイルの整形差分を PR に混ぜない**
- 一括整形をやりたい場合は、それ単体の PR にして「整形のみ・挙動変更なし」と明記する

この方針は妥協であって理想ではありません。負債の在り処は
[`docs/almanac/`](./docs/almanac/) 側に記録してください。

## Issue の扱い

**Issue の大半は人間が書いたものではありません。** 運用ワークフローが自動で開きます。
種類と扱いは [`docs/runbooks/issue-triage.md`](./docs/runbooks/issue-triage.md) を参照してください。

新規に Issue を立てる前に、テンプレートの `config.yml` が案内している 2 か所
（Runbook と LANDMINES）を先に見てください。だいたい既に答えがあります。

## コミット

Conventional Commits。許可された type は `AGENTS.md` が機械可読な形で規定しています:
`feat`, `fix`, `docs`, `refactor`, `test`, `chore`。

```
feat: 記事から動画への受け渡しを Linear 経由で開通（Phase μ）
fix: e2e-server の cookie パースを prototype pollution から守る
refactor: 宣言的設定・契約仕様へ再構成（Phase κ）
docs: ADR 0010 tiered routing を追加
```

Phase 記号（κ, λ, μ …）は大きな構造変更にだけ付けます。通常の変更には不要です。

## PR

- `.github/pull_request_template.md` を埋めてください
- `bun run verify` の結果を書く
- `config/pipeline.json` を変えたなら、何の閾値がどう動くかを一行で
- 記事コンテンツの変更と、パイプラインの変更は別 PR に分ける

セキュリティ上の問題は [SECURITY.md](./SECURITY.md) を参照してください。公開 Issue に書かないこと。
