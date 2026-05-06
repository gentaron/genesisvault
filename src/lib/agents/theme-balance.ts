/**
 * Phase θ — Theme Balance Module
 *
 * Pure function for theme balance analysis.
 * Extracted from shared.ts for testability and CLI access.
 */

import { THEME_KEYWORDS, type ThemeBalance, type ThemePriority } from './shared.js';

/**
 * Calculate theme weights based on recent article history.
 * Pure function: same input always produces same output.
 *
 * @param recentArticles - Array of { title, tags? } objects
 * @param gensnotesArticles - Array of titles from the old blog
 * @returns ThemePriority[] sorted by score ascending (least-used first)
 */
export function calculateThemeWeights(
  recentArticles: { title: string; tags?: string[] }[],
  gensnotesArticles: string[] = [],
): ThemePriority[] {
  // Count recent articles per theme
  const recentCount: Record<string, number> = Object.fromEntries(
    Object.keys(THEME_KEYWORDS).map(k => [k, 0]),
  );

  for (const article of recentArticles) {
    const searchable = [article.title, ...(article.tags || [])].join(' ');
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => searchable.includes(kw))) {
        recentCount[theme]++;
        break; // Each article counts once
      }
    }
  }

  // Count gensnotes articles per theme
  const gensnotesCount: Record<string, number> = Object.fromEntries(
    Object.keys(THEME_KEYWORDS).map(k => [k, 0]),
  );

  for (const title of gensnotesArticles) {
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => title.includes(kw))) {
        gensnotesCount[theme]++;
        break;
      }
    }
  }

  // Build priority list
  return Object.keys(THEME_KEYWORDS)
    .map(theme => ({
      theme,
      score: (recentCount[theme] || 0) * 3 + (gensnotesCount[theme] || 0),
    }))
    .sort((a, b) => a.score - b.score);
}

/**
 * Get a human-readable theme distribution report.
 */
export function getThemeDistribution(
  recentArticles: { title: string; tags?: string[] }[],
  gensnotesArticles: string[] = [],
): string {
  const weights = calculateThemeWeights(recentArticles, gensnotesArticles);
  const lines = ['テーマバランス分析:', ''];
  for (const w of weights) {
    const bar = '█'.repeat(Math.min(w.score * 2, 40));
    lines.push(`  ${w.theme.padEnd(16)} スコア: ${String(w.score).padStart(2)} ${bar}`);
  }
  lines.push('');
  lines.push(`次の推奨テーマ: ${weights[0]?.theme || 'N/A'}（スコア: ${weights[0]?.score || 0}）`);
  return lines.join('\n');
}
