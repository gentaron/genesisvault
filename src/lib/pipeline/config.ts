/**
 * Phase κ — Declarative Pipeline Config
 *
 * `config/pipeline.json` is the single source of truth for the agent
 * roster, provider chain, per-agent routing, and quality-gate thresholds.
 * This module loads it, validates it with Zod at import time, and hands
 * typed values to the rest of the pipeline.
 *
 * Why a JSON file instead of TypeScript constants:
 *   - An agent (human or AI) can patch one declarative file instead of
 *     hunting the same numbers across routing.ts / quality-gate.ts /
 *     providers.ts / shared.ts.
 *   - `bun run verify` can validate the whole configuration without a
 *     network call, an API key, or an LLM.
 *   - Config drift becomes a schema error at import time, not a silent
 *     behavior change discovered in production.
 *
 * Invariant: this module holds *no* default values of its own. If the
 * JSON is wrong, we fail loudly rather than quietly running on stale
 * hardcoded numbers. See docs/almanac/INVARIANTS.md.
 */

import { z } from 'zod';
import rawConfig from '../../../config/pipeline.json';

// ─── Schema ─────────────────────────────────────────────────────

export const AgentTierSchema = z.enum(['light', 'creative', 'heavy', 'precision']);

export const AgentDefSchema = z.object({
  id: z.string().regex(/^VE-\d{3}$/, 'agent id must look like VE-001'),
  name: z.string().min(1),
  shortName: z.string().min(1),
  role: z.string().min(1),
  roleJa: z.string().min(1),
  step: z.number().int().min(1),
  promptDir: z.string().min(1),
});

export const ProviderDefSchema = z.object({
  name: z.string().min(1),
  sdk: z.enum(['google', 'groq', 'cerebras', 'openrouter', 'huggingface']),
  model: z.string().min(1),
  envKey: z.string().min(1),
  rpm: z.number().int().positive(),
  rpd: z.number().int().positive(),
});

export const RouteSchema = z.object({
  tier: AgentTierSchema,
  preferredProviders: z.array(z.string()),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive(),
  why: z.string().optional(),
});

export const QualityGateSchema = z.object({
  comment: z.string().optional(),
  minBodyLength: z.number().int().positive(),
  maxBodyLength: z.number().int().positive(),
  minH2Headings: z.number().int().min(0),
  binaryContrastLimit: z.number().int().positive(),
  penalty: z.object({
    error: z.number().int().min(0),
    warning: z.number().int().min(0),
  }),
  placeholderPatterns: z.array(z.string()).min(1),
  grandioseHeadingPatterns: z.array(z.string()),
  clicheVocabulary: z.array(z.string()),
});

export const PipelineConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.string(),
  description: z.string().optional(),
  agents: z.array(AgentDefSchema).min(1),
  providers: z.object({
    comment: z.string().optional(),
    chain: z.array(ProviderDefSchema).min(1),
  }),
  routing: z.object({
    comment: z.string().optional(),
    default: RouteSchema,
    byAgent: z.record(z.string(), RouteSchema),
  }),
  qualityGate: QualityGateSchema,
  references: z.object({
    comment: z.string().optional(),
    legacy: z.array(z.string()),
    current: z.array(z.string()),
  }),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type AgentDef = z.infer<typeof AgentDefSchema>;
export type ProviderDef = z.infer<typeof ProviderDefSchema>;
export type AgentRoute = z.infer<typeof RouteSchema>;
export type AgentTier = z.infer<typeof AgentTierSchema>;
export type QualityGateConfig = z.infer<typeof QualityGateSchema>;

// ─── Referential integrity ──────────────────────────────────────

/**
 * Cross-field checks the Zod schema cannot express on its own.
 * Returns human-readable problems; empty array means the config is sound.
 */
export function checkConfigIntegrity(config: PipelineConfig): string[] {
  const problems: string[] = [];
  const providerNames = new Set(config.providers.chain.map((p) => p.name));
  const agentIds = new Set(config.agents.map((a) => a.id));

  for (const [agentId, route] of Object.entries(config.routing.byAgent)) {
    if (!agentIds.has(agentId)) {
      problems.push(
        `routing.byAgent["${agentId}"] は agents に存在しないエージェントを指しています`,
      );
    }
    for (const name of route.preferredProviders) {
      if (!providerNames.has(name)) {
        problems.push(
          `routing.byAgent["${agentId}"].preferredProviders の "${name}" は providers.chain に存在しません`,
        );
      }
    }
  }

  const seenIds = new Set<string>();
  for (const agent of config.agents) {
    if (seenIds.has(agent.id)) problems.push(`エージェント ID が重複しています: ${agent.id}`);
    seenIds.add(agent.id);
  }

  const seenProviders = new Set<string>();
  for (const provider of config.providers.chain) {
    if (seenProviders.has(provider.name)) {
      problems.push(`プロバイダー名が重複しています: ${provider.name}`);
    }
    seenProviders.add(provider.name);
  }

  const steps = config.agents.map((a) => a.step).sort((a, b) => a - b);
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] !== i + 1) {
      problems.push(`agents.step は 1 から連番である必要があります（実際: ${steps.join(', ')}）`);
      break;
    }
  }

  if (config.qualityGate.minBodyLength >= config.qualityGate.maxBodyLength) {
    problems.push('qualityGate.minBodyLength は maxBodyLength より小さい必要があります');
  }

  for (const pattern of [
    ...config.qualityGate.placeholderPatterns,
    ...config.qualityGate.grandioseHeadingPatterns,
  ]) {
    try {
      new RegExp(pattern);
    } catch {
      problems.push(`qualityGate の正規表現が不正です: ${pattern}`);
    }
  }

  return problems;
}

// ─── Load & validate (at import time) ───────────────────────────

function loadConfig(): PipelineConfig {
  const parsed = PipelineConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error(
      `config/pipeline.json がスキーマ検証に失敗しました:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const problems = checkConfigIntegrity(parsed.data);
  if (problems.length > 0) {
    throw new Error(
      `config/pipeline.json の整合性チェックに失敗しました:\n- ${problems.join('\n- ')}`,
    );
  }
  return parsed.data;
}

export const PIPELINE_CONFIG: PipelineConfig = loadConfig();

// ─── Convenience accessors ──────────────────────────────────────

/** Agents in pipeline execution order. */
export function agentsInOrder(): AgentDef[] {
  return [...PIPELINE_CONFIG.agents].sort((a, b) => a.step - b.step);
}

export function getAgent(agentId: string): AgentDef | undefined {
  return PIPELINE_CONFIG.agents.find((a) => a.id === agentId);
}
