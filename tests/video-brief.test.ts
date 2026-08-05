import { describe, expect, it } from 'vitest';
import { VIDEO_BRIEF_CONFIG } from '../src/lib/pipeline/config';
import {
  type ArticleSource,
  briefTitle,
  EMPTY_LEDGER,
  extractSourceSlug,
  ledgerAppend,
  ledgerHas,
  lintVideoBrief,
  longestVerbatimRun,
  mergeLedgers,
  parseArticle,
  parseLedger,
  renderLedger,
  renderVideoBrief,
  sourceMarker,
  type VideoBrief,
} from '../src/lib/pipeline/video-brief';

// ═══════════════════════════════════════════════════════════════
// Phase μ — Article → Video Brief (Genesis Vault → Linear → VAIZ)
//
// Everything under test here runs before an issue is filed. Past that
// point the consumer is unattended, so these are the checks that decide
// whether a bad brief becomes a bad video overnight.
// ═══════════════════════════════════════════════════════════════

const VB = VIDEO_BRIEF_CONFIG;

const POST = `---
title: "AIエージェントに承認ゲートが要る理由"
date: 2026-08-03
mood: "💭 思索"
tags: ["AI", "自動化", "エージェント"]
description: "止まらないエージェントに、どこで止まるかを先に決めておく話。"
keywords: ["承認ゲート", "エージェント"]
agents:
  writer: "VE-002 Sophia Nightingale"
---

## 止まらないものに手綱をつける

きょうは自動化の設計をしていた。エージェントは指示が曖昧でも最後まで走り切ってしまう。
だから止める場所を先に決めておく必要がある、とノートに書いた。

ラベルを一枚貼るだけで、暴走のコストが劇的に下がるのがおもしろい。
`;

const ARTICLE = parseArticle(
  '2026-08-03-post-dgbijg.md',
  POST,
  'https://genesisvault.vercel.app',
) as ArticleSource;

function validBrief(overrides: Partial<VideoBrief> = {}): VideoBrief {
  return {
    video_title: 'エージェントを止める場所を決める',
    theme: 'AIエージェントに仕事を任せるとき、なぜ人間の承認ゲートが必要になるのかを1本で扱う。',
    points: [
      'エージェントは指示が曖昧でも最後まで走り切ってしまう',
      'だから、どこで止まるかを先に決めておく必要がある',
      'ラベル一枚を着手の合図にするだけで暴走のコストが下がる',
      '全自動が偉いのではなく、どこを人間が握るかを設計したものが強い',
    ],
    tone: '断定しすぎない。自分で組んでみた人間の一人称で、失敗も込みで話す。',
    visual_direction:
      '抽象寄り。歯車やロボットのような直球のモチーフは避ける。信号機、ゲート、ダムなど流れを制御するもの。暗めの背景に一点だけ色。',
    ...overrides,
  };
}

describe('Phase μ — parseArticle', () => {
  it('reads slug, date, url and anchors out of a post', () => {
    expect(ARTICLE.slug).toBe('2026-08-03-post-dgbijg');
    expect(ARTICLE.date).toBe('2026-08-03');
    expect(ARTICLE.url).toBe('https://genesisvault.vercel.app/posts/2026-08-03-post-dgbijg');
    expect(ARTICLE.tags).toContain('自動化');
    expect(ARTICLE.keywords).toContain('承認ゲート');
  });

  it('does not double the slash when the site url has a trailing one', () => {
    const a = parseArticle('2026-08-03-x.md', POST, 'https://example.com/');
    expect(a?.url).toBe('https://example.com/posts/2026-08-03-x');
  });

  it('returns null for a file that is not a usable post', () => {
    expect(parseArticle('nope.md', 'no frontmatter here', 'https://x.test')).toBeNull();
    expect(parseArticle('nodate-post.md', POST, 'https://x.test')).toBeNull();
    expect(
      parseArticle('2026-08-03-x.md', '---\ndate: 2026-08-03\n---\nbody', 'https://x.test'),
    ).toBeNull();
  });
});

describe('Phase μ — renderVideoBrief', () => {
  const rendered = renderVideoBrief(validBrief(), ARTICLE);

  it('emits the section headings VAIZ already reads (GEN-6 / GEN-7)', () => {
    for (const heading of [
      '## テーマ',
      '## 伝えたいこと',
      '## トーン',
      '## 想定尺',
      '## ビジュアルの方向性',
    ]) {
      expect(rendered).toContain(heading);
    }
  });

  it('writes the duration contract from config, not from the model', () => {
    expect(rendered).toContain(
      `${VB.minSeconds}〜${VB.maxSeconds}秒、縦型。${VB.minScenes}〜${VB.maxScenes}シーン。`,
    );
  });

  it('renders the bullet characters itself', () => {
    expect(rendered).toContain('* エージェントは指示が曖昧でも最後まで走り切ってしまう');
  });

  it('links back to the source article', () => {
    expect(rendered).toContain(ARTICLE.url);
  });

  it('carries a machine-readable source marker for idempotency', () => {
    expect(rendered).toContain(sourceMarker(ARTICLE.slug));
    expect(extractSourceSlug(rendered)).toBe(ARTICLE.slug);
  });

  it('prefixes the title from config', () => {
    expect(briefTitle(validBrief())).toBe(`${VB.titlePrefix}エージェントを止める場所を決める`);
  });
});

