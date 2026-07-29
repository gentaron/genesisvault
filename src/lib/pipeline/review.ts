/**
 * Phase λ — The Enclosure (囲い): LLM-as-Judge, done defensively
 *
 * A weak or lenient reviewer is the most expensive component in a
 * generation pipeline, because its failures are silent: a miss produces
 * no error, no warning, no red line. The run is green and the bad work
 * ships. Everything in this module exists to make that failure mode
 * visible or impossible.
 *
 * Five defenses, in order of importance:
 *
 *   1. **The model observes; the code decides.** The judge never returns a
 *      final score. It returns per-criterion observations, and
 *      `computeVerdict()` aggregates them deterministically from the
 *      rubric weights in `config/pipeline.json`. A model cannot be lenient
 *      about a number it does not produce.
 *
 *   2. **Evidence must be real.** Every finding must quote the article.
 *      `verifyEvidence()` checks each quote actually occurs in the text and
 *      discards the ones that do not. A judge that invents quotes is
 *      detected rather than believed — and this check needs no model.
 *
 *   3. **Veto criteria cannot be averaged away.** Theme drift and factual
 *      regression reject outright. A weighted mean lets four good scores
 *      drown one disqualifying flaw; a veto does not.
 *
 *   4. **Fail-closed.** If the judge cannot be reached, returns garbage, or
 *      cites nothing real, the article is REJECTED, never passed. An
 *      unavailable gate is a closed gate (INV-012).
 *
 *   5. **Independence.** The judge sees the brief and the article, and
 *      nothing else — no past posts, no theme balance, no style samples.
 *      Handing it the writing context turns review into self-assessment.
 *      `buildJudgePrompt()` is the only place the prompt is assembled, and
 *      it is unit-tested to contain no writing context.
 *
 * The functions here are deliberately pure and side-effect free so the
 * gate's own logic can be tested without an API key. `judgeArticle()` is
 * the single impure entry point.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProviderEntry } from '../ai/providers.js';
import { buildProviderChain } from '../ai/providers.js';
import type { RubricCriterion } from './config.js';
import { PIPELINE_CONFIG } from './config.js';

const REVIEW = PIPELINE_CONFIG.review;

// ─── What the judge is allowed to return ────────────────────────

/**
 * One observation per rubric criterion. Note what is absent: a total
 * score, a pass/fail flag, a recommendation. The judge reports what it
 * saw; it does not get a vote on the outcome.
 */
export const ObservationSchema = z.object({
  criterionId: z.string(),
  /** 0-100 for this criterion alone. */
  score: z.number().min(0).max(100),
  /**
   * Verbatim quote from the article supporting the finding. Required when
   * the score is low — a complaint without a citation is not actionable
   * and cannot be verified.
   */
  evidence: z.string(),
  /** What is wrong (or right), in one sentence. */
  finding: z.string(),
});

export const JudgeOutputSchema = z.object({
  observations: z.array(ObservationSchema),
  /** Brief points the article never addresses. */
  missing: z.array(z.string()),
  /** Explicit rule violations. */
  violations: z.array(z.string()),
  /** If the article drifted to another subject, what it drifted to. Empty if not. */
  drift: z.string(),
  /** Concrete instructions for the next writing attempt. */
  revision: z.string(),
});

export type Observation = z.infer<typeof ObservationSchema>;
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ─── Rubric selection ───────────────────────────────────────────

/**
 * Criteria that apply to this review. Without a brief, brief-dependent
 * criteria drop out and the remaining weights renormalize — the gate
 * still runs rather than silently passing everything (fail-open was the
 * original bug: no brief meant no review at all).
 */
export function activeCriteria(hasBrief: boolean): RubricCriterion[] {
  return REVIEW.rubric.filter((c) => hasBrief || !c.requiresBrief);
}

// ─── Evidence verification (no model involved) ──────────────────

/** Collapse whitespace so quoting differences in spacing don't cause false negatives. */
function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

