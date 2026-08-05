# AGENTS.md — AI Development Rules for gentaron

> **Version**: 2.1.0
> **Maintainer**: gentaron
> **Effective**: All AI assistants (Z.AI, Claude, Cursor, Copilot, etc.)

This file is the **highest priority** instruction set for any AI operating on this repository.

<!--
  Phase θ — Machine-parseable rules (parsed by src/lib/pipeline/rules.ts)
  These values are enforced at runtime by the pipeline driver.
  DO NOT modify without understanding the consequences.
-->
<!-- rules:start
version: "2.1.0"
max_iterations_per_agent: 3
max_total_iterations: 15
allowed_commit_types: [feat, fix, docs, refactor, test, chore]
deadlock_threshold_ms: 120000
min_article_length: 500
max_article_length: 5000
quality_score_threshold: 50
rules:end -->

---

## 1. Entry Point Protocol (The Boot Sequence)

When accessing this repository, read files in this exact order:

1. **AGENTS.md** (this file) — highest priority instructions
2. **CLAUDE.md** (if exists) — supplementary instructions
3. **docs/almanac/INVARIANTS.md** — what must not break, and how it is guarded
4. **docs/almanac/LANDMINES.md** — traps already stepped on; do not step again
5. **config/pipeline.json** — the declarative source of truth for the pipeline
6. **README.md** — project overview and purpose
7. **package.json** or equivalent manifest — dependencies and scripts
8. **src/ or lib/ entry point** — architecture overview
9. **Test files** — expected behavior

Do NOT skip or reorder this sequence.

Steps 3–5 exist because the expensive knowledge in this repository is not
"what the code does" (readable) but "why it is this way" and "what breaks if
you change it" (not readable). Read them before proposing changes.

---

## 2. Deadlock Prevention

### 2.1 Iteration Cap
For any single task, never repeat the same approach more than 3 times:
- Attempt 1: Execute initial approach
- Attempt 2: Fine-tune and retry
- Attempt 3: Switch to a **completely different approach**
- Attempt 4+: Report to user and ask for guidance

### 2.2 Blocker Detection & Escalation
Detect these conditions immediately and report to user:
- Build error unresolved after 3 consecutive attempts
- Dependency installation failure
- Tests unable to run due to environment issues
- Required files or directories missing

When a blocker is detected:
1. Explain the current situation concisely
2. List attempted approaches
3. Provide possible causes
4. Suggest up to 3 next actions for user

### 2.3 Circular Dependency Detection
If editing A requires changing B, and B requires changing A:
1. **Stop immediately** — make neither edit
2. Visualize the circular structure
3. Propose interface extraction
4. Let user decide

### 2.4 Indecision Resolution
When multiple equally valid implementations exist:
1. List pros and cons of each option
2. Evaluate against **existing project patterns**
3. If still undecided → choose the **simplest implementation**
4. Document the reasoning in a comment

Never enter a "cannot decide, stopping work" state.

### 2.5 Scope Boundary Enforcement
- Task is "done" when minimum requirements are met
- Do NOT make incidental improvements — treat them as separate tasks
- Refactoring only when explicitly requested
- Out-of-scope improvements: list as **proposals** after task completion (do not execute)

---

## 3. Task Execution Protocol

### 3.0 Work From a Contract, Not a Request

A task is ready to start when it states, in verifiable form:

1. **Acceptance criteria** — conditions whose pass/fail can be judged
   without reading the implementation
2. **Non-goals** — what is explicitly out of scope
3. **How it is verified** — the command or test that proves it

`.github/ISSUE_TEMPLATE/feature.yml` enforces all three. If you are handed
work missing any of them, write the missing part first and confirm it
before implementing. Implementation capacity is cheap; removing ambiguity
is the scarce part, and doing it after the code is written is the
expensive order.

When done, the acceptance criteria — not your summary of the work — are
what gets checked.

### 3.1 Pre-Implementation Decomposition
Before starting any task:
1. Break into maximum 5 subtasks
2. Estimate steps per subtask
3. Explicitly state dependencies between subtasks
4. Determine execution order and present to user

### 3.2 Phased Implementation & Verification
1. Skeleton (type definitions and interfaces only)
2. Core logic (happy path only)
3. Error handling
4. Integration (connect with existing code)
5. Verification (build / test / manual check)

**Build must pass at each phase. Never proceed to next phase with a broken build.**

### 3.3 Minimal Edit Principle
- Max 10 files per editing session
- Minimize lines changed per file
- Do not mix formatting changes with logic changes
- Prefer commenting out over deleting

---

## 4. Error Recovery Protocol

### 4.1 Error Classification

| Category | Action |
|----------|--------|
| Syntax error | Fix immediately. Verify type definitions, do not guess |
| Runtime error | Add error handling. Investigate root cause |
| Environment error | Verify prerequisites. **Report to user** |
| Design error | **Stop implementation**. Revisit design |
| Test error | Verify test intent. Fix implementation or test |

