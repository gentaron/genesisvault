import { describe, it, expect } from 'vitest';

const THEME_KEYWORDS: Record<string, string[]> = {
  '貯金・節約': ['貯金', '節約', '家計', '生活費'],
  '投資・資産形成': ['投資', 'ETF', '株', '資産'],
  'ひとり旅': ['旅', '旅行', 'ひとり旅'],
  '読書': ['読書', '本', '書籍'],
  '瞑想・マインドフルネス': ['瞑想', 'マインドフルネス', '呼吸'],
  'ジャーナリング': ['ジャーナリング', '日記'],
  '散歩・日常': ['散歩', '日常', '朝'],
  '暗号資産': ['暗号', 'ビットコイン', 'BTC'],
  '自己成長': ['成長', '自己啓発', 'スキル'],
};

function categorizeByTheme(texts: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
  for (const text of texts) {
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        counts[theme]++;
        break;
      }
    }
  }
  return counts;
}

describe('Theme Balance Analysis', () => {
  it('categorizes posts correctly', () => {
    const titles = ['貯金100万円達成', 'ETF積立3年目', '鎌倉散歩記'];
    const counts = categorizeByTheme(titles);
    expect(counts['貯金・節約']).toBe(1);
    expect(counts['投資・資産形成']).toBe(1);
    expect(counts['散歩・日常']).toBe(1);
  });

  it('assigns each post to only one theme', () => {
    const titles = ['ETF積立を始めよう']; // Only matches 投資・資産形成
    const counts = categorizeByTheme(titles);
    expect(counts['投資・資産形成']).toBe(1);
    expect(counts['貯金・節約']).toBe(0);
  });

  it('returns zero for uncategorized content', () => {
    const titles = ['今日の天気は晴れ'];
    const counts = categorizeByTheme(titles);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});
