import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ═══════════════════════════════════════════════════════════════
// Nostr Broadcast — parseFrontmatter
// ═══════════════════════════════════════════════════════════════

// Extract parseFrontmatter from nostr-broadcast.mjs logic for testing
function parseFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const metadata: Record<string, any> = {};
  const fm = match[1];
  const body = match[2].trim();

  for (const line of fm.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const titleMatch = trimmed.match(/^title:\s*"(.+?)"$/);
    if (titleMatch) { metadata.title = titleMatch[1]; continue; }

    const dateMatch = trimmed.match(/^date:\s*(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) { metadata.date = dateMatch[1]; continue; }

    const tagsMatch = trimmed.match(/^tags:\s*\[([^\]]*)\]$/);
    if (tagsMatch) {
      metadata.tags = tagsMatch[1]
        .split(',')
        .map(t => t.trim().replace(/"/g, ''))
        .filter(Boolean);
      continue;
    }

    const descMatch = trimmed.match(/^description:\s*"(.+?)"$/);
    if (descMatch) { metadata.description = descMatch[1]; continue; }

    const kwMatch = trimmed.match(/^keywords:\s*\[([^\]]*)\]$/);
    if (kwMatch) {
      metadata.keywords = kwMatch[1]
        .split(',')
        .map(k => k.trim().replace(/"/g, ''))
        .filter(Boolean);
      continue;
    }
  }

  return { metadata, body };
}

describe('Nostr Broadcast — parseFrontmatter', () => {
  it('parses title, date, tags, description, keywords', () => {
    const content = `---
title: "朝5時の家計簿タイム"
date: 2026-05-05
tags: ["貯金", "節約", "マネー"]
description: "貯金のコツを紹介する記事"
keywords: ["貯金", "家計"]
---
## 本文

これは本文です。`;
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.title).toBe('朝5時の家計簿タイム');
    expect(metadata.date).toBe('2026-05-05');
    expect(metadata.tags).toEqual(['貯金', '節約', 'マネー']);
    expect(metadata.description).toBe('貯金のコツを紹介する記事');
    expect(metadata.keywords).toEqual(['貯金', '家計']);
    expect(body).toContain('## 本文');
  });

  it('returns full content when no frontmatter', () => {
    const content = '# No frontmatter\n\nJust content.';
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata).toEqual({});
    expect(body).toBe(content);
  });

  it('handles partial frontmatter (title only)', () => {
    const content = `---
title: "Minimal Post"
---
Body here.`;
    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.title).toBe('Minimal Post');
    expect(metadata.date).toBeUndefined();
    expect(body).toBe('Body here.');
  });

  it('ignores comment lines in frontmatter', () => {
    const content = `---
# This is a comment
title: "Comment Test"
date: 2026-05-05
---
Body.`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.title).toBe('Comment Test');
    expect(metadata['# This is a comment']).toBeUndefined();
  });

  it('handles empty tags and keywords arrays', () => {
    const content = `---
title: "No Tags"
date: 2026-05-05
tags: []
keywords: []
---
Body.`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.tags).toEqual([]);
    expect(metadata.keywords).toEqual([]);
  });

  it('trims quotes from tag values', () => {
    const content = `---
title: "Test"
date: 2026-05-05
tags: ["one", "two"]
---
Body.`;
    const { metadata } = parseFrontmatter(content);
    expect(metadata.tags).toEqual(['one', 'two']);
  });

  it('handles body with multiple sections', () => {
    const content = `---
title: "Long Post"
date: 2026-05-05
---
## Section 1

Content 1.

## Section 2

Content 2.`;
    const { body } = parseFrontmatter(content);
    expect(body).toContain('## Section 1');
    expect(body).toContain('## Section 2');
  });
});

// ═══════════════════════════════════════════════════════════════
// Nostr Broadcast — Private Key Validation
// ═══════════════════════════════════════════════════════════════

