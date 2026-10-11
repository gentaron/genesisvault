/**
 * Clef 審査 — System One 形式の判断モデルで、公開前の原稿を審査する。
 *
 * 既存の審査役（review.ts）は、モデルに「所見の文章」と「逐語引用」を書かせる設計で、
 * 文字列を返さない判断モデル（Jev / Clef）では構造的に答えられない。ここではその代わりに、
 * 判断モデルが得意な形 — yes/no の確率（noul）と、順序つきレベル（score）— だけで問う。
 *
 * 設計は囲い（ADR-0016）の原則に合わせる:
 *   - モデルは観察（確率）だけを返し、合否はこのファイルの閾値が決める（INV-013）
 *   - veto 項目（題材のすり替え・投資助言・実額の記載）は加重平均に混ぜない
 *   - 審査役には企画指示と原稿しか渡さない（書き手の文脈を渡すと自己評価になる）
 *
 * 不合格の扱いは config の `clefReview.mode`:
 *   - `advisory` … 1回だけ書き直させる。それでも不合格なら、記録を残して公開を続ける
 *   - `enforce`  … 書き直しても不合格なら公開しない（テンプレートへ）
 * Clef が使えない日は「審査なし」として記録し、公開は止めない（毎日の投稿はこれまでも
 * 審査役なしで動いていた。止める側に倒すのは enforce を選んだときだけ）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { askJev, type JevQuestion } from '../ai/jev.js';
import { CLEF_REVIEW_CONFIG } from './config.js';

export interface ClefCheck {
  id: string;
  label: string;
  /** 0〜1。noul は「真である確率」、score はレベルを 0〜1 に直した値。 */
  value: number | null;
  threshold: number;
  veto: boolean;
  passed: boolean;
}

export interface ClefVerdict {
  available: boolean;
  passed: boolean;
  checks: ClefCheck[];
  model: string | null;
  notes: string[];
}

/** 質問の正本。id は記録とテストが参照する。 */
export const CLEF_QUESTIONS: (JevQuestion & { label: string; veto: boolean })[] = [
  {
    name: 'on_brief',
    type: 'noul',
    label: '企画指示の題材を主題として扱っている',
    veto: true,
    prompt:
      '原稿は【企画指示】の題材そのものを主題として扱っているか。関連する別の話題に移っていたら偽。',
  },
  {
    name: 'no_advice',
    type: 'noul',
    label: '投資助言・売買の推奨をしていない',
    veto: true,
    prompt: '原稿は、読者に特定の金融商品の売買・増減を勧めていないか（勧めていなければ真）。',
  },
  {
    name: 'no_amount',
    type: 'noul',
    label: '自分の資産の金額を書いていない',
    veto: true,
    prompt:
      '原稿は、書き手自身の資産・貯蓄・投資の金額（円やドルの実額）を書いていないか（書いていなければ真）。',
  },
  {
    name: 'concrete',
    type: 'noul',
    label: 'その日にしか起きない具体がある',
    veto: false,
    prompt: '原稿には、その日・その人にしか起きない具体的な出来事や行動が少なくとも1つあるか。',
  },
  {
    name: 'gate',
    type: 'noul',
    label: '読者が自分に置き換えられ、今日ひとつ試せることがある',
    veto: false,
    prompt:
      '原稿を読み終えた読者が、自分の暮らしに置き換えて今日ひとつだけ試せることが書かれているか。',
  },
  {
    name: 'readability',
    type: 'score',
    label: 'スマホで最後まで読める読みやすさ',
    veto: false,
    prompt: '1段落に話は1つ、一文は短い、専門用語はすぐ言い換える、という基準での読みやすさ。',
    levels: ['読みにくい', 'やや読みにくい', 'ふつう', '読みやすい', 'とても読みやすい'],
  },
];

export function buildReviewState(brief: string, title: string, body: string): string {
  return [
    `【企画指示】\n${brief || '（指示なし）'}`,
    `【タイトル】\n${title}`,
    `【原稿】\n${body}`,
  ].join('\n\n');
}

