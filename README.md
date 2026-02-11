# 2026年の静かな日記ブログ 🌿

朝の柔らかい光がカーテン越しに差し込むような、静かで優しい個人日記ブログです。

## ✨ 特徴

- **毎日自動投稿**: GitHub Actionsで毎日新しい記事が自動生成されます
- **美しい日本語タイポグラフィ**: Noto Serif JP / Noto Sans JPで読みやすさを追求
- **ダークモード対応**: 夜の読書にも優しい自然なダークテーマ
- **ミニマルデザイン**: 紙の日記帳をデジタルにしたような温かみのあるUI
- **完全静的サイト**: Astroで高速・軽量なブログ体験

## 🚀 開発環境のセットアップ

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

## 📝 記事の書き方

`src/content/posts/` に Markdown ファイルを作成します:

```markdown
---
title: 記事のタイトル
date: 2026-02-11
mood: 🌿 平和
weather: ☀️ 晴れ
tags: [日常, 気づき]
---

ここに本文を書きます...
```

## 🤖 自動投稿

毎日午前9時(JST)に自動で新しい記事が投稿されます。手動で実行する場合:

```bash
npm run auto-post
```

## 🎨 デザインコンセプト

- **カラーパレット**: オフホワイト、薄いベージュ、淡いグリーン、ラベンダー
- **フォント**: Noto Serif JP (見出し) + Noto Sans JP (本文)
- **雰囲気**: 朝の柔らかい光、静かで優しい空気、紙の日記帳

## 📦 技術スタック

- **フレームワーク**: Astro 4.x
- **スタイリング**: Tailwind CSS + Typography plugin
- **コンテンツ**: Markdown / MDX
- **デプロイ**: Vercel
- **自動化**: GitHub Actions

## 🌐 Vercelへのデプロイ

1. GitHubにプッシュ
2. Vercelで新規プロジェクト作成
3. リポジトリを選択
4. 自動でデプロイ完了!

## 📄 ライセンス

MIT License

---

**作成者**: Genesis Notes  
**コンセプト**: 2026年の最高の個人日記ブログ
