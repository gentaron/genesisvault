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

/** view-transition-name は CSS の識別子。数字で始まる slug をそのまま使うと無効になる。 */
export function transitionName(kind: 'title' | 'art', slug: string): string {
  return `gv-${kind}-${slug.replace(/[^\w-]/g, '-')}`;
}
