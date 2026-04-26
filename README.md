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
2. `gemini-2.5-flash` — 10 RPM / 250 RPD
3. `gemini-2.0-flash` — フォールバック

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

| カテゴリ | 使用技術 |
|---------|---------|
| フレームワーク | Astro 4.x |
| コンテンツ | Markdown / MDX |
| スタイリング | カスタム CSS |
| デプロイ | Vercel |
| 自動化 | GitHub Actions |
| AI | Google Gemini API |
| ウォレット | Ethereum（3 USDC ペイウォール） |

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
