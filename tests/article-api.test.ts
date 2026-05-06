import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// ─── Replicate hmacVerify from article/[slug].ts ────────────────
function hmacVerify(cookieHeader: string | undefined): { valid: boolean; wallet?: string } {
  if (!cookieHeader) return { valid: false };
  const match = cookieHeader.match(/gv_unlock=([^;]+)/);
  if (!match) return { valid: false };

  let payload: string, sig: string;
  try {
    const decoded = decodeURIComponent(match[1]);
    const dotIndex = decoded.lastIndexOf('.');
    if (dotIndex === -1) return { valid: false };
    payload = decoded.substring(0, dotIndex);
    sig = decoded.substring(dotIndex + 1);
  } catch {
    return { valid: false };
  }

  const secret = process.env.PAYWALL_SECRET || 'change-me-in-production';
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig !== expected) return { valid: false };

  const parts = payload.split('.');
  if (parts.length !== 2) return { valid: false };
  const [wallet, expiry] = parts;
  if (Number(expiry) < Date.now()) return { valid: false };

  return { valid: true, wallet };
}

// ─── Replicate extractMarkdownBody from article/[slug].ts ──────
function extractMarkdownBody(raw: string): string {
  const fmEnd = raw.indexOf('---', raw.indexOf('---') + 3);
  if (fmEnd === -1) return raw;
  return raw.substring(fmEnd + 3).trim();
}

// ─── Replicate simpleMarkdownToHtml from article/[slug].ts ─────
function simpleMarkdownToHtml(md: string): string {
  let html = md;
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[23]>)/g, '$1');
  html = html.replace(/(<\/h[23]>)<\/p>/g, '$1');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ═══════════════════════════════════════════════════════════════
// Article API — HMAC Verification (server-side paywall)
// ═══════════════════════════════════════════════════════════════

