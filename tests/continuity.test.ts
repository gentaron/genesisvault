/**
 * Phase ι tests — Continuity Subsystem (過去記事整合性)
 *
 * 「貯金300万の記事のあとに貯金200万の記事を書く」逆行を防ぐための
 * 決定的コア（抽出 Vera → 統合 Edda）を検証する。LLM/ネットワークには依存しない。
 */
import { describe, it, expect } from 'vitest';
import {
  parseAmountYen,
  runResearcher,
  consolidate,
  buildDeterministicBrief,
  MONEY_MAX_YEN,
  type PastArticle,
} from '../src/lib/agents/continuity';

describe('parseAmountYen', () => {
  it('parses 万 amounts with and without 円', () => {
    expect(parseAmountYen('300万円')).toBe(3_000_000);
    expect(parseAmountYen('300万')).toBe(3_000_000);
    expect(parseAmountYen('1,250万円')).toBe(12_500_000);
  });

  it('parses 億 and mixed amounts', () => {
    expect(parseAmountYen('1億円')).toBe(100_000_000);
    expect(parseAmountYen('1億2000万円')).toBe(120_000_000);
  });

  it('parses plain 円 and rejects non-amounts', () => {
    expect(parseAmountYen('3000円')).toBe(3000);
    expect(parseAmountYen('7%')).toBeNull();
    expect(parseAmountYen('こんにちは')).toBeNull();
  });
});

describe('continuity canon (anti-regression)', () => {
  // 出版順がバラバラでも、貯金額の正典は「最高到達点」になる。
  const articles: PastArticle[] = [
    { title: '年利7%目標、貯金100万達成！', text: '貯金100万円を達成できた。', date: '2026-05-13' },
    { title: '貯金300万達成！自己成長への投資戦略', text: '貯金300万達成！コツコツ続けた成果だ。', date: '2026-06-15' },
    // ↓ これが本来書かれてはいけなかった「逆行」記事
    { title: '貯金200万達成！成長の証を掴む', text: '貯金200万円達成！うれしい。', date: '2026-06-28' },
  ];

  it('locks 貯金額 canon to the maximum (300万), not the latest (200万)', () => {
    const mined = runResearcher(articles);
    const { facts } = consolidate(mined);
    const savings = facts.find(f => f.metric === '貯金額');
    expect(savings).toBeDefined();
    expect(savings?.valueNum).toBe(3_000_000);
    expect(savings?.asOf).toBe('2026-06-15');
    expect(savings?.monotonic).toBe(true);
  });

  it('brief warns writers not to depict a lower amount as newly achieved', () => {
    const mined = runResearcher(articles);
    const { facts, milestones } = consolidate(mined);
    const brief = buildDeterministicBrief(facts, milestones);
    expect(brief).toContain('逆行');
    expect(brief).toContain('300万円');
  });

  it('excludes implausible amounts above the personal cap (essay noise)', () => {
    const noisy: PastArticle[] = [
      { title: 'market', text: '総資産100億円規模の企業の貯金戦略について。', date: '2026-01-01' },
    ];
    const mined = runResearcher(noisy);
    const moneyFacts = mined.filter(f => f.metric === '貯金額' || f.metric === '総資産額');
    // 100億円は MONEY_MAX_YEN(1億) を超えるので個人事実から除外される
    expect(moneyFacts.every(f => (f.valueNum ?? 0) <= MONEY_MAX_YEN)).toBe(true);
  });

  it('ignores statistic citations (平均/世帯) when mining personal money', () => {
    const stat: PastArticle[] = [
      { title: 's', text: '世帯の平均貯金は1700万円と言われる。', date: '2026-01-01' },
    ];
    const mined = runResearcher(stat);
    expect(mined.filter(f => f.metric === '貯金額')).toHaveLength(0);
  });
});
