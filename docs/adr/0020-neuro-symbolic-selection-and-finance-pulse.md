# ADR-0020: 財務パルス × ニューロシンボリック選定（Jev）× IDEAZ の型

- 日付: 2026-10-10
- 状態: 採用
- 関連: ADR-0016（囲い）、ADR-0018（トレンド・レーダー）、INV-003 / INV-004 / INV-012 / INV-013、LM-017 / LM-018

## 文脈

テーマは Nova（LLM）が「テーマ残高」だけを見て選んでいた。外の地形も、
ミナ自身の資産の動きも、選定には入っていなかった。書き方も日記体の固定ルールで、
note で実績のある IDEAZ の型（関門の一文・シグナル5つ・タイトル規格・文体）とは別物だった。

また、選ぶ係に文字列を生成する LLM を置くと、「選んだ理由」をそれらしく書けてしまい、
規則違反の候補を選んでも言い訳がつく。選定は**判断**であって、文章ではない。

## 決定

### 1. VE-011 Kaia（Treasurer）— QAIZ と assetlog を毎日読む

- assetlog: 公開スプレッドシートの logs を gviz（鍵不要）で読み、前日比・1週・1か月・高値からの距離・
  連続日数・30日ボラティリティを出す
- QAIZ: `GET /api/overview`（`QAIZ_BASE_URL`）からレジーム・市場の幅・セクターの強弱・象限の切り替わりを拾う
- 観測を**記号の事実**（`portfolio.drawdown`、`divergence.market_up_me_down` …）に落とす
- **金額は持たない**（`disclosure: relative`）。公開リポジトリにコミットされる
  `data/finance-pulse.json` にも、記事にも、実額は出ない。継続性台帳の「総資産額は逆行しない」と
  実際に上下する資産が衝突しないため

### 2. VE-012 Juno（Arbiter）— ニューロシンボリック選定

| 層 | 何をするか | 失敗したら |
|----|-----------|-----------|
| 記号（決定論） | 候補生成 → 硬い規則で落とす → 特徴量（不足度・顕著さ・新しさ） | 失敗しない（純関数） |
| 神経（Jev） | 生き残りの候補 ID の **Choice** と、関門の一文を埋められるかの **Noul** | 無料 LLM → 記号のみ |
| 融合 | `final = 0.45·symbolic + 0.55·neural`。確信度 < 0.55 なら棄権扱い | — |

Jev を選んだ理由:
- 文字列を返さない。宣言した選択肢（候補 ID の enum）の外を返せないので、
  **記号の規則で落ちた候補は型の上で選べない**
- 確信度が返る。低いときに棄権させられる（選択的予測）
- Cloudflare Workers AI の無料枠（1日 10,000 Neurons）で叩ける。鍵は
  `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` だけ

それでも応答は受け取る側で型検査し直す（宣言外の選択肢・範囲外の確率は捨てる）。
「原理的に起きない」を確かめるのは受け取る側の仕事（INV-013 と同じ考え方）。

### 3. 書き方は IDEAZ の型

`prompts/ideaz/` に IDEAZ の memory/ の写しを置き、`scripts/sync-ideaz.mjs` で毎朝取り寄せ直す。
組み立ては IDEAZ の build.mjs と同じく見出し単位で抜くだけで、文言はこのリポジトリに持たない。
AI 以外の題材の日は「読み替え」を1段添える（軸の「強いAI」→ 前は手が届かなかったやり方、など）。
見出し記号を使わない型なので `qualityGate.minH2Headings` を 0 にした。

### 4. 全部無料枠

| 何を | どこで |
|------|-------|
| 財務データ | gviz（鍵不要）/ QAIZ（Workers 無料プラン） |
| 選定 | Workers AI 無料枠の Jev → GitHub Models 無料枠 |
| 執筆 | Gemini 無料枠 → **GitHub Models**（Actions の `GITHUB_TOKEN` だけ。鍵の登録ゼロ）→ Groq / Cerebras / OpenRouter `:free` |

Workers AI の Neurons は Jev に全部回すため、文字を書くチェーンには入れていない
（`workers-ai` の SDK は配線済みで、JSON の追記だけで載せられる）。

## 帰結

- 選定の記録は `docs/selection-runs/YYYY-MM.md`。採用だけでなく、負けた候補と落とした候補も残す
- Jev の公開 API は早期アクセス中で、リクエストの細部が動く可能性がある。モデル ID は
  `JEV_WORKERS_AI_MODEL`、TypeSafe 直のベース URL は `TYPESAFE_API_BASE_URL` で差し替えられ、
  応答の読み取りは複数の形を受け付ける。読めなければ記号の順位で決まり、記事は止まらない
- `QAIZ_BASE_URL` が未設定なら QAIZ は読まない（assetlog だけで動く）
