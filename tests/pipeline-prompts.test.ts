import { describe, expect, it } from 'vitest';
import type { AgentId } from '../src/lib/pipeline/prompts';
import {
  getAllPromptVersions,
  getCurrentPromptVersion,
  readPrompt,
} from '../src/lib/pipeline/prompts';

const AGENTS: AgentId[] = ['nova', 'lena', 'chloe', 'sophia', 'iris'];

describe('Phase θ — Prompt Version Manager', () => {
  describe('getCurrentPromptVersion', () => {
    it('returns the latest version for each agent from prompts/', async () => {
      for (const agent of AGENTS) {
        const version = await getCurrentPromptVersion(agent);
        expect(version.agent).toBe(agent);
        expect(version.version).toMatch(/^v?\d+\.\d+\.\d+$/);
        expect(version.path).toContain(`prompts/${agent}`);
      }
    });

    it('falls back to 1.0.0 with empty path for a missing agent directory', async () => {
      const version = await getCurrentPromptVersion('bogus-agent' as AgentId);
      expect(version.version).toBe('1.0.0');
      expect(version.path).toBe('');
    });
  });

  describe('getAllPromptVersions', () => {
    it('returns a version entry for all 5 agents', async () => {
      const versions = await getAllPromptVersions();
      for (const agent of AGENTS) {
        expect(versions[agent]).toBeDefined();
        expect(versions[agent].agent).toBe(agent);
      }
    });
  });

  describe('readPrompt', () => {
    it('reads the current prompt content for an agent', async () => {
      const content = await readPrompt('nova');
      expect(content.length).toBeGreaterThan(0);
    });

    it('reads a specific existing version', async () => {
      const current = await getCurrentPromptVersion('lena');
      const content = await readPrompt('lena', current.version);
      expect(content.length).toBeGreaterThan(0);
    });

    it('returns empty string for a nonexistent version', async () => {
      const content = await readPrompt('nova', 'v9.9.9');
      expect(content).toBe('');
    });

    it('returns empty string for a missing agent directory', async () => {
      const content = await readPrompt('bogus-agent' as AgentId);
      expect(content).toBe('');
    });
  });
});
