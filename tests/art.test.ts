import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEYWORDS } from '../src/lib/agents/shared';
import {
  buildCoverSvg,
  detectTheme,
  hashString,
  PALETTES,
  seededRandom,
} from '../src/lib/art/cover';
import {
  buildIllustrationPrompt,
  extractImageBase64,
  generateIllustration,
  publicUrlFor,
  sniffImage,
  THEME_SCENES,
} from '../src/lib/art/illustrate';
import { findIllustration, transitionName } from '../src/lib/art/resolve';

afterEach(() => {
  vi.unstubAllGlobals();
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const ENV = { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'tok' } as NodeJS.ProcessEnv;

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gv-art-'));
}

describe('cover art (deterministic SVG)', () => {
  it('has a palette and a scene for every theme', () => {
    for (const theme of Object.keys(THEME_KEYWORDS)) {
      expect(PALETTES[theme], theme).toBeDefined();
      expect(THEME_SCENES[theme], theme).toBeDefined();
    }
  });

  it('is the same picture for the same slug, and a different one for another slug', () => {
    const a = buildCoverSvg({
      slug: '2026-10-11-post-6cuzey',
      title: '朝の散歩',
      tags: ['散歩・日常'],
    });
    const b = buildCoverSvg({
      slug: '2026-10-11-post-6cuzey',
      title: '朝の散歩',
      tags: ['散歩・日常'],
    });
    const c = buildCoverSvg({
      slug: '2026-10-12-post-aaaaaa',
      title: '朝の散歩',
      tags: ['散歩・日常'],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('renders every theme as well-formed SVG with an accessible label and no NaN', () => {
    for (const theme of Object.keys(THEME_KEYWORDS)) {
      for (let i = 0; i < 20; i++) {
        const svg = buildCoverSvg({ slug: `s-${theme}-${i}`, title: 't', tags: [theme] });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).toContain('role="img"');
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });

  it('escapes the title so it cannot break out of the SVG', () => {
    const svg = buildCoverSvg({ slug: 'x', title: '<script>alert("x")</script>&' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('picks the theme from tags first, then from the title, then falls back', () => {
    expect(detectTheme('なんでも', ['読書'])).toBe('読書');
    expect(detectTheme('ビットコインの画面を閉じた')).toBe('暗号資産');
    expect(detectTheme('なにも当てはまらない')).toBe('散歩・日常');
  });

  it('has a stable hash and a reproducible random stream', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    const r1 = seededRandom(42);
    const r2 = seededRandom(42);
    const xs = Array.from({ length: 5 }, () => r1());
    expect(xs).toEqual(Array.from({ length: 5 }, () => r2()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('illustration prompt', () => {
  it('never asks for people or text', () => {
    const p = buildIllustrationPrompt('ひとり旅の朝', ['ひとり旅']);
    expect(p).toContain('no people');
    expect(p).toContain('no text');
    expect(p).toContain(THEME_SCENES['ひとり旅']);
  });

  it('does not leak the article title into the prompt', () => {
    expect(buildIllustrationPrompt('資産が最高値の日', [])).not.toContain('資産');
  });
});

describe('image helpers', () => {
  it('recognises real image bytes only', () => {
    expect(sniffImage(JPEG)).toBe('jpg');
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))).toBe('png');
    expect(sniffImage(new TextEncoder().encode('{"error":"nope"}'))).toBeNull();
  });

  it('reads both response shapes', () => {
    expect(extractImageBase64({ result: { image: 'abc' } })).toBe('abc');
    expect(extractImageBase64({ image: 'abc' })).toBe('abc');
    expect(extractImageBase64({ result: {} })).toBeNull();
    expect(extractImageBase64(null)).toBeNull();
  });

  it('builds the public URL from the dir under public/', () => {
    expect(publicUrlFor('2026-10-12-post-x', 'jpg', 'public/art')).toBe(
      '/art/2026-10-12-post-x.jpg',
    );
  });

  it('makes a valid CSS ident for view-transition-name even when the slug starts with a digit', () => {
    expect(transitionName('art', '2026-10-12-post-x')).toBe('gv-art-2026-10-12-post-x');
  });
});

describe('generateIllustration is fail-soft', () => {
  it('does nothing without keys', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const notes: string[] = [];
    expect(await generateIllustration(await tmpRoot(), 'p1', 't', [], notes, {})).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notes[0]).toContain('未設定');
  });

  it('saves a real image and the build finds it', async () => {
    const root = await tmpRoot();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: { image: Buffer.from(JPEG).toString('base64') },
          success: true,
        }),
      })),
    );
    const notes: string[] = [];
    const art = await generateIllustration(root, 'p2', 't', ['読書'], notes, ENV);
    expect(art?.url).toBe('/art/p2.jpg');
    expect(findIllustration('p2', root)).toBe('/art/p2.jpg');
    // 2回目は描かない（Neurons の節約）
    const again = await generateIllustration(root, 'p2', 't', ['読書'], notes, ENV);
    expect(again).toBeNull();
    expect(notes).toContain('挿絵は既にある');
  });

  it('refuses a non-image body, an HTTP error and a thrown fetch without throwing', async () => {
    const root = await tmpRoot();
    const cases = [
      async () => ({
        ok: true,
        json: async () => ({ result: { image: Buffer.from('oops').toString('base64') } }),
      }),
      async () => ({ ok: false, status: 429, text: async () => 'daily limit' }),
      async () => {
        throw new Error('ETIMEDOUT');
      },
    ];
    for (const impl of cases) {
      vi.stubGlobal('fetch', vi.fn(impl));
      const notes: string[] = [];
      expect(await generateIllustration(root, 'p3', 't', [], notes, ENV)).toBeNull();
      expect(notes.length).toBeGreaterThan(0);
    }
    expect(findIllustration('p3', root)).toBeNull();
  });

  it('rejects path-traversal slugs', async () => {
    const notes: string[] = [];
    expect(await generateIllustration(await tmpRoot(), '../evil', 't', [], notes, ENV)).toBeNull();
    expect(findIllustration('../evil')).toBeNull();
  });
});