export interface EvidenceCheck {
  /** Observations whose evidence was found in the article. */
  verified: Observation[];
  /** Observations discarded because their quote does not exist in the article. */
  fabricated: Observation[];
}

/**
 * Drop observations that cite text the article does not contain.
 *
 * A judge that fabricates quotes is not a strict judge — it is an
 * unreliable one, and its complaints must not be allowed to reject work
 * (nor its praise to pass it). Positive observations with no evidence are
 * kept: quoting is only required to *accuse*.
 */
export function verifyEvidence(article: string, observations: Observation[]): EvidenceCheck {
  const haystack = normalize(article);
  const verified: Observation[] = [];
  const fabricated: Observation[] = [];

  for (const obs of observations) {
    const quote = normalize(obs.evidence);
    const accusation = obs.score < 100;

    if (!accusation || quote.length === 0) {
      // Nothing to verify: a clean criterion needs no citation.
      verified.push(obs);
      continue;
    }
    if (haystack.includes(quote)) {
      verified.push(obs);
    } else {
      fabricated.push(obs);
    }
  }

  return { verified, fabricated };
}

// ─── Deterministic verdict ──────────────────────────────────────

export interface CriterionResult {
  id: string;
  label: string;
  weight: number;
  score: number;
  veto: boolean;
  vetoed: boolean;
  finding: string;
  evidence: string;
  /** True when the judge returned nothing for this criterion. */
  unreported: boolean;
}

export interface Verdict {
  /** 0-100, computed here — never taken from the model. */
  score: number;
  passed: boolean;
  /** Set when a veto criterion failed; passed is false regardless of score. */
  vetoedBy: string[];
  criteria: CriterionResult[];
  missing: string[];
  violations: string[];
  drift: string;
  revision: string;
  /** Quotes the judge invented. Non-empty means the judge is suspect. */
  fabricatedEvidence: Observation[];
  /** Why the article was rejected, in one line. Empty when passed. */
  reason: string;
}

/** A veto criterion trips below this score. */
export const VETO_THRESHOLD = 50;

/**
 * Aggregate observations into a verdict.
 *
 * Unreported criteria score 0, not "skip". A judge that stays silent
 * about a criterion has not cleared it — treating silence as approval is
 * how a gate quietly stops gating.
 */
export function computeVerdict(opts: {
  output: JudgeOutput;
  article: string;
  hasBrief: boolean;
  minScore?: number;
}): Verdict {
  const minScore = opts.minScore ?? REVIEW.minScore;
  const criteria = activeCriteria(opts.hasBrief);

  const { verified, fabricated } = REVIEW.requireEvidence
    ? verifyEvidence(opts.article, opts.output.observations)
    : { verified: opts.output.observations, fabricated: [] as Observation[] };

  const byId = new Map(verified.map((o) => [o.criterionId, o]));

  const results: CriterionResult[] = criteria.map((criterion) => {
    const obs = byId.get(criterion.id);
    const score = obs ? obs.score : 0;
    return {
      id: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      score,
      veto: criterion.veto,
      vetoed: criterion.veto && score < VETO_THRESHOLD,
      finding: obs?.finding ?? '審査結果が返されませんでした（未報告は不合格として扱います）',
      evidence: obs?.evidence ?? '',
      unreported: !obs,
    };
  });

  const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
  const score =
    totalWeight === 0
      ? 0
      : Math.round(results.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight);

  const vetoedBy = results.filter((r) => r.vetoed).map((r) => r.id);
  const passed = vetoedBy.length === 0 && score >= minScore;

  let reason = '';
  if (vetoedBy.length > 0) {
    reason = `veto: ${vetoedBy.join(', ')}`;
  } else if (score < minScore) {
    reason = `スコア ${score} が合格ライン ${minScore} 未満`;
  }

  return {
    score,
    passed,
    vetoedBy,
    criteria: results,
    missing: opts.output.missing,
    violations: opts.output.violations,
    drift: opts.output.drift,
    revision: opts.output.revision,
    fabricatedEvidence: fabricated,
    reason,
  };
}

