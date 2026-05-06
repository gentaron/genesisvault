/**
 * Phase γ — Fallback Generation
 *
 * Two entry points:
 *   `generateWithFallback<T>` — uses `generateObject` + Zod schema (structured agents)
 *   `generateTextWithFallback` — uses `generateText` (text agents)
 *
 * Both iterate through the provider chain, recording telemetry for each attempt.
 * If all SDK providers fail, `callGeminiDirect` provides a REST-level fallback.
 */

import { generateObject, generateText } from 'ai';
import type { ZodSchema } from 'zod';
import { buildProviderChain } from './providers.js';
import { recordTelemetry } from './telemetry.js';

// ─── Result types ───────────────────────────────────────────────

export interface FallbackResult<T> {
  value: T;
  providerUsed: string;
  attempts: number;
  latencyMs: number;
}

export interface TextFallbackResult {
  text: string;
  providerUsed: string;
  attempts: number;
  latencyMs: number;
}

// ─── Structured output (Nova / Lena / Chloe) ────────────────────

export async function generateWithFallback<T>(opts: {
  schema: ZodSchema<T>;
  system: string;
  prompt: string;
  agentId: string;
  agentName: string;
  abortSignal?: AbortSignal;
}): Promise<FallbackResult<T>> {
  const providers = buildProviderChain();
  const errors: { provider: string; error: unknown }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const { object } = await generateObject({
        model: provider.model,
        schema: opts.schema,
        system: opts.system,
        prompt: opts.prompt,
        abortSignal: opts.abortSignal,
      });
      const latencyMs = Date.now() - startTime;
      recordTelemetry({
        timestamp: new Date().toISOString(),
        agentId: opts.agentId,
        agentName: opts.agentName,
        provider: provider.name,
        attempts: i + 1,
        latencyMs,
        success: true,
      });
      return { value: object, providerUsed: provider.name, attempts: i + 1, latencyMs };
    } catch (err) {
      errors.push({ provider: provider.name, error: err });
    }
  }

  recordTelemetry({
    timestamp: new Date().toISOString(),
    agentId: opts.agentId,
    agentName: opts.agentName,
    provider: 'none',
    attempts: providers.length,
    latencyMs: Date.now() - startTime,
    success: false,
    errors: errors.map(e => ({ provider: e.provider, message: String(e.error) })),
  });

  throw new AggregateError(
    errors.map(e => e.error),
    `All ${providers.length} providers exhausted for ${opts.agentName}`,
  );
}

// ─── Freeform text (Sophia / Iris) ──────────────────────────────

export async function generateTextWithFallback(opts: {
  system?: string;
  prompt: string;
  agentId: string;
  agentName: string;
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}): Promise<TextFallbackResult> {
  const providers = buildProviderChain();
  const errors: { provider: string; error: unknown }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    try {
      const { text } = await generateText({
        model: provider.model,
        system: opts.system,
        prompt: opts.prompt,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
        temperature: opts.temperature ?? 0.85,
        abortSignal: opts.abortSignal,
      });
      if (text && text.trim()) {
        const latencyMs = Date.now() - startTime;
        recordTelemetry({
          timestamp: new Date().toISOString(),
          agentId: opts.agentId,
          agentName: opts.agentName,
          provider: provider.name,
          attempts: i + 1,
          latencyMs,
          success: true,
        });
        return { text: text.trim(), providerUsed: provider.name, attempts: i + 1, latencyMs };
      }
    } catch (err) {
      errors.push({ provider: provider.name, error: err });
    }
  }

  // All SDK providers failed — try direct Gemini REST as a last resort
  const geminiText = await callGeminiDirect(opts.prompt);
  if (geminiText) {
    const latencyMs = Date.now() - startTime;
    recordTelemetry({
      timestamp: new Date().toISOString(),
      agentId: opts.agentId,
      agentName: opts.agentName,
      provider: 'gemini-direct-rest',
      attempts: providers.length + 1,
      latencyMs,
      success: true,
    });
    return { text: geminiText, providerUsed: 'gemini-direct-rest', attempts: providers.length + 1, latencyMs };
  }

  recordTelemetry({
    timestamp: new Date().toISOString(),
    agentId: opts.agentId,
    agentName: opts.agentName,
    provider: 'none',
    attempts: providers.length,
    latencyMs: Date.now() - startTime,
    success: false,
    errors: errors.map(e => ({ provider: e.provider, message: String(e.error) })),
  });

  throw new AggregateError(
    errors.map(e => e.error),
    `All ${providers.length} providers exhausted for ${opts.agentName}`,
  );
}

// ─── Direct Gemini REST fallback ────────────────────────────────

export async function callGeminiDirect(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const maxRetries = 3;
  const baseDelay = 10000;

  for (const model of models) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 4096 },
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          const error = new Error(`Gemini API error (${res.status}): ${errText.substring(0, 200)}`);
          (error as any).status = res.status;
          throw error;
        }
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) return text.trim();
      } catch (err: any) {
        if (err.status === 429 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
  }
  return null;
}
