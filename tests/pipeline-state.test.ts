/**
 * Phase θ tests — Pipeline State Machine
 */
import { describe, it, expect } from 'vitest';
import {
  type PipelineState,
  getNextAgent,
  isTerminal,
  isRunning,
  extractPreservedOutputs,
  generateRunId,
  AGENT_IDS,
  AGENT_NAMES,
} from '../src/lib/pipeline/state.js';

describe('Pipeline State Machine', () => {
  describe('getNextAgent', () => {
    it('returns null for idle state', () => {
      expect(getNextAgent({ phase: 'idle' })).toBeNull();
    });

    it('returns null for done state', () => {
      const state: PipelineState = { phase: 'done', runId: 'test', startedAt: '', completedAt: '', articleSlug: 'test' };
      expect(getNextAgent(state)).toBeNull();
    });

    it('returns null for failed state', () => {
      const state: PipelineState = { phase: 'failed', runId: 'test', startedAt: '', failedAt: 'nova', error: 'test', failedPhase: '' };
      expect(getNextAgent(state)).toBeNull();
    });

    it('returns nova for nova-running', () => {
      const state: PipelineState = { phase: 'nova-running', runId: 'test', startedAt: '' };
      expect(getNextAgent(state)).toBe('nova');
    });

    it('returns lena for nova-done', () => {
      const state: PipelineState = { phase: 'nova-done', runId: 'test', startedAt: '', nova: 'テスト', novaMeta: { provider: 'test', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' } };
      expect(getNextAgent(state)).toBe('lena');
    });

    it('returns sophia for chloe-done', () => {
      const meta = { provider: 'test', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' };
      const state: PipelineState = {
        phase: 'chloe-done', runId: 'test', startedAt: '',
        nova: 't', novaMeta: meta,
        lena: { theme: 't', topic: 't', angle: 't', title: 't', mood_hint: '思索' }, lenaMeta: meta,
        chloe: { tags: ['t'], keywords: ['t'], description: 't' }, chloeMeta: meta,
      };
      expect(getNextAgent(state)).toBe('sophia');
    });

    it('returns null for iris-done', () => {
      const meta = { provider: 'test', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' };
      const state: PipelineState = {
        phase: 'iris-done', runId: 'test', startedAt: '',
        nova: 't', novaMeta: meta,
        lena: { theme: 't', topic: 't', angle: 't', title: 't', mood_hint: '思索' }, lenaMeta: meta,
        chloe: { tags: ['t'], keywords: ['t'], description: 't' }, chloeMeta: meta,
        sophia: 'body', sophiaMeta: meta,
        iris: 'edited', irisMeta: meta,
      };
      expect(getNextAgent(state)).toBeNull();
    });

    it('returns null for quality-check and commiting', () => {
      const meta = { provider: 'test', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' };
      const fullState: PipelineState = {
        phase: 'quality-check', runId: 'test', startedAt: '',
        nova: 't', novaMeta: meta,
        lena: { theme: 't', topic: 't', angle: 't', title: 't', mood_hint: '思索' }, lenaMeta: meta,
        chloe: { tags: ['t'], keywords: ['t'], description: 't' }, chloeMeta: meta,
        sophia: 'body', sophiaMeta: meta,
        iris: 'edited', irisMeta: meta,
      };
      expect(getNextAgent(fullState)).toBeNull();
    });
  });

  describe('isTerminal', () => {
    it('returns true for done', () => {
      expect(isTerminal({ phase: 'done', runId: '', startedAt: '', completedAt: '', articleSlug: '' })).toBe(true);
    });

    it('returns true for failed', () => {
      expect(isTerminal({ phase: 'failed', runId: '', startedAt: '', failedAt: 'nova', error: '', failedPhase: '' })).toBe(true);
    });

    it('returns false for nova-done', () => {
      const meta = { provider: 't', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' };
      expect(isTerminal({ phase: 'nova-done', runId: '', startedAt: '', nova: '', novaMeta: meta })).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns true for agent-running states', () => {
      for (const id of AGENT_IDS) {
        expect(isRunning({ phase: `${id}-running`, runId: '', startedAt: '' } as PipelineState)).toBe(true);
      }
    });

    it('returns false for done/failed/idle', () => {
      expect(isRunning({ phase: 'done' } as PipelineState)).toBe(false);
      expect(isRunning({ phase: 'failed' } as PipelineState)).toBe(false);
      expect(isRunning({ phase: 'idle' })).toBe(false);
    });
  });

  describe('extractPreservedOutputs', () => {
    it('extracts outputs from a mid-pipeline state', () => {
      const meta = { provider: 't', attempts: 1, latencyMs: 100, promptVersion: '1.0.0', timestamp: '' };
      const state: PipelineState = {
        phase: 'chloe-done', runId: 'test', startedAt: '',
        nova: 'theme1', novaMeta: meta,
        lena: { theme: 't', topic: 't', angle: 't', title: 't', mood_hint: '思索' }, lenaMeta: meta,
        chloe: { tags: ['t'], keywords: ['t'], description: 't' }, chloeMeta: meta,
      };
      const outputs = extractPreservedOutputs(state);
      expect(outputs.nova).toBe('theme1');
      expect(outputs.lena).toBeDefined();
      expect(outputs.chloe).toBeDefined();
      expect(outputs.sophia).toBeUndefined();
      expect(outputs.iris).toBeUndefined();
    });
  });

  describe('generateRunId', () => {
    it('generates deterministic IDs for the same date', () => {
      const id1 = generateRunId('2026-05-06');
      const id2 = generateRunId('2026-05-06');
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^run-2026-05-06-[a-z0-9]+$/);
    });

    it('generates different IDs for different dates', () => {
      const id1 = generateRunId('2026-05-06');
      const id2 = generateRunId('2026-05-07');
      expect(id1).not.toBe(id2);
    });
  });

  describe('AGENT_IDS and AGENT_NAMES', () => {
    it('has 5 agents in correct order', () => {
      expect(AGENT_IDS).toEqual(['nova', 'lena', 'chloe', 'sophia', 'iris']);
    });

    it('has names for all agents', () => {
      for (const id of AGENT_IDS) {
        expect(AGENT_NAMES[id]).toBeDefined();
        expect(typeof AGENT_NAMES[id]).toBe('string');
      }
    });
  });
});
