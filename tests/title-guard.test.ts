import { describe, expect, it } from 'vitest';
import type { TitleGuardConfig } from '../src/lib/pipeline/config';
import {
  auditTitleEchoes,
  buildTitleEchoFeedback,
  findTitleEchoes,
  longestCommonSubstring,
  normalizeTitle,
} from '../src/lib/pipeline/title-guard';

const cfg: TitleGuardConfig = {
  enabled: true,
  windowDays: 30,
  minSharedChars: 4,
  allowedShared: ['ポートフォリオ', 'ジャーナリング'],
  maxRetries: 3,
  enforceFrom: '2026-11-13',
};

const recent = [
  {
    date: '2026-11-11',
    title: '1万歩超えの道草、AI進化と静かな市場で「制約」を「ふつう」に変える根拠',
  },
  { date: '2026-11-08', title: '暴落時、5分瞑想で思考停止を防ぐ。QAIZも静観。' },
  { date: '2026-09-01', title: '1万歩超えの古い日' },
];

describe('title guard — 同じ言い回しを降らせない（LM-022）', () => {
  it('normalize は記号と全角を揃える', () => {
    expect(normalizeTitle('「ＡＩ」進化！')).toBe('ai進化');
  });

  it('最長共通部分文字列', () => {
    expect(longestCommonSubstring('abcdef', 'zzcdez')).toBe('cde');
    expect(longestCommonSubstring('', 'a')).toBe('');
  });

  it('直近のタイトルと同じフレーズを持てば止める', () => {
    const e = findTitleEchoes('1万歩超えで見つけた朝の光', recent, '2026-11-13', cfg);
    expect(e.map((x) => x.phrase)).toContain('1万歩超え');
    expect(findTitleEchoes('市場が荒れても5分瞑想', recent, '2026-11-13', cfg)[0].phrase).toBe(
      '5分瞑想',
    );
  });

  it('窓の外・一般語・別の言い回しは通す', () => {
    expect(findTitleEchoes('古い日の記憶をたどる', recent, '2026-11-13', cfg)).toEqual([]);
    expect(
      findTitleEchoes(
        'ポートフォリオを閉じた夜',
        [{ date: '2026-11-10', title: 'ポートフォリオの朝' }],
        '2026-11-13',
        cfg,
      ),
    ).toEqual([]);
    expect(findTitleEchoes('鎌倉で迷子になった午後', recent, '2026-11-13', cfg)).toEqual([]);
  });

  it('当日以降の記事（自分自身）は比較しない', () => {
    expect(
      findTitleEchoes(
        '1万歩超えの道草',
        [{ date: '2026-11-13', title: '1万歩超えの道草' }],
        '2026-11-13',
        cfg,
      ),
    ).toEqual([]);
  });

  it('差し戻し文は使い回した言い回しを名指しする', () => {
    const fb = buildTitleEchoFeedback(findTitleEchoes('5分瞑想の効用', recent, '2026-11-13', cfg));
    expect(fb).toContain('「5分瞑想');
  });

  it('監査は enforceFrom 以降だけを見る', () => {
    const posts = [
      { file: 'a.md', date: '2026-11-10', title: '1万歩超えの朝' },
      { file: 'b.md', date: '2026-11-12', title: '1万歩超えの夜' },
      { file: 'c.md', date: '2026-11-14', title: '1万歩超えの昼' },
    ];
    expect(auditTitleEchoes(posts, cfg).map((x) => x.file)).toEqual(['c.md']);
  });
});