/** A verdict that rejects, used when the judge could not be trusted or reached. */
export function rejectedVerdict(reason: string): Verdict {
  return {
    score: 0,
    passed: false,
    vetoedBy: [],
    criteria: [],
    missing: [],
    violations: [],
    drift: '',
    revision: '審査を完了できませんでした。原稿を確認し、審査を再実行してください。',
    fabricatedEvidence: [],
    reason,
  };
}

// ─── Second opinion ─────────────────────────────────────────────

/**
 * Borderline scores get a second, independent judge. Sampling noise
 * around the pass line decides real outcomes, so near the threshold one
 * opinion is not enough.
 */
export function needsSecondOpinion(score: number, minScore = REVIEW.minScore): boolean {
  const band = REVIEW.secondOpinionBand;
  return score >= minScore - band && score <= minScore + band;
}

/**
 * Combine two independent verdicts conservatively: the lower score wins
 * and vetoes union. Disagreement resolves toward rejection, because a
 * wrongly rejected draft costs one rerun while a wrongly accepted one is
 * published.
 */
export function combineVerdicts(first: Verdict, second: Verdict): Verdict {
  const lower = second.score < first.score ? second : first;
  const vetoedBy = [...new Set([...first.vetoedBy, ...second.vetoedBy])];
  const passed = vetoedBy.length === 0 && first.passed && second.passed;

  return {
    ...lower,
    vetoedBy,
    passed,
    missing: [...new Set([...first.missing, ...second.missing])],
    violations: [...new Set([...first.violations, ...second.violations])],
    drift: first.drift || second.drift,
    fabricatedEvidence: [...first.fabricatedEvidence, ...second.fabricatedEvidence],
    reason: passed
      ? ''
      : vetoedBy.length > 0
        ? `veto: ${vetoedBy.join(', ')}（二重審査）`
        : `二重審査の低い方のスコア ${lower.score} が合格ライン未満`,
  };
}

// ─── Prompt construction ────────────────────────────────────────

/**
 * Build the judge prompt.
 *
 * This function receives the brief and the article and nothing else, by
 * design. Do not add past posts, theme balance, style samples, or the
 * writer's reasoning: a judge holding the author's context stops being an
 * external check. There is a test asserting this stays true.
 */
export function buildJudgePrompt(opts: {
  spec: string;
  article: string;
  hasBrief: boolean;
}): string {
  const criteria = activeCriteria(opts.hasBrief);

  const rubricText = criteria
    .map(
      (c) =>
        `- **${c.id}**（${c.label}${c.veto ? ' / これは一発不合格の項目' : ''}）\n  ${c.guidance}`,
    )
    .join('\n');

  const specSection = opts.hasBrief
    ? `# 企画指示\n${opts.spec}`
    : '# 企画指示\n（今回は指示なし。指示に依存しない項目のみを審査すること）';

  return `あなたは編集長です。提出された原稿を、下の評価項目に沿って厳格に審査してください。

あなたの仕事は**欠陥を見つけること**です。読みやすいという理由で点を与えてはいけません。
文章が流暢であることと、指示に従っていることは別物です。前者で後者を補ってはいけません。

## 守るべき審査ルール

1. 各項目を 0〜100 で採点し、**必ず全項目について報告**してください。報告の無い項目は 0 点として扱われます。
2. **減点する項目には、原稿からの逐語引用を evidence に必ず入れてください。**
   引用は原稿に実在する文字列でなければなりません。実在しない引用を書いた場合、その指摘は無効として破棄されます。
   満点の項目は evidence を空文字にして構いません。
3. 総合点や合否は書かないでください。それは別の仕組みが決めます。あなたは観察だけを報告します。
4. 迷ったら低く付けてください。見逃しは誰にも気づかれないまま公開されますが、厳しすぎる指摘は次の執筆で是正されます。

## 評価項目

${rubricText}

${specSection}

# 提出原稿

${opts.article}`;
}

