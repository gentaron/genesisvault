/**
 * Phase θ — Theme Balance CLI
 *
 * Usage: bun run analyze:themes
 *
 * Shows current category distribution across all posts.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..');
const POSTS_DIR = path.join(ROOT_DIR, 'src', 'content', 'posts');

async function main() {
  const { getThemeDistribution } = await import('../src/lib/agents/theme-balance.js');

  // Read all posts
  const files = await fs.readdir(POSTS_DIR);
  const mdFiles = files.filter(f => f.endsWith('.md'));

  const recentArticles: { title: string; tags?: string[] } = [];
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf-8');
    const titleMatch = raw.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
    const tagsMatch = raw.match(/^tags:\s*\[([^\]]+)\]/m);
    const tags = tagsMatch?.[1]?.split(',').map(t => t.trim().replace(/"/g, '')) || [];
    if (titleMatch) {
      recentArticles.push({ title: titleMatch[1], tags });
    }
  }

  console.log(`\n全${recentArticles.length}記事のテーマバランス分析:\n`);
  console.log(getThemeDistribution(recentArticles.reverse()));
}

main().catch(console.error);
