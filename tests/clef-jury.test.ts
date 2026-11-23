/**
 * 判断AI v2 — 陪審（PoLL）・双対質問・記号審査。ネットワークには触らない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JevQuestion, JevResult } from '../src/lib/ai/jev';
import { askJury, mergeJury } from '../src/lib/ai/jev';
import {
  buildJuryQuestions,
  CLEF_QUESTIONS,
  combinePolarity,
  decideJury,
  runClefReview,
  symbolicChecks,
} from '../src/lib/pipeline/clef-review';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const T = { veto: 0.5, noul: 0.5, score: 0.5, maxSoftFailures: 1 };
const clean = (over: Record<string, number | null> = {}) => ({
  on_brief: 0.9,
  no_advice: 0.9,
  no_amount: 0.9,
  concrete: 0.8,
  gate: 0.8,
  readability: 0.75,
  ...over,
});

describe('双対質問（yes に寄る偏りを打ち消す）', () => {
  it('inverse を持つ yes/no は逆向きでも聞く', () => {
    const names = buildJuryQuestions(true).map((q) => q.name);
    for (const q of CLEF_QUESTIONS.filter((x) => x.inverse))
      expect(names).toContain(`${q.name}__not`);
    expect(buildJuryQuestions(false).some((q) => q.name.endsWith('__not'))).toBe(false);
  });

  it('正向きも逆向きも「はい」と答えるモデルは 50% に引き戻される', () => {
    const v = combinePolarity({
      no_advice: { type: 'noul', probability: 0.95 },
      no_advice__not: { type: 'noul', probability: 0.95 },
    });
    expect(v.no_advice).toBe(0.5);
  });

  it('一貫したモデルの値はほぼそのまま', () => {
    const v = combinePolarity({
      concrete: { type: 'noul', probability: 0.8 },
      concrete__not: { type: 'noul', probability: 0.2 },
      readability: { type: 'score', value: 0.6 },
    });
    expect(v.concrete).toBe(0.8);
    expect(v.readability).toBe(0.6);
  });
});

describe('陪審の合議', () => {
  it('veto は最も厳しい票で決まる', () => {
    const { passed, checks } = decideJury([clean(), clean({ no_advice: 0.45 })], T, 0.9);
    expect(passed).toBe(false);
    expect(checks.find((c) => c.id === 'no_advice')?.value).toBe(0.45);
  });

  it('その他は平均で決まる', () => {
    const { checks } = decideJury([clean({ concrete: 0.3 }), clean({ concrete: 0.9 })], T, 0.9);
    const c = checks.find((x) => x.id === 'concrete');
    expect(c?.value).toBe(0.6);
    expect(c?.passed).toBe(true);
    expect(c?.jurors).toEqual([0.3, 0.9]);
  });

  it('veto の票が大きく割れたら判断不能として不合格（fail-closed）', () => {
    const { passed, checks } = decideJury(
      [clean({ on_brief: 0.95 }), clean({ on_brief: 0.52 })],
      T,
      0.4,
    );
    expect(checks.find((c) => c.id === 'on_brief')?.passed).toBe(false);
    expect(passed).toBe(false);
  });

  it('答えの無い項目は不合格に数える', () => {
    const { checks } = decideJury([clean({ no_amount: null })], T, 0.4);
    expect(checks.find((c) => c.id === 'no_amount')?.passed).toBe(false);
  });
});

describe('記号審査（モデルに聞かない veto）', () => {
  it('main で旧 Clef が合格にした原稿を止める', () => {
    const fails = (title: string, body: string) =>
      symbolicChecks(title, body)
        .filter((c) => !c.passed)
        .map((c) => c.id);
    expect(fails('AI進化で「制約」が「ふつう」に。積立9年目の投資ルール見直し。', '')).toContain(
      'canon',
    );
    expect(fails('荒れる市場', '画面を閉じて5分、静止する僕のルール。')).toContain('canon');
    expect(fails('朝5時の家計簿タイム', '')).toContain('forbidden');
  });

  it('引用の中の他人の一人称は通す', () => {
    const r = symbolicChecks('駅で', '「僕はここで降りる」と彼が言った。わたしは笑った。');
    expect(r.find((c) => c.id === 'canon')?.passed).toBe(true);
  });

  it('過去記事があればタイトルの使い回しも見る', () => {
    const r = symbolicChecks('1万歩超えの朝', 'わたしは歩いた。', {
      recent: [{ date: '2026-11-20', title: '1万歩超えの夜' }],
      today: '2026-11-23',
    });
    expect(r.find((c) => c.id === 'title_echo')?.passed).toBe(false);
  });
});

describe('askJury / mergeJury', () => {
  const qs: JevQuestion[] = [
    { name: 'pick', type: 'choice', prompt: 'p', options: ['a', 'b'] },
    { name: 'g', type: 'noul', prompt: 'g' },
  ];

  it('陪審員を全員同時に呼び、答えた人だけ返す', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acc');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'tok');
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        n++ === 0
          ? new Response(JSON.stringify({ result: { answers: { g: { noul: 0.7 } } } }), {
              status: 200,
            })
          : new Response('busy', { status: 503 }),
      ),
    );
    const notes: string[] = [];
    const r = await askJury('s', qs, notes);
    expect(r).toHaveLength(1);
    expect(notes.join(' ')).toContain('503');
  });

  it('選定用の合議は分布の平均。第1候補が割れれば確信度が下がる', () => {
    const mk = (model: string, a: number): JevResult => ({
      transport: 'workers-ai',
      model,
      latencyMs: 10,
      answers: {
        pick: {
          type: 'choice',
          value: a > 0.5 ? 'a' : 'b',
          probability: Math.max(a, 1 - a),
          distribution: { a, b: 1 - a },
        },
        g: { type: 'noul', probability: a },
      },
    });
    const m = mergeJury([mk('@cf/cloudflare/clef', 0.9), mk('@cf/cloudflare/clef-flash', 0.2)], qs);
    expect(m?.model).toBe('clef+clef-flash');
    const pick = m?.answers.pick;
    expect(pick?.type === 'choice' && pick.probability).toBeLessThan(0.6);
    expect(mergeJury([], qs)).toBeNull();
  });
});

describe('陪審なしでも記号審査は動く', () => {
  it('鍵が無い環境', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    const v = await runClefReview('b', '静かな朝', 'わたしは歩いた。');
    expect(v.available).toBe(false);
    expect(v.checks.length).toBeGreaterThan(0);
  });
});
