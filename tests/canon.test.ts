import { describe, expect, it } from 'vitest';
import {
  buildCanonBrief,
  buildCanonFeedback,
  detectCanonViolations,
  loadCanon,
  parseCanon,
} from '../src/lib/canon/canon';

const canon = loadCanon();
const rules = (text: string) => detectCanonViolations(text, canon).map((v) => v.rule);

describe('canon — 投資歴の作り話を止める（LM-021）', () => {
  it.each([
    'わたしの積立投資も、もう9年目になるんだよね。',
    '積立投資を始めてもう9年になるけれど、色々な波を見てきた。',
    '9年という長い年月をかけて積立投資を続けてきた。',
    'わたしはもう9年以上も積立投資を続けているんだ。',
    '皆が上がり、私だけ下落。9年積立で分かったこと',
    'ETF積立3年目の通知表',
    '暗号資産に投資を始めたのは、もう5年以上前のことだ。',
    '投資歴7年のわたしが思うこと。',
  ])('「%s」を止める', (text) => {
    expect(rules(text).some((r) => r.startsWith('tenure'))).toBe(true);
  });

  it.each([
    '2025年4月から資産を記録している。',
    '2026年という現在地から、ポートフォリオの育て方を考えたい。',
    'バフェットは10年間でヘッジファンドに勝った。',
    'この習慣は、これから10年続けても役に立つかもしれない。',
    '3年後のわたしへ。今日も積み立てたよ。',
    '瞑想を120日続けた。',
    'わたしのポートフォリオは前日比プラス0.11%だった。',
  ])('「%s」は通す（誤検出しない）', (text) => {
    expect(rules(text)).toEqual([]);
  });

  it('暗号資産が中心だという誤りを止める（実際は1割未満）', () => {
    expect(rules('わたしのポートフォリオの大半はビットコインだ。')).toContain(
      'allocation.crypto_core',
    );
    expect(rules('ポートフォリオの一部として暗号資産を持っている。')).toEqual([]);
  });

  it('自分の資産の金額は書かない（disclosure=relative）', () => {
    expect(rules('わたしの総資産は1000万円を超えた。')).toContain('disclosure.amount');
    expect(rules('ビットコインは75669ドルだった。')).toEqual([]);
  });

  it('引用は原稿に実在する部分文字列', () => {
    const text = '静かな朝。積立投資ももう9年続けているから、慣れている。';
    for (const v of detectCanonViolations(text, canon)) expect(text).toContain(v.quote);
  });

  it('ブリーフとフィードバックに正典の事実が入る', () => {
    expect(buildCanonBrief(canon)).toContain('2025年4月10日');
    const fb = buildCanonFeedback(detectCanonViolations('積立9年目の朝', canon));
    expect(fb).toContain('積立9年目');
  });

  it('壊れた正典は例外で落ちる（黙って空にしない）', () => {
    expect(() =>
      parseCanon({ schema: 1, updated: '2026-11-12', facts: [], forbiddenClaims: [] }),
    ).toThrow();
    expect(() =>
      parseCanon({
        schema: 1,
        updated: '2026-11-12',
        facts: [{ id: 'a', statement: 's', source: 'x' }],
        forbiddenClaims: [{ id: 'r', message: 'm', pattern: '(' }],
      }),
    ).toThrow(/正規表現/);
  });
});
