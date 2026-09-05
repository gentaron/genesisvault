import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

// RSS 2.0 フィード。本文は載せない — ゲート記事の本文は静的ビルドに存在しない
// （INV-010 の隣接領域）ため、description だけを配信する。
export const prerender = true;

const FALLBACK_SITE = 'https://genesisvault.vercel.app';
const MAX_ITEMS = 30;

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET(context: APIContext): Promise<Response> {
  const base = context.site ?? new URL(FALLBACK_SITE);
  const posts = await getCollection('posts', ({ data }) => data.draft !== true);
  const sorted = posts
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, MAX_ITEMS);

  const items = sorted.map((post) => {
    const link = new URL(`posts/${post.slug}/`, base).href;
    const lines = [
      '    <item>',
      `      <title>${escapeXml(post.data.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${post.data.date.toUTCString()}</pubDate>`,
    ];
    if (post.data.description) {
      lines.push(`      <description>${escapeXml(post.data.description)}</description>`);
    }
    for (const tag of post.data.tags) {
      lines.push(`      <category>${escapeXml(tag)}</category>`);
    }
    lines.push('    </item>');
    return lines.join('\n');
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>Genesis Vault</title>\n    <link>${escapeXml(base.href)}</link>\n    <description>思考の種を保管する、静かなデジタル日記 — Mina Eureka Ernst</description>\n    <language>ja-JP</language>\n    <atom:link href="${escapeXml(new URL('rss.xml', base).href)}" rel="self" type="application/rss+xml" />\n${items.join('\n')}\n  </channel>\n</rss>\n`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
