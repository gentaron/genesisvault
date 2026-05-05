# ADR-0008: Agent Pipeline Hardening

**Status**: Accepted
**Date**: 2026-05-05
**Decision Makers**: gentaron

## Context

The 5-agent auto-post pipeline runs daily via GitHub Actions. Failures occur due to:
- AI API rate limits (429 errors)
- Network timeouts
- GitHub Actions job timeouts (6-hour limit)
- Cron job retries creating duplicate posts

## Decision

### 1. Idempotency Check
Before generating a post, check if a file matching today's date already exists in `src/content/posts/`.
If it does, exit cleanly with code 0. This prevents duplicate posts when cron retries.

### 2. Structured Logging
Each agent emits JSON-formatted log lines:
```json
{"timestamp":"2026-05-05T19:30:00Z","agent":"VE-001 Lena Strauss","action":"topic_selected","result":"貯金・節約"}
```
This enables machine-parseable logs for monitoring dashboards and debugging.

### 3. Resume from Failure
Intermediate state is saved to `.pipeline-state.json` after each agent step.
On restart, the pipeline detects the saved state and resumes from the last successful step.
The state file is deleted on successful completion.

### 4. Result Validation
Each agent's output is validated for expected shape before proceeding:
- CEO Agent: must have `title`, `theme`, `topic`, `angle`, `mood_hint`
- SEO Agent: must have non-empty `tags` array and `description`

### 5. Why NOT a Database
- Zero-cost constraint: no SQLite, no Supabase, no PlanetScale
- File-based state (`.pipeline-state.json`) is sufficient for single-instance execution
- GitHub Actions runs one pipeline at a time — no concurrency issues
- If scaling becomes necessary, revisit with Turso or LiteFS

## Consequences

- **Positive**: No duplicate posts; pipeline can resume mid-execution; logs are machine-parseable
- **Negative**: `.pipeline-state.json` is a local file — doesn't survive across different runner instances
- **Mitigation**: GitHub Actions always uses a fresh runner, but state is saved in the workspace and restored via caching if needed

## Alternatives Considered

| Approach | Rejected Because |
|----------|-----------------|
| Redis state store | Requires paid hosting (Upstash free tier has limits) |
| Database (SQLite) | Overkill for single key-value state |
| No state at all | Wasted API calls on retry; duplicate posts |
