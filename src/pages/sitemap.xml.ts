import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

// 静的なサイトマップ。生成はオフラインのビルド時だけで完結する（INV-004 と同じ精神）。
export const prerender = true;

const FALLBACK_SITE = 'https://genesisvault.vercel.app';
const STATIC_PATHS = ['', 'about/', 'agents/', 'status/', 'privacy/'];

export async function GET(context: APIContext): Promise<Response> {
  const base = context.site ?? new URL(FALLBACK_SITE);
  const posts = await getCollection('posts', ({ data }) => data.draft !== true);
  const sorted = posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  const entries: string[] = [];

  for (const path of STATIC_PATHS) {
    entries.push(`  <url>\n    <loc>${new URL(path, base).href}</loc>\n  </url>`);
  }

  for (const post of sorted) {
    const loc = new URL(`posts/${post.slug}/`, base).href;
    const lastmod = post.data.date.toISOString();
    entries.push(`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
