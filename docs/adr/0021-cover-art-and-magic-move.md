# ADR-0021: 挿絵（決定論 SVG + FLUX.1 schnell）と Magic Move（View Transitions）

- 日付: 2026-10-12
- 状態: 採用
- 関連: ADR-0019（PWA）、ADR-0020（Workers AI の無料枠）、LM-020

## 文脈

記事は文字だけで、一覧も記事ページも絵が無かった。スライドを自作している人のやり方
（Keynote / Slidev の **Magic Move** を軸に、クラウド LLM でやっていた動きをテンプレートに固め、
文字だけ差し替えて使う。アニメーションは使いこなせる 12 種に絞る。CLI 連携は無くてもよかった）を、
ブログに持ち込む。条件は「無料」「エラーを起こさない」。

記事にはコードブロックが1本も無いので、コード専用の Magic Move（shiki-magic-move）は効かない。
Web で Keynote の Magic Move に当たるのは **View Transitions API**（共有要素の移動）。

## 決定

### 1. 挿絵は2段

| 段 | 何で | 費用 | 失敗したら |
|----|------|------|-----------|
| AI の挿絵 | Workers AI の **FLUX.1 schnell**（`@cf/black-forest-labs/flux-1-schnell`, 4 steps）を、日次パイプラインが新しい記事に1枚だけ | 無料枠（1枚あたり数十 Neurons、Clef と同じ 1日 10,000 の枠。Workers Free は超えても課金されない） | 保存しない → 下の SVG |
| カバー絵 | `src/lib/art/cover.ts` が slug から**決定論**で作る SVG（テーマごとの構図 10 種 × 乱数の揺らぎ） | 0（ビルド時の文字列） | 失敗しようがない |

- 構図（テンプレート）は固定し、差し替えるのは slug とテーマだけ。同じ記事は毎回同じ絵
- AI には**人物と文字を描かせない**（ミナの見た目が毎回変わる・偽の文字になる）。記事のタイトルも渡さない
- 応答はマジックバイトで画像か確かめ、600KB を超えたら保存しない。既にあれば描かない
- AI の挿絵がある記事は、それを OGP 画像（`summary_large_image`）にも使う
- 一覧カードは `/art/<slug>.svg` を `loading="lazy"` で読む（148 枚をインラインにすると HTML が 400KB 太る）。
  記事ページの大きな絵だけインライン SVG で、線が描かれていく動きつき

### 2. 動きは CSS だけ・12 種だけ

`src/styles/motion.css`。JavaScript は使わない。

- **Magic Move**: `@view-transition { navigation: auto }`（クロスドキュメント）。一覧カードの絵とタイトルが、
  記事ページの同じ要素へ拡大移動する。`view-transition-name` は `gv-art-<slug>` / `gv-title-<slug>`
  （slug は数字で始まるので接頭辞が要る）
- 12 種: fade-up / fade-in / slide-left / slide-right / scale-in / blur-in / clip-reveal / progress（読了バー）/
  art-draw / art-rise / art-float / art-pulse
- 本文の段落・見出し・一覧カードはスクロール連動（`animation-timeline: view()`）で現れる

### 3. 壊さないための約束

- 動きはすべて `@media screen and (prefers-reduced-motion: no-preference)` の中で付ける。
  「動きを減らす」設定・印刷では最初から何も動かない
- スクロール連動は `@supports (animation-timeline: view())` の中だけ。非対応ブラウザでは最初から全部見える
- View Transitions 非対応のブラウザでは、普通にページが切り替わるだけ
- `ClientRouter`（SPA 化）は**使わない**。BaseLayout と wallet-ui の初期化スクリプトがページ読み込みを前提にしていて、
  SPA 遷移では二重初期化や未初期化が起きうる。クロスドキュメントの View Transitions なら MPA のまま同じ見た目が出る

## 採らなかったもの

- shiki-magic-move: 記事にコードが無い
- Motion / GSAP などの JS アニメーションライブラリ: CSS で足りる。JS は壊れる経路を増やす
- 記事の本文に部品を埋める MDX 化: 書き手（LLM）の出力形式を変えると品質ゲートの前提が崩れる
- 挿絵の CLI / 一括生成コマンド: 過去 148 本を一度に描くと無料枠を超える。カバー絵の SVG で全記事が埋まっているので不要
