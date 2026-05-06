# ADR-0009: Prompt Versioning

**Status**: Accepted
**Date**: 2026-05-06
**Phase**: θ — Agent Hardening

## Context

Agent system prompts were previously inline strings in `src/lib/agents/runners.ts`.
This made it impossible to:
- Track which prompt version produced which article
- A/B test prompt variants
- Roll back a prompt that caused quality regressions
- Audit the AI's "instructions" (transparency promise)

## Decision

Extract all agent prompts to versioned markdown files in `prompts/{agent}/v{semver}.md`.

### Directory Structure
```
prompts/
  nova/v1.0.0.md      — Balancer agent prompt
  lena/v1.0.0.md      — CEO agent prompt
  chloe/v1.0.0.md     — SEO agent prompt
  sophia/v1.0.0.md    — Writer agent prompt
  iris/v1.0.0.md      — Editor agent prompt
```

### Version Resolution
The current version is the latest file (sorted by semver). `src/lib/pipeline/prompts.ts`
reads these at runtime.

### Retention Policy
- Maximum 5 versions per agent
- Older versions moved to `prompts/_archive/{agent}/`
- Each version includes a CHANGELOG section

### Frontmatter Recording
The `runNova`, `runLena`, etc. functions record the prompt version in `AgentRunMeta`,
which is persisted in the pipeline checkpoint and committed in `docs/agent-runs/YYYY-MM.md`.

## Consequences

- **Positive**: Full prompt audit trail; A/B testing capability; transparency
- **Negative**: Prompts live outside TypeScript — no compile-time validation of prompt changes
- **Risk**: Too many versions → maintenance burden (mitigated by 5-version cap)