describe('Phase μ — extractSourceSlug', () => {
  it('returns null when there is no marker', () => {
    expect(extractSourceSlug('人間が手で書いたブリーフ')).toBeNull();
    expect(extractSourceSlug(null)).toBeNull();
    expect(extractSourceSlug(undefined)).toBeNull();
  });
});

describe('Phase μ — lintVideoBrief', () => {
  const rules = (brief: VideoBrief) => lintVideoBrief(brief, ARTICLE).map((p) => p.rule);

  it('passes a well-formed brief', () => {
    expect(lintVideoBrief(validBrief(), ARTICLE)).toEqual([]);
  });

  it('rejects a title that already carries the prefix', () => {
    expect(rules(validBrief({ video_title: `${VB.titlePrefix}承認ゲートの話` }))).toContain(
      'title_prefix',
    );
  });

  it('rejects a title containing a newline', () => {
    expect(rules(validBrief({ video_title: '承認ゲート\nの話' }))).toContain('title_shape');
  });

  it('rejects unfinished generation', () => {
    expect(rules(validBrief({ tone: '[TODO] あとで書く。断定しすぎない語り。' }))).toContain(
      'placeholder',
    );
  });

  it('rejects bullet characters the renderer would nest', () => {
    const brief = validBrief();
    brief.points[0] = '* エージェントは指示が曖昧でも走り切ってしまう';
    expect(rules(brief)).toContain('point_bullet');
  });

  it('rejects duplicate points padded to reach the minimum', () => {
    const brief = validBrief();
    brief.points[3] = brief.points[0];
    expect(rules(brief)).toContain('point_duplicate');
  });

  // The failure this catches is silent: a brief about something else is
  // still a valid brief, and the video only reveals it hours later.
  it('rejects a brief that shares no vocabulary with the article', () => {
    const drifted = validBrief({
      video_title: '朝の散歩で見つけたパン屋',
      theme: '週末の散歩コースにあるパン屋の話を1本で扱う。',
      points: [
        '駅の裏手に小さなパン屋がある',
        '開店は朝七時で、焼き上がりの時間が決まっている',
        'クロワッサンは十時を過ぎると売り切れる',
        '並ぶ人の顔ぶれが平日と週末で違う',
      ],
      tone: 'のんびりした一人称で、街の風景として話す。',
      visual_direction:
        '朝の光、湯気、木のトレイ。人物の顔は映さない。暖色に寄せて、影を長めに取る。',
    });
    expect(rules(drifted)).toContain('topic_anchor');
  });

  // A brief is a derivation. A brief that copies is a paywalled body
  // republished into a third-party tracker (INV-010's reasoning).
  it('rejects a brief that copies the article body verbatim', () => {
    const copied = validBrief({
      theme:
        'きょうは自動化の設計をしていた。エージェントは指示が曖昧でも最後まで走り切ってしまう。だから止める場所を先に決めておく必要がある、とノートに書いた。',
    });
    expect(rules(copied)).toContain('verbatim_copy');
  });

  it('does not flag an article with no tags or keywords for drift', () => {
    const bare: ArticleSource = { ...ARTICLE, tags: [], keywords: [] };
    const drifted = validBrief({ theme: '全く関係のない話題について1本で扱う内容です。' });
    expect(lintVideoBrief(drifted, bare).map((p) => p.rule)).not.toContain('topic_anchor');
  });
});

describe('Phase μ — longestVerbatimRun', () => {
  it('is zero when nothing is shared', () => {
    expect(longestVerbatimRun('まったく別の文章', 'ぜんぜん違う内容')).toBe(0);
  });

  it('measures content, not formatting', () => {
    // Same words, different markdown — the run should still be found.
    expect(longestVerbatimRun('**止める場所を先に決めておく**', '止める場所を先に決めておく')).toBe(
      13,
    );
  });

  it('handles an empty side', () => {
    expect(longestVerbatimRun('', 'なにか')).toBe(0);
    expect(longestVerbatimRun('なにか', '')).toBe(0);
  });
});

