import { describe, expect, it } from 'vitest';
import { PIPELINE_CONFIG } from '../src/lib/pipeline/config';
import {
  activeCriteria,
  buildJudgePrompt,
  combineVerdicts,
  computeVerdict,
  type JudgeOutput,
  needsSecondOpinion,
  type Observation,
  orderJudgeProviders,
  rejectedVerdict,
  VETO_THRESHOLD,
  verifyEvidence,
} from '../src/lib/pipeline/review';

// ═══════════════════════════════════════════════════════════════
// Phase λ — The Enclosure (囲い)
//
// These tests cover the gate's decision logic, which is deliberately
// pure so it can be verified with no API key, no network, and no model.
// A gate whose own logic is untested is not a gate.
// ═══════════════════════════════════════════════════════════════

const ARTICLE = `---
title: "朝5時の家計簿タイム"
date: 2026-07-28
---

## 通帳を眺める小さな幸せ

今月も無事、目標額を貯金できた。アプリで残高を確認するたびに、少しずつ積み上がっていく数字を見て、静かな達成感を覚える。

## 節約と豊かさのバランス

毎朝カフェでコーヒーを買う代わりに、家で丁寧にドリップする。その時間がむしろ贅沢に感じる。
`;

/** Build a full-marks judge output, then override specific criteria. */
function judgeOutput(
  overrides: Partial<Record<string, number>> = {},
  extra: Partial<JudgeOutput> = {},
): JudgeOutput {
  return {
    observations: PIPELINE_CONFIG.review.rubric.map((c) => ({
      criterionId: c.id,
      score: overrides[c.id] ?? 100,
      evidence: '',
      finding: 'ok',
    })),
    missing: [],
    violations: [],
    drift: '',
    revision: '',
    ...extra,
  };
}

describe('Phase λ — Enclosure: rubric selection', () => {
  it('drops brief-dependent criteria when there is no brief', () => {
    const withBrief = activeCriteria(true);
    const without = activeCriteria(false);
    expect(without.length).toBeLessThan(withBrief.length);
    expect(without.every((c) => !c.requiresBrief)).toBe(true);
  });

  it('still has criteria to judge with no brief (no fail-open)', () => {
    // The original gate skipped review entirely when no brief was supplied.
    expect(activeCriteria(false).length).toBeGreaterThan(0);
  });

  it('keeps at least one veto criterion so flaws cannot be averaged away', () => {
    expect(activeCriteria(true).some((c) => c.veto)).toBe(true);
  });
});

describe('Phase λ — Enclosure: evidence verification', () => {
  const accuse = (evidence: string): Observation => ({
    criterionId: 'ai_slop',
    score: 20,
    evidence,
    finding: '定型表現',
  });

  it('keeps a finding that quotes the article verbatim', () => {
    const { verified, fabricated } = verifyEvidence(ARTICLE, [accuse('静かな達成感を覚える')]);
    expect(verified).toHaveLength(1);
    expect(fabricated).toHaveLength(0);
  });

  it('tolerates whitespace differences in the quote', () => {
    const { verified } = verifyEvidence(ARTICLE, [accuse('静かな  達成感を\n覚える')]);
    expect(verified).toHaveLength(1);
  });

  it('discards a finding whose quote is not in the article', () => {
    const { verified, fabricated } = verifyEvidence(ARTICLE, [
      accuse('人生の本質とは何かを考えさせられた'),
    ]);
    expect(verified).toHaveLength(0);
    expect(fabricated).toHaveLength(1);
  });

  it('does not require evidence for a clean criterion', () => {
    const clean: Observation = {
      criterionId: 'persona_consistency',
      score: 100,
      evidence: '',
      finding: 'ok',
    };
    const { verified, fabricated } = verifyEvidence(ARTICLE, [clean]);
    expect(verified).toHaveLength(1);
    expect(fabricated).toHaveLength(0);
  });

  it('keeps an accusation that offers no quote at all', () => {
    // Deliberate: some real defects cannot be quoted because they are
    // absences — a missing brief point has no span to cite. Only quotes
    // that are *offered* get checked; offering none is not fabrication.
    const { verified, fabricated } = verifyEvidence(ARTICLE, [accuse('')]);
    expect(verified).toHaveLength(1);
    expect(fabricated).toHaveLength(0);
  });
});

