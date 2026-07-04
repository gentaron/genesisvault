/**
 * Phase ι — Per-Agent Tiered Routing
 *
 * Each agent has a different job, so each agent gets different wiring:
 * a preferred provider order, a temperature suited to the task, and a
 * token budget. Light classification work is routed to the fastest
 * free providers first (sparing the Gemini quota for prose), while
 * long-form Japanese writing is routed to the strongest Gemini model.
 *
 * The design follows the tiered-routing pattern used by agent runtimes
 * like OpenSquilla / OpenClaude (route cheap tasks to cheap models,
 * heavy reasoning to strong models) — implemented natively here so the
 * pipeline stays dependency-free and 100% free-tier.
 *
 * All providers referenced here are free-tier only. If a preferred
 * provider's API key is not set, it is simply absent from the chain
 * and the next preference applies — no configuration required.
 */

import type { ProviderEntry } from './providers.js';

export type AgentTier = 'light' | 'creative' | 'heavy' | 'precision';

export interface AgentRoute {
  /** Task class — documents why the wiring looks the way it does. */
  tier: AgentTier;
  /** Provider names tried first, in order. Unlisted providers follow in chain order. */
  preferredProviders: string[];
  /** Sampling temperature suited to the agent's job. */
  temperature: number;
  /** Output token budget for the agent's job. */
  maxOutputTokens: number;
}

/**
 * Routing table, keyed by agent ID.
 *
 * - VE-005 Nova (Balancer): tiny JSON classification. Fast free
 *   providers (Groq/Cerebras) first — spares Gemini RPD and cuts latency.
 *   Low temperature: selection should be stable, not creative.
 * - VE-001 Lena (CEO): creative planning + title writing in Japanese.
 *   gemini-2.5-flash first (best JA creativity), high temperature.
 * - VE-003 Chloe (SEO): structured metadata. flash-lite first,
 *   moderate-low temperature for consistent tags/keywords.
 * - VE-002 Sophia (Writer): 1,000–2,000 char Japanese diary prose.
 *   The quality-critical step — strongest Gemini model first.
 * - VE-006 Iris (Editor): proofreading. Precision work — low
 *   temperature (an editor should not rewrite creatively).
 */
export const AGENT_ROUTES: Record<string, AgentRoute> = {
  'VE-005': {
    tier: 'light',
    preferredProviders: ['groq-llama-3.3-70b', 'cerebras-llama-3.3-70b', 'gemini-2.5-flash-lite'],
    temperature: 0.3,
    maxOutputTokens: 512,
  },
  'VE-001': {
    tier: 'creative',
    preferredProviders: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'groq-llama-3.3-70b'],
    temperature: 0.9,
    maxOutputTokens: 1024,
  },
  'VE-003': {
    tier: 'light',
    preferredProviders: ['gemini-2.5-flash-lite', 'groq-llama-3.3-70b', 'cerebras-llama-3.3-70b'],
    temperature: 0.4,
    maxOutputTokens: 512,
  },
  'VE-002': {
    tier: 'heavy',
    preferredProviders: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    temperature: 0.85,
    maxOutputTokens: 4096,
  },
  'VE-006': {
    tier: 'precision',
    preferredProviders: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
    temperature: 0.3,
    maxOutputTokens: 4096,
  },
};

/** Fallback route for unknown agent IDs — behaves like the pre-routing pipeline. */
export const DEFAULT_ROUTE: AgentRoute = {
  tier: 'heavy',
  preferredProviders: [],
  temperature: 0.85,
  maxOutputTokens: 4096,
};

export function getAgentRoute(agentId: string): AgentRoute {
  return AGENT_ROUTES[agentId] ?? DEFAULT_ROUTE;
}

/**
 * Reorder a provider chain for an agent: preferred providers first
 * (in preference order), then the remaining providers in their
 * original chain order. Providers whose API keys are missing are
 * already absent from the chain, so this degrades gracefully.
 */
export function orderProvidersForAgent(
  providers: ProviderEntry[],
  agentId: string,
): ProviderEntry[] {
  const route = getAgentRoute(agentId);
  if (route.preferredProviders.length === 0) return providers;

  const byName = new Map(providers.map((p) => [p.name, p]));
  const ordered: ProviderEntry[] = [];

  for (const name of route.preferredProviders) {
    const entry = byName.get(name);
    if (entry) {
      ordered.push(entry);
      byName.delete(name);
    }
  }
  for (const p of providers) {
    if (byName.has(p.name)) ordered.push(p);
  }
  return ordered;
}
