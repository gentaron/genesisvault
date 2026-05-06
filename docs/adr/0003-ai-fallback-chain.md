# ADR-0003: AI Fallback Chain via Vercel AI SDK 5 (Phase γ)

**Status:** Accepted
**Date:** 2026-05-06
**Supersedes:** Initial ADR-0003 (2026-05-06 pre-γ)
**Deciders:** Genesis Vault Engineering

## Context

The Genesis Vault auto-post pipeline runs daily at 19:30 MYT via GitHub Actions. It uses a 5-agent architecture (Nova/Balancer → Lena/CEO → Chloe/SEO → Sophia/Writer → Iris/Editor) where each agent calls an LLM for text or structured generation.

### Pre-γ state

- Agents used `generateText` (freeform text output) from the Vercel AI SDK
- Agent outputs were parsed via regex (`raw.match(/\{[\s\S]*\}/)`) + `JSON.parse` — the "parse by hope" pattern
- Provider chain existed but was inline in a monolithic 1104-line `scripts/auto-post.mjs`
- No Zod validation of agent outputs
- No structured telemetry
- The pipeline imported all AI SDK packages with a try/catch wrapper that silently degraded

### Problems addressed in Phase γ

1. **JSON parse fragility**: When an LLM returns malformed JSON (trailing commas, wrapped in markdown code fences, extra commentary), the pipeline would fail silently and fall through to template fallbacks. This class of bugs is eliminated entirely by `generateObject` + Zod schemas.
2. **No structured output validation**: Agent outputs (theme selection, title, tags) were trusted blindly after the regex parse. Zod schemas enforce type safety and constraint validation (e.g., mood_hint must be one of 7 values, title must be 8-50 chars).
3. **Monolithic architecture**: 1104 lines in a single file made testing, debugging, and future provider additions difficult. Phase γ extracts the AI pipeline into 6 focused modules under `src/lib/`.
4. **No observability**: When a provider failed, there was no persistent record of which provider was used, how many attempts were needed, or what the latency was. Phase γ adds JSONL telemetry to `logs/agent-runs.jsonl`.

## Decision

### Architecture: 6-module extraction

```
src/lib/
  ai/
    providers.ts   — Multi-provider chain builder (6 providers)
    generate.ts    — generateWithFallback (structured) + generateTextWithFallback (text)
    telemetry.ts   — JSONL agent telemetry logging
  agents/
    schemas.ts     — Zod schemas for Nova, Lena, Chloe
    shared.ts      — PERSONA, THEME_KEYWORDS, fallback data, helpers
    runners.ts     — 5 agent runner functions (runNova, runLena, etc.)
scripts/
  auto-post.mjs    — Orchestration only (reference data, pipeline state, frontmatter, I/O)
```

### Structured vs text agents

| Agent | ID | Mode | Schema |
|-------|-----|------|--------|
| Nova (Balancer) | VE-005 | `generateObject` | `NovaOutputSchema` |
| Lena (CEO) | VE-001 | `generateObject` | `LenaOutputSchema` |
| Chloe (SEO) | VE-003 | `generateObject` | `ChloeOutputSchema` |
| Sophia (Writer) | VE-002 | `generateText` | None (freeform Markdown) |
| Iris (Editor) | VE-006 | `generateText` | None (freeform Markdown) |

Rationale: Nova/Lena/Chloe return compact JSON objects that benefit from type-safe validation. Sophia/Iris return long-form Japanese text (1000-2000 characters) where `generateObject` may struggle with output length constraints on some providers. `generateText` with the same fallback chain provides equivalent resilience.

### Provider chain (ordered by quality, then throughput)

| Priority | Provider | Model | Import | Free Tier (May 2026) |
|----------|----------|-------|--------|---------------------|
| 1 | Google Gemini | `gemini-2.5-flash-lite` | `@ai-sdk/google` | 15 RPM, 1000 RPD |
| 2 | Google Gemini | `gemini-2.5-flash` | `@ai-sdk/google` | 10 RPM, 250 RPD |
| 3 | Groq | `llama-3.3-70b-versatile` | `@ai-sdk/groq` | 30 RPM, 14400 RPD |
| 4 | Cerebras | `llama-3.3-70b` | `@ai-sdk/cerebras` | 30 RPM, very high TPS |
| 5 | OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | `@openrouter/ai-sdk-provider` | 20 RPM, shared free pool |
| 6 | HuggingFace | `meta-llama/Llama-3.3-70B-Instruct` | `@ai-sdk/huggingface` | Variable, serverless |

Additionally, `generateTextWithFallback` includes a **direct Gemini REST API** fallback when all SDK providers fail, providing a 7th path that bypasses the SDK entirely.

### Fallback strategy

1. First provider that returns a valid result wins (no retries on the same provider within the chain)
2. Each provider's own SDK handles rate-limit retries internally
3. If all SDK providers fail for text agents, `callGeminiDirect()` provides REST-level fallback
4. If all generation fails, template-based fallback posts are used (unchanged from original design)
5. Deterministic fallback for Nova (picks from least-used theme tier) and Lena (picks from pre-written title list)

### Telemetry

Every agent call records a JSONL entry to `logs/agent-runs.jsonl`:
```json
{
  "timestamp": "2026-05-06T19:30:00.000Z",
  "agentId": "VE-001",
  "agentName": "Lena Strauss",
  "provider": "gemini-2.5-flash-lite",
  "attempts": 1,
  "latencyMs": 2345,
  "success": true
}
```

The file is gitignored (`logs/agent-runs.jsonl`) to avoid committing daily telemetry data. A daily summary can be aggregated for Phase η observability.

### Package changes

Added:
- `@openrouter/ai-sdk-provider@^2.9.0` — OpenRouter community provider (package name is NOT `@ai-sdk/openrouter` — that package does not exist on npm)
- `@ai-sdk/huggingface@^1.0.48` — HuggingFace Inference Providers

Already present (no changes needed):
- `ai@^5.0.0`, `@ai-sdk/google@^2.0.0`, `@ai-sdk/groq@^2.0.0`, `@ai-sdk/cerebras@^2.0.0`

## Consequences

- **Positive:** Eliminates an entire class of JSON-parsing bugs via `generateObject` + Zod
- **Positive:** Type-safe agent outputs enable compile-time validation
- **Positive:** 6-provider chain raises theoretical uptime to 99.99%
- **Positive:** Modular architecture enables independent testing of each agent
- **Positive:** Telemetry enables data-driven provider performance analysis (Phase η)
- **Positive:** Dry-run mode (`bun run gen:dry`) for safe local testing
- **Positive:** `.env.example` documents all required/optional API keys
- **Negative:** `generateObject` may not be supported by all providers equally well (Groq and Cerebras support it; HuggingFace support varies)
- **Negative:** Non-Gemini models may produce different Japanese quality nuances
- **Negative:** Additional npm dependencies (+2 packages)
- **Neutral:** All existing behavior preserved — same prompts, same fallback templates, same frontmatter format
- **Neutral:** API keys remain optional; pipeline works with only `GEMINI_API_KEY` set
