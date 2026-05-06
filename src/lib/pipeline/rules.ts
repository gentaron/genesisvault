/**
 * Phase θ — AGENTS.md Rule Enforcement
 *
 * Parses AGENTS.md frontmatter and enforces development rules at runtime.
 * The pipeline driver validates against these rules before committing.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// ─── Rules schema (parsed from AGENTS.md frontmatter) ─────────

export const RulesSchema = z.object({
  version: z.string(),
  max_iterations_per_agent: z.number().int().min(1).max(10),
  max_total_iterations: z.number().int().min(5).max(50),
  allowed_commit_types: z.array(z.enum(['feat', 'fix', 'docs', 'refactor', 'test', 'chore'])),
  deadlock_threshold_ms: z.number().int().min(60_000),
  min_article_length: z.number().int().min(100),
  max_article_length: z.number().int().max(10000),
  quality_score_threshold: z.number().int().min(0).max(100),
});

export type Rules = z.infer<typeof RulesSchema>;

// ─── Default rules (used if AGENTS.md parsing fails) ───────────

export const DEFAULT_RULES: Rules = {
  version: '1.0.0',
  max_iterations_per_agent: 3,
  max_total_iterations: 15,
  allowed_commit_types: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'],
  deadlock_threshold_ms: 120_000,
  min_article_length: 500,
  max_article_length: 5000,
  quality_score_threshold: 50,
};

// ─── Parse AGENTS.md frontmatter ──────────────────────────────

/**
 * Extracts machine-parseable rules from AGENTS.md.
 * Supports two formats:
 *
 * 1. YAML frontmatter: `---\nkey: value\n---`
 * 2. HTML comment block: `<!-- rules:start\nkey: value\nrules:end -->`
 */
function parseFrontmatter(content: string): Record<string, unknown> {
  let block = '';

  // Try HTML comment format first (Phase θ)
  const commentMatch = content.match(/<!--\s*rules:start\s*\n([\s\S]*?)\n\s*rules:end\s*-->/);
  if (commentMatch) {
    block = commentMatch[1];
  } else {
    // Try YAML frontmatter
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (yamlMatch) {
      block = yamlMatch[1];
    }
  }

  if (!block) return {};
  const lines = block.split('\n');
  const data: Record<string, unknown> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    let val: unknown = line.substring(colonIdx + 1).trim();
    // Parse arrays
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    }
    // Parse numbers
    if (typeof val === 'string' && /^\d+$/.test(val)) {
      val = parseInt(val, 10);
    }
    data[key] = val;
  }
  return data;
}

// ─── Load and validate rules ──────────────────────────────────

let cachedRules: Rules | null = null;

/**
 * Load rules from AGENTS.md. Returns default rules if parsing fails.
 * Results are cached for the process lifetime.
 */
export async function loadRules(): Promise<Rules> {
  if (cachedRules) return cachedRules;

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const rootDir = path.join(__dirname, '..', '..', '..');
    const content = await readFile(path.join(rootDir, 'AGENTS.md'), 'utf-8');
    const frontmatter = parseFrontmatter(content);

    const result = RulesSchema.safeParse(frontmatter);
    if (result.success) {
      cachedRules = result.data;
      console.log(`[Rules] Loaded AGENTS.md v${result.data.version}`);
      return result.data;
    }
    console.warn(`[Rules] AGENTS.md frontmatter parse failed: ${result.error.message}`);
    console.warn('[Rules] Using default rules');
  } catch (err) {
    console.warn(`[Rules] Could not read AGENTS.md: ${(err as Error).message}`);
  }

  cachedRules = DEFAULT_RULES;
  return DEFAULT_RULES;
}

/**
 * Validate a commit message against allowed commit types.
 */
export function validateCommitType(commitMsg: string, rules: Rules): boolean {
  const match = commitMsg.match(/^(\w+)(?:\(.+\))?:/);
  if (!match) return false;
  return rules.allowed_commit_types.includes(match[1] as any);
}
