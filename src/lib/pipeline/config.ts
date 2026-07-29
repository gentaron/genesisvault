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

/**
 * `judge` is deliberately distinct from `precision`: a proofreader edits,
 * a judge decides pass/fail. Judge work gets the strongest model in the
 * chain — a lenient reviewer lets bad work through silently, and nothing
 * downstream can catch it. See config `review.comment` and INV-011.
 */
export const AgentTierSchema = z.enum(['light', 'creative', 'heavy', 'precision', 'judge']);

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

export const RubricCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Relative weight in the aggregate score. Normalized across active criteria. */
  weight: z.number().positive(),
  /** Skip this criterion when no brief was supplied (weights renormalize). */
  requiresBrief: z.boolean(),
  /** A failing veto criterion rejects the article outright, regardless of score. */
  veto: z.boolean(),
  guidance: z.string().min(1),
});

export const ReviewConfigSchema = z.object({
  comment: z.string().optional(),
  /** Weighted score (0-100) at or above which an article passes. */
  minScore: z.number().int().min(0).max(100),
  /** Scores within ±band of minScore trigger an independent second judge. */
  secondOpinionBand: z.number().int().min(0).max(50),
  maxJudgeAttempts: z.number().int().min(1).max(10),
  judgeTemperature: z.number().min(0).max(2),
  /** Require every finding to quote real text from the article. */
  requireEvidence: z.boolean(),
  quarantineDir: z.string().min(1),
  auditLogDir: z.string().min(1),
  judgeProviders: z.array(z.string()).min(1),
  rubric: z.array(RubricCriterionSchema).min(1),
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
  review: ReviewConfigSchema,
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
export type AgentDef = z.infer<typeof AgentDefSchema>;
export type ProviderDef = z.infer<typeof ProviderDefSchema>;
export type AgentRoute = z.infer<typeof RouteSchema>;
export type AgentTier = z.infer<typeof AgentTierSchema>;
export type QualityGateConfig = z.infer<typeof QualityGateSchema>;
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

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

  // ─── Review (囲い) ────────────────────────────────────────────
  //
  // A misconfigured gate does not announce itself: it just passes
  // everything. These checks make gate misconfiguration loud.

  const seenCriteria = new Set<string>();
  for (const criterion of config.review.rubric) {
    if (seenCriteria.has(criterion.id)) {
      problems.push(`review.rubric の criterion ID が重複しています: ${criterion.id}`);
    }
    seenCriteria.add(criterion.id);
  }

  for (const name of config.review.judgeProviders) {
    if (!providerNames.has(name)) {
      problems.push(`review.judgeProviders の "${name}" は providers.chain に存在しません`);
    }
  }

  // The judge must be at least as strong as the writer. If the reviewer runs
  // on a weaker model than the author, misses become invisible — the pipeline
  // reports all-green while shipping work nobody checked properly.
  const writerRoute = config.routing.byAgent['VE-002'];
  const editorRoute = config.routing.byAgent['VE-006'];
  if (writerRoute && editorRoute) {
    const chainRank = new Map(config.providers.chain.map((p, i) => [p.name, i]));
    const writerTop = writerRoute.preferredProviders[0];
    const editorTop = editorRoute.preferredProviders[0];
    if (writerTop && editorTop && writerTop !== editorTop) {
      problems.push(
        `審査役(VE-006)の最優先モデル "${editorTop}" が書き手(VE-002)の "${writerTop}" と異なります。` +
          `審査役には書き手と同等以上のモデルを配ってください（弱い審査役の見逃しは表示されません）`,
      );
    }
  }

  const briefOnly = config.review.rubric.every((c) => c.requiresBrief);
  if (briefOnly) {
    problems.push(
      'review.rubric が企画指示ありの場合しか働きません。指示が無いときも効く criterion を最低1つ用意してください（fail-open 防止）',
    );
  }

  if (!config.review.rubric.some((c) => c.veto)) {
    problems.push(
      'review.rubric に veto criterion がありません。テーマのすり替えや事実の逆行が加重平均で薄まって通過します',
    );
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
