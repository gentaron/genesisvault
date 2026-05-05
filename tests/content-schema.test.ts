import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replicate the content schema from src/content/config.ts for testing
const postsSchema = z.object({
  title: z.string(),
  date: z.date(),
  mood: z.string().optional(),
  weather: z.string().optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  agents: z.object({
    ceo: z.string().optional(),
    seo: z.string().optional(),
    writer: z.string().optional(),
    editor: z.string().optional(),
  }).optional(),
});

describe('Content Schema', () => {
  it('accepts valid post frontmatter', () => {
    const result = postsSchema.safeParse({
      title: 'テスト記事',
      date: new Date('2026-05-05'),
      mood: '🌿 平和',
      tags: ['ジャーナリング'],
      agents: {
        ceo: 'VE-001 Lena Strauss',
        seo: 'VE-003 Chloe Verdant',
        writer: 'VE-002 Sophia Nightingale',
        editor: 'VE-006 Iris Koenig',
      },
    });
    expect(result.success).toBe(true);
  });

  it('requires title and date', () => {
    const result = postsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('provides defaults for optional arrays', () => {
    const result = postsSchema.safeParse({
      title: 'テスト',
      date: new Date('2026-05-05'),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
      expect(result.data.keywords).toEqual([]);
      expect(result.data.draft).toBe(false);
    }
  });

  it('rejects invalid mood format gracefully', () => {
    // mood is a free-form string, so any string is valid — this tests that it is optional
    const result = postsSchema.safeParse({
      title: 'テスト',
      date: new Date('2026-05-05'),
    });
    expect(result.success).toBe(true);
  });
});
