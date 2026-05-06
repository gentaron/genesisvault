/**
 * Phase γ — Agent Zod Schemas
 *
 * Defines the structured output schemas for the 3 structured agents:
 *   - VE-005 Nova Harmon  (Balancer)  → NovaOutputSchema
 *   - VE-001 Lena Strauss (CEO)       → LenaOutputSchema
 *   - VE-003 Chloe Verdant (SEO)      → ChloeOutputSchema
 *
 * The 2 text agents (Sophia/Writer, Iris/Editor) use freeform text
 * and have no schema.
 */

import { z } from 'zod';

// ─── VE-005 Nova Harmon (Balancer) ──────────────────────────

export const NovaOutputSchema = z.object({
  selected_theme: z.string().min(2).max(30),
  reason: z.string().min(10).max(300),
});
export type NovaOutput = z.infer<typeof NovaOutputSchema>;

// ─── VE-001 Lena Strauss (CEO) ──────────────────────────────

export const LenaOutputSchema = z.object({
  topic: z.string().min(5).max(120),
  angle: z.string().min(20).max(400),
  title: z.string().min(8).max(50),
  mood_hint: z.enum(['静寂', '思索', '平和', '発見', '情熱', '充実', '自由']),
});
export type LenaOutput = z.infer<typeof LenaOutputSchema>;

// ─── VE-003 Chloe Verdant (SEO) ─────────────────────────────

export const ChloeOutputSchema = z.object({
  tags: z.array(z.string().min(1).max(20)).min(3).max(8),
  keywords: z.array(z.string().min(1).max(30)).min(2).max(5),
  description: z.string().min(30).max(160),
});
export type ChloeOutput = z.infer<typeof ChloeOutputSchema>;

// ─── Shared theme constants ─────────────────────────────────

export const ALL_THEMES = [
  '貯金・節約',
  '投資・資産形成',
  'ひとり旅',
  '読書',
  '瞑想・マインドフルネス',
  'ジャーナリング',
  '散歩・日常',
  '暗号資産',
  '自己成長',
] as const;

export type Theme = (typeof ALL_THEMES)[number];
