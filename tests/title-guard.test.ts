import { describe, expect, it } from 'vitest';
import type { TitleGuardConfig } from '../src/lib/pipeline/config';
import {
  auditTitleEchoes,
  buildTitleEchoFeedback,
  findOverusedTerms,
  findTitleEchoes,
  listOverusedTerms,
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
  termWindowDays: 14,
  maxTermUses: 2,
  termStopwords: [],
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

  it('語の使いすぎ: 直近14日に2本以上で使った語は止める（LM-024）', () => {
    const r = [
      { date: '2026-11-10', title: 'AIと散歩した朝' },
      { date: '2026-11-11', title: 'AIの夜に読む本' },
      { date: '2026-10-01', title: '市場の話' },
      { date: '2026-10-02', title: '市場の朝' },
    ];
    expect(findOverusedTerms('AIが変える読書', r, '2026-11-13', cfg).map((e) => e.phrase)).toEqual([
      'AI',
    ]);
    // 窓の外の「市場」・1本しか無い「読書」は通す
    expect(findOverusedTerms('市場で読書', r, '2026-11-13', cfg)).toEqual([]);
    expect(listOverusedTerms(r, '2026-11-13', cfg)).toEqual(['AI']);
    expect(findTitleEchoes('AIの話', r, '2026-11-13', cfg).some((e) => e.kind === 'term')).toBe(
      true,
    );
  });

  it('語は英数字・カタカナ・漢字の2文字以上', async () => {
    const { titleTerms } = await import('../src/lib/pipeline/title-guard');
    expect(titleTerms('1万歩超えでＡＩ進化とポートフォリオ')).toEqual([
      '万歩超',
      'AI',
      '進化',
      'ポートフォリオ',
    ]);
  });

  it('監査は enforceFrom 以降だけを見る', () => {
    const posts = [
      { file: 'z.md', date: '2026-11-01', title: '別の話' },
      { file: 'a.md', date: '2026-11-10', title: '1万歩超えの朝' },
      { file: 'b.md', date: '2026-11-12', title: '1万歩超えの夜' },
      { file: 'c.md', date: '2026-11-14', title: '1万歩超えの昼' },
    ];
    expect(auditTitleEchoes(posts, cfg).map((x) => x.file)).toEqual(['c.md']);
  });
});