/** 確率 → 合否。ここが判定の正本（モデルではなくコードが決める）。 */
export function decide(
  answers: Record<string, { type: string; probability?: number; value?: number | string }>,
  t = CLEF_REVIEW_CONFIG.thresholds,
): { passed: boolean; checks: ClefCheck[] } {
  const checks: ClefCheck[] = CLEF_QUESTIONS.map((q) => {
    const a = answers[q.name];
    const value =
      a?.type === 'noul'
        ? (a.probability ?? null)
        : a?.type === 'score' && typeof a.value === 'number'
          ? a.value
          : null;
    const threshold = q.veto ? t.veto : q.type === 'score' ? t.score : t.noul;
    // 答えが無い項目は不合格に数える（審査できなかったものを通さない）
    return {
      id: q.name,
      label: q.label,
      value,
      threshold,
      veto: q.veto,
      passed: value != null && value >= threshold,
    };
  });
  const vetoFailed = checks.some((c) => c.veto && !c.passed);
  const softFailed = checks.filter((c) => !c.veto && !c.passed).length;
  return { passed: !vetoFailed && softFailed <= t.maxSoftFailures, checks };
}

export async function runClefReview(
  brief: string,
  title: string,
  body: string,
): Promise<ClefVerdict> {
  const notes: string[] = [];
  if (!CLEF_REVIEW_CONFIG.enabled) {
    return {
      available: false,
      passed: true,
      checks: [],
      model: null,
      notes: ['clefReview.enabled=false'],
    };
  }
  const questions: JevQuestion[] = CLEF_QUESTIONS.map(({ label: _l, veto: _v, ...q }) => q);
  const result = await askJev(buildReviewState(brief, title, body), questions, notes);
  if (!result) return { available: false, passed: true, checks: [], model: null, notes };
  const { passed, checks } = decide(result.answers);
  return { available: true, passed, checks, model: `${result.transport}:${result.model}`, notes };
}

/** 書き直しの指示（落ちた項目だけ）。 */
export function buildClefFeedback(verdict: ClefVerdict): string {
  const failed = verdict.checks.filter((c) => !c.passed);
  if (failed.length === 0) return '';
  return [
    '審査（Clef）で次の項目が基準に届きませんでした。ここだけを直してください:',
    ...failed.map(
      (c) =>
        `- ${c.label}（${c.value == null ? '判定なし' : `${Math.round(c.value * 100)}%`} / 基準 ${Math.round(c.threshold * 100)}%）`,
    ),
  ].join('\n');
}

/** 通過分も含めて docs/gate-runs/YYYY-MM.md に残す（見逃しは通過の記録からしか見つからない）。 */
export async function appendClefReviewLog(
  rootDir: string,
  today: string,
  title: string,
  verdicts: ClefVerdict[],
): Promise<void> {
  const dir = path.join(rootDir, CLEF_REVIEW_CONFIG.auditLogDir);
  const file = path.join(dir, `${today.slice(0, 7)}.md`);
  const lines = ['', `## ${today} Clef 審査 —「${title}」`, ''];
  verdicts.forEach((v, i) => {
    lines.push(
      `### ${i === 0 ? '初稿' : `書き直し ${i}`}: ${v.available ? (v.passed ? '✅ 合格' : '❌ 不合格') : '⏭️ 審査なし'}${v.model ? `（${v.model}）` : ''}`,
    );
    for (const c of v.checks) {
      lines.push(
        `- ${c.passed ? '✅' : '❌'} ${c.label}${c.veto ? '（veto）' : ''}: ${c.value == null ? '—' : `${Math.round(c.value * 100)}%`} / 基準 ${Math.round(c.threshold * 100)}%`,
      );
    }
    for (const n of v.notes) lines.push(`- ${n}`);
    lines.push('');
  });
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(file, lines.join('\n'), 'utf-8');
}
