# Pipeline Recovery Runbook

## How to Manually Resume a Failed Pipeline

### 1. Check the latest checkpoint

```bash
bun run gen:resume
```

This shows the current state, which agent needs to run next, and the runId.

### 2. Resume a specific run

```bash
bun run gen:resume run-2026-05-06-a3b4c1
```

### 3. Delete a stuck checkpoint

If the checkpoint is corrupt or you want a fresh run:

```bash
rm -rf .pipeline-state/
```

Then re-run the pipeline:
```bash
bun run auto-post
```

### 4. Skip a stuck phase

If a specific agent keeps failing:

1. Edit the checkpoint JSON in `.pipeline-state/{runId}.json`
2. Manually add the failed agent's output (copy from a previous successful run)
3. Advance the `phase` field to the next step
4. Run `bun run gen:resume {runId}` to verify
5. Run `bun run auto-post` to continue

### 5. Roll back a bad prompt

If a recent prompt change caused quality regressions:

1. Navigate to `prompts/{agent}/`
2. Delete or rename the current version
3. The pipeline will fall back to the previous version
4. Verify with `bun run gen:dry`

### 6. Force a re-run for today

If today's article already exists but you want to regenerate:

1. Delete the existing article: `rm src/content/posts/2026-05-06-*.md`
2. Clear checkpoints: `rm -rf .pipeline-state/`
3. Re-run: `bun run auto-post`

## Common Failure Scenarios

| Scenario | Recovery |
|----------|----------|
| Nova fails (no theme selected) | Fallback: deterministic least-used theme. Pipeline continues. |
| Lena fails (no title) | Fallback: picks from THEMES titles. Pipeline continues. |
| Sophia fails (no body) | Fallback: template body from FALLBACK_BODIES. Pipeline continues. |
| Iris fails (no edit) | Original Sophia draft is used. Pipeline continues. |
| Quality gate fails | Pipeline uses best available output and logs a warning. |
| All agents fail | Pipeline uses generateFallbackPost() with a template body. |
| CI timeout (GitHub Actions) | Pipeline auto-resumes from checkpoint on next run. |

## 投稿の push が弾かれたとき（LM-016）

日次投稿は `scripts/push-with-rebase.sh` から main へ押す。押せなかった場合、
ジョブのログには次のどちらかが出る。

**A. 「自動解決の方針が無いファイルで衝突しました: `<path>`」**

そのファイルは自動では触らない。ジョブは rebase を中断して赤で終わり、
記事はランナーと一緒に消える。復旧は手で作り直すのが早い:

1. 失敗した run のログから記事本文をコピーする
   （`Run Multi-Agent Pipeline` ステップに全文が出ている）
2. `src/content/posts/YYYY-MM-DD-*.md` として置き、`bun run verify:quick` を通す
3. コミットして push する

同じファイルが繰り返し衝突するなら、それは方針が要るということ。
`push-with-rebase.sh` の `resolve_conflicts()` に足す。

**B. 「5 回試しても push できませんでした」**

main が数分おきに動き続けているか、`GITHUB_TOKEN` の権限が落ちている。
`permissions: contents: write` が付いているか先に確認する。付いていれば
`workflow_dispatch` で走らせ直せばよい — その日の記事がまだ無ければ書き直す。

### 押し直しが何をするか

| 衝突したファイル | 解決 |
|---|---|
| `docs/agent-runs/*.md`, `docs/gate-runs/*.md` | `merge=union` で両方の追記を残す（衝突にならない） |
| `data/continuity-ledger.json`, `data/trend-radar.json` | 今回の実行の版を採る（次回の実行が記事から作り直す） |
| `data/video-briefs.json` | 両側の記録を union（`bun scripts/merge-brief-ledger.mjs`） |
| それ以外 | 解決しない。rebase を中断して赤で終わる |
