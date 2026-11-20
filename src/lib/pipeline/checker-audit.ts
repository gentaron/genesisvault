/**
 * Checker audit — phantom success / silent failure
 *
 * Simulated manipulation benchmarks label episodes with hand-written success
 * checkers. A checker can accept partial progress (phantom success) or reject
 * a valid alternative completion (silent failure). The same asymmetry applies
 * to the deterministic quality gate: a miss is green and invisible.
 *
 * This wraps the existing quality checker with three oracle-labelled cases.
 * It does not change the gate's decision logic; it only measures it.
 */

import { runQualityGate } from './quality-gate.js';

export type CheckerCaseKind = 'complete' | 'partial' | 'alternate';

export interface CheckerCase {
  id: string;
  kind: CheckerCaseKind;
  expectedPass: boolean;
  body: string;
}

export interface CheckerAuditMetrics {
  phantomSuccess: number;
  silentFailure: number;
}

export interface CheckerAuditCaseResult {
  id: string;
  kind: CheckerCaseKind;
  expectedPass: boolean;
  actualPass: boolean;
}

export interface CheckerAuditResult {
  metrics: CheckerAuditMetrics;
  cases: CheckerAuditCaseResult[];
}

const DIARY_PROSE = [
  '今日は朝5時に目が覚めた。カーテンの隙間から差し込む光がまぶしくて、しばらくベッドの中で今日の予定を考えていた。',
  '6時を過ぎたころに家を出て、いつもの公園まで歩いた。桜の葉が少しずつ色を変えていて、風に揺れるたびに小さな音がした。',
  '公園のベンチで10分だけ座って、持ってきたノートに昨夜見た夢のことを書いた。細かいところはもう思い出せなかったけれど、なぜか気持ちは軽かった。',
  '帰り道に寄ったカフェで、店主が新しく入れた豆の話をしてくれた。酸味の少ない飲みやすい味で、思わず二杯目を頼んでしまった。',
  '夜は読書をして早めに布団に入った。今日は何かを成し遂げた日ではないけれど、こういう日があってもいいと思っている。',
  '寝る前に明日の服を用意して、窓を少しだけ開けた。遠くの踏切の音が聞こえて、今日という日が静かに終わっていくのを感じた。',
  '帰宅してからは洗濯物をたたんで、冷蔵庫の残り物で簡単な夕食を作った。特別なことは何もない一日だったけれど、こうして振り返ると悪くない一日だった。',
].join('\n\n');

/** Oracle-labelled cases: complete, partial, and a different valid completion. */
export const CHECKER_AUDIT_CASES: readonly CheckerCase[] = [
  {
    id: 'complete-with-heading',
    kind: 'complete',
    expectedPass: true,
    body: `## 朝の散歩\n\n${DIARY_PROSE}`,
  },
  {
    id: 'stopped-partway',
    kind: 'partial',
    expectedPass: false,
    body: '## 朝の散歩\n\n今日は朝5時に目が覚めた。\n\n[TODO] 続きを書く',
  },
  {
    id: 'complete-without-heading',
    kind: 'alternate',
    expectedPass: true,
    body: DIARY_PROSE,
  },
];

/**
 * Run the existing checker over the oracle cases and count the two failure
 * modes from the paper: partial accepted, and valid alternative rejected.
 */
export function auditQualityChecker(
  cases: readonly CheckerCase[] = CHECKER_AUDIT_CASES,
  checker: (body: string) => { passed: boolean } = runQualityGate,
): CheckerAuditResult {
  const results = cases.map((testCase) => ({
    id: testCase.id,
    kind: testCase.kind,
    expectedPass: testCase.expectedPass,
    actualPass: checker(testCase.body).passed,
  }));

  return {
    metrics: {
      phantomSuccess: results.filter((r) => !r.expectedPass && r.actualPass).length,
      silentFailure: results.filter((r) => r.expectedPass && !r.actualPass).length,
    },
    cases: results,
  };
}
