/**
 * Phase γ — Multi-Provider Chain
 *
 * Builds an ordered array of AI provider entries. Each entry carries a
 * `LanguageModel` instance from the Vercel AI SDK, plus metadata
 * (name, RPM, RPD) used by the fallback logic.
 *
 * Chain order:
 *   gemini-2.5-flash-lite → gemini-2.5-flash → Groq Llama 3.3 70B
 *   → Cerebras Llama 3.3 70B → OpenRouter free → HuggingFace
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createCerebras } from '@ai-sdk/cerebras';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createHuggingFace } from '@ai-sdk/huggingface';
import type { LanguageModel } from 'ai';

export interface ProviderEntry {
  name: string;
  model: LanguageModel;
  rpm: number;
  rpd: number;
}

export function buildProviderChain(): ProviderEntry[] {
  const providers: ProviderEntry[] = [];

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const HF_TOKEN = process.env.HF_TOKEN;

  if (GEMINI_API_KEY) {
    const gp = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
    providers.push(
      { name: 'gemini-2.5-flash-lite', model: gp('gemini-2.5-flash-lite'), rpm: 15, rpd: 1000 },
      { name: 'gemini-2.5-flash', model: gp('gemini-2.5-flash'), rpm: 10, rpd: 250 },
    );
  }
  if (GROQ_API_KEY) {
    const gq = createGroq({ apiKey: GROQ_API_KEY });
    providers.push({ name: 'groq-llama-3.3-70b', model: gq('llama-3.3-70b-versatile'), rpm: 30, rpd: 14400 });
  }
  if (CEREBRAS_API_KEY) {
    const cb = createCerebras({ apiKey: CEREBRAS_API_KEY });
    providers.push({ name: 'cerebras-llama-3.3-70b', model: cb('llama-3.3-70b'), rpm: 30, rpd: 14400 });
  }
  if (OPENROUTER_API_KEY) {
    const or = createOpenRouter({ apiKey: OPENROUTER_API_KEY });
    providers.push({ name: 'openrouter-free', model: or('meta-llama/llama-3.3-70b-instruct:free'), rpm: 20, rpd: 200 });
  }
  if (HF_TOKEN) {
    const hf = createHuggingFace({ apiKey: HF_TOKEN });
    providers.push({ name: 'huggingface', model: hf('meta-llama/Llama-3.3-70B-Instruct'), rpm: 10, rpd: 500 });
  }

  return providers;
}
