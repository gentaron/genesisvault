import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// AI Providers — buildProviderChain
// ═══════════════════════════════════════════════════════════════

describe('AI Providers — buildProviderChain', () => {
  beforeEach(() => {
    // Clear env vars for clean test
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.HF_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns empty array when no API keys are set', async () => {
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(0);
  });

  it('includes Gemini providers when GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(2);
    expect(chain[0].name).toBe('gemini-2.5-flash-lite');
    expect(chain[1].name).toBe('gemini-2.5-flash');
    expect(chain[0].rpm).toBe(15);
    expect(chain[1].rpm).toBe(10);
  });

  it('includes Groq provider when GROQ_API_KEY is set', async () => {
    process.env.GROQ_API_KEY = 'test-groq-key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('groq-llama-3.3-70b');
    expect(chain[0].rpm).toBe(30);
  });

  it('includes Cerebras provider when CEREBRAS_API_KEY is set', async () => {
    process.env.CEREBRAS_API_KEY = 'test-cerebras-key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('cerebras-llama-3.3-70b');
  });

  it('includes OpenRouter provider when OPENROUTER_API_KEY is set', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('openrouter-free');
  });

  it('includes HuggingFace provider when HF_TOKEN is set', async () => {
    process.env.HF_TOKEN = 'test-hf-key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].name).toBe('huggingface');
  });

  it('maintains correct order with multiple providers', async () => {
    process.env.GEMINI_API_KEY = 'key';
    process.env.GROQ_API_KEY = 'key';
    process.env.CEREBRAS_API_KEY = 'key';
    process.env.OPENROUTER_API_KEY = 'key';
    process.env.HF_TOKEN = 'key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    expect(chain).toHaveLength(6);
    expect(chain[0].name).toBe('gemini-2.5-flash-lite');
    expect(chain[1].name).toBe('gemini-2.5-flash');
    expect(chain[2].name).toBe('groq-llama-3.3-70b');
    expect(chain[3].name).toBe('cerebras-llama-3.3-70b');
    expect(chain[4].name).toBe('openrouter-free');
    expect(chain[5].name).toBe('huggingface');
  });

  it('each entry has model, rpm, and rpd', async () => {
    process.env.GEMINI_API_KEY = 'key';
    const { buildProviderChain } = await import('../src/lib/ai/providers');
    const chain = buildProviderChain();
    for (const entry of chain) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('model');
      expect(entry).toHaveProperty('rpm');
      expect(entry).toHaveProperty('rpd');
      expect(typeof entry.rpm).toBe('number');
      expect(typeof entry.rpd).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AI Generate — callGeminiDirect (REST fallback)
// ═══════════════════════════════════════════════════════════════

describe('AI Generate — callGeminiDirect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns null when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    const { callGeminiDirect } = await import('../src/lib/ai/generate');
    const result = await callGeminiDirect('test prompt');
    expect(result).toBeNull();
  });
});