describe('Phase μ — brief ledger', () => {
  it('round-trips through parse and render', () => {
    const entry = {
      slug: '2026-08-03-post-dgbijg',
      issue: 'GEN-9',
      url: 'https://linear.app/gentaron/issue/GEN-9',
      filedAt: '2026-08-03T12:00:00.000Z',
    };
    const ledger = ledgerAppend(EMPTY_LEDGER, entry);
    expect(ledgerHas(ledger, entry.slug)).toBe(true);
    expect(parseLedger(JSON.stringify(ledger)).briefs).toEqual([entry]);
  });

  it('never records the same slug twice', () => {
    const one = ledgerAppend(EMPTY_LEDGER, {
      slug: 'a',
      issue: 'GEN-1',
      url: 'u',
      filedAt: 't',
    });
    const two = ledgerAppend(one, { slug: 'a', issue: 'GEN-2', url: 'u2', filedAt: 't2' });
    expect(two.briefs).toHaveLength(1);
    expect(two.briefs[0].issue).toBe('GEN-2');
  });

  // A corrupt ledger must not read as "nothing has ever been filed" in a
  // way that crashes the run — but it must also not claim work was done.
  it('degrades to an empty ledger on malformed input', () => {
    expect(parseLedger('{{{').briefs).toEqual([]);
    expect(parseLedger('').briefs).toEqual([]);
    expect(parseLedger('{"version":1}').briefs).toEqual([]);
    expect(ledgerHas(parseLedger('null'), 'anything')).toBe(false);
  });

  it('drops entries that are not usable records', () => {
    const ledger = parseLedger('{"version":1,"briefs":[{"slug":"ok"},{"nope":1},null]}');
    expect(ledger.briefs).toHaveLength(1);
  });

  it('ships a committed ledger that parses', async () => {
    const raw = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL(`../${VB.ledgerFile}`, import.meta.url), 'utf-8'),
    );
    expect(parseLedger(raw).version).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 衝突した台帳の統合（scripts/merge-brief-ledger.mjs の中身）
//
// 二人の書き手が同じ配列の末尾に追記したときの解決。ここを間違えると
// 「片側の記録が消える」→ 同じ記事の Issue がもう一度生える、という形で
// Linear 側に出る。union が正しいことをここで固定しておく。
// ═══════════════════════════════════════════════════════════════
describe('Phase μ — 台帳の衝突解決', () => {
  const entry = (slug: string, issue: string, filedAt: string) => ({
    slug,
    issue,
    url: `https://linear.app/gentaron/issue/${issue}`,
    filedAt,
  });

  const a = entry('post-a', 'GEN-1', '2026-08-01T00:00:00.000Z');
  const b = entry('post-b', 'GEN-2', '2026-08-02T00:00:00.000Z');

  it('両側の記録を残す', () => {
    const merged = mergeLedgers(
      { version: 1, comment: 'c', briefs: [a] },
      { version: 1, comment: 'c', briefs: [b] },
    );
    expect(merged.briefs.map((e) => e.slug)).toEqual(['post-a', 'post-b']);
  });

  it('どちらを先に渡しても同じ結果になる', () => {
    const left = { version: 1, comment: 'c', briefs: [a, b] };
    const right = { version: 1, comment: 'c', briefs: [b] };
    expect(mergeLedgers(left, right)).toEqual(mergeLedgers(right, left));
  });

  it('同じ記事が両側にあるときは先に届け出たほうを残す', () => {
    const later = entry('post-a', 'GEN-99', '2026-08-09T00:00:00.000Z');
    const merged = mergeLedgers({ version: 1, briefs: [later] }, { version: 1, briefs: [a] });
    expect(merged.briefs).toHaveLength(1);
    expect(merged.briefs[0].issue).toBe('GEN-1');
  });

  it('時刻を持たない壊れた記録より、揃っている記録を優先する', () => {
    const broken = { slug: 'post-a', issue: '', url: '', filedAt: '' };
    const merged = mergeLedgers({ version: 1, briefs: [broken] }, { version: 1, briefs: [a] });
    expect(merged.briefs[0].issue).toBe('GEN-1');
  });

  it('片側が空でも失わない', () => {
    expect(mergeLedgers(parseLedger(''), { version: 1, briefs: [a, b] }).briefs).toHaveLength(2);
    expect(mergeLedgers({ version: 1, briefs: [a] }, parseLedger('{{{')).briefs).toHaveLength(1);
  });

  it('統合した結果はそのまま台帳として読み書きできる', () => {
    const merged = mergeLedgers(
      { version: 1, comment: EMPTY_LEDGER.comment, briefs: [b] },
      { version: 1, briefs: [a] },
    );
    expect(parseLedger(renderLedger(merged)).briefs).toEqual(merged.briefs);
    expect(renderLedger(merged).endsWith('}\n')).toBe(true);
  });
});
