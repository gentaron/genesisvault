# ADR-0011: AI Slop Detection in the Quality Gate

**Status:** Accepted
**Date:** 2026-07-03
**Deciders:** Genesis Vault Engineering

## Context

Per a user request, the tools covered by note.com author [humble_bobcat51 (ゆいまる)](https://note.com/humble_bobcat51) were surveyed for anything worth adopting into Genesis Vault. That author's notes cover a wide range: local LLMs (Ornith, GLM, Gemma variants), presentation/music/animation generators (Presenton, ACE-Step, Gorest), dev-workflow tools (Cline Kanban, Mistral Vibe, Nub), knowledge tools (Open Notebook, Tolaria, Penpot), speech recognition (parakeet.cpp), and code-intelligence tooling (`codebase-memory-mcp`), among others.

Genesis Vault's actual product surface is a 5-agent Markdown blog pipeline — there is no presentation, music, animation, speech, or IDE-orchestration surface for most of that catalog to attach to. Adopting them would violate the Scope Boundary rule in AGENTS.md §2.5 (no incidental features).

One article stood out as a direct fit: **["Regaining Natural Writing: A Guide to Using 'stop-slop' to Eliminate AI-Specific Quirks"](https://note.com/humble_bobcat51/n/n185741f3337f)**, covering the `stop-slop` Claude Skill and its Japanese port, [`stop-ai-slop-jp`](https://github.com/iKora128/stop-ai-slop-jp). Both are MIT-licensed rule sets (not services, no API keys, no new runtime dependency) for detecting formulaic "AI-sounding" writing — exactly the job already assigned to Iris Koenig (Editor, VE-006) and to `runQualityGate` (`src/lib/pipeline/quality-gate.ts`), which already flags placeholder text, code fences, and AI disclaimers.

`codebase-memory-mcp` (code-intelligence MCP server) was also considered, since it's genuinely well-regarded. It was not adopted here: it's a local dev-environment tool for whichever AI coding agent works on the repo, not something the repository itself can "implement" — there's no source-level integration point, and Genesis Vault's codebase (290 files) is far below the scale where its token-saving pitch pays off. It's a reasonable addition to a developer's personal MCP config, not to this ADR.

## Decision

Port the five stop-ai-slop-jp detection categories (立場/主体/構造/語彙/記号) into two places, at the level that's actually testable in this codebase:

1. **`detectAiSlop()`** in `src/lib/pipeline/quality-gate.ts` — a pure heuristic function checking for:
   - Grandiose, proposition-style H2 headings (`〜が教えてくれたもの`, `〜と向き合う時間`, etc. — the same clichés Lena's title rules already ban, now also checked for headings inside the body)
   - Cliché "universal truth" vocabulary (真理/美学/境地/本質) inflating a small diary moment
   - Repeated "A ではなく B" binary-contrast rhetoric (3+ uses)
   - Decorative full-width dash runs (`――`)
   - Stray Markdown bold (`**text**`) left in what should be plain diary prose

   Wired into `runQualityGate()` as five new **warning**-severity checks (`no_grandiose_headings`, `no_cliche_vocabulary`, `no_binary_contrast_repetition`, `no_decorative_dashes`, `no_bold_remnants`). Warnings degrade the score but never flip `passed` to `false` — consistent with the existing gate philosophy ("the gate doesn't reject — it records").

2. **`prompts/iris/v1.1.0.md`** — a new prompt version (per ADR-0009's versioning convention) adding an explicit "AIくささの除去" section with the same three categories (構造/語彙/記号), so the Editor agent tries to *fix* these patterns before the quality gate ever has to *flag* them. The live inline prompt in `runIris()` (`src/lib/agents/runners.ts`) was updated to match.

## Consequences

- **Positive:** Closes a real gap — the previous quality gate only caught gross AI artifacts (disclaimers, leftover code fences), not the subtler formulaic phrasing patterns that make AI-written diary prose read as generic.
- **Positive:** No new dependency, API key, or network call — pure regex/string heuristics, same pattern as the existing checks.
- **Positive:** Reinforces the pipeline's own established taste (Lena's title-banning rules) instead of introducing a new, unrelated standard.
- **Neutral:** All five new checks are warnings, so no existing published article's status changes and no pipeline run starts failing because of this change.
- **Negative:** Regex heuristics are approximate — they can miss AI slop that avoids the specific listed vocabulary/patterns, and (rarely) flag a deliberate stylistic choice. Severity is `warning`, not `error`, specifically to keep false positives from blocking publication.
- **Rejected scope:** Presenton, ACE-Step, Cline Kanban, Mistral Vibe, Tolaria, Penpot, parakeet.cpp, Gorest, Open Notebook, Nub, and `codebase-memory-mcp` — surveyed, none fit Genesis Vault's actual runtime surface closely enough to justify inclusion under AGENTS.md's scope-boundary rule.
