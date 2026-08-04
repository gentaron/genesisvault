# Runbook: 記事 → Linear → 動画

記事から短尺動画までの経路と、詰まったときの触り方。

設計判断は ADR-0017、壊してはいけない前提は INV-017 / INV-018 にある。

---

## 経路

```
daily-post.yml (11:30 UTC)
  │  auto-post.mjs         記事を生成
  │  verify:quick          決定論チェック
  │  commit + push         src/content/posts/
  ▼
linear-video-brief.mjs
  │  VE-009 Runa           記事 → ブリーフ5フィールド
  │  lintVideoBrief()      決定論チェック（通らなければ Issue を作らない）
  │  issueCreate           Linear: Todo + agent-ready
  │  data/video-briefs.json を commit + push
  ▼
（任意）repository_dispatch → VAIZ を即起動。無ければ VAIZ の cron (22:00 UTC) 待ち
  ▼
VAIZ video-loop
  plan → images → tts → render → publish
  → 同じ Issue に mp4 を添付して In Review
```

---

## 手で動かす

```bash
# 生成と検証だけ。Linear には一切触らない
bun run video:brief:dry

# 最新の記事を送る
LINEAR_API_KEY=... GEMINI_API_KEY=... bun run video:brief

# 特定の記事を送る
bun run video:brief -- --date 2026-08-03
bun run video:brief -- --file src/content/posts/2026-08-03-post-dgbijg.md

# ラベルを貼らずに置く（人間が agent-ready を貼るまで VAIZ は拾わない）
bun run video:brief -- --no-agent-ready
```

`--dry-run` は Linear の認証情報を要求しない。ブリーフの中身だけ見たいときはこれ。

---

## 症状別

### Issue が作られない

スクリプトは「作らない理由」を必ず1行で出して **exit 0** で終わる。
Actions のログでその行を読む。

| ログ | 意味 | 対応 |
|------|------|------|
| `既に Linear へ送信済みです` | 台帳にある | 正常。再送したいなら台帳から該当行を消す |
| `Linear に同じ記事の Issue が既にあります` | 台帳が古い | 正常。台帳は自動で直る |
| `Todo に未着手のブリーフが N 件あります` | 背圧が効いた | VAIZ 側を見る（下記） |
| `LINEAR_API_KEY が未設定` | Secret が無い | リポジトリの Secrets を確認 |
| `AI プロバイダーのキーが1つも設定されていない` | 生成できない | 同上 |

### `ブリーフが 3 回とも検証を通りませんでした`（exit 1）

Runa の出力が `lintVideoBrief()` に落とされ続けている。
ログに差し戻し理由が全部出ているので、まずそれを読む。

| ルール | よくある原因 |
|--------|------------|
| `topic_anchor` | 記事が抽象的でタグと本文が噛み合っていない |
| `verbatim_copy` | 記事が短く、要約すると原文に寄ってしまう |
| `point_bullet` / `title_prefix` | プロンプトの指示が効いていない（モデルが弱い） |

記事側の問題なら放置してよい（翌日の記事で回復する）。
繰り返すなら `prompts/runa/` を新バージョンで更新する。

**Issue は作られていない。記事は既に push 済みなので、失われたものは無い。**

### Todo が詰まって背圧が効いている

VAIZ が消化していない。順に見る。

1. VAIZ の Actions で video-loop が失敗していないか
2. 失敗した Issue が **In Progress のまま**残っていないか
   （VAIZ は後段の失敗では Todo に戻さない。原因未修正のリトライで
   無料枠を食い潰さないための設計）
3. 直したら VAIZ の Actions から手動で Run workflow

一時的に流量を上げたいだけなら `config/pipeline.json` の
`videoBrief.maxQueued` を上げる。恒久的に上げる前に、なぜ詰まったかを見ること。

### 同じ記事の Issue が 2 件できた

INV-017 の冪等が破れている。起きうる筋は 1 つだけ:

- 台帳のコミットが失われ、かつ Linear の新しい 100 件から外れるほど
  古い記事を再送した

片方を Cancel し、台帳に正しい 1 件を書いて commit する。

---

## 設定

すべて `config/pipeline.json` の `videoBrief`。TypeScript 側に値は無い（INV-001）。

| キー | 既定 | 意味 |
|------|------|------|
| `teamKey` | `GEN` | 起票先の Linear チーム |
| `label` | `agent-ready` | VAIZ が拾う目印 |
| `minSeconds` / `maxSeconds` | 45 / 60 | **VAIZ の `PlanSchema` と一致必須** |
| `minScenes` / `maxScenes` | 6 / 8 | 同上 |
| `minPoints` / `maxPoints` | 4 / 7 | 「伝えたいこと」の件数 |
| `maxQueued` | 3 | 背圧の閾値 |
| `maxVerbatimChars` | 60 | 記事本文との逐語一致の上限 |

尺とシーン数を動かすときは **VAIZ 側の `scripts/video/plan.mjs` も同時に直す**。
片方だけ動かすと、VAIZ が組めない企画を毎晩生成し続ける。

---

## Secrets

| 名前 | 必須 | 用途 |
|------|------|------|
| `LINEAR_API_KEY` | ○ | Issue の作成 |
| `GEMINI_API_KEY` 他 | ○ | ブリーフ生成（1つでもあれば動く） |
| `VAIZ_DISPATCH_TOKEN` | — | VAIZ の即時起動。無ければ VAIZ の cron が拾う |

`VAIZ_DISPATCH_TOKEN` は `gentaron/VAIZ` に対する `contents: write` を持つ PAT。
待ち時間を最大 10 時間縮めるだけのものなので、無くても経路は成立する。

---

## 止め方

| やりたいこと | 方法 |
|-------------|------|
| 人間の承認ゲートに戻す | 起票工程に `--no-agent-ready` を付ける（Todo には積まれ、ラベルは人間が貼る） |
| 起票そのものを止める | `daily-post.yml` の該当ステップを削除するか、`LINEAR_API_KEY` を外す |
| 一時的に止める | Linear 側で Todo を `maxQueued` 件以上溜める（背圧が自動で止める） |
