# ADR-0010: OpenRouter Tier Diversification (Phase γ.2)

**Status:** Accepted
**Date:** 2026-07-03
**Deciders:** Genesis Vault Engineering

## Context

ADR-0003 established a 6-provider fallback chain (Gemini ×2, Groq, Cerebras, OpenRouter, HuggingFace) for the daily agent pipeline, ending with `callGeminiDirect` as a 7th REST-level fallback. Every tier in that chain routes to a different lab/company **except** OpenRouter, which pointed at a single free model (`meta-llama/llama-3.3-70b-instruct:free`). If that one model is deprecated, renamed, or its free quota is exhausted on OpenRouter's shared pool, the entire OpenRouter tier drops out — even though OpenRouter itself proxies dozens of other free models from unrelated labs.

This gap was noticed while reviewing a roundup of current model/tooling releases (Qwen, DeepSeek, GLM, MiniMax, Kimi, and gateway/routing tools like OmniRoute that fan requests out across many providers). The generic pattern those tools apply — route across many interchangeable free endpoints instead of trusting one — is directly applicable to the existing OpenRouter tier without adding a new dependency, provider account, or API key.

## Decision

Expand the single `openrouter-free` entry in `buildProviderChain()` (`src/lib/ai/providers.ts`) into an ordered list, `OPENROUTER_FREE_MODELS`, of free-tier OpenRouter models from unrelated labs:

| Order | Name | Model | Rationale |
|-------|------|-------|-----------|
| 1 | `openrouter-llama` | `meta-llama/llama-3.3-70b-instruct:free` | Existing default — preserved first so behavior is unchanged when it's healthy |
| 2 | `openrouter-qwen` | `qwen/qwen-2.5-72b-instruct:free` | Different lab (Alibaba) — Qwen's free tier has historically been one of OpenRouter's most stable |
| 3 | `openrouter-deepseek` | `deepseek/deepseek-chat:free` | Different lab (DeepSeek) — adds a third independent free pool |

`generate.ts`'s existing fallback loop needed no changes — it already iterates whatever `buildProviderChain()` returns and records per-attempt telemetry, so the OpenRouter tier now silently retries across three unrelated free pools before falling through to HuggingFace, exactly like every other tier already does across providers.

## Consequences

- **Positive:** OpenRouter no longer has a single point of failure — losing any one of the three free models still leaves the tier functional.
- **Positive:** No new dependency, environment variable, or account — reuses the existing `OPENROUTER_API_KEY`.
- **Positive:** Existing telemetry (`logs/agent-runs.jsonl`) now distinguishes which OpenRouter model actually served a request (`openrouter-llama` / `openrouter-qwen` / `openrouter-deepseek`), which was previously invisible.
- **Neutral:** Chain length grows by 2 entries; worst-case latency before falling through to HuggingFace increases only when *all three* OpenRouter models fail, which is rarer than one model failing.
- **Negative:** OpenRouter's free-tier catalog changes over time — `OPENROUTER_FREE_MODELS` is a maintenance surface that should be revisited if a listed model is removed from OpenRouter's free tier.
