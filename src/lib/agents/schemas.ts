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
import { VIDEO_BRIEF_CONFIG } from '../pipeline/config.js';

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

// ─── VE-009 Runa Vogel (Briefer) ────────────────────────────

/**
 * The content half of a short-video brief. Deliberately five fields and
 * no markdown: the heading structure, the title prefix, and the target
 * duration are rendered from config by `src/lib/pipeline/video-brief.ts`.
 *
 * The point bounds come from the config so the same numbers are not
 * restated here and in the renderer (INV-001).
 */
export const RunaOutputSchema = z.object({
  /** Video title *without* the `動画：` prefix — the renderer adds it. */
  video_title: z.string().min(8).max(50),
  /** What the video is about, in 1-2 sentences. */
  theme: z.string().min(20).max(300),
  /** The beats of the script, one idea per entry, no bullet characters. */
  points: z
    .array(z.string().min(10).max(120))
    .min(VIDEO_BRIEF_CONFIG.minPoints)
    .max(VIDEO_BRIEF_CONFIG.maxPoints),
  /** How it should sound. */
  tone: z.string().min(15).max(200),
  /** What the images should and should not show. */
  visual_direction: z.string().min(30).max(400),
});
export type RunaOutput = z.infer<typeof RunaOutputSchema>;

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
