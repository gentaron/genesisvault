import { describe, expect, it } from 'vitest';
import type { ProviderEntry } from '../src/lib/ai/providers';
import {
  AGENT_ROUTES,
  DEFAULT_ROUTE,
  getAgentRoute,
  orderProvidersForAgent,
} from '../src/lib/ai/routing';

// Minimal fake chain — the model instance is irrelevant for ordering
function fakeChain(names: string[]): ProviderEntry[] {
  return names.map((name) => ({ name, model: {} as never, rpm: 10, rpd: 100 }));
}

const FULL_CHAIN = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'groq-llama-3.3-70b',
  'cerebras-llama-3.3-70b',
  'openrouter-free',
  'huggingface',
];

describe('Phase ι — Per-Agent Tiered Routing', () => {
  describe('AGENT_ROUTES table', () => {
    it('defines a route for all 5 agents', () => {
      for (const id of ['VE-005', 'VE-001', 'VE-003', 'VE-002', 'VE-006']) {
        expect(AGENT_ROUTES[id]).toBeDefined();
      }
    });

    it('gives the Writer (VE-002) the strongest Gemini model first', () => {
      expect(AGENT_ROUTES['VE-002'].preferredProviders[0]).toBe('gemini-2.5-flash');
      expect(AGENT_ROUTES['VE-002'].tier).toBe('heavy');
    });

    it('gives the Editor (VE-006) a low precision temperature', () => {
      expect(AGENT_ROUTES['VE-006'].temperature).toBeLessThanOrEqual(0.4);
      expect(AGENT_ROUTES['VE-006'].tier).toBe('precision');
    });

    it('gives the CEO (VE-001) a high creative temperature', () => {
      expect(AGENT_ROUTES['VE-001'].temperature).toBeGreaterThanOrEqual(0.8);
    });

    it('routes light agents away from the heavy Gemini model', () => {
      // Nova and Chloe should not burn gemini-2.5-flash quota first
      expect(AGENT_ROUTES['VE-005'].preferredProviders[0]).not.toBe('gemini-2.5-flash');
      expect(AGENT_ROUTES['VE-003'].preferredProviders[0]).not.toBe('gemini-2.5-flash');
    });

    it('keeps token budgets small for light agents', () => {
      expect(AGENT_ROUTES['VE-005'].maxOutputTokens).toBeLessThanOrEqual(1024);
      expect(AGENT_ROUTES['VE-003'].maxOutputTokens).toBeLessThanOrEqual(1024);
    });
  });

  describe('getAgentRoute', () => {
    it('returns the route for a known agent', () => {
      expect(getAgentRoute('VE-002')).toBe(AGENT_ROUTES['VE-002']);
    });

    it('returns DEFAULT_ROUTE for unknown agents', () => {
      expect(getAgentRoute('VE-999')).toBe(DEFAULT_ROUTE);
    });
  });

  describe('orderProvidersForAgent', () => {
    it('puts preferred providers first, in preference order', () => {
      const chain = fakeChain(FULL_CHAIN);
      const ordered = orderProvidersForAgent(chain, 'VE-005');
      expect(ordered.map((p) => p.name).slice(0, 3)).toEqual([
        'groq-llama-3.3-70b',
        'cerebras-llama-3.3-70b',
        'gemini-2.5-flash-lite',
      ]);
    });

    it('keeps unlisted providers after preferred ones, in chain order', () => {
      const chain = fakeChain(FULL_CHAIN);
      const ordered = orderProvidersForAgent(chain, 'VE-005');
      expect(ordered.map((p) => p.name).slice(3)).toEqual([
        'gemini-2.5-flash',
        'openrouter-free',
        'huggingface',
      ]);
    });

    it('preserves the full chain length (no dropped or duplicated providers)', () => {
      const chain = fakeChain(FULL_CHAIN);
      for (const id of Object.keys(AGENT_ROUTES)) {
        const ordered = orderProvidersForAgent(chain, id);
        expect(ordered).toHaveLength(chain.length);
        expect(new Set(ordered.map((p) => p.name)).size).toBe(chain.length);
      }
    });

    it('skips preferred providers whose keys are not set (absent from chain)', () => {
      // Only Gemini keys set — Groq/Cerebras absent
      const chain = fakeChain(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
      const ordered = orderProvidersForAgent(chain, 'VE-005');
      expect(ordered.map((p) => p.name)).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
    });

    it('returns the chain unchanged for unknown agents', () => {
      const chain = fakeChain(FULL_CHAIN);
      const ordered = orderProvidersForAgent(chain, 'VE-999');
      expect(ordered.map((p) => p.name)).toEqual(FULL_CHAIN);
    });

    it('returns an empty chain unchanged', () => {
      expect(orderProvidersForAgent([], 'VE-002')).toEqual([]);
    });
  });
});
