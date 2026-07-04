import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  loadRules,
  RulesSchema,
  validateCommitType,
} from '../src/lib/pipeline/rules';

describe('Phase θ — AGENTS.md Rule Enforcement', () => {
  describe('RulesSchema', () => {
    it('accepts DEFAULT_RULES', () => {
      const result = RulesSchema.safeParse(DEFAULT_RULES);
      expect(result.success).toBe(true);
    });

    it('rejects out-of-range iteration limits', () => {
      const result = RulesSchema.safeParse({ ...DEFAULT_RULES, max_iterations_per_agent: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid quality score threshold', () => {
      const result = RulesSchema.safeParse({ ...DEFAULT_RULES, quality_score_threshold: 101 });
      expect(result.success).toBe(false);
    });

    it('rejects unknown commit types', () => {
      const result = RulesSchema.safeParse({
        ...DEFAULT_RULES,
        allowed_commit_types: ['feat', 'yolo'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a too-low deadlock threshold', () => {
      const result = RulesSchema.safeParse({ ...DEFAULT_RULES, deadlock_threshold_ms: 1000 });
      expect(result.success).toBe(false);
    });
  });

  describe('loadRules', () => {
    it('loads rules (from AGENTS.md or defaults) that satisfy the schema', async () => {
      const rules = await loadRules();
      const result = RulesSchema.safeParse(rules);
      expect(result.success).toBe(true);
      expect(rules.allowed_commit_types.length).toBeGreaterThan(0);
    });

    it('caches the result for the process lifetime', async () => {
      const first = await loadRules();
      const second = await loadRules();
      expect(second).toBe(first);
    });
  });

  describe('validateCommitType', () => {
    it('accepts an allowed conventional commit type', () => {
      expect(validateCommitType('feat: add tiered routing', DEFAULT_RULES)).toBe(true);
    });

    it('accepts a scoped commit type', () => {
      expect(validateCommitType('fix(pipeline): quality gate wiring', DEFAULT_RULES)).toBe(true);
    });

    it('rejects a disallowed commit type', () => {
      expect(validateCommitType('yolo: ship it', DEFAULT_RULES)).toBe(false);
    });

    it('rejects a message without a type prefix', () => {
      expect(validateCommitType('add stuff without prefix', DEFAULT_RULES)).toBe(false);
    });
  });
});
