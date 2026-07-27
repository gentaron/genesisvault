# Linear ↔ GitHub 連携セットアップ

このリポジトリ（`gentaron/genesisvault`）と Linear ワークスペース `gentaron` をつなぐ手順書。

コード側の準備（PRテンプレート、`agent-ready` ラベル）は済んでいる。
残りは **ブラウザでボタンを押す作業だけ** で、これは API では代行できない。以下を上から順に。

---

## 1. GitHub 連携を有効化する（必須・所要3分）

1. Linear を開く → **Settings → Features → Integrations → GitHub**
2. **Connect** を押す。GitHub の OAuth 画面に飛ぶ
3. インストール先に `gentaron` を選び、リポジトリは **`genesisvault` のみ** を選択
   （All repositories は選ばない。将来増えたら都度追加する）
4. 戻ってきたら **Code access** を有効化する

Code access を入れると何が変わるか:

| 機能 | Code access なし | あり |
|---|---|---|
| PR と Issue の紐付け | ○ | ○ |
| Issue 側に PR の状態が出る | ○ | ○ |
| Linear 上で差分を読む（Reviews） | × | ○ |
| Linear 上でレビュー・マージ | × | ○ |
| Coding sessions（後述） | × | ○ |

紐付けだけなら Code access は不要。ただし後述の Coding sessions を使うなら必須なので、
最初から入れておくほうが二度手間にならない。

> GitHub Organization 側で IP allow list を使っている場合のみ、
> Linear の IP を許可リストに追加する必要がある（個人アカウントなら不要）。

---

## 2. PR と Issue を紐付ける方法

紐付けの経路は3つ。**どれか1つ**が満たされればよい。

### (a) ブランチ名（推奨）

Linear の Issue で `Cmd/Ctrl + Shift + .` → ブランチ名がコピーされる。

```
gen5wx/gen-12-fix-rss-feed-encoding
```

この名前でブランチを切れば、PR を開いた瞬間に自動で紐付く。**入力ミスが起きないのでこれが一番堅い。**

### (b) PR タイトルに Issue ID

```
GEN-12 RSS フィードのエンコーディングを修正
```

### (c) PR 本文にマジックワード

`.github/pull_request_template.md` の1行目がこれ。

```
Fixes GEN-12
```

**クローズ系**（マージ時に Issue を Done にする）:
`close` / `fix` / `resolve` / `complete` / `implement`（各活用形も可）

**非クローズ系**（紐付けるが、マージしてもステータスを勝手に動かさない）:
`ref` / `references` / `part of` / `related to` / `contributes to` / `towards`

複数 Issue を1つの PR に紐付ける場合:

```
Fixes GEN-12, GEN-15 and GEN-18
```

> ⚠️ **コミットメッセージと PR コメントでは紐付かない。** ブランチ名・PRタイトル・PR本文の3つだけ。
> 既存の PR を後から紐付けたい場合は、タイトルか本文を編集すれば拾われる。

---

## 3. ステータス自動遷移の設定

**Settings → Team → Workflow** で、PR の状態変化に応じた Issue ステータスを決める。
**チームごとの設定**なので、チームを分割したら両方で設定すること。

推奨マッピング:

| GitHub 側のイベント | Linear のステータス |
|---|---|
| PR が draft で作られた | In Progress |
| PR が review 待ちになった | In Review |
| PR が merge された | Done |

`main` へのマージのみ Done にしたい、といったブランチ別ルールも正規表現で書ける。

---

## 4. チーム分割（GVE / GV）

**これは Linear の UI からしかできない。**API にチーム作成の口がない。

**Settings → Workspace → Teams → Create team** から2つ:

| チーム | キー | 担当 |
|---|---|---|
| Genesis Vault Engineering | `GVE` | Astro サイト、`scripts/`、テスト、CI |
| Genesis Vault Content | `GV` | 記事パイプライン、テーマ設計、公開運用 |

既存の `Gentaron`（`GEN`）は、オンボーディング Issue しか入っていないのでアーカイブしてよい。
`agent-ready` ラベルはワークスペースレベルで作成済みなので、新チームでもそのまま使える。

---

## 5. Coding sessions —— これが本命かもしれない

Linear には **Issue をエージェントに委譲して PR を書かせる機能が公式に載っている**。
Claude Code か Codex がセキュアな環境で走り、Linear が PR を下書きして、差分が Issue に付く。
レビューして問題なければ Linear からそのままマージできる。

つまり **Finn-loop がやろうとしていることの、ホスト版**。

### 有効化

1. GitHub 連携で **code access** を許可（手順1で済ませてある）
2. **Settings → AI & Agents → Coding sessions** をオンにする
3. 使うメンバーは **Connected Accounts** で GitHub アカウントを紐付ける

モデルは Auto（既定は Claude Opus 4.8）のほか、Fable 5 / Sonnet 5 / GPT-5.x が選べる。
ワークスペース単位の設定で、以降の全セッションに適用される。

### `agent-ready` ゲートとの接続

**Settings → Team → Triage** の Triage automation で、
「Triage に入った Issue が特定のラベルを持っていたら coding session を開始」という条件が組める。

ただし発火点は **Triage への到着時**。既存の Issue に後からラベルを貼っても走らない。
「人間がラベルを貼ってから起動」という運用を厳密にやるなら、
Issue を Triage 経由で入れるフローに寄せるか、当面は手動 delegate で回すのが確実。

### コスト

Coding sessions は **ワークスペースの AI クレジット**を消費する（Basic / Business / Enterprise プラン）。
Claude Code のサブスクとは別勘定。**どちらが安いかはワークスペースの人数と稼働量で変わるので、
記事パイプライン（GitHub Actions 無料枠 + 各社 API 無料枠）はここに寄せないこと。**
Coding sessions に載せるのはコード側（GVE）だけにする。

---

## 6. 動作確認

連携が効いているかは、これで確かめられる。

1. Linear で適当な Issue を1つ作る（例: `GVE-1`）
2. `Cmd + Shift + .` でブランチ名をコピーし、そのブランチで空コミットを1つ積む
3. PR を開く。本文の `Fixes GEN-` を `Fixes GVE-1` に直す
4. **Linear の Issue に PR が添付され、ステータスが In Progress に動けば成功**
5. GitHub の PR 側にも Linear からリンクバックのコメントが付く

添付されない場合の切り分け:

- Issue ID の綴りが合っているか（チームキーは大文字、`GVE-1` であって `gve-1` ではない）
- 対象リポジトリが連携対象に含まれているか（手順1でリポジトリを絞ったため）
- ステータスが動かないだけなら、手順3の Workflow 設定が未設定

---

## 参考

- [GitHub 連携](https://linear.app/docs/github)
- [Coding sessions](https://linear.app/docs/coding-sessions)
- [Reviews（Linear 上での差分レビュー）](https://linear.app/docs/diffs)
- 既存 PR は `github.com` を `linear.review` に置き換えると Linear 側で開ける
  例: `linear.review/gentaron/genesisvault/pull/123`
