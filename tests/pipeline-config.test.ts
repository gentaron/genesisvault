import { describe, expect, it } from 'vitest';
import rawConfig from '../config/pipeline.json';
import {
  agentsInOrder,
  checkConfigIntegrity,
  getAgent,
  PIPELINE_CONFIG,
  PipelineConfigSchema,
} from '../src/lib/pipeline/config';

// ═══════════════════════════════════════════════════════════════
// Phase κ — config/pipeline.json is the single source of truth
// ═══════════════════════════════════════════════════════════════

describe('Phase κ — Declarative Pipeline Config', () => {
  describe('schema validation', () => {
    it('validates the shipped config/pipeline.json', () => {
      const result = PipelineConfigSchema.safeParse(rawConfig);
      expect(result.success).toBe(true);
    });

    it('exposes a parsed config at import time', () => {
      expect(PIPELINE_CONFIG.version).toBeTruthy();
      expect(PIPELINE_CONFIG.agents.length).toBeGreaterThan(0);
      expect(PIPELINE_CONFIG.providers.chain.length).toBeGreaterThan(0);
    });

    it('rejects a config with an out-of-range temperature', () => {
      const broken = structuredClone(rawConfig) as Record<string, unknown>;
      (broken.routing as { byAgent: Record<string, { temperature: number }> }).byAgent[
        'VE-002'
      ].temperature = 9;
      expect(PipelineConfigSchema.safeParse(broken).success).toBe(false);
    });

    it('rejects a malformed agent id', () => {
      const broken = structuredClone(rawConfig) as { agents: { id: string }[] };
      broken.agents[0].id = 'nope';
      expect(PipelineConfigSchema.safeParse(broken).success).toBe(false);
    });
  });

  describe('referential integrity', () => {
    it('finds no problems in the shipped config', () => {
      expect(checkConfigIntegrity(PIPELINE_CONFIG)).toEqual([]);
    });

    it('detects a route pointing at an unknown provider', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.routing.byAgent['VE-002'].preferredProviders = ['gemini-9-ultra'];
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('gemini-9-ultra'))).toBe(true);
    });

    it('detects a route pointing at an unknown agent', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.routing.byAgent['VE-999'] = broken.routing.default;
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('VE-999'))).toBe(true);
    });

    it('detects duplicate agent ids', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.agents.push({ ...broken.agents[0] });
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('重複'))).toBe(true);
    });

    it('detects non-sequential agent steps', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.agents[0].step = 99;
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('連番'))).toBe(true);
    });

    it('detects inverted body-length bounds', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.qualityGate.minBodyLength = broken.qualityGate.maxBodyLength + 1;
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('minBodyLength'))).toBe(true);
    });

    it('detects an invalid regex pattern', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.qualityGate.placeholderPatterns = ['[unclosed'];
      const problems = checkConfigIntegrity(broken);
      expect(problems.some((p) => p.includes('正規表現'))).toBe(true);
    });

    // These bounds are the contract with VAIZ's planner. Inverting one
    // does not fail here — it fails one repo away, hours later, as briefs
    // no consumer can satisfy.
    it('detects inverted video-brief duration bounds', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.videoBrief.minSeconds = broken.videoBrief.maxSeconds + 1;
      expect(checkConfigIntegrity(broken).some((p) => p.includes('minSeconds'))).toBe(true);
    });

    it('detects inverted video-brief scene bounds', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.videoBrief.minScenes = broken.videoBrief.maxScenes + 1;
      expect(checkConfigIntegrity(broken).some((p) => p.includes('minScenes'))).toBe(true);
    });

    it('detects inverted video-brief point bounds', () => {
      const broken = structuredClone(PIPELINE_CONFIG);
      broken.videoBrief.minPoints = broken.videoBrief.maxPoints + 1;
      expect(checkConfigIntegrity(broken).some((p) => p.includes('minPoints'))).toBe(true);
    });
  });

  describe('committed JSON Schema', () => {
    it('matches the Zod schema (run `bun run config:schema` if this fails)', async () => {
      const { readFile } = await import('node:fs/promises');
      const { renderSchema } = await import('../scripts/sync-config-schema.mjs');
      const committed = await readFile('config/pipeline.schema.json', 'utf-8');
      expect(committed).toBe(renderSchema());
    });

    it('is referenced by config/pipeline.json for editor validation', () => {
      expect(PIPELINE_CONFIG.$schema).toBe('./pipeline.schema.json');
    });
  });

  describe('accessors', () => {
    it('returns agents sorted by pipeline step', () => {
      const steps = agentsInOrder().map((a) => a.step);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    });

    it('looks up an agent by id', () => {
      expect(getAgent('VE-002')?.role).toBe('writer');
      expect(getAgent('VE-000')).toBeUndefined();
    });
  });

  describe('config drives the runtime modules', () => {
    it('routing table matches the config', async () => {
      const { AGENT_ROUTES, DEFAULT_ROUTE } = await import('../src/lib/ai/routing');
      expect(AGENT_ROUTES).toBe(PIPELINE_CONFIG.routing.byAgent);
      expect(DEFAULT_ROUTE).toBe(PIPELINE_CONFIG.routing.default);
    });

    it('reference files match the config', async () => {
      const { REFERENCE_FILES } = await import('../src/lib/agents/shared');
      expect(REFERENCE_FILES).toEqual([
        ...PIPELINE_CONFIG.references.legacy,
        ...PIPELINE_CONFIG.references.current,
      ]);
    });

    it('every routed agent exists in the roster', () => {
      for (const agentId of Object.keys(PIPELINE_CONFIG.routing.byAgent)) {
        expect(getAgent(agentId)).toBeDefined();
      }
    });

    it('the Runa output schema takes its point bounds from the config', async () => {
      const { RunaOutputSchema } = await import('../src/lib/agents/schemas');
      const point = 'これは十文字以上ある項目です';
      const tooFew = Array(PIPELINE_CONFIG.videoBrief.minPoints - 1).fill(point);
      const tooMany = Array.from(
        { length: PIPELINE_CONFIG.videoBrief.maxPoints + 1 },
        (_, i) => `${point}${i}`,
      );
      const base = {
        video_title: 'エージェントを止める場所を決める',
        theme: 'AIエージェントに承認ゲートが必要になる理由を1本で扱う。',
        tone: '断定しすぎない一人称で話す。',
        visual_direction:
          '抽象寄り。信号機、ゲート、ダムなど流れを制御するもの。暗めの背景に一点だけ色を置く。',
      };
      expect(RunaOutputSchema.safeParse({ ...base, points: tooFew }).success).toBe(false);
      expect(RunaOutputSchema.safeParse({ ...base, points: tooMany }).success).toBe(false);
    });
  });
});
