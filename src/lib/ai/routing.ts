/**
 * Phase ι — Per-Agent Tiered Routing
 *
 * Each agent has a different job, so each agent gets different wiring:
 * a preferred provider order, a temperature suited to the task, and a
 * token budget. Light classification work is routed to the fastest
 * free providers first (sparing the Gemini quota for prose), while
 * long-form Japanese writing is routed to the strongest Gemini model.
 *
 * Phase κ: the routing table itself now lives in `config/pipeline.json`,
 * next to the reason each route looks the way it does (`why`). This
 * module is only the lookup and ordering logic — it holds no numbers.
 * To retune routing, edit the JSON and run `bun run verify`.
 *
 * All providers referenced here are free-tier only. If a preferred
 * provider's API key is not set, it is simply absent from the chain
 * and the next preference applies — no configuration required.
 */

import { PIPELINE_CONFIG } from '../pipeline/config.js';
import type { AgentRoute, AgentTier } from '../pipeline/config.js';
import type { ProviderEntry } from './providers.js';

export type { AgentRoute, AgentTier };

/**
 * Routing table, keyed by agent ID.
 * Derived from `config/pipeline.json` → `routing.byAgent`.
 */
export const AGENT_ROUTES: Record<string, AgentRoute> = PIPELINE_CONFIG.routing.byAgent;

/** Fallback route for unknown agent IDs — behaves like the pre-routing pipeline. */
export const DEFAULT_ROUTE: AgentRoute = PIPELINE_CONFIG.routing.default;

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
