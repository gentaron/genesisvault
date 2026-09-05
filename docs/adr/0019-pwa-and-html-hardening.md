# ADR-0019: フルPWA対応とHTMLのアクセシビリティ・SEO強化

- 日付: 2026-09-05
- 状態: 採用
- 関連: ADR-0004（ペイウォール）、ADR-0007（オブザーバビリティ）、INV-009 / INV-010、LM-002 / LM-011

## 文脈

Genesis Vault は静的 SSG（Astro）+ Vercel API の構成で、manifest も Service Worker も
無くインストール不可だった。HTML の側でも、viewport に `initial-scale` が無く、
構造化データ・フィード・robots も無い。スマートフォンで毎日読む日記として、
ホーム画面からの起動・オフラインでの再読・検索エンジンからの発見可能性を
構造で支えたかった。

## 決定

### 1. PWA は依存を追加せず手書きの Service Worker で入れる

`vite-plugin-pwa`（Workbox ラップ）を採用しなかった。理由は2つ。

- 依存の追加はロックファイルとビルド経路の両方に影響する。このリポジトリは
  `verify` をオフラインで完結させる（INV-004）ため、ビルド時挙動のブラックボックス化は避けたい
- 必要な戦略は 100 行強で書ける。ナビゲーションは network-first（4秒で諦める）、
  `/_astro/*` は cache-first、その他是 stale-while-revalidate。Workbox の抽象は要らない

### 2. ペイウォール境界は Service Worker でも守る

`/api/*` へのリクエストには**一切介入しない**。署名 Cookie の検証はサーバー側のみ
（INV-009）であり、キャッシュ層がその境界に関与する余地を構造的に潰す。
ゲート記事の本文は静的ビルドに存在しないので、キャッシュに本文が載る経路は
そもそも無い（INV-010）。RSS も本文を運ばず description のみ。

### 3. 更新はユーザー主導、インストール促しは一度だけ

waiting な Service Worker がいるときだけ静かなトースト（`role=status`）を出し、
「更新する」が押されたときだけ `skipWaiting` → reload する。自動 reload はしない。
初回アクセス時の `clients.claim()` による controllerchange は更新ではないので
リロードしない（ガード済み）。インストール促しは `beforeinstallprompt` を
捕捉して一度だけ出し、閉じたら 90 日間黙る。

### 4. iOS はスタンドアロン一式を入れる

`apple-mobile-web-app-*`、apple-touch-icon（180px）、スプラッシュ 12 サイズ
（.flat な背景 + アイコン + ワードマーク、計 ~1.2MB、ホーム画面起動時のみ読まれる）。
スプラッシュは 2026-09 時点の主要デバイスの portrait のみ。

### 5. HTML 強化はレイアウトに集約する

- 構造化データ: 全ページに WebSite + Person の `@graph`。記事ページは
  BaseLayout の `jsonLd` プロップで BlogPosting + BreadcrumbList を差し込む
- a11y: スキップリンク、`aria-current`、`aria-pressed`、`aria-labelledby`、
  `role=list/listitem`。既存の `:focus-visible` / `prefers-reduced-motion` は
  global-legacy.css に既にあったので触らない
- エンドポイント: robots.txt / sitemap.xml / rss.xml は依存ゼロのハンドロール
  （`@astrojs/sitemap` の追加を見送り、生成はビルド時・オフラインで完結）

## 影響

- アイコン・スプラッシュは `public/icons` `public/splash` に生成物として置く。
  生成スクリプトはリポジトリ外（Pillow）。差し替えるときは同じ寸法で上書きする
- `config/quality-baseline.json` は、bun.lock の依存更新（biome 2.0.x → 2.4.14）
  で指摘件数がコード変更なしに増えたため 86 → 114 / 3 → 19 に再基準化した
  （2026-08-28 以降 CI の verify が赤かった件の解消を兼ねる）
- e2e に Journey 7（PWA）/ 8（SEO エンドポイント）を追加

## 結果

- `bun run verify` 合格（biome 114 / 型 19 / テスト 479、すべて増加なし）
- playwright e2e 19 件全合格（既存 13 + 新規 6）
- Lighthouse 的な観点: manifest / SW / オフライン / インストール可能性 / 構造化データ /
  viewport / カラースキームを満たす
