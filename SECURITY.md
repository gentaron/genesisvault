# Security Policy — Genesis Vault

このファイルは **報告手順** です。
脅威モデルと既知の残存リスクは [`docs/security.md`](./docs/security.md) にあります。
報告する前にそちらを読むと、既知事項との重複を避けられます。

## サポート範囲

`main` ブランチの最新コミット、および本番デプロイ (https://genesisvault.vercel.app) のみ。

## 脆弱性の報告

**公開 Issue に書かないでください。**

[Security Advisories](https://github.com/gentaron/genesisvault/security/advisories/new)
から非公開で報告してください。72 時間以内に一次応答します。

含めてほしいもの:

- 再現手順（curl のコマンド列が最良）
- 想定される影響
- 影響コミット SHA またはデプロイ URL

## 重大度の目安

このサイトはペイウォール付きの記事配信と、自動投稿パイプラインで構成されています。
重大度は概ね以下の順です。

| 重大度 | 例 |
|---|---|
| **Critical** | `PAYWALL_SECRET` の漏洩経路。有効な `gv_unlock` Cookie を支払いなしで偽造できる経路。CI Secret の窃取 |
| **High** | ゲート記事の本文を `/api/article/[slug]` の認証を経ずに取得できる経路（静的ビルド出力への混入を含む）。オンチェーン検証の回避 |
| **Medium** | 検索エンジンキャッシュ等を経由したゲート記事の露出。パイプラインへの投入内容を外部から操作できる経路 |
| **Low** | 情報量の少ないエラーメッセージからの内部構造推定 |

### 特に見てほしい不変条件

これらは壊れると即座に Critical/High になります。変更レビュー時も同じ目で見てください。

- **ゲート記事の本文は静的ビルド出力 (`dist/`) に入らない。** Phase δ でここを直しています
  （それ以前は CSS のぼかしだけの「ペイウォール」でした）。ビルド設定の変更でこれが戻ると、
  DevTools で読めるようになります。
- **`gv_unlock` Cookie は HttpOnly / Secure / SameSite=Strict、HMAC 署名付き、30 日で失効。**
  この 4 つのどれを緩めても穴になります。
- **支払い検証は Transfer イベントのデコードで行う。** 生の calldata を信用する実装に
  戻さないこと。
- **`verify` はネットワークと API キーを使わない。** ゲートの独立性がここに依存しています。

## 依存関係

Renovate が週次で更新 PR を出します (`.github/renovate.json`)。
`vulnerabilityAlerts` は `security` ラベル付きで **automerge が有効** です。
CodeQL (`.github/workflows/codeql.yml`) が push / PR / 週次で `security-extended` を回します。

## 適用外

- 生成された記事の内容（事実誤り・品質）は編集上の問題であり、脆弱性ではありません
- 無料 Ethereum RPC のレート制限による一時的な検証失敗は既知の制約です
  （[`docs/security.md`](./docs/security.md) の残存リスク表を参照）
- ヘルスチェックの失敗通知そのものは運用イベントです。
  扱いは [`docs/runbooks/issue-triage.md`](./docs/runbooks/issue-triage.md) を参照してください