// ─── The one impure entry point ─────────────────────────────────

/** Order the chain so the configured judge models come first. */
export function orderJudgeProviders(providers: ProviderEntry[]): ProviderEntry[] {
  const byName = new Map(providers.map((p) => [p.name, p]));
  const ordered: ProviderEntry[] = [];
  for (const name of REVIEW.judgeProviders) {
    const entry = byName.get(name);
    if (entry) {
      ordered.push(entry);
      byName.delete(name);
    }
  }
  for (const p of providers) if (byName.has(p.name)) ordered.push(p);
  return ordered;
}

export interface JudgeRun {
  verdict: Verdict;
  providerUsed: string;
  attempts: number;
  latencyMs: number;
}

/**
 * Run the judge against an article.
 *
 * Fail-closed: every failure path returns a rejecting verdict rather than
 * throwing or passing. `skipProvider` lets the second opinion pick a
 * different model than the first.
 */
export async function judgeArticle(opts: {
  spec: string;
  article: string;
  hasBrief: boolean;
  skipProvider?: string;
  minScore?: number;
  providers?: ProviderEntry[];
}): Promise<JudgeRun> {
  const started = Date.now();
  const chain = orderJudgeProviders(opts.providers ?? buildProviderChain()).filter(
    (p) => p.name !== opts.skipProvider,
  );

  if (chain.length === 0) {
    return {
      verdict: rejectedVerdict(
        '審査に使えるプロバイダーがありません（APIキー未設定）。審査できない原稿は通しません。',
      ),
      providerUsed: 'none',
      attempts: 0,
      latencyMs: Date.now() - started,
    };
  }

  const prompt = buildJudgePrompt({
    spec: opts.spec,
    article: opts.article,
    hasBrief: opts.hasBrief,
  });

  const limit = Math.min(REVIEW.maxJudgeAttempts, chain.length);
  const errors: string[] = [];

  for (let i = 0; i < limit; i++) {
    const provider = chain[i];
    try {
      const { object } = await generateObject({
        model: provider.model,
        schema: JudgeOutputSchema,
        prompt,
        temperature: REVIEW.judgeTemperature,
      });

      const verdict = computeVerdict({
        output: object,
        article: opts.article,
        hasBrief: opts.hasBrief,
        minScore: opts.minScore,
      });

      return {
        verdict,
        providerUsed: provider.name,
        attempts: i + 1,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      errors.push(`${provider.name}: ${(err as Error).message?.slice(0, 120)}`);
    }
  }

  return {
    verdict: rejectedVerdict(`審査が ${limit} 回とも失敗しました — ${errors.join(' / ')}`),
    providerUsed: 'none',
    attempts: limit,
    latencyMs: Date.now() - started,
  };
}

/**
 * Full review: one judge, plus an independent second opinion when the
 * result lands near the pass line.
 */
export async function reviewArticle(opts: {
  spec: string;
  article: string;
  hasBrief: boolean;
  minScore?: number;
  providers?: ProviderEntry[];
}): Promise<{ verdict: Verdict; runs: JudgeRun[] }> {
  const first = await judgeArticle(opts);
  const runs = [first];

  const shouldRecheck =
    first.providerUsed !== 'none' && needsSecondOpinion(first.verdict.score, opts.minScore);

  if (!shouldRecheck) return { verdict: first.verdict, runs };

  const second = await judgeArticle({ ...opts, skipProvider: first.providerUsed });
  runs.push(second);

  // A failed second opinion must not upgrade a borderline pass into a
  // pass by default, but it also must not manufacture a rejection out of
  // an outage: keep the first verdict and record that recheck failed.
  if (second.providerUsed === 'none') return { verdict: first.verdict, runs };

  return { verdict: combineVerdicts(first.verdict, second.verdict), runs };
}
