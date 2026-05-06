/**
 * Phase θ tests — Theme Balance Module
 */
import { describe, it, expect } from 'vitest';
import { calculateThemeWeights, getThemeDistribution } from '../src/lib/agents/theme-balance.js';

describe('Theme Balance Module', () => {
  describe('calculateThemeWeights', () => {
    it('returns all 9 themes sorted by score', () => {
      const weights = calculateThemeWeights([], []);
      expect(weights).toHaveLength(9);
      expect(weights[0].score).toBeLessThanOrEqual(weights[weights.length - 1].score);
      // All should start at 0 for empty input
      expect(weights.every(w => w.score === 0)).toBe(true);
    });

    it('prioritizes least-used themes', () => {
      const articles = [
        { title: '貯金100万円達成', tags: ['貯金'] },
        { title: '貯金のコツ', tags: ['貯金'] },
      ];
      const weights = calculateThemeWeights(articles);
      const savingsScore = weights.find(w => w.theme === '貯金・節約')?.score;
      const otherScore = weights.find(w => w.theme !== '貯金・節約')?.score;
      expect(savingsScore).toBeGreaterThan(otherScore!);
    });

    it('counts gensnotes articles', () => {
      const gensnotes = ['貯金の話', '投資の話', '投資の話'];
      const weights = calculateThemeWeights([], gensnotes);
      const investmentScore = weights.find(w => w.theme === '投資・資産形成')?.score;
      const savingsScore = weights.find(w => w.theme === '貯金・節約')?.score;
      // gensnotes has 2 investment + 1 savings
      // gensnotes weight = 1, recent weight = 3
      expect(investmentScore).toBe(2); // 2 * 1 (gensnotes only)
      expect(savingsScore).toBe(1); // 1 * 1 (gensnotes only)
    });

    it('combines recent and gensnotes with correct weighting', () => {
      const articles = [{ title: '投資の話' }]; // recent: 1 investment
      const gensnotes = ['投資の話', '投資の話']; // gensnotes: 2 investment
      const weights = calculateThemeWeights(articles, gensnotes);
      const investmentScore = weights.find(w => w.theme === '投資・資産形成')?.score;
      // recent=1 * 3 + gensnotes=2 * 1 = 5
      expect(investmentScore).toBe(5);
    });

    it('handles empty corpus gracefully', () => {
      const weights = calculateThemeWeights([], []);
      expect(weights).toHaveLength(9);
      expect(weights.every(w => w.score === 0)).toBe(true);
    });

    it('handles single category dominance', () => {
      const articles = Array(10).fill({ title: '貯金', tags: ['貯金'] });
      const weights = calculateThemeWeights(articles);
      const savingsScore = weights.find(w => w.theme === '貯金・節約')?.score;
      expect(savingsScore).toBe(30); // 10 * 3
      expect(weights[0].theme).not.toBe('貯金・節約'); // least used first
    });

    it('uses tags for classification', () => {
      const articles = [{ title: 'ブログ', tags: ['投資', 'NISA'] }];
      const weights = calculateThemeWeights(articles);
      const investmentScore = weights.find(w => w.theme === '投資・資産形成')?.score;
      expect(investmentScore).toBeGreaterThan(0);
    });

    it('handles multi-theme articles (first match wins)', () => {
      // Title contains both 貯金 and 投資 keywords, but only counts once
      const articles = [{ title: '貯金と投資の話' }];
      const weights = calculateThemeWeights(articles);
      const savingsScore = weights.find(w => w.theme === '貯金・節約')?.score;
      const investmentScore = weights.find(w => w.theme === '投資・資産形成')?.score;
      // Only one theme counted (貯金 comes first in keywords check)
      expect(savingsScore + investmentScore).toBe(3); // 1 * 3
    });
  });

  describe('getThemeDistribution', () => {
    it('returns a formatted string', () => {
      const dist = getThemeDistribution([]);
      expect(dist).toContain('テーマバランス分析');
      expect(dist).toContain('テーマ');
    });

    it('shows bars for used themes', () => {
      const articles = [{ title: '貯金の話' }];
      const dist = getThemeDistribution(articles);
      expect(dist).toContain('█');
    });
  });
});