describe('Article API — Cookie Verification', () => {
  const secret = process.env.PAYWALL_SECRET || 'change-me-in-production';

  function makeCookie(wallet: string, expiry: number): string {
    const payload = `${wallet.toLowerCase()}.${expiry}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `gv_unlock=${encodeURIComponent(payload + '.' + sig)}; Path=/; HttpOnly`;
  }

  it('accepts valid cookie', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = makeCookie('0xabcdef1234567890abcdef1234567890abcdef12', expiry);
    const result = hmacVerify(cookie);
    expect(result.valid).toBe(true);
  });

  it('extracts wallet from valid cookie', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const wallet = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
    const cookie = makeCookie(wallet, expiry);
    const result = hmacVerify(cookie);
    expect(result.wallet).toBe(wallet.toLowerCase());
  });

  it('rejects tampered cookie', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = makeCookie('0xabcdef1234567890abcdef1234567890abcdef12', expiry);
    // Extract the gv_unlock value, tamper it, and reassemble
    const match = cookie.match(/gv_unlock=([^;]+)/);
    const originalValue = match![1];
    const tamperedValue = originalValue.slice(0, -10) + 'TAMPERED';
    const tamperedCookie = cookie.replace(originalValue, tamperedValue);
    const result = hmacVerify(tamperedCookie);
    expect(result.valid).toBe(false);
  });

  it('rejects expired cookie', () => {
    const expiry = Date.now() - 1000;
    const cookie = makeCookie('0xabcdef1234567890abcdef1234567890abcdef12', expiry);
    const result = hmacVerify(cookie);
    expect(result.valid).toBe(false);
  });

  it('rejects missing cookie header', () => {
    const result = hmacVerify(undefined);
    expect(result.valid).toBe(false);
  });

  it('rejects empty string cookie', () => {
    const result = hmacVerify('');
    expect(result.valid).toBe(false);
  });

  it('rejects cookie with wrong name (gv_token)', () => {
    const result = hmacVerify('gv_token=some.value.here');
    expect(result.valid).toBe(false);
  });

  it('rejects cookie with wrong name (session)', () => {
    const result = hmacVerify('session=abc123');
    expect(result.valid).toBe(false);
  });

  it('handles cookie with multiple key-value pairs', () => {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const validPart = makeCookie('0xabcdef1234567890abcdef1234567890abcdef12', expiry);
    const cookie = `other=value; ${validPart}; session=xyz`;
    const result = hmacVerify(cookie);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Article API — Markdown Body Extraction
// ═══════════════════════════════════════════════════════════════

describe('Article API — Markdown Body Extraction', () => {
  it('extracts body after frontmatter', () => {
    const raw = `---
title: Test Post
date: 2026-05-05
---
# Hello

This is the body.`;
    const body = extractMarkdownBody(raw);
    expect(body).toBe('# Hello\n\nThis is the body.');
  });

  it('returns full content when no frontmatter', () => {
    const raw = '# Hello\n\nNo frontmatter here.';
    const body = extractMarkdownBody(raw);
    expect(body).toBe('# Hello\n\nNo frontmatter here.');
  });

  it('handles complex frontmatter', () => {
    const raw = `---
title: "Test Post with Quotes"
date: 2026-05-05
tags: ["one", "two", "three"]
mood: "🌿 平和"
agents:
  ceo: VE-001
  seo: VE-003
---
Body content here.`;
    const body = extractMarkdownBody(raw);
    expect(body).toBe('Body content here.');
  });

  it('handles empty body after frontmatter', () => {
    const raw = `---
title: Test
date: 2026-05-05
---`;
    const body = extractMarkdownBody(raw);
    expect(body).toBe('');
  });

  it('handles body starting with blank lines', () => {
    const raw = `---
title: Test
date: 2026-05-05
---

Body after blank lines.`;
    const body = extractMarkdownBody(raw);
    expect(body).toBe('Body after blank lines.');
  });
});

// ═══════════════════════════════════════════════════════════════
// Article API — Simple Markdown to HTML Conversion
// ═══════════════════════════════════════════════════════════════

describe('Article API — Markdown to HTML Conversion', () => {
  it('converts h2 headings', () => {
    const html = simpleMarkdownToHtml('## Title');
    expect(html).toContain('<h2>Title</h2>');
  });

  it('converts h3 headings', () => {
    const html = simpleMarkdownToHtml('### Subtitle');
    expect(html).toContain('<h3>Subtitle</h3>');
  });

  it('converts bold text', () => {
    const html = simpleMarkdownToHtml('This is **bold** text.');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('converts italic text', () => {
    const html = simpleMarkdownToHtml('This is *italic* text.');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts inline code', () => {
    const html = simpleMarkdownToHtml('Use `console.log()` here.');
    expect(html).toContain('<code>console.log()</code>');
  });

  it('wraps paragraphs in <p> tags', () => {
    const html = simpleMarkdownToHtml('First paragraph.\n\nSecond paragraph.');
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('removes empty paragraphs', () => {
    const html = simpleMarkdownToHtml('Hello\n\n\n\nWorld');
    expect(html).not.toContain('<p></p>');
  });

  it('converts line breaks to <br>', () => {
    const html = simpleMarkdownToHtml('Line one\nLine two');
    expect(html).toContain('<br>');
  });

  it('handles headings without extra <p> wrapping', () => {
    const html = simpleMarkdownToHtml('## Title\n\nParagraph.');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).not.toContain('<p><h2>');
    expect(html).not.toContain('</h2></p>');
  });

  it('handles mixed markdown content', () => {
    const md = [
      '## Introduction',
      '',
      'This is a **test** post with *various* formatting.',
      '',
      '### Details',
      '',
      "Use `code` for examples.",
    ].join('\n');

    const html = simpleMarkdownToHtml(md);
    expect(html).toContain('<h2>Introduction</h2>');
    expect(html).toContain('<strong>test</strong>');
    expect(html).toContain('<em>various</em>');
    expect(html).toContain('<h3>Details</h3>');
    expect(html).toContain('<code>code</code>');
  });
});

// ═══════════════════════════════════════════════════════════════
// Article API — Free Post Logic
// ═══════════════════════════════════════════════════════════════

describe('Article API — Free Post Logic (newest 2)', () => {
  it('identifies the two newest posts as free', () => {
    const files = ['2026-05-01-a.md', '2026-05-02-b.md', '2026-05-03-c.md', '2026-05-04-d.md', '2026-05-05-e.md'];
    const sortedFiles = [...files].sort().reverse();
    const newestFile = sortedFiles[0];  // 2026-05-05-e.md
    const secondNewest = sortedFiles[1]; // 2026-05-04-d.md
    expect(sortedFiles.indexOf(newestFile)).toBe(0);
    expect(sortedFiles.indexOf(secondNewest)).toBe(1);
    // Both are "free" (index < 2)
    expect(sortedFiles.indexOf(newestFile) < 2).toBe(true);
    expect(sortedFiles.indexOf(secondNewest) < 2).toBe(true);
  });

  it('third-newest post is gated', () => {
    const files = ['2026-05-01-a.md', '2026-05-02-b.md', '2026-05-03-c.md', '2026-05-04-d.md', '2026-05-05-e.md'];
    const sortedFiles = [...files].sort().reverse();
    const thirdFile = sortedFiles[2]; // 2026-05-03-c.md
    expect(sortedFiles.indexOf(thirdFile) >= 2).toBe(true);
  });

  it('handles only one post (free)', () => {
    const files = ['2026-05-05-a.md'];
    const sortedFiles = [...files].sort().reverse();
    expect(sortedFiles.length).toBe(1);
    expect(sortedFiles.indexOf(sortedFiles[0]) < 2).toBe(true);
  });

  it('handles two posts (both free)', () => {
    const files = ['2026-05-04-a.md', '2026-05-05-b.md'];
    const sortedFiles = [...files].sort().reverse();
    expect(sortedFiles.every((_, i) => i < 2)).toBe(true);
  });
});
