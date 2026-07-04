# ADR 0010 — Phase ι: ティア制エージェントルーティングと品質ゲート配線

Date: 2026-07-04
Status: Accepted

## Context

Phase γ のフォールバックチェーン（ADR 0003）は全エージェントが同一のプロバイダー順
（gemini-flash-lite が常に先頭）と同一の生成パラメータを共有していた。課題は3つ:

1. **役割とパラメータの不一致** — 校正担当の Iris が Writer と同じ
   temperature 0.85 で動いており、校正のはずが創作的に書き換えるリスクがあった。
   逆に分類タスクの Nova にも 0.85 が適用されていた（structured 経路は
   temperature 未指定 = SDK デフォルト）。
2. **クォータ配分の非効率** — 軽い JSON 分類（Nova/Chloe）が長文執筆と同じ
   Gemini 枠を先頭から消費していた。
3. **未配線モジュール** — Phase θ で実装済みの品質ゲート
   （`src/lib/pipeline/quality-gate.ts`）が `auto-post.mjs` から一度も
   呼ばれていなかった。

## Decision

**エージェントごとのルーティング表**（`src/lib/ai/routing.ts`）を導入する。
これは OpenSquilla / OpenClaude 等のエージェントランタイムで使われる
「タスクをティア分けし、軽いタスクは安い・速いモデルへ、重い推論は強いモデルへ
ルーティングする」パターンを、外部依存なしでネイティブ実装したもの。

- 各エージェントに `tier` / `preferredProviders` / `temperature` /
  `maxOutputTokens` を定義
- `generate.ts` は `orderProvidersForAgent()` でチェーンを並べ替えてから
  フォールバックループを回す（プロバイダーのキー未設定時は従来どおり自動スキップ）
- runners.ts のハードコードされた生成パラメータは削除し、ルーティング表を
  単一の真実の源とする

**品質ゲートの配線**: Iris の校正後に `runQualityGate()` を実行。
校正版が不合格なら Writer 原稿を再検査して採用、両方不合格なら既存の
テンプレートフォールバックに委ねる。

## Consequences

- 全プロバイダーは引き続き無料ティアのみ。月額コスト 0 円を維持
- Gemini flash（250 RPD）は Lena/Sophia の品質重視ステップに温存され、
  Nova の分類は Groq（14,400 RPD）が先頭で受ける
- 校正が低温度（0.3）になり、Iris による本文の意図しない書き換えが減る
- プレースホルダーや AI アーティファクトを含む記事がコミットされる前に
  品質ゲートで遮断される
- 検証: `tests/ai-routing.test.ts`（ルーティング）、既存の
  `tests/quality-gate.test.ts`（ゲート本体）
