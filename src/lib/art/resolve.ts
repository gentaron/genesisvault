/**
 * ビルド時に、記事の挿絵として何を出すかを決める。
 * public/art/<slug>.(jpg|png|webp) があれば AI の挿絵、無ければ SVG のカバー絵。
 */

import fs from 'node:fs';
import path from 'node:path';

const EXTS = ['jpg', 'webp', 'png'] as const;

export function findIllustration(
  slug: string,
  rootDir: string = process.cwd(),
  dir = 'public/art',
): string | null {
  if (!/^[\w-]+$/.test(slug)) return null;
  for (const ext of EXTS) {
    try {
      if (fs.statSync(path.join(rootDir, dir, `${slug}.${ext}`)).size > 0) {
        return `/${dir.replace(/^public\/?/, '')}/${slug}.${ext}`.replace(/\/+/g, '/');
      }
    } catch {
      /* 無い */
    }
  }
  return null;
}

let thumbnailThemes: Map<string, string> | null = null;

/**
 * サムネ決定機構（src/lib/art/thumbnail.ts）が記録したテーマ。SVG のカバー絵も
 * AI の挿絵と同じテーマで描くために使う。記録が無ければ undefined（タイトルから推測）。
 */
export function findThumbnailTheme(
  slug: string,
  rootDir: string = process.cwd(),
  file = 'data/thumbnails.json',
): string | undefined {
  if (!thumbnailThemes) {
    thumbnailThemes = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf-8'));
      for (const e of raw?.entries ?? []) {
        if (typeof e?.slug === 'string' && typeof e?.theme === 'string') {
          thumbnailThemes.set(e.slug, e.theme);
        }
      }
    } catch {
      /* 記録が無い（SVG はタイトルから推測する） */
    }
  }
  return thumbnailThemes.get(slug);
}

/** view-transition-name は CSS の識別子。数字で始まる slug をそのまま使うと無効になる。 */
export function transitionName(kind: 'title' | 'art', slug: string): string {
  return `gv-${kind}-${slug.replace(/[^\w-]/g, '-')}`;
}
