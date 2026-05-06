# Agent Pipeline Runbook

## Overview

The Genesis Vault agent pipeline generates a daily blog post through a 5-agent sequential pipeline. Phase γ (May 2026) refactored the pipeline from a monolithic script into modular TypeScript modules with structured outputs.

## Architecture (Phase γ)

```
scripts/auto-post.mjs          ← Orchestration + I/O (kept as .mjs for Bun compatibility)
src/lib/ai/providers.ts        ← 6-provider chain builder
src/lib/ai/generate.ts         ← generateWithFallback (structured) + generateTextWithFallback (text)
src/lib/ai/telemetry.ts        ← JSONL telemetry to logs/agent-runs.jsonl
src/lib/agents/schemas.ts      ← Zod schemas for Nova, Lena, Chloe
src/lib/agents/shared.ts       ← PERSONA, THEME_KEYWORDS, fallback data, helpers
src/lib/agents/runners.ts      ← 5 agent runner functions
```

## 1. Running the Pipeline

### Production (commits to repo)
```bash
GEMINI_API_KEY=your-key bun scripts/auto-post.mjs
# Or via npm script:
GEMINI_API_KEY=your-key bun run auto-post
```

### Dry run (no file write)
```bash
GEMINI_API_KEY=your-key bun run gen:dry
# Or explicitly:
DRY_RUN=true GEMINI_API_KEY=your-key bun scripts/auto-post.mjs
```

Dry run runs the full 5-agent pipeline but skips writing the file to disk. Use this for testing API keys and provider chain connectivity.

### With multiple providers
```bash
GEMINI_API_KEY=key1 \
GROQ_API_KEY=key2 \
CEREBRAS_API_KEY=key3 \
OPENROUTER_API_KEY=key4 \
HF_TOKEN=key5 \
bun scripts/auto-post.mjs
```

## 2. Provider Chain

The pipeline tries providers in this order:
1. `gemini-2.5-flash-lite` (15 RPM, 1000 RPD free)
2. `gemini-2.5-flash` (10 RPM, 250 RPD free)
3. `groq-llama-3.3-70b-versatile` (30 RPM, 14400 RPD free)
4. `cerebras-llama-3.3-70b` (30 RPM, high TPS free)
5. `openrouter-free` (20 RPM, shared pool)
6. `huggingface` (variable limits)
7. Direct Gemini REST API (text agents only, as final fallback)

**First success wins.** No retries on the same provider within a single call.

## 3. Adding a New Provider

1. Install the AI SDK provider package:
   ```bash
   bun add @ai-sdk/newprovider
   ```

2. Add the provider to `src/lib/ai/providers.ts`:
   ```ts
   if (process.env.NEW_PROVIDER_API_KEY) {
     const np = createNewProvider({ apiKey: process.env.NEW_PROVIDER_API_KEY });
     providers.push({ name: 'new-provider-model', model: np('model-name'), rpm: 30, rpd: 5000 });
   }
   ```

3. Add the API key to `.env.example` and `.github/workflows/daily-post.yml`:
   ```yaml
   env:
     NEW_PROVIDER_API_KEY: ${{ secrets.NEW_PROVIDER_API_KEY }}
   ```

4. Add the secret to GitHub repo Settings → Secrets and variables → Actions

5. Test with dry run: `bun run gen:dry`

## 4. Debugging a Failed Pipeline

### Check structured logs
Each agent emits JSON logs. Look for lines like:
```json
{"timestamp":"...","agent":"VE-001 Lena Strauss","action":"topic_selected","result":"貯金・節約"}
{"timestamp":"...","agent":"VE-001 Lena Strauss","action":"error","error":"..."}
```

### Check telemetry
```bash
tail -20 logs/agent-runs.jsonl
```

Filter by agent:
```bash
rg 'VE-001' logs/agent-runs.jsonl
```

Filter failures:
```bash
rg '"success":false' logs/agent-runs.jsonl
```

### Common failure modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "All providers exhausted" | No API keys set, or all rate-limited | Check API keys; verify free tier quotas |
| "Nova generateObject failed" | Provider doesn't support structured output | Check telemetry for which provider was tried |
| "Writer Agent returned empty" | API returned empty response | Try dry run; check provider logs |
| "Balancer Agent fallback" | Nova AI failed; using deterministic selection | Non-critical — pipeline continues |
| Template post generated | All agents failed; using pre-written content | Check all API keys; verify connectivity |

### Check for stuck state
```bash
cat .pipeline-state.json
```
If the file exists and the date is today, the pipeline will try to resume. To force a fresh run:
```bash
rm .pipeline-state.json
```

## 5. Rotating API Keys

1. Generate a new key from the provider's dashboard
2. Update the GitHub secret: Settings → Secrets → Actions → edit the key
3. If the key has changed locally, update `.env`
4. No code changes needed — the pipeline reads keys from environment variables at runtime

## 6. Verifying Free-Tier Compliance

At month end, verify zero billing on each provider's dashboard:

| Provider | Dashboard URL |
|----------|-------------|
| Google Gemini | https://aistudio.google.com/apikey |
| Groq | https://console.groq.com/usage |
| Cerebras | https://cloud.cerebras.ai/ |
| OpenRouter | https://openrouter.ai/credits |
| HuggingFace | https://huggingface.co/settings/billing |

If any provider returns 402 (billing required), remove it from `providers.ts` and update the ADR.

## 7. Resuming from a Specific Step

The pipeline saves state after each step to `.pipeline-state.json`:
```json
{ "step": "ceo", "data": { ... }, "date": "2026-05-06" }
```

To resume, just re-run the pipeline — it detects the state file and continues.

To skip to a specific step, edit the state file manually:
```json
{ "step": "writer", "data": { ... }, "date": "2026-05-06" }
```

## 8. When All AI Providers Are Exhausted

1. The pipeline falls back to **template-based posts** from `FALLBACK_BODIES` in `src/lib/agents/shared.ts`
2. The fallback chooses the least-used theme to maintain diversity
3. Fallback posts have valid markdown with proper frontmatter
4. No API calls are needed — fallback always succeeds

### Escalation path
1. Wait 1 hour and retry (rate limits usually reset within the hour)
2. Check provider dashboards for outages
3. Verify free tier quotas haven't been exhausted
4. The fallback will continue generating posts until AI access is restored
