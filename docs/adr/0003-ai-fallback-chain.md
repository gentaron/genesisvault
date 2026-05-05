# ADR-0003: AI Fallback Chain via Vercel AI SDK 5

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** Genesis Vault Engineering

## Context

The Genesis Vault auto-post pipeline runs daily at 19:30 MYT via GitHub Actions. It uses a 5-agent architecture (Balancer → CEO → SEO → Writer → Editor) where each agent calls Google Gemini for text generation.

**Problem:** When Gemini API experiences downtime or rate-limiting (429 errors), the entire pipeline fails and falls back to static template posts. With a single provider, estimated uptime is ~99.0% (Gemini's historical availability).

## Decision

Implement a multi-provider fallback chain using Vercel AI SDK v5, which provides a unified provider interface for multiple LLM services.

### Provider Chain (ordered by quality, then cost)

| Priority | Provider | Model | Free Tier |
|----------|----------|-------|-----------|
| 1 | Google Gemini | `gemini-2.5-flash-lite` | 15 RPM, 1000 RPD |
| 2 | Google Gemini | `gemini-2.5-flash` | 10 RPM, 250 RPD |
| 3 | Groq | `llama-3.3-70b-versatile` | 30 RPM, 14400 RPD |
| 4 | Cerebras | `llama-3.3-70b` | Limited free tier |
| 5 | OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` | Shared free pool |
| 6 | HuggingFace | `meta-llama/Llama-3.3-70B-Instruct` | Limited free inference |

### Implementation

- **Primary path:** `callAI(prompt)` uses Vercel AI SDK's `generateText()` with the provider chain
- **Fallback:** If AI SDK fails to import or all SDK providers fail, falls back to direct Gemini REST API calls (original `callGemini()`)
- **Final fallback:** Static template posts (unchanged from original design)

Each provider attempt includes up to 3 retries with exponential backoff (10s, 20s, 40s) for 429 errors.

## Why Vercel AI SDK 5

1. **Unified interface** — Same `generateText()` call works across all providers
2. **Streaming support** — Ready for future real-time features
3. **Structured outputs** — Built-in JSON schema validation (future use)
4. **Type safety** — Full TypeScript types for all providers
5. **Zero-cost** — SDK itself is free, providers are used on their free tiers

## Estimated Uptime Improvement

```
Single Gemini:  ~99.0% uptime  (1 in 100 days fails)
6-provider chain: ~99.99% uptime (1 in 10000 days fails)
```

Assuming providers fail independently at ~1% per day, the probability of all 6 failing simultaneously is approximately `0.01^6 ≈ 0.0000000001`.

## Consequences

- **Positive:** Near-100% pipeline reliability without paid API budgets
- **Positive:** Non-Gemini providers serve as automatic load balancing
- **Positive:** No changes to agent logic, persona, or prompts
- **Negative:** Non-Gemini models may produce slightly different output quality (Japanese nuances)
- **Negative:** Additional npm dependencies (~6 provider SDKs)
- **Neutral:** API keys are optional; pipeline works with only `GEMINI_API_KEY` set
