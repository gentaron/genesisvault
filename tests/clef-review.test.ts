/**
 * Clef 審査 — 判断モデルの確率から合否を決めるのはコード（INV-013）。
 * ネットワークには触らない。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRequestBody, normalizeAnswers } from '../src/lib/ai/jev';
import {
  buildClefFeedback,
  CLEF_QUESTIONS,
  decide,
  runClefReview,
} from '../src/lib/pipeline/clef-review';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const T = { veto: 0.5, noul: 0.5, score: 0.5, maxSoftFailures: 1 };

function allPass() {
  return {
    on_brief: { type: 'noul', probability: 0.9 },
    no_advice: { type: 'noul', probability: 0.95 },
    no_amount: { type: 'noul', probability: 0.97 },
    concrete: { type: 'noul', probability: 0.8 },
    gate: { type: 'noul', probability: 0.7 },
    readability: { type: 'score', value: 0.75 },
  };
}

describe('decide', () => {
  it('passes when every check clears its threshold', () => {
    const { passed, checks } = decide(allPass(), T);
    expect(passed).toBe(true);
    expect(checks.map((c) => c.id)).toEqual(CLEF_QUESTIONS.map((q) => q.name));
  });

  it('a single veto failure rejects regardless of the rest', () => {
    const a = { ...allPass(), on_brief: { type: 'noul', probability: 0.2 } };
    expect(decide(a, T).passed).toBe(false);
  });

  it('tolerates up to maxSoftFailures soft failures', () => {
    const one = { ...allPass(), gate: { type: 'noul', probability: 0.1 } };
    expect(decide(one, T).passed).toBe(true);
    const two = { ...one, concrete: { type: 'noul', probability: 0.1 } };
    expect(decide(two, T).passed).toBe(false);
  });

  it('counts a missing answer as a failure (fail-closed per check)', () => {
    const { on_brief: _drop, ...rest } = allPass();
    expect(decide(rest, T).passed).toBe(false);
  });
});

describe('score levels', () => {
  const q = [{ name: 'r', type: 'score' as const, prompt: 'p', levels: ['a', 'b', 'c', 'd', 'e'] }];

  it('sends levels as the criteria list', () => {
    expect(buildRequestBody('@cf/cloudflare/clef', 's', q).questions.r).toEqual({
      type: 'score',
      instructions: 'p',
      criteria: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  it('normalizes a 0..(n-1) weighted score to 0..1', () => {
    expect(normalizeAnswers({ result: { answers: { r: { score: 3 } } } }, q).r).toEqual({
      type: 'score',
      value: 0.75,
    });
  });
});

describe('runClefReview', () => {
  it('is "no review" (not a pass verdict) without keys', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    const v = await runClefReview('brief', 't', 'body');
    expect(v.available).toBe(false);
    expect(v.checks).toEqual([]);
  });

  it('reads Clef answers and builds feedback for failed checks only', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acc');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                answers: {
                  on_brief: { noul: 0.9 },
                  no_advice: { noul: 0.9 },
                  no_amount: { noul: 0.9 },
                  concrete: { noul: 0.2 },
                  gate: { noul: 0.3 },
                  readability: { score: 3 },
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const v = await runClefReview('brief', 't', 'body');
    expect(v.available).toBe(true);
    expect(v.model).toBe('workers-ai:@cf/cloudflare/clef');
    expect(v.passed).toBe(false);
    const fb = buildClefFeedback(v);
    expect(fb).toContain('その日にしか起きない具体');
    expect(fb).not.toContain('投資助言');
  });
});
