/**
 * Phase θ tests — Theme Balance Module
 */
import { describe, expect, it } from 'vitest';
import { THEME_KEYWORDS } from '../src/lib/agents/shared.js';
import { calculateThemeWeights, getThemeDistribution } from '../src/lib/agents/theme-balance.js';

describe('Theme Balance Module', () => {
  describe('calculateThemeWeights', () => {
    it('returns every known theme sorted by score', () => {
      const weights = calculateThemeWeights([], []);
      expect(weights).toHaveLength(Object.keys(THEME_KEYWORDS).length);
      expect(weights[0].score).toBeLessThanOrEqual(weights[weights.length - 1].score);
      // All should start at 0 for empty input
      expect(weights.every((w) => w.score === 0)).toBe(true);
    });

    it('prioritizes least-used themes', () => {
      const articles = [
        { title: 'ビットコイン100万円達成', tags: ['ビットコイン'] },
        { title: 'ビットコインのコツ', tags: ['ビットコイン'] },
      ];
      const weights = calculateThemeWeights(articles);
      const cryptoScore = weights.find((w) => w.theme === '暗号資産')?.score;
      const otherScore = weights.find((w) => w.theme !== '暗号資産')?.score;
      expect(cryptoScore).toBeGreaterThan(otherScore!);
    });

    it('counts gensnotes articles', () => {
      const gensnotes = ['ビットコインの話', '投資の話', '投資の話'];
      const weights = calculateThemeWeights([], gensnotes);
      const investmentScore = weights.find((w) => w.theme === '投資・資産形成')?.score;
      const cryptoScore = weights.find((w) => w.theme === '暗号資産')?.score;
      // gensnotes has 2 investment + 1 savings
      // gensnotes weight = 1, recent weight = 3
      expect(investmentScore).toBe(2); // 2 * 1 (gensnotes only)
      expect(cryptoScore).toBe(1); // 1 * 1 (gensnotes only)
    });

    it('combines recent and gensnotes with correct weighting', () => {
      const articles = [{ title: '投資の話' }]; // recent: 1 investment
      const gensnotes = ['投資の話', '投資の話']; // gensnotes: 2 investment
      const weights = calculateThemeWeights(articles, gensnotes);
      const investmentScore = weights.find((w) => w.theme === '投資・資産形成')?.score;
      // recent=1 * 3 + gensnotes=2 * 1 = 5
      expect(investmentScore).toBe(5);
    });

    it('handles empty corpus gracefully', () => {
      const weights = calculateThemeWeights([], []);
      expect(weights).toHaveLength(Object.keys(THEME_KEYWORDS).length);
      expect(weights.every((w) => w.score === 0)).toBe(true);
    });

    it('handles single category dominance', () => {
      const articles = Array(10).fill({ title: 'ビットコイン', tags: ['ビットコイン'] });
      const weights = calculateThemeWeights(articles);
      const cryptoScore = weights.find((w) => w.theme === '暗号資産')?.score;
      expect(cryptoScore).toBe(30); // 10 * 3
      expect(weights[0].theme).not.toBe('暗号資産'); // least used first
    });

    it('uses tags for classification', () => {
      const articles = [{ title: 'ブログ', tags: ['投資', 'NISA'] }];
      const weights = calculateThemeWeights(articles);
      const investmentScore = weights.find((w) => w.theme === '投資・資産形成')?.score;
      expect(investmentScore).toBeGreaterThan(0);
    });

    it('handles multi-theme articles (first match wins)', () => {
      // Title contains both ビットコイン and 投資 keywords, but only counts once
      const articles = [{ title: 'ビットコインと投資の話' }];
      const weights = calculateThemeWeights(articles);
      const cryptoScore = weights.find((w) => w.theme === '暗号資産')?.score;
      const investmentScore = weights.find((w) => w.theme === '投資・資産形成')?.score;
      // Only one theme counted (投資 comes first in keywords check)
      expect(cryptoScore).toBeDefined();
      expect(investmentScore).toBeDefined();
      expect((cryptoScore ?? 0) + (investmentScore ?? 0)).toBe(3); // 1 * 3
    });
  });

  describe('getThemeDistribution', () => {
    it('returns a formatted string', () => {
      const dist = getThemeDistribution([]);
      expect(dist).toContain('テーマバランス分析');
      expect(dist).toContain('テーマ');
    });

    it('shows bars for used themes', () => {
      const articles = [{ title: 'ビットコインの話' }];
      const dist = getThemeDistribution(articles);
      expect(dist).toContain('█');
    });
  });
});
