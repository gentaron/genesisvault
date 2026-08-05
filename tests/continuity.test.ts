/**
 * Phase ι tests — Continuity Subsystem (過去記事整合性)
 *
 * 「貯金300万の記事のあとに貯金200万の記事を書く」逆行を防ぐための
 * 決定的コア（抽出 Vera → 統合 Edda）を検証する。LLM/ネットワークには依存しない。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDeterministicBrief,
  buildRegressionFeedback,
  type CanonFact,
  type ContinuityLedger,
  consolidate,
  dedupeMilestones,
  detectRegressions,
  isRegressiveMilestone,
  LEDGER_REL_PATH,
  LEDGER_SCHEMA,
  loadDiaryArticles,
  loadLedger,
  MONEY_MAX_YEN,
  type PastArticle,
  parseAmountYen,
  runRecorder,
  runResearcher,
  runSummarizer,
  saveLedger,
  stripHtml,
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
    {
      title: '貯金300万達成！自己成長への投資戦略',
      text: '貯金300万達成！コツコツ続けた成果だ。',
      date: '2026-06-15',
    },
    // ↓ これが本来書かれてはいけなかった「逆行」記事
    {
      title: '貯金200万達成！成長の証を掴む',
      text: '貯金200万円達成！うれしい。',
      date: '2026-06-28',
    },
  ];

  it('drops the regressive milestone so the ledger stops endorsing it', () => {
    const mined = runResearcher(articles);
    const { facts, milestones } = consolidate(mined);
    expect(isRegressiveMilestone('貯金200万達成！', facts)).toBe(true);
    expect(milestones.some((m) => m.event.includes('200万'))).toBe(false);
  });

  it('keeps the first occurrence of a milestone, not its later restatements', () => {
    // 達成後も同じ節目は繰り返し言及される。言い換えを12件並べると
    // 他の出来事が枠から押し出されるので、最初の1件に畳む。
    const folded = dedupeMilestones([
      { date: '2026-07-25', event: '貯金300万超え！' },
      { date: '2026-06-15', event: '貯金300万達成！' },
      { date: '2026-07-05', event: '貯金が300万円を突破した話' },
      { date: '2026-05-13', event: '瞑想を100日続けた' },
    ]);
    expect(folded).toHaveLength(2);
    expect(folded[0]).toEqual({ date: '2026-06-15', event: '貯金300万達成！' });
  });

  it('locks 貯金額 canon to the maximum (300万), not the latest (200万)', () => {
    const mined = runResearcher(articles);
    const { facts } = consolidate(mined);
    const savings = facts.find((f) => f.metric === '貯金額');
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
    const moneyFacts = mined.filter((f) => f.metric === '貯金額' || f.metric === '総資産額');
    // 100億円は MONEY_MAX_YEN(1億) を超えるので個人事実から除外される
    expect(moneyFacts.every((f) => (f.valueNum ?? 0) <= MONEY_MAX_YEN)).toBe(true);
  });

  it('ignores statistic citations (平均/世帯) when mining personal money', () => {
    const stat: PastArticle[] = [
      { title: 's', text: '世帯の平均貯金は1700万円と言われる。', date: '2026-01-01' },
    ];
    const mined = runResearcher(stat);
    expect(mined.filter((f) => f.metric === '貯金額')).toHaveLength(0);
  });
});

describe('stripHtml', () => {
  it('strips tags and decodes entities', () => {
    expect(stripHtml('<p>hello&nbsp;world</p>')).toBe('hello world');
    expect(stripHtml('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });

  it('leaves no tag-shaped substring even for nested/obfuscated input', () => {
    // 一度の置換では <...> が残り得るが、不動点まで繰り返すのでタグ片は残らない
    const out = stripHtml('<di<div>v>hello<sc<script>ript>');
    expect(out).not.toMatch(/<[^>]*>/);
    expect(out).toContain('hello');
  });
});

describe('runSummarizer (Edda)', () => {
  it('builds a deterministic ledger with brief and carries diary count', () => {
    const articles: PastArticle[] = [
      { title: '貯金100万達成！', text: '貯金100万円を達成。', date: '2026-01-01' },
    ];
    const mined = runResearcher(articles);
    const ledger = runSummarizer(mined, { diaryArticleCount: 7 } as ContinuityLedger);
    expect(ledger.schema).toBe(LEDGER_SCHEMA);
    expect(ledger.diaryArticleCount).toBe(7);
    expect(ledger.facts.find((f) => f.metric === '貯金額')?.valueNum).toBe(1_000_000);
    expect(ledger.brief).toContain('逆行');
  });

  it('renders 億/万 amounts in the brief', () => {
    const facts: CanonFact[] = [
      {
        metric: '総資産額',
        value: '5000万円',
        valueNum: 50_000_000,
        unit: 'yen',
        monotonic: true,
        asOf: '2026-01-01',
        source: 's',
      },
    ];
    const brief = buildDeterministicBrief(facts, []);
    expect(brief).toContain('5,000万円');
  });

  it('states the floor for the next article, not just the current value', () => {
    const facts: CanonFact[] = [
      {
        metric: '瞑想の継続日数',
        value: '300日',
        valueNum: 300,
        unit: '日',
        monotonic: true,
        asOf: '2026-06-06',
        source: 's',
      },
    ];
    const brief = buildDeterministicBrief(facts, []);
    expect(brief).toContain('次に触れるなら 300日 以上');
    // 話題を問わない共通ルールが必ず付く（金額だけの縛りに読ませない）
    expect(brief).toContain('話題を問わず');
  });
});

describe('non-money metrics (あらゆる話題での逆行防止)', () => {
  it('mines habit streaks in days', () => {
    const mined = runResearcher([
      { title: '瞑想300日目の停滞打破', text: '瞑想300日目の停滞打破。', date: '2026-06-06' },
    ]);
    const streak = mined.find((f) => f.metric === '瞑想の継続日数');
    expect(streak?.valueNum).toBe(300);
    expect(streak?.unit).toBe('日');
  });

  it('mines years of continuity', () => {
    const mined = runResearcher([
      { title: 't', text: '積立投資を始めて5年目になった。', date: '2026-07-28' },
    ]);
    expect(mined.find((f) => f.metric === '積立投資の継続年数')?.valueNum).toBe(5);
  });

  it('scopes yearly metrics by year so January is not a regression', () => {
    const mined = runResearcher([
      { title: 't', text: '今年は32冊読んだ。', date: '2026-12-20' },
      { title: 't', text: '今年は3冊読んだ。', date: '2027-01-10' },
    ]);
    const { facts } = consolidate(mined);
    expect(facts.find((f) => f.metric === '2026年の読了冊数')?.valueNum).toBe(32);
    expect(facts.find((f) => f.metric === '2027年の読了冊数')?.valueNum).toBe(3);
  });

  it('ignores numbers that are not adjacent to their subject', () => {
    // 「3日続けて雨」は散歩の継続日数ではない
    const mined = runResearcher([
      { title: 't', text: '3日続けて雨だったので、そのあと近所を散歩した。', date: '2026-06-01' },
    ]);
    expect(mined.find((f) => f.metric === '散歩の継続日数')).toBeUndefined();
  });
});

describe('detectRegressions (継続性ゲート)', () => {
  const ledger: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: '2026-07-28',
    diaryArticleCount: 10,
    facts: [
      {
        metric: '貯金額',
        value: '300万',
        valueNum: 3_000_000,
        unit: 'yen',
        monotonic: true,
        asOf: '2026-06-15',
        source: 's',
      },
      {
        metric: '瞑想の継続日数',
        value: '300日',
        valueNum: 300,
        unit: '日',
        monotonic: true,
        asOf: '2026-06-06',
        source: 's',
      },
    ],
    milestones: [],
    brief: '',
  };

  it('flags a lower amount presented as a fresh achievement', () => {
    const found = detectRegressions(
      {
        title: '貯金200万達成！',
        text: '貯金200万達成！やっと200万円貯まった。',
        date: '2026-08-05',
      },
      ledger,
    );
    expect(found).toHaveLength(1);
    expect(found[0].metric).toBe('貯金額');
    expect(found[0].claimedNum).toBe(2_000_000);
    expect(found[0].canonNum).toBe(3_000_000);
  });

  it('flags regressions outside money too (habit streaks)', () => {
    const found = detectRegressions(
      { title: 't', text: '瞑想を10日続けている。', date: '2026-08-05' },
      ledger,
    );
    expect(found.map((f) => f.metric)).toContain('瞑想の継続日数');
  });

  it('allows retrospective mentions of smaller numbers', () => {
    expect(
      detectRegressions(
        { title: 't', text: '始めた頃は貯金100万円しかなかった。', date: '2026-08-05' },
        ledger,
      ),
    ).toEqual([]);
  });

  it('allows equal or higher values', () => {
    expect(
      detectRegressions(
        { title: 't', text: '貯金が350万円を超えた。瞑想は320日続いている。', date: '2026-08-05' },
        ledger,
      ),
    ).toEqual([]);
  });

  it('does not read market numbers as personal facts', () => {
    // トレンド・レーダー由来の数字が本文に入っても、個人の到達点にはしない
    expect(
      detectRegressions(
        {
          title: 't',
          text: '日経平均が4万2000円をつけた日に、積立の設定を見直した。',
          date: '2026-08-05',
        },
        ledger,
      ),
    ).toEqual([]);
  });

  it('reports one finding per metric (the worst), not one per sentence', () => {
    const found = detectRegressions(
      { title: 't', text: '貯金250万円を達成した。貯金100万円の壁を越えた。', date: '2026-08-05' },
      ledger,
    );
    expect(found).toHaveLength(1);
    expect(found[0].claimedNum).toBe(1_000_000);
  });

  it('returns nothing when there is no ledger yet', () => {
    expect(
      detectRegressions({ title: 't', text: '貯金100万円達成！', date: '2026-08-05' }, null),
    ).toEqual([]);
  });

  it('feedback tells the writer both ways out', () => {
    const feedback = buildRegressionFeedback(
      detectRegressions({ title: 't', text: '貯金200万達成！', date: '2026-08-05' }, ledger),
    );
    expect(feedback).toContain('300万円');
    expect(feedback).toContain('回想');
  });
});

describe('runRecorder (Mira)', () => {
  const base: ContinuityLedger = {
    schema: LEDGER_SCHEMA,
    updated: '2026-06-15',
    diaryArticleCount: 1,
    facts: [
      {
        metric: '貯金額',
        value: '300万',
        valueNum: 3_000_000,
        unit: 'yen',
        monotonic: true,
        asOf: '2026-06-15',
        source: '貯金300万達成',
      },
    ],
    milestones: [{ date: '2026-06-15', event: '貯金300万達成！', source: '貯金300万達成' }],
    brief: '...',
  };

  it('does NOT lower the canon when a lower amount is published', () => {
    const updated = runRecorder(base, {
      title: '貯金200万達成！',
      text: '貯金200万円達成！',
      date: '2026-06-28',
    });
    expect(updated.facts.find((f) => f.metric === '貯金額')?.valueNum).toBe(3_000_000);
    expect(updated.diaryArticleCount).toBe(2);
  });

  it('raises the canon when a higher amount is published', () => {
    const updated = runRecorder(base, {
      title: '貯金400万達成！',
      text: '貯金400万円達成！',
      date: '2026-07-10',
    });
    const savings = updated.facts.find((f) => f.metric === '貯金額');
    expect(savings?.valueNum).toBe(4_000_000);
    expect(savings?.asOf).toBe('2026-07-10');
  });

  it('does NOT record a milestone that undercuts the canon', () => {
    // 台帳が逆行を追認してしまうと、次の書き手は「200万を達成したばかり」と読む
    const updated = runRecorder(base, {
      title: '貯金200万達成！',
      text: '貯金200万達成！',
      date: '2026-06-28',
    });
    expect(updated.milestones.some((m) => m.event.includes('200万'))).toBe(false);
    expect(updated.milestones.some((m) => m.event.includes('300万'))).toBe(true);
  });

  it('keeps non-money streaks monotonic as well', () => {
    const withStreak: ContinuityLedger = {
      ...base,
      facts: [
        {
          metric: '瞑想の継続日数',
          value: '300日',
          valueNum: 300,
          unit: '日',
          monotonic: true,
          asOf: '2026-06-06',
          source: 's',
        },
      ],
    };
    const updated = runRecorder(withStreak, {
      title: 't',
      text: '瞑想を30日続けている。',
      date: '2026-07-01',
    });
    expect(updated.facts.find((f) => f.metric === '瞑想の継続日数')?.valueNum).toBe(300);
  });

  it('records a brand-new metric not present in the prior ledger', () => {
    const empty: ContinuityLedger = { ...base, facts: [], milestones: [] };
    const updated = runRecorder(empty, {
      title: 't',
      text: '総資産が500万円に到達した。',
      date: '2026-07-01',
    });
    expect(updated.facts.find((f) => f.metric === '総資産額')?.valueNum).toBe(5_000_000);
  });
});

describe('ledger persistence and diary loading', () => {
  it('round-trips the ledger through save/load and reads diary posts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-continuity-'));
    try {
      const postsDir = path.join(dir, 'src', 'content', 'posts');
      await fs.mkdir(postsDir, { recursive: true });
      await fs.writeFile(
        path.join(postsDir, '2026-06-15-a.md'),
        '---\ntitle: "貯金300万達成"\ndate: 2026-06-15\n---\n\n<p>今月、ついに貯金300万円を達成した。コツコツ積み上げてきた成果がようやく数字になって表れて、とても嬉しい。</p>\n',
        'utf-8',
      );

      const articles = await loadDiaryArticles(dir);
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe('貯金300万達成');
      expect(articles[0].date).toBe('2026-06-15');
      expect(articles[0].text).not.toContain('<p>'); // HTML stripped

      const ledger = runSummarizer(runResearcher(articles), null);
      await saveLedger(dir, ledger);
      const onDisk = await loadLedger(dir);
      expect(onDisk?.facts.find((f) => f.metric === '貯金額')?.valueNum).toBe(3_000_000);
      expect(await fs.readFile(path.join(dir, LEDGER_REL_PATH), 'utf-8')).toContain('"schema"');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadLedger returns null when no ledger exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-continuity-'));
    try {
      expect(await loadLedger(dir)).toBeNull();
      expect(await loadDiaryArticles(dir)).toEqual([]); // no posts dir
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