describe('Phase λ — Enclosure: deterministic verdict', () => {
  it('passes a clean article', () => {
    const v = computeVerdict({ output: judgeOutput(), article: ARTICLE, hasBrief: true });
    expect(v.score).toBe(100);
    expect(v.passed).toBe(true);
    expect(v.reason).toBe('');
  });

  it('computes the score from rubric weights, not from the model', () => {
    // The judge output carries no total; the score must still be derived.
    const v = computeVerdict({
      output: judgeOutput({ concrete_specificity: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    const weight = PIPELINE_CONFIG.review.rubric.find(
      (c) => c.id === 'concrete_specificity',
    )!.weight;
    const total = PIPELINE_CONFIG.review.rubric.reduce((s, c) => s + c.weight, 0);
    expect(v.score).toBe(Math.round(100 - (100 * weight) / total));
  });

  it('scores an unreported criterion as 0 rather than skipping it', () => {
    // Silence from the judge is not clearance.
    const output = judgeOutput();
    output.observations = output.observations.filter((o) => o.criterionId !== 'ai_slop');
    const v = computeVerdict({ output, article: ARTICLE, hasBrief: true });
    const slop = v.criteria.find((c) => c.id === 'ai_slop')!;
    expect(slop.unreported).toBe(true);
    expect(slop.score).toBe(0);
    expect(v.score).toBeLessThan(100);
  });

  it('rejects on a veto criterion even when the weighted score is high', () => {
    const v = computeVerdict({
      output: judgeOutput({ theme_drift: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    expect(v.score).toBeGreaterThan(PIPELINE_CONFIG.review.minScore);
    expect(v.passed).toBe(false);
    expect(v.vetoedBy).toContain('theme_drift');
    expect(v.reason).toContain('veto');
  });

  it('does not veto when the veto criterion is merely mediocre', () => {
    const v = computeVerdict({
      output: judgeOutput({ theme_drift: VETO_THRESHOLD + 1 }),
      article: ARTICLE,
      hasBrief: true,
    });
    expect(v.vetoedBy).toEqual([]);
  });

  it('fails below the pass line', () => {
    const v = computeVerdict({
      output: judgeOutput({ brief_coverage: 0, concrete_specificity: 0, ai_slop: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    expect(v.passed).toBe(false);
    expect(v.reason).toContain('合格ライン');
  });

  it('discards fabricated evidence instead of letting it reject the article', () => {
    const output = judgeOutput({ ai_slop: 0 });
    const slop = output.observations.find((o) => o.criterionId === 'ai_slop')!;
    slop.evidence = 'この記事には存在しない引用文';

    const v = computeVerdict({ output, article: ARTICLE, hasBrief: true });
    expect(v.fabricatedEvidence).toHaveLength(1);
    // The unreliable finding is dropped, so the criterion falls back to unreported (0)
    expect(v.criteria.find((c) => c.id === 'ai_slop')?.unreported).toBe(true);
  });

  it('renormalizes weights when there is no brief', () => {
    const v = computeVerdict({ output: judgeOutput(), article: ARTICLE, hasBrief: false });
    expect(v.score).toBe(100);
    expect(
      v.criteria.every(
        (c) => !PIPELINE_CONFIG.review.rubric.find((r) => r.id === c.id)?.requiresBrief,
      ),
    ).toBe(true);
  });

  it('rejectedVerdict never passes', () => {
    const v = rejectedVerdict('プロバイダーなし');
    expect(v.passed).toBe(false);
    expect(v.score).toBe(0);
    expect(v.reason).toBe('プロバイダーなし');
  });
});

describe('Phase λ — Enclosure: second opinion', () => {
  const min = PIPELINE_CONFIG.review.minScore;
  const band = PIPELINE_CONFIG.review.secondOpinionBand;

  it('rechecks scores near the pass line', () => {
    expect(needsSecondOpinion(min)).toBe(true);
    expect(needsSecondOpinion(min - band)).toBe(true);
    expect(needsSecondOpinion(min + band)).toBe(true);
  });

  it('does not recheck clear passes or clear failures', () => {
    expect(needsSecondOpinion(min + band + 1)).toBe(false);
    expect(needsSecondOpinion(min - band - 1)).toBe(false);
  });

  it('takes the lower of two verdicts', () => {
    const high = computeVerdict({ output: judgeOutput(), article: ARTICLE, hasBrief: true });
    const low = computeVerdict({
      output: judgeOutput({ brief_coverage: 0, ai_slop: 0, concrete_specificity: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    const combined = combineVerdicts(high, low);
    expect(combined.score).toBe(low.score);
    expect(combined.passed).toBe(false);
  });

  it('requires both judges to pass', () => {
    const pass = computeVerdict({ output: judgeOutput(), article: ARTICLE, hasBrief: true });
    const veto = computeVerdict({
      output: judgeOutput({ internal_consistency: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    expect(combineVerdicts(pass, veto).passed).toBe(false);
    expect(combineVerdicts(veto, pass).passed).toBe(false);
  });

  it('unions the vetoes from both judges', () => {
    const a = computeVerdict({
      output: judgeOutput({ theme_drift: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    const b = computeVerdict({
      output: judgeOutput({ internal_consistency: 0 }),
      article: ARTICLE,
      hasBrief: true,
    });
    expect(combineVerdicts(a, b).vetoedBy.sort()).toEqual(['internal_consistency', 'theme_drift']);
  });
});

describe('Phase λ — Enclosure: judge independence', () => {
  const prompt = buildJudgePrompt({ spec: 'タイトル: 貯金の話', article: ARTICLE, hasBrief: true });

  it('contains the brief and the article', () => {
    expect(prompt).toContain('貯金の話');
    expect(prompt).toContain('通帳を眺める小さな幸せ');
  });

  it('lists every active criterion so none can be silently skipped', () => {
    for (const c of activeCriteria(true)) {
      expect(prompt).toContain(c.id);
    }
  });

  it('marks veto criteria as disqualifying', () => {
    expect(prompt).toContain('一発不合格');
  });

  it('tells the judge not to output a total score', () => {
    // The verdict is computed in code; a model-supplied total would defeat that.
    expect(prompt).toContain('総合点や合否は書かないでください');
  });

  it('demands verbatim evidence for deductions', () => {
    expect(prompt).toContain('逐語引用');
  });

  it('states that fluency does not excuse non-compliance', () => {
    expect(prompt).toContain('読みやすい');
  });

  it('says nothing about the writing context', () => {
    // A judge holding the author's context is doing self-assessment.
    for (const forbidden of ['テーマバランス', '文体サンプル', '過去記事', 'gensnotes']) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it('tells the judge that unreported criteria score zero', () => {
    expect(prompt).toContain('0 点として扱われます');
  });
});

describe('Phase λ — Enclosure: judge provider ordering', () => {
  const chain = [
    { name: 'groq-llama-3.3-70b', model: {} as never, rpm: 30, rpd: 100 },
    { name: 'gemini-2.5-flash-lite', model: {} as never, rpm: 15, rpd: 100 },
    { name: 'gemini-2.5-flash', model: {} as never, rpm: 10, rpd: 100 },
  ];

  it('puts the configured judge models first', () => {
    const ordered = orderJudgeProviders(chain);
    expect(ordered[0].name).toBe(PIPELINE_CONFIG.review.judgeProviders[0]);
  });

  it('keeps the remaining providers as fallbacks', () => {
    expect(orderJudgeProviders(chain)).toHaveLength(chain.length);
  });

  it('degrades gracefully when a preferred judge model is absent', () => {
    const partial = [chain[0]];
    expect(orderJudgeProviders(partial).map((p) => p.name)).toEqual(['groq-llama-3.3-70b']);
  });
});