**Environment and design errors: do NOT attempt to resolve independently. Report to user immediately.**

### 4.2 Rollback Strategy
When implementation is not progressing:
1. Save current changes with `git stash` or temporary commit
2. Restore to last working state
3. Analyze root cause
4. Re-implement with different approach

### 4.3 Fallback Chain
1. **Ideal implementation** → on failure:
2. **Simplified implementation** (simpler approach) → on failure:
3. **Minimal implementation** (core functionality only) → on failure:
4. **Stub implementation** (interface only + TODO comment)

---

## 5. Quality Verification Protocol

### 5.0 The Single Gate — `bun run verify`

Generation is cheap; deciding whether output is correct is the bottleneck.
So the decision "is this mergeable?" must be one deterministic command,
not a judgment call:

```bash
bun run verify         # config + content + almanac + lint/types/tests
bun run verify --quick # config + content + almanac only (fast, no subprocesses)
```

**`verify` must never require an LLM, a network call, or an API key.**
That is what makes it trustworthy as a gate — it produces the same answer
on a laptop, in CI, and inside an agent run. Do not add a check that
violates this (see INV-004).

Anything a rule can decide, decide with a rule. Send only genuinely
subjective work to a model.

### 5.1 Verification Gates
- **On file save**: Linter and type checker introduce no new findings
- **On feature completion**: Related tests all pass, build succeeds
- **On task completion**: `bun run verify` exits 0

### 5.2 Self-Review Checklist
Before marking any task complete:
- [ ] All user requirements met
- [ ] Error handling is appropriate
- [ ] No hardcoded values
- [ ] No security issues
- [ ] Naming is consistent
- [ ] No leftover comments or debug code
- [ ] `bun run verify` exits 0

### 5.3 Pre-existing Findings — Ratchet, Do Not Sweep

This repository carries a known backlog of Biome and type-check findings,
recorded in `config/quality-baseline.json`. `verify` fails if the count
**grows** and asks you to tighten the baseline when it shrinks.

Do NOT "fix" the backlog in bulk. An 85-file formatting diff hides real
changes from review and violates §3.3. Format only the files you touched:

```bash
bunx biome check --write <the files you actually changed>
```

### 5.4 The Enclosure — Never Weaken the Reviewer

Generated output passes through a review layer (`src/lib/pipeline/review.ts`,
`bun run gate`). Its rules are not negotiable defaults:

- **The reviewer never runs a weaker model than the writer.** A sloppy
  draft is fixed by a strict reviewer; a lenient reviewer ships sloppy
  work. A miss prints nothing — no error, no warning, all green — so it
  is never discovered in operation. Enforced by config integrity.
- **The model observes; the code decides.** Never let a judge return a
  total score or a pass/fail. Aggregate in code from the rubric.
- **Deductions require a real quote.** Evidence is checked against the
  article; fabricated citations are discarded.
- **Fail-closed.** Cannot review ⇒ reject. Never skip, never default-pass.
- **The judge sees only the brief and the article.** Adding writing
  context turns review into self-assessment.

When you touch the gate — model, rubric, thresholds — run:

```bash
bun run gate:eval    # measures what the reviewer catches and misses
```

If you find a miss, **add a fixture to `tests/fixtures/gate/` first**, then
fix it. A miss with no fixture will come back and nobody will notice.

---

## 6. Conflict Resolution Protocol

### 6.1 Rule Priority Hierarchy
1. **User's explicit instructions** (highest priority)
2. **AGENTS.md / CLAUDE.md rules**
3. **Existing project patterns and conventions**
4. **Industry best practices**
5. **AI's general judgment** (lowest priority)

### 6.2 Security vs Functionality
- **Always prioritize security**
- Never implement insecure solutions
- If user knowingly requests a security risk: explain the risk and propose safer alternatives

---

## 7. Communication Protocol

### 7.1 Progress Report Format
**Done**: ✅ [Task name] complete — Implementation: ... — Changed files: ...
**Blocker**: 🚫 [Task name] blocked — Cause: ... — Attempted fixes: ...
**In Progress**: 🔄 [Task name] in progress — Progress: ... — Remaining: ...

### 7.2 Question Rules
- Maximum 3 questions at a time
- Include recommended answers for each question
- Prefer Yes/No format
- Do not ask about matters solvable by general best practices

---

## 8. Context Management

### 8.0 Configuration Lives in One File

`config/pipeline.json` is the single source of truth for the agent roster,
provider chain, per-agent routing, quality-gate thresholds, and reference
files. To retune the pipeline, **edit the JSON — do not add constants to
TypeScript**.

