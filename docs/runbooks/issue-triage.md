# Issue Triage Runbook

## なぜこの文書があるか

2026 年 6 月の時点で、このリポジトリには **open な Issue が 194 件** ありました。
その 194 件は全部が同じものです — ヘルスチェックワークフローが、失敗するたびに
新しい Issue を 1 件立てていた結果です。

1 回の障害が放置されると、6 時間おきに 1 件ずつ増えます。1 か月で 120 件。
中身は同じで、番号だけが違う。**バグ報告の山ではなく、1 件の障害の再通知の山**でした。

外から見ると区別がつきません。「194 件の未解決 Issue を抱えたリポジトリ」に見えます。
この文書は、Issue の出どころと扱いを明示して、その誤読をなくすためのものです。

## Issue の出どころ

| 出どころ | ラベル | 誰が立てるか | 扱い |
|---|---|---|---|
| ヘルスチェック失敗 | `healthcheck`, `bug` | `github-actions` | **自動**。未解決の障害につき 1 件に集約され、回復時に自動クローズ |
| バグ報告 | `bug` | 人間 (`.github/ISSUE_TEMPLATE/bug.yml`) | 手動トリアージ |
| 機能要求 | `enhancement` | 人間 (`.github/ISSUE_TEMPLATE/feature.yml`) | 手動トリアージ |
| 依存更新 | `dependencies` / `security` | Renovate | PR として来る。`security` は automerge |

**`healthcheck` ラベルが付いた Issue は運用イベントであって、作業項目ではありません。**
統計を取るときは除外してください。

```
# 人間が扱うべき Issue だけを見る
is:issue is:open -label:healthcheck
```

## ヘルスチェック Issue のライフサイクル (2026-08 以降)

`.github/workflows/healthcheck.yml` は 6 時間おき (00:30 / 06:30 / 12:30 / 18:30 UTC) に、
本番サイトに対して 3 つを検査します。

1. トップページが HTTP 200 を返すか
2. 最新記事が 36 時間以内か
3. ゲート記事の API が未認証で 402 を返すか

結果によって以下のように動きます。

```
失敗 → open な healthcheck Issue がある?
        ├── ある  → その Issue の本文を最新化する（新しい Issue は作らない）
        │           コメントは 24 時間に 1 回まで
        └── ない  → 1 件だけ作る

成功 → open な healthcheck Issue がある?
        ├── ある  → 最新の 1 件に回復コメントを付け、まとめてクローズする
        └── ない  → 何もしない
```

つまり **未解決の障害が n 個あっても Issue は最大 1 件** です。

### 以前の挙動との違い

以前は失敗のたびに `Healthcheck failed — <timestamp>` という新規 Issue を作っていました。
Issue 本文には *"It will be auto-resolved once the next healthcheck passes"* と書かれて
いましたが、**そのクローズ処理は実装されていませんでした**。194 件はこの差分です。

あわせて、通知の実装を第三者アクション `dacbd/create-issue-action@main` から公式の
`actions/github-script@v7` に置き換えました。`issues: write` を持つワークフローが
可変ブランチ (`@main`) を指す外部アクションを実行していたためです。

## 障害が起きたときの手順

`healthcheck` Issue が開いたら:

1. Issue 本文の「確認する順番」に従う（Vercel status → デプロイ → 自動投稿 → API キー → パイプライン状態）
2. 記事の鮮度が原因なら [`pipeline-recovery.md`](./pipeline-recovery.md)
3. ペイウォール (402) が原因なら [`paywall.md`](./paywall.md)
4. それ以外は [`incident-response.md`](./incident-response.md)

**Issue を手でクローズしないでください。** 次のヘルスチェックが成功した時点で自動的に
閉じます。手で閉じると、障害が続いている場合に新しい Issue が立ち、また番号が増えます。

## 溜まった Issue の掃除

2026-06-24 以前に作られた `healthcheck` Issue は、すべて同一障害の再通知です。
次にヘルスチェックが成功した時点で、上記のクローズ処理がまとめて閉じます
(1 回の実行あたり最大 100 件なので、200 件弱なら 2 回)。

急ぐ場合は手動でも構いません。

```bash
gh issue list --repo gentaron/genesisvault --state open --label healthcheck \
  --limit 300 --json number --jq '.[].number' \
  | xargs -I{} gh issue close {} --repo gentaron/genesisvault \
      --reason completed \
      --comment "同一障害の再通知として自動生成されたもの。ヘルスチェックの重複排除により集約済み。"
```

閉じる前に `is:issue is:open -label:healthcheck` が 0 件であること
（＝人間が書いた Issue を巻き込まないこと）を確認してください。

## 立てる前に

`.github/ISSUE_TEMPLATE/config.yml` は空の Issue を禁止し、2 か所へ誘導しています。

- [`docs/runbooks/`](../runbooks/) — パイプライン復旧・ペイウォール・監視の手順書
- [`docs/almanac/LANDMINES.md`](../almanac/LANDMINES.md) — 一度踏んだ罠

新しい Issue を立てる前にこの 2 つを見てください。だいたい既に答えがあります。
