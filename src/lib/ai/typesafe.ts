/**
 * TypeSafe AI — Jev client (System One Model)
 *
 * Jev is a **System One Model**: it does NOT generate strings. It returns
 * typed, calibrated, structured decisions. That makes it a poor fit for
 * the Vercel AI SDK's `LanguageModel` interface (which assumes
 * autoregressive token generation) but an excellent fit for the judge
 * role in the review pipeline.
 *
 * Public reference: https://typesafe.ai/blog/introducing-system-one-models-and-jev
 *   - Input:  $0.042 / MTok
 *   - Output: free (too cheap to meter)
 *   - Latency: 70–500 ms end-to-end
 *   - Status: early access via waitlist (Sep 2026)
 *
 * Because the public API surface is still in early access, the endpoint
 * and request shape are parameterized via env vars so the integration can
 * be activated by editing configuration alone once TypeSafe publishes the
 * stable API docs. When `TYPESAFE_API_KEY` is unset, this module reports
 * unavailable and the review pipeline falls back to the existing
 * `generateObject` chain — fail-soft, like every other provider.
 *
 * Architectural rule: Jev is **judge-only**. The writer, editor, and
 * every other agent that produces prose must stay on the string-generating
 * chain. Jev's strength (no hallucination, calibrated probabilities) is
 * only valuable at the gate; using it elsewhere would not be a
 * performance gain, it would be a category error.
 */

// ─── Configuration ────────────────────────────────────────────────

/** Default endpoint — overridable via env for the early-access period. */
const DEFAULT_BASE_URL = 'https://api.typesafe.ai';

/** Default request timeout. Jev is documented as 70–500 ms; allow headroom. */
const DEFAULT_TIMEOUT_MS = 8000;

export interface TypeSafeConfig {
  apiKey: string;
  /** Base URL of the TypeSafe API, no trailing slash. */
  baseUrl: string;
  /** Model id; `jev` is the only public System One Model today. */
  model: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** Read config from env. Returns null when the key is missing (graceful skip). */
export function loadTypeSafeConfig(): TypeSafeConfig | null {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.TYPESAFE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.TYPESAFE_MODEL ?? 'jev',
    timeoutMs: Number(process.env.TYPESAFE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

/** True when Jev can be reached (key present). Does not ping the API. */
export function isTypeSafeAvailable(): boolean {
  return loadTypeSafeConfig() !== null;
}

// ─── Decision schema (Zod-compatible shape) ───────────────────────

/**
 * A single Jev decision spec: a name, a human-readable label, and the
 * allowed choices with their types. Jev returns one probability per
 * choice in parallel — not autoregressively.
 *
 * For the judge use case, we model each rubric criterion as one decision
 * with two parts: a numeric score (0–100) and the structured finding
 * fields. This is the minimum surface area that lets the deterministic
 * `computeVerdict()` in `review.ts` aggregate without modification.
 */
export interface DecisionSpec {
  name: string;
  description: string;
  choices: Record<string, DecisionChoice>;
}

export type DecisionChoice =
  | { type: 'number'; min?: number; max?: number }
  | { type: 'string' }
  | { type: 'enum'; values: string[] }
  | { type: 'boolean' };

export interface DecisionResult {
  /** The chosen value (or sampled value for numeric decisions). */
  value: unknown;
  /** Calibrated probability the model assigns to this value, 0–1. */
  probability: number;
}

export interface TypeSafeResponse {
  /** One result per decision in the request, keyed by name. */
  decisions: Record<string, DecisionResult>;
  /** Overall confidence in the response, 0–1. Lower = more uncertain. */
  confidence: number;
  /** Optional model-side reasoning trace, when included. */
  reasoning?: string;
  /** Raw response echoed back for debugging, when requested. */
  raw?: unknown;
}

// ─── Transport ────────────────────────────────────────────────────

/**
 * Call the TypeSafe API. The request body is intentionally simple —
 * `state` (free text the model reads) plus `decisions` (the typed
 * contract it must answer). This matches the public blog's
 * "unstructured state in, typed probabilistic decisions out" framing.
 *
 * On any transport-level failure (network, non-2xx, malformed JSON),
 * this throws. Callers MUST catch and treat the failure as "Jev
 * unavailable" — never as a positive verdict (INV-012 fail-closed).
 */
export async function callTypeSafe(
  cfg: TypeSafeConfig,
  state: string,
  decisions: Record<string, DecisionSpec>,
): Promise<TypeSafeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(`${cfg.baseUrl}/v1/decisions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Typesafe-Model': cfg.model,
      },
      body: JSON.stringify({
        model: cfg.model,
        state,
        decisions,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `TypeSafe API ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await res.json()) as TypeSafeResponse;
    if (!json || typeof json !== 'object' || !json.decisions) {
      throw new Error('TypeSafe API returned malformed payload (missing decisions)');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Judge-specific helper ────────────────────────────────────────

/**
 * Build the Jev decision contract for the judge task.
 *
 * Each rubric criterion becomes one decision returning a 0–100 score,
 * plus the four free-text fields the existing `JudgeOutput` schema
 * expects (`missing`, `violations`, `drift`, `revision`). We deliberately
 * keep the contract small: Jev is priced on input tokens, so every field
 * we add to the spec costs money every call.
 */
export function buildJudgeDecisionSpec(criterionIds: string[]): Record<string, DecisionSpec> {
  const specs: Record<string, DecisionSpec> = {};

  for (const id of criterionIds) {
    specs[`crit_${id}_score`] = {
      name: `crit_${id}_score`,
      description: `Score for rubric criterion ${id}, 0 (worst) to 100 (best).`,
      choices: { value: { type: 'number', min: 0, max: 100 } },
    };
    specs[`crit_${id}_finding`] = {
      name: `crit_${id}_finding`,
      description: `One-sentence finding for criterion ${id}. Empty if no issue.`,
      choices: { value: { type: 'string' } },
    };
    specs[`crit_${id}_evidence`] = {
      name: `crit_${id}_evidence`,
      description: `Verbatim quote from the article supporting the finding. Required when score < 100.`,
      choices: { value: { type: 'string' } },
    };
  }

  specs.missing = {
    name: 'missing',
    description: 'Brief points the article never addresses, as a comma-separated list.',
    choices: { value: { type: 'string' } },
  };
  specs.violations = {
    name: 'violations',
    description: 'Explicit rule violations, as a comma-separated list.',
    choices: { value: { type: 'string' } },
  };
  specs.drift = {
    name: 'drift',
    description: 'If the article drifted to another subject, name it. Empty string if not.',
    choices: { value: { type: 'string' } },
  };
  specs.revision = {
    name: 'revision',
    description: 'Concrete revision instructions for the next writing attempt.',
    choices: { value: { type: 'string' } },
  };

  return specs;
}

/** Coerce a Jev response value into a 0–100 integer score. */
export function coerceScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Split a comma-separated Jev string into a clean list. */
export function coerceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(/[、,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Coerce any Jev value to a string (empty string when nullish). */
export function coerceString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
