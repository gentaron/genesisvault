#!/usr/bin/env bash
#
# ─── main へ押し込むときの唯一の入口 ─────────────────────────
#
# 使い方: scripts/push-with-rebase.sh "<commit message>" <path>...
#
# 何を直しているか:
#
#   `git commit && git push` は「push するとき main は checkout した瞬間の
#   ままだ」と仮定している。この前提は毎日壊れる — 記事の生成には数分かかり、
#   その間に PR がマージされれば main は進む。進んでいれば push は
#   non-fast-forward で弾かれ、ジョブは赤で終わる。
#
#   このとき失われるのは push だけではない。**書き上がった記事そのもの**が
#   消える。ランナーは使い捨てで、コミットはローカルにしか無く、再試行も
#   無いからだ。翌日の実行は翌日の日付で新しい記事を書くだけで、消えた分は
#   誰も書き直さない（LM-016）。
#
# どう直すか:
#
#   弾かれたら origin を取り込んで rebase し、もう一度押す。追記専用ログは
#   .gitattributes の merge=union が黙って結合してくれるので（LM-015）、
#   ここで衝突として残りうるのは下の3つの JSON だけ。それぞれに方針がある:
#
#     data/continuity-ledger.json  記事から毎回導出される → 今回の版を採る
#     data/trend-radar.json        その日の外の景色のスナップショット → 同上
#     data/video-briefs.json       追記専用の台帳 → 両側を union（専用スクリプト）
#
#   方針を持たないファイルが衝突したら、**推測せずに落とす**。自動で解決した
#   ふりをして間違った側を捨てるより、赤いジョブのほうが安い。
#
set -euo pipefail

ATTEMPTS="${GV_PUSH_ATTEMPTS:-5}"
BACKOFF="${GV_PUSH_BACKOFF:-5}" # 秒。試行ごとに ×1, ×2, ×3 … と伸ばす
REMOTE="${GV_PUSH_REMOTE:-origin}"

if [ "$#" -lt 2 ]; then
  echo "usage: $0 \"<commit message>\" <path>..." >&2
  exit 2
fi

MESSAGE="$1"
shift

# 押し先は「今チェックアウトしているブランチ」。main を焼き込まないのは、
# workflow_dispatch を試験ブランチで回したときに main を書き換えないため。
BRANCH="${GV_PUSH_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
if [ "$BRANCH" = "HEAD" ]; then
  BRANCH="${GITHUB_REF_NAME:-}"
fi
if [ -z "$BRANCH" ]; then
  echo "::error::push 先のブランチを特定できません（detached HEAD）。GV_PUSH_BRANCH を指定してください。" >&2
  exit 2
fi

# ─── 1. コミット（変更が無ければ何もしない）────────────────────
git add -- "$@"
if git diff --cached --quiet; then
  echo "  ⏭️  ステージされた変更はありません — コミットも push もしません"
  exit 0
fi
git commit -m "$MESSAGE"

# ─── 2. 衝突の解決方針 ────────────────────────────────────────
#
# rebase 中の --ours / --theirs は直感と逆になる:
#   --ours   = rebase の土台 = origin/main
#   --theirs = 今 replay しているコミット = この実行が書いたもの
# 導出物は「新しく作り直した側」を残したいので --theirs を採る。
# どちらを採っても次回の実行が記事から作り直すので、ここは逆行しない。
resolve_conflicts() {
  local file
  local unmerged
  unmerged="$(git diff --name-only --diff-filter=U)"

  if [ -z "$unmerged" ]; then
    # 衝突以外の理由で rebase が止まった（浅いクローンで共通祖先が無い等）。
    echo "::error::rebase が衝突以外の理由で停止しました。自動では続行しません。" >&2
    return 1
  fi

  while IFS= read -r file; do
    case "$file" in
      # 解決の各手に `|| return 1` を付けているのは、この関数が `if !` の中で
      # 呼ばれていて **set -e が効かない**ため。付け忘れると、解決に失敗した
      # ファイルをそのまま（衝突マーカー入りで）add してしまう。
      data/continuity-ledger.json | data/trend-radar.json)
        git checkout --theirs -- "$file" || return 1
        git add -- "$file" || return 1
        echo "  ♻️  $file: 今回の実行の版を採用（次回の実行が記事から作り直します）"
        ;;
      data/video-briefs.json)
        bun scripts/merge-brief-ledger.mjs "$file" || return 1
        git add -- "$file" || return 1
        ;;
      *)
        echo "::error::自動解決の方針が無いファイルで衝突しました: $file" >&2
        echo "::error::手で解決してください。方針を足す場合は $0 を編集します。" >&2
        return 1
        ;;
    esac
  done <<< "$unmerged"

  return 0
}

# ─── 3. origin を取り込み直す ─────────────────────────────────
sync_with_origin() {
  # 浅いクローン（actions/checkout の既定）のままだと共通祖先に届かず
  # rebase できないことがある。必要なときだけ深さを足す — --unshallow は
  # 全履歴を引くので、日次ジョブには過剰。
  if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
    git fetch --deepen=50 "$REMOTE" "$BRANCH" || return 1
  else
    git fetch "$REMOTE" "$BRANCH" || return 1
  fi

  if git rebase "${REMOTE}/${BRANCH}"; then
    return 0
  fi

  if ! resolve_conflicts; then
    git rebase --abort || true
    return 1
  fi

  # 解決の結果、上流と同じ内容になった場合は空コミットになる（--continue は
  # そこで止まる）ので、その1手だけ skip に振り分ける。
  # 続行に失敗したら rebase を残さない。中途半端な rebase 状態のまま次の
  # ステップ（台帳のコミット）に入ると、そこで何を押すことになるか読めない。
  if git diff --cached --quiet; then
    git rebase --skip || {
      git rebase --abort || true
      return 1
    }
  else
    GIT_EDITOR=true git rebase --continue || {
      git rebase --abort || true
      return 1
    }
  fi
}

# ─── 4. 押す。弾かれたら取り込んで押し直す ────────────────────
attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  if git push "$REMOTE" "HEAD:refs/heads/${BRANCH}"; then
    echo "  ✅ push 成功（試行 ${attempt}/${ATTEMPTS}）"
    exit 0
  fi

  if [ "$attempt" -eq "$ATTEMPTS" ]; then
    break
  fi

  echo "  ↻ push が通りませんでした（${BRANCH} が進んだ可能性）— 取り込んで再試行します"
  sleep "$((BACKOFF * attempt))"

  if ! sync_with_origin; then
    echo "::error::${REMOTE}/${BRANCH} の取り込みに失敗しました。コミットは手元にあります（$(git rev-parse --short HEAD)）。" >&2
    exit 1
  fi

  attempt="$((attempt + 1))"
done

echo "::error::${ATTEMPTS} 回試しても push できませんでした。コミット $(git rev-parse --short HEAD) は失われます。" >&2
exit 1