- Validated by `src/lib/pipeline/config.ts` (Zod + referential integrity)
- Invalid config throws at import time. Never make it fall back silently
  to a hardcoded default — that hides the misconfiguration (INV-001)
- After editing the Zod schema, run `bun run config:schema`
- `config/pipeline.schema.json` is generated. Never hand-edit it (INV-002)

### 8.1 Cross-Session State Inheritance
When a session is interrupted:
1. Reload AGENTS.md / CLAUDE.md
2. Read `docs/almanac/INVARIANTS.md` and `LANDMINES.md`
3. Check `git log --oneline -10`
4. Check `git status`, `git diff`
5. Search for TODO/FIXME comments
6. Report to user: "Continuing from previous session"

### 8.2 Write Down What Code Cannot Say

Code records *what*. It does not record *why*, *what must not break*, or
*where someone already got hurt*. Those live in `docs/almanac/` and are
worth more than the code when the next session starts cold.

| You just… | Write it in |
|-----------|-------------|
| chose between real alternatives | `docs/adr/` (next free number — check `docs/almanac/INDEX.md`) |
| got stuck, then unstuck | `docs/almanac/LANDMINES.md` (症状 → 原因 → 回避策) |
| created or changed an assumption others must respect | `docs/almanac/INVARIANTS.md` |
| repeated an operation for the second time | `docs/runbooks/` |

Write it immediately after the fact. By the next session the reason is gone.
`INDEX.md` is generated — run `bun run almanac`, never edit it by hand.

---

## 9. Commit & Push Rules

### 9.1 Conventional Commits
Use conventional commit format:
- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code restructuring
- `test:` test additions/modifications
- `chore:` maintenance

### 9.2 Commit Scope
- One logical change per commit
- Do not mix unrelated changes
- Keep commit messages concise and descriptive

---

**This ruleset applies to all repositories under the gentaron GitHub account.**
**Do not override these rules with general AI behavior.**

---

## 10. Pipeline Observability

### 10.1 Structured Logging
Each agent emits JSON-formatted logs:
```json
{"timestamp":"2026-05-05T19:30:00Z","agent":"VE-001 Lena Strauss","action":"topic_selected","result":"貯金・節約"}
```

### 10.2 Idempotency
The pipeline checks for existing posts for today's date before generating.
If a post already exists, the pipeline exits cleanly with code 0.

### 10.3 Resume from Failure
Intermediate state is saved to `.pipeline-state.json`.
On restart, the pipeline resumes from the last successful step.
State file is deleted on successful completion.

### 10.4 Error Escalation
If all AI providers fail (Phase γ), the pipeline falls back to template-based posts.
Template posts are marked with `fallback: true` in the agents metadata.

---

## 11. Continuity — 到達点は後退させない

読者から見れば、「貯金300万円の次に貯金200万円達成」も「120日目と書いた瞑想が
30日目に戻る」も同じ嘘である。だから継続性は**金額だけの話ではない**。

### 11.1 台帳は導出物

`data/continuity-ledger.json` は `src/content/posts` から毎回作り直す。
キャッシュを信じない。LLM もネットワークも使わない走査なので、
更新漏れを心配するより作り直すほうが安い（LM-013）。

### 11.2 ブリーフは指示、ゲートが保証

「逆行するな」と伝えるのは安いので続ける。ただし守られたかどうかは
`detectRegressions()` が決める。**指示が破られても画面には何も出ない**ので、
最後は決定的なチェックで止める（INV-019）。

止める場所は3つ。書き手の原稿（指摘つきで1度だけ書き直させる）、
校正後の本文（Iris は本文を書き換える）、テンプレートのフォールバック。
3つ目を忘れると、**AI が全滅した日にだけ逆行が出る**——最も見つけにくい壊れ方になる。

### 11.3 指標を足すときの原則

**取りこぼしは安いが、誤検出は高い。** 拾い損ねた事実はその日の縛りが1つ減るだけだが、
誤って拾った事実は台帳に居座り、以後の原稿を毎日落とし続ける。
主語と数値の近接を要求し、曖昧な言い回しは拾わないこと。

外から来た数値（相場・ニュース）を個人の事実にしてはいけない。
「日経平均4万2000円」が貯金額として台帳に入ると、到達不能な下限が居座る。

---

## 12. Trend Radar — 外を見るときの作法

VE-010 Tessa（`src/lib/agents/trends.ts`）は、このリポジトリで唯一、外へ通信する。
設計は審査層とちょうど逆にする（INV-020）。

- **fail-soft**: 取れなければ諦めて続行する。審査層の fail-closed と混同しない
- **`bun run verify` から呼ばない**: 検証はオフラインで完結する（INV-004）
- **API キーを要求するソースを足さない**: 鍵の有無で挙動が変えない（INV-003）
- **材料には必ず使い方を添える**: 制約なしで渡すと、日記がニュース要約に化ける
