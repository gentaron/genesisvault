# Agent Pipeline Runbook

## 1. Running the Pipeline Manually

```bash
# Requires GEMINI_API_KEY in environment
GEMINI_API_KEY=your-key node scripts/auto-post.mjs

# Or use npm script
GEMINI_API_KEY=your-key npm run auto-post
```

The pipeline will:
1. Load reference data from `gensnotes_1.md` / `gensnotes_2.md`
2. Analyze theme balance across recent posts
3. Run 5 agents sequentially: Balancer → CEO → SEO → Writer → Editor
4. Save the post to `src/content/posts/YYYY-MM-DD-post-xxxxxx.md`

## 2. Debugging a Failed Pipeline

### Check structured logs
Each agent emits JSON logs. Look for lines like:
```json
{"timestamp":"...","agent":"VE-001 Lena Strauss","action":"topic_selected","result":"貯金・節約"}
{"timestamp":"...","agent":"VE-001 Lena Strauss","action":"error","error":"Gemini API error (429): ..."}
```

### Common failure modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "All Gemini models failed" | Rate limit (429) | Wait 10-60 minutes, retry |
| "GEMINI_API_KEY not set" | Missing env var | Set the environment variable |
| "Writer Agent returned empty" | API returned empty response | Check API key, retry |
| "Balancer Agent fallback" | Balancer API call failed | Non-critical — uses deterministic fallback |

### Check for stuck state
```bash
cat .pipeline-state.json
```
If the file exists and the date is today, the pipeline will try to resume. To force a fresh run:
```bash
rm .pipeline-state.json
```

## 3. Force Regenerate a Post

If a post was generated with poor quality or wrong content:

```bash
# 1. Delete the existing post
rm src/content/posts/YYYY-MM-DD-post-*.md

# 2. Clear any stuck pipeline state
rm .pipeline-state.json

# 3. Re-run the pipeline
GEMINI_API_KEY=your-key npm run auto-post
```

## 4. Checking Agent Logs

The pipeline outputs structured JSON logs to stdout. To filter by agent:

```bash
# CEO Agent logs
GEMINI_API_KEY=your-key npm run auto-post 2>&1 | rg 'VE-001'

# All errors
GEMINI_API_KEY=your-key npm run auto-post 2>&1 | rg '"action":"error"'

# All structured logs
GEMINI_API_KEY=your-key npm run auto-post 2>&1 | rg '^\{'
```

## 5. Resuming from a Specific Step

The pipeline saves state after each step to `.pipeline-state.json`:

```json
{
  "step": "ceo",
  "data": { "theme": "...", "title": "...", ... },
  "date": "2026-05-05"
}
```

To resume:
```bash
# Just re-run — it will detect the state file and resume
GEMINI_API_KEY=your-key npm run auto-post
```

To skip to a specific step (advanced — edit the state file manually):
```json
// To resume from the Writer step, set:
{ "step": "seo", "data": {...}, "date": "2026-05-05" }
```

## 6. When All AI Providers Are Exhausted

If both Gemini models fail (rate limit, outage, etc.):

1. The pipeline **automatically falls back** to template-based posts
2. Template posts use pre-written content from `FALLBACK_BODIES` in the script
3. The fallback chooses the least-used theme to maintain diversity
4. No API calls are needed for fallback — it always succeeds
5. Fallback posts are still valid markdown with proper frontmatter

**To identify fallback posts**: Check the `agents` field in the post frontmatter.
All posts (including fallback) list the same agents — the fallback mechanism
is transparent to readers.

### Escalation path
1. Wait 1 hour and retry (rate limits usually reset within the hour)
2. Check [Gemini API status](https://status.cloud.google.com)
3. If persistent, the fallback will continue generating posts until API access is restored