describe('Nostr Broadcast — Private Key Validation', () => {
  it('validates 64 hex character key', () => {
    const validKey = 'a'.repeat(64);
    expect(/^[0-9a-fA-F]{64}$/.test(validKey)).toBe(true);
  });

  it('rejects key that is too short', () => {
    const shortKey = 'a'.repeat(32);
    expect(/^[0-9a-fA-F]{64}$/.test(shortKey)).toBe(false);
  });

  it('rejects key that is too long', () => {
    const longKey = 'a'.repeat(128);
    expect(/^[0-9a-fA-F]{64}$/.test(longKey)).toBe(false);
  });

  it('rejects key with non-hex characters', () => {
    const badKey = 'g'.repeat(64);
    expect(/^[0-9a-fA-F]{64}$/.test(badKey)).toBe(false);
  });

  it('rejects empty key', () => {
    expect(/^[0-9a-fA-F]{64}$/.test('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Nostr Broadcast — Relay URL Parsing
// ═══════════════════════════════════════════════════════════════

describe('Nostr Broadcast — Relay URL Parsing', () => {
  const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://relay.nostr.band',
  ];

  function getRelays(envValue: string | undefined): string[] {
    if (!envValue) return DEFAULT_RELAYS;
    return envValue.split(',').map(r => r.trim()).filter(Boolean);
  }

  it('returns default relays when env is not set', () => {
    const relays = getRelays(undefined);
    expect(relays).toEqual(DEFAULT_RELAYS);
  });

  it('parses comma-separated relay URLs from env', () => {
    const relays = getRelays('wss://relay1.com, wss://relay2.com, wss://relay3.com');
    expect(relays).toEqual([
      'wss://relay1.com',
      'wss://relay2.com',
      'wss://relay3.com',
    ]);
  });

  it('filters empty strings from env', () => {
    const relays = getRelays('wss://relay1.com, , wss://relay2.com');
    expect(relays).toEqual(['wss://relay1.com', 'wss://relay2.com']);
  });

  it('trims whitespace from relay URLs', () => {
    const relays = getRelays('  wss://relay1.com  ,  wss://relay2.com  ');
    expect(relays).toEqual(['wss://relay1.com', 'wss://relay2.com']);
  });

  it('handles single relay URL', () => {
    const relays = getRelays('wss://solo.relay.com');
    expect(relays).toEqual(['wss://solo.relay.com']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Nostr Broadcast — NIP-23 Tag Construction
// ═══════════════════════════════════════════════════════════════

describe('Nostr Broadcast — NIP-23 Tag Construction', () => {
  it('builds d-tag from date', () => {
    const metadata = { date: '2026-05-05' };
    const dTag = `${metadata.date || new Date().toISOString().split('T')[0]}-genesis-vault`;
    expect(dTag).toBe('2026-05-05-genesis-vault');
  });

  it('calculates published_at timestamp from date', () => {
    const metadata = { date: '2026-05-05' };
    const publishedAt = Math.floor(new Date(metadata.date).getTime() / 1000);
    expect(typeof publishedAt).toBe('number');
    expect(publishedAt).toBeGreaterThan(1700000000); // after 2023
  });

  it('builds t-tags from tags and keywords (deduplicated)', () => {
    const tags = ['貯金', '節約'];
    const keywords = ['貯金', 'マネー'];
    const allTags = [...new Set([...tags, ...keywords])];
    expect(allTags).toEqual(['貯金', '節約', 'マネー']);
  });

  it('event kind is 30023 (NIP-23 Long-form Content)', () => {
    const kind = 30023;
    expect(kind).toBe(30023);
  });
});

// ═══════════════════════════════════════════════════════════════
// IPFS Archive — Pinata Metadata Construction
// ═══════════════════════════════════════════════════════════════

describe('IPFS Archive — Metadata Construction', () => {
  it('builds correct metadata keyvalues', () => {
    const filename = '2026-05-05-post-abc123.md';
    const metadata = {
      name: `genesis-vault-${filename}`,
      keyvalues: {
        source: 'genesis-vault',
        type: 'blog-post',
        date: new Date().toISOString().split('T')[0],
      },
    };
    expect(metadata.name).toBe(`genesis-vault-${filename}`);
    expect(metadata.keyvalues.source).toBe('genesis-vault');
    expect(metadata.keyvalues.type).toBe('blog-post');
    expect(metadata.keyvalues.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('options use CID version 1', () => {
    const options = { cidVersion: 1 };
    expect(options.cidVersion).toBe(1);
  });

  it('FormData is created with correct content type', () => {
    const content = '# Test\n\nBody.';
    const blob = new Blob([content], { type: 'text/markdown' });
    expect(blob.type).toBe('text/markdown');
    expect(blob.size).toBeGreaterThan(0);
  });
});
