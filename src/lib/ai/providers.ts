/**
 * Phase γ — Multi-Provider Chain
 *
 * Builds an ordered array of AI provider entries. Each entry carries a
 * `LanguageModel` instance from the Vercel AI SDK, plus metadata
 * (name, RPM, RPD) used by the fallback logic.
 *
 * Phase κ: the chain itself is declared in `config/pipeline.json`
 * (`providers.chain`) — order, model IDs, env keys, and rate limits.
 * This module only turns that declaration into SDK model instances.
 * Adding or reordering a provider is a JSON edit, not a code change.
 *
 * Chain order (as configured today):
 *   gemini-2.5-flash-lite → gemini-2.5-flash → Groq Llama 3.3 70B
 *   → Cerebras Llama 3.3 70B → OpenRouter free (multi-model) → HuggingFace
 *
 * The OpenRouter tier fans out across several free-tier models instead of
 * a single one, so a single model being deprecated, renamed, or rate-limited
 * on OpenRouter's shared free pool no longer removes the whole tier — see
 * ADR-0010 (provider diversification).
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createCerebras } from '@ai-sdk/cerebras';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createHuggingFace } from '@ai-sdk/huggingface';
import type { LanguageModel } from 'ai';
import { PIPELINE_CONFIG } from '../pipeline/config.js';
import type { ProviderDef } from '../pipeline/config.js';

export interface ProviderEntry {
  name: string;
  model: LanguageModel;
  rpm: number;
  rpd: number;
}

/**
 * OpenRouter free-tier candidates, tried in order within the OpenRouter tier.
 * Derived from the configured chain; kept as a named export because the
 * fallback tests and telemetry reporting reference the tier as a unit.
 */
export const OPENROUTER_FREE_MODELS: ProviderDef[] = PIPELINE_CONFIG.providers.chain.filter(
  (p) => p.sdk === 'openrouter',
);

/** A configured SDK client: give it a model ID, get a model instance. */
type ModelClient = (model: string) => LanguageModel;

/**
 * One constructor per SDK named in `config/pipeline.json`. Keyed by the
 * `sdk` enum so adding a provider to the config without wiring an SDK
 * here is a compile error rather than a runtime surprise.
 */
const SDK_CLIENTS: Record<ProviderDef['sdk'], (apiKey: string) => ModelClient> = {
  google: (apiKey) => createGoogleGenerativeAI({ apiKey }),
  groq: (apiKey) => createGroq({ apiKey }),
  cerebras: (apiKey) => createCerebras({ apiKey }),
  openrouter: (apiKey) => createOpenRouter({ apiKey }),
  huggingface: (apiKey) => createHuggingFace({ apiKey }),
};

/**
 * Build a model resolver that memoizes one client per SDK for the
 * duration of a `buildProviderChain()` call, so entries sharing an SDK
 * (e.g. both Gemini models) share a single client.
 */
function makeModelFactory(): (def: ProviderDef, apiKey: string) => LanguageModel {
  const clients = new Map<string, ModelClient>();

  return (def, apiKey) => {
    let client = clients.get(def.sdk);
    if (!client) {
      client = SDK_CLIENTS[def.sdk](apiKey);
      clients.set(def.sdk, client);
    }
    return client(def.model);
  };
}

/**
 * Build the provider chain from config, skipping every provider whose
 * API key is absent from the environment. An empty environment yields
 * an empty chain — the pipeline then falls back to templates rather
 * than failing (see AGENTS.md §10.4).
 */
export function buildProviderChain(): ProviderEntry[] {
  const toModel = makeModelFactory();
  const providers: ProviderEntry[] = [];

  for (const def of PIPELINE_CONFIG.providers.chain) {
    const apiKey = process.env[def.envKey];
    if (!apiKey) continue;
    providers.push({
      name: def.name,
      model: toModel(def, apiKey),
      rpm: def.rpm,
      rpd: def.rpd,
    });
  }

  return providers;
}
