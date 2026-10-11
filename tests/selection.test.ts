/**
 * VE-012 Juno — ニューロシンボリック選定と Jev クライアント
 *
 * 守りたいのは:
 *   1. 記号の規則で落ちた候補は、Jev の選択肢に存在しない（型の上で選べない）
 *   2. Jev の応答を受け取る側で型検査する（宣言外の選択肢・範囲外の確率は捨てる）
 *   3. 確信度が低い Jev は棄権扱い → 記号側の順位で決まる
 *   4. 鍵が1本も無くても選定は止まらない
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRequestBody,
  type JevQuestion,
  normalizeAnswers,
  resolveEndpoints,
} from '../src/lib/ai/jev';
import type { FinancePulse } from '../src/lib/finance/pulse';
import {
  generateCandidates,
  reviewCandidates,
  type SymbolicContext,
} from '../src/lib/selection/candidates';
import {
  buildQuestions,
  buildSelectionBrief,
  fuse,
  neuralScores,
  runJuno,
} from '../src/lib/selection/select';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const priority = [
  { theme: '読書', score: 0 },
  { theme: 'ひとり旅', score: 2 },
  { theme: '投資・資産形成', score: 5 },
  { theme: '貯金・節約', score: 1 },
  { theme: '瞑想・マインドフルネス', score: 9 },
];

const pulse: FinancePulse = {
  capturedAt: '2026-10-10',
  portfolio: null,
  market: null,
  predicates: ['divergence.market_up_me_down', 'portfolio.drawdown'],
  degraded: true,
  notes: [],
};

const ctx = (over: Partial<SymbolicContext> = {}): SymbolicContext => ({
  priority,
  recentPosts: [{ date: '2026-10-09', title: '瞑想をサボった週に起きたこと' }],
  publishedTitles: [],
  forbiddenTerms: ['貯金', '貯蓄', '家計簿'],
  themeCooldownDays: 2,
  maxTitleSimilarity: 0.6,
  today: '2026-10-10',
  ...over,
});

describe('symbolic layer', () => {
  it('builds finance, tech and balance candidates with stable ids', () => {
    const cands = generateCandidates(pulse, null, priority, 12);
    expect(cands.map((c) => c.source)).toEqual([
      'finance',
      'finance',
      'balance',
      'balance',
      'balance',
      'balance',
    ]);
    expect(cands[0].id).toBe('c01');
    expect(cands[0].why).toContain('portfolio.drawdown');
  });

  it('rejects forbidden themes, cooled themes and near-duplicates with a reason', () => {
    const cands = generateCandidates(pulse, null, priority, 12);
    const { accepted, rejected } = reviewCandidates(cands, ctx());
    const rules = Object.fromEntries(rejected.map((r) => [r.candidate.theme, r.rule]));
    expect(rules['貯金・節約']).toBe('forbidden_term');
    expect(rules['瞑想・マインドフルネス']).toBe('theme_cooldown');
    expect(accepted.every((c) => c.theme !== '貯金・節約')).toBe(true);
    expect(accepted.every((c) => c.symbolic >= 0 && c.symbolic <= 1)).toBe(true);
  });

  it('rejects a hook too close to an already-published title', () => {
    const cands = generateCandidates(pulse, null, priority, 12);
    const target = cands.find((c) => c.theme === '投資・資産形成') ?? cands[0];
    const { rejected } = reviewCandidates(cands, ctx({ publishedTitles: [target.hook] }));
    expect(rejected.find((r) => r.candidate.id === target.id)?.rule).toBe('too_similar');
  });

  it('is deterministic', () => {
    const run = () =>
      reviewCandidates(generateCandidates(pulse, null, priority, 12), ctx()).accepted.map(
        (c) => c.id,
      );
    expect(run()).toEqual(run());
  });
});

describe('Jev client — type checking on our side', () => {
  const questions: JevQuestion[] = [
    { name: 'pick', type: 'choice', prompt: 'p', options: ['c01', 'c02'] },
    { name: 'gate_c01', type: 'noul', prompt: 'g' },
    { name: 'fit', type: 'score', prompt: 's' },
  ];

  it('accepts the Workers AI envelope with a probability map', () => {
    const answers = normalizeAnswers(
      {
        result: {
          answers: {
            pick: { choice: 'c02', probabilities: { c01: 0.2, c02: 0.8 } },
            gate_c01: { probability: 0.7 },
            fit: { score: 64 },
          },
        },
        success: true,
      },
      questions,
    );
    expect(answers.pick).toEqual({
      type: 'choice',
      value: 'c02',
      probability: 0.8,
      distribution: { c01: 0.2, c02: 0.8 },
    });
    expect(answers.gate_c01).toEqual({ type: 'noul', probability: 0.7 });
    expect(answers.fit).toEqual({ type: 'score', value: 0.64 });
  });

  it('accepts an array of named answers', () => {
    const answers = normalizeAnswers(
      { answers: [{ name: 'pick', value: 'c01', probability: 0.9 }] },
      questions,
    );
    expect(answers.pick?.type === 'choice' && answers.pick.value).toBe('c01');
  });

  it('drops a choice outside the declared options', () => {
    const answers = normalizeAnswers(
      { answers: { pick: { choice: 'c99', probability: 0.99 } } },
      questions,
    );
    expect(answers.pick).toBeUndefined();
  });

  it('drops out-of-range probabilities', () => {
    const answers = normalizeAnswers(
      { answers: { gate_c01: { probability: 150 }, fit: { score: -1 } } },
      questions,
    );
    expect(answers).toEqual({});
  });

  it('resolves Workers AI first, TypeSafe second, nothing without keys', () => {
    expect(resolveEndpoints({})).toEqual([]);
    const eps = resolveEndpoints({
      CLOUDFLARE_ACCOUNT_ID: 'acc',
      CLOUDFLARE_API_TOKEN: 'tok',
      TYPESAFE_API_KEY: 'k',
    });
    expect(eps.map((e) => e.transport)).toEqual(['workers-ai', 'typesafe']);
    expect(eps[0].url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/typesafe/jev',
    );
  });

  it('declares choices as the candidate id enum only', () => {
    const body = buildRequestBody('jev', 'state', questions);
    expect(body.questions[0]).toEqual({
      name: 'pick',
      type: 'choice',
      question: 'p',
      options: ['c01', 'c02'],
    });
  });
});

describe('fusion', () => {
  const { accepted } = reviewCandidates(generateCandidates(pulse, null, priority, 12), ctx());

  it('only offers surviving candidates to Jev', () => {
    const q = buildQuestions(accepted)[0];
    expect(q.type === 'choice' && q.options).toEqual(accepted.map((c) => c.id));
  });

  it('lets a confident neural pick overturn the symbolic order', () => {
    const last = accepted[accepted.length - 1];
    const dist = Object.fromEntries(accepted.map((c) => [c.id, c.id === last.id ? 0.9 : 0.02]));
    const neural = neuralScores(
      accepted,
      { value: last.id, probability: 0.9, distribution: dist },
      {},
    );
    const ranked = fuse(accepted, neural, { symbolic: 0.45, neural: 0.55 });
    expect(ranked[0].id).toBe(last.id);
  });

  it('falls back to the symbolic order without a neural signal', () => {
    const ranked = fuse(accepted, null, { symbolic: 0.45, neural: 0.55 });
    expect(ranked[0].id).toBe(accepted[0].id);
    expect(ranked[0].final).toBe(accepted[0].symbolic);
  });
});

describe('runJuno', () => {
  const { accepted, rejected } = reviewCandidates(
    generateCandidates(pulse, null, priority, 12),
    ctx(),
  );

  function stubJev(payload: unknown) {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acc');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'tok');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('uses Jev when it is confident', async () => {
    const pickId = accepted[1].id;
    const fetchMock = stubJev({
      result: { answers: { pick: { choice: pickId, probability: 0.9 } } },
    });
    const result = await runJuno('2026-10-10', accepted, rejected, '');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result?.method).toBe('jev');
    expect(result?.winner.id).toBe(pickId);
  });

  it('treats a low-confidence Jev answer as an abstention', async () => {
    stubJev({ result: { answers: { pick: { choice: accepted[1].id, probability: 0.3 } } } });
    vi.stubEnv('GEMINI_API_KEY', '');
    const result = await runJuno('2026-10-10', accepted, rejected, '');
    expect(result?.abstained).toBe(true);
    expect(result?.method).toBe('symbolic');
    expect(result?.winner.id).toBe(accepted[0].id);
  });

  it('still decides with no keys at all', async () => {
    for (const k of [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'TYPESAFE_API_KEY',
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'CEREBRAS_API_KEY',
      'OPENROUTER_API_KEY',
      'HF_TOKEN',
      'GITHUB_TOKEN',
    ]) {
      vi.stubEnv(k, '');
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const result = await runJuno('2026-10-10', accepted, rejected, '');
    expect(result?.method).toBe('symbolic');
    expect(buildSelectionBrief(result)).toContain('今日の題材（選定済み・変更不可）');
  });

  it('returns null when the symbolic layer rejected everything', async () => {
    expect(await runJuno('2026-10-10', [], rejected, '')).toBeNull();
  });
});

describe('appendSelectionLog / buildState', () => {
  it('records the winner, the losers and the rejected candidates', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { appendSelectionLog, buildState } = await import('../src/lib/selection/select');
    const { accepted, rejected } = reviewCandidates(
      generateCandidates(pulse, null, priority, 12),
      ctx(),
    );
    for (const k of [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'TYPESAFE_API_KEY',
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'CEREBRAS_API_KEY',
      'OPENROUTER_API_KEY',
      'HF_TOKEN',
      'GITHUB_TOKEN',
    ]) {
      vi.stubEnv(k, '');
    }
    const result = await runJuno('2026-10-10', accepted, rejected, '');
    if (!result) throw new Error('expected a selection');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-sel-'));
    await appendSelectionLog(dir, '2026-10-10', result);
    await appendSelectionLog(dir, '2026-10-11', result);
    const log = await fs.readFile(path.join(dir, 'docs/selection-runs/2026-10.md'), 'utf-8');
    expect(log.match(/^# テーマ選定ログ/gm)).toHaveLength(1);
    expect(log).toContain('## 2026-10-10 — symbolic');
    expect(log).toContain('落とした候補:');
    expect(log).toContain('theme_cooldown');

    const state = buildState('2026-10-10', accepted, '【今日のお金の景色】');
    expect(state).toContain(accepted[0].id);
    expect(state).toContain('【今日のお金の景色】');
  });

  it('returns no brief without a selection', () => {
    expect(buildSelectionBrief(null)).toBe('');
  });
});
