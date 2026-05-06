# ADR-0008: Pipeline State Machine

**Status**: Accepted
**Date**: 2026-05-06
**Phase**: θ — Agent Hardening

## Context

The 5-agent daily-post pipeline (Nova→Lena→Chloe→Sophia→Iris) was previously implemented
as a sequential script in `scripts/auto-post.mjs` with a single `.pipeline-state.json` file for
resume capability. This approach had several limitations:

1. **Coarse-grained state**: Only "step completed" was tracked. No agent-level output preservation.
2. **Wasted quota on retry**: A failure at agent 4 of 5 re-ran agents 1-3 unnecessarily.
3. **Non-deterministic IDs**: Random slugs made idempotency checks fragile.
4. **No quality gate**: Content was committed without post-generation validation.

## Decision

### State Machine

Model the pipeline as an explicit state machine using a TypeScript discriminated union
(`src/lib/pipeline/state.ts`). Each agent phase has a "running" and "done" variant,
preserving all prior agent outputs.

### Checkpointing

State is persisted to `.pipeline-state/{runId}.json` (gitignored). Each successful agent
transition saves the new state. On retry, the driver loads the latest checkpoint and resumes
from the appropriate phase, skipping already-completed agents.

### Idempotency

- `runId` is deterministic: `run-{YYYY-MM-DD}-{hash}`. Same date = same runId.
- Before committing, the pipeline checks for existing articles with the same slug.
- Duplicates abort silently with exit code 0.

### Quality Gate

Pre-commit validation via `src/lib/pipeline/quality-gate.ts`:
- Body length: 400–5000 chars (Japanese, excluding whitespace)
- No placeholder patterns ([TODO], [TBD], etc.)
- No code fences wrapping the entire body
- No AI disclaimer text
- Markdown structure: at least one h2 heading

### Prompt Versioning

Each agent's system prompt is stored in `prompts/{agent}/v{semver}.md`. The current version
is the latest file in each agent's directory. Version used for each run is recorded in
the pipeline metadata, enabling:
- A/B testing prompt variants
- Rolling back a regression-causing prompt
- Auditing which prompt produced which article

## Consequences

- **Positive**: No wasted API quota on retry; fully auditable pipeline; deterministic run IDs
- **Negative**: Additional complexity in pipeline orchestration; prompts directory must be maintained
- **Risk**: Checkpoint artifacts on GitHub Actions have 90-day retention

## Alternatives Considered

| Approach | Rejected Because |
|----------|------------------|
| Single JSON state file | Coarse-grained, can't resume mid-pipeline |
| In-memory state only | Lost on CI restart; no recovery |
| Database-backed state | Overkill for a blog; adds external dependency |
