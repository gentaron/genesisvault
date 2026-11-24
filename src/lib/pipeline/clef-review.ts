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
 *
 * ── v2（2026-11-23）: 1人の審査員から「記号審査 + 陪審 + 双対質問」へ ──
 * 11/13〜11/22 の記録では、Clef は「積立9年目」「僕のルール」を含む原稿を合格にしていた。
 * 判断モデルはミナが何者かを知らないので、知らないことは見逃す。そこで3層にした:
 *   1. 記号審査（無料・0ms・決定論）: 正典違反・一人称・禁止トピック・タイトルの使い回し。
 *      ルールで決まることはルールで決める（AGENTS.md §5.0）。モデルに聞かない
 *   2. 陪審（PoLL）: Clef と Clef-flash を同時に呼ぶ。veto は最も厳しい票、その他は平均。
 *      票が割れた veto 項目は「判断不能」＝不合格（fail-closed）
 *   3. 双対質問: yes/no を正向きと逆向きの2問で聞き、p = (p正 + (1 − p逆)) / 2。
 *      判断モデルが「はい」に寄る偏り（veto が毎日 90% 台で通っていた）を打ち消す
 * veto が落ちたら enforceVeto で公開しない（advisory でも）。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { askJury, bodyModelName, type JevAnswer, type JevQuestion } from '../ai/jev.js';
import { type Canon, detectCanonViolations, loadCanon } from '../canon/canon.js';
import { CLEF_REVIEW_CONFIG } from './config.js';
import { findTitleEchoes } from './title-guard.js';

export interface ClefCheck {
  id: string;
  label: string;
  /** 0〜1。noul は「真である確率」、score はレベルを 0〜1 に直した値。 */
  value: number | null;
  threshold: number;
  veto: boolean;
  passed: boolean;
  /** 陪審員ごとの値（モデルの順）。記号審査では空。 */
  jurors?: (number | null)[];
  /** 陪審員の値の幅（最大 − 最小）。 */
  spread?: number;
  /** 'symbolic' は記号審査、'jury' は判断モデル。 */
  source?: 'symbolic' | 'jury';
  /** 記号審査で落ちた理由（原稿に実在する引用）。 */
  evidence?: string;
}

export interface ClefVerdict {
  available: boolean;
  passed: boolean;
  checks: ClefCheck[];
  model: string | null;
  notes: string[];
  /** 公開を止めるべきか（mode=enforce の不合格、または enforceVeto で veto が落ちた）。 */
  blocking: boolean;
}

/** 質問の正本。id は記録とテストが参照する。 */
export const CLEF_QUESTIONS: (JevQuestion & { label: string; veto: boolean; inverse?: string })[] =
  [
    {
      name: 'on_brief',
      type: 'noul',
      label: '企画指示の題材を主題として扱っている',
      veto: true,
      prompt:
        '原稿は【企画指示】の題材そのものを主題として扱っているか。関連する別の話題に移っていたら偽。',
      inverse: '原稿は【企画指示】の題材から離れ、別の話題を主題にしているか。',
    },
    {
      name: 'no_advice',
      type: 'noul',
      label: '投資助言・売買の推奨をしていない',
      veto: true,
      prompt: '原稿は、読者に特定の金融商品の売買・増減を勧めていないか（勧めていなければ真）。',
      inverse: '原稿は、読者に特定の金融商品の売買・増減を勧めているか。',
    },
    {
      name: 'no_amount',
      type: 'noul',
      label: '自分の資産の金額を書いていない',
      veto: true,
      prompt:
        '原稿は、書き手自身の資産・貯蓄・投資の金額（円やドルの実額）を書いていないか（書いていなければ真）。',
      inverse: '原稿は、書き手自身の資産・貯蓄・投資の金額（円やドルの実額）を書いているか。',
    },
    {
      name: 'concrete',
      type: 'noul',
      label: 'その日にしか起きない具体がある',
      veto: false,
      prompt: '原稿には、その日・その人にしか起きない具体的な出来事や行動が少なくとも1つあるか。',
      inverse:
        '原稿は、誰にでも当てはまる一般論だけで、その日・その人にしか起きない具体が1つも無いか。',
    },
    {
      name: 'gate',
      type: 'noul',
      label: '読者が自分に置き換えられ、今日ひとつ試せることがある',
      veto: false,
      prompt:
        '原稿を読み終えた読者が、自分の暮らしに置き換えて今日ひとつだけ試せることが書かれているか。',
      inverse: '原稿を読み終えても、読者が今日試せることが何も書かれていないか。',
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

// ─── 双対質問 ─────────────────────────────────────────────────

const NOT = '__not';

/** 陪審員に投げる質問。dualPolarity なら inverse を持つ yes/no を逆向きでも聞く（1回の呼び出しに同梱）。 */
export function buildJuryQuestions(dual = CLEF_REVIEW_CONFIG.jury.dualPolarity): JevQuestion[] {
  const out: JevQuestion[] = [];
  for (const { label: _l, veto: _v, inverse, ...q } of CLEF_QUESTIONS) {
    out.push(q as JevQuestion);
    if (dual && inverse && q.type === 'noul')
      out.push({ name: `${q.name}${NOT}`, type: 'noul', prompt: inverse });
  }
  return out;
}

/** 1人の陪審員の答え → 質問ごとの値（0〜1）。正逆が揃えば (p + (1 − q)) / 2。 */
export function combinePolarity(answers: Record<string, JevAnswer>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const q of CLEF_QUESTIONS) {
    const a = answers[q.name];
    if (q.type === 'score') {
      out[q.name] = a?.type === 'score' ? a.value : null;
      continue;
    }
    const pos = a?.type === 'noul' ? a.probability : null;
    const n = answers[`${q.name}${NOT}`];
    const neg = n?.type === 'noul' ? 1 - n.probability : null;
    out[q.name] =
      pos != null && neg != null ? Math.round(((pos + neg) / 2) * 1000) / 1000 : (pos ?? neg);
  }
  return out;
}

// ─── 陪審の合議 ───────────────────────────────────────────────

/**
 * 陪審員ごとの値 → 合否。veto は最も厳しい票（最小値）、その他は平均。
 * veto の票が maxDisagreement 以上割れたら、その項目は不合格（判断不能を通さない）。
 */
export function decideJury(
  jurors: Record<string, number | null>[],
  t = CLEF_REVIEW_CONFIG.thresholds,
  maxDisagreement = CLEF_REVIEW_CONFIG.jury.maxDisagreement,
): { passed: boolean; checks: ClefCheck[] } {
  const merged: Record<string, { type: string; probability?: number; value?: number }> = {};
  const per: Record<string, { values: (number | null)[]; spread: number }> = {};
  for (const q of CLEF_QUESTIONS) {
    const values = jurors.map((j) => j[q.name] ?? null);
    const got = values.filter((v): v is number => v != null);
    const spread =
      got.length > 1 ? Math.round((Math.max(...got) - Math.min(...got)) * 1000) / 1000 : 0;
    per[q.name] = { values, spread };
    if (got.length === 0) continue;
    const v = q.veto ? Math.min(...got) : got.reduce((a, b) => a + b, 0) / got.length;
    const r = Math.round(v * 1000) / 1000;
    merged[q.name] =
      q.type === 'score' ? { type: 'score', value: r } : { type: 'noul', probability: r };
  }
  const { checks } = decide(merged, t);
  const out = checks.map((c) => {
    const { values, spread } = per[c.id];
    const split = c.veto && spread >= maxDisagreement;
    return { ...c, jurors: values, spread, source: 'jury' as const, passed: c.passed && !split };
  });
  const vetoFailed = out.some((c) => c.veto && !c.passed);
  const softFailed = out.filter((c) => !c.veto && !c.passed).length;
  return { passed: !vetoFailed && softFailed <= t.maxSoftFailures, checks: out };
}

// ─── 記号審査（モデルに聞かない） ─────────────────────────────

let forbiddenTermsCache: string[] | null = null;
/** qualityGate.forbiddenTopics はスキーマ未宣言で PIPELINE_CONFIG から落ちる（LM-018）。生の JSON から読む。 */
function forbiddenTerms(): string[] {
  if (!forbiddenTermsCache) {
    try {
      const raw = JSON.parse(
        fs.readFileSync(new URL('../../../config/pipeline.json', import.meta.url), 'utf-8'),
      );
      forbiddenTermsCache = raw?.qualityGate?.forbiddenTopics?.terms ?? [];
    } catch {
      forbiddenTermsCache = [];
    }
  }
  return forbiddenTermsCache ?? [];
}

export interface SymbolicContext {
  canon?: Canon;
  /** タイトルの使い回しを見るための過去記事（date / title）。 */
  recent?: { date: string; title: string }[];
  today?: string;
}

/** ルールで決まる veto。正典（投資歴・一人称・資産構成・金額）、禁止トピック、タイトルの使い回し。 */
export function symbolicChecks(
  title: string,
  body: string,
  ctx: SymbolicContext = {},
): ClefCheck[] {
  const check = (id: string, label: string, bad: string[]): ClefCheck => ({
    id,
    label,
    value: bad.length === 0 ? 1 : 0,
    threshold: 1,
    veto: true,
    passed: bad.length === 0,
    source: 'symbolic',
    evidence: bad.length
      ? bad
          .slice(0, 3)
          .map((b) => `「${b}」`)
          .join(' ')
      : undefined,
  });
  const out: ClefCheck[] = [];
  let canon = ctx.canon;
  try {
    canon ??= loadCanon();
  } catch {
    /* 正典が読めない環境（テストなど）では正典の項目を出さない。本番は auto-post が先に落ちる */
  }
  if (canon) {
    const hits = detectCanonViolations(`${title}。\n${body}`, canon);
    out.push(
      check(
        'canon',
        '正典（投資歴・一人称・資産構成・金額）に反していない',
        hits.map((h) => h.quote),
      ),
    );
  }
  const text = `${title}${body}`;
  out.push(
    check(
      'forbidden',
      '禁止トピックを含まない',
      forbiddenTerms().filter((t) => text.includes(t)),
    ),
  );
  if (ctx.recent && ctx.today) {
    const echoes = findTitleEchoes(title, ctx.recent, ctx.today);
    out.push(
      check('title_echo', 'タイトルが直近の言い回し・語を使い回していない', [
        ...new Set(echoes.map((e) => e.phrase)),
      ]),
    );
  }
  return out;
}

function isBlocking(passed: boolean, checks: ClefCheck[]): boolean {
  if (passed) return false;
  return (
    CLEF_REVIEW_CONFIG.mode === 'enforce' ||
    (CLEF_REVIEW_CONFIG.enforceVeto && checks.some((c) => c.veto && !c.passed))
  );
}

export async function runClefReview(
  brief: string,
  title: string,
  body: string,
  ctx: SymbolicContext = {},
): Promise<ClefVerdict> {
  const notes: string[] = [];
  // 1. 記号審査は判断モデルの有無に関係なく必ず走る（無料・決定論）
  const symbolic = symbolicChecks(title, body, ctx);
  const symbolicPassed = symbolic.every((c) => c.passed);
  if (!CLEF_REVIEW_CONFIG.enabled) {
    notes.push('clefReview.enabled=false（記号審査のみ）');
    return {
      available: false,
      passed: symbolicPassed,
      checks: symbolic,
      model: null,
      notes,
      blocking: isBlocking(symbolicPassed, symbolic),
    };
  }
  // 2〜3. 陪審 + 双対質問（1人あたり1回の呼び出し）
  const results = await askJury(buildReviewState(brief, title, body), buildJuryQuestions(), notes);
  if (results.length === 0) {
    return {
      available: false,
      passed: symbolicPassed,
      checks: symbolic,
      model: null,
      notes,
      blocking: isBlocking(symbolicPassed, symbolic),
    };
  }
  if (results.length === 1)
    notes.push(`陪審が1人だけ（${bodyModelName(results[0].model)}）— 合議なしで判定`);
  const jury = decideJury(results.map((r) => combinePolarity(r.answers)));
  for (const c of jury.checks) {
    if (c.veto && c.spread != null && c.spread >= CLEF_REVIEW_CONFIG.jury.maxDisagreement) {
      notes.push(
        `${c.label}: 陪審の票が割れた（幅 ${Math.round(c.spread * 100)}pt）→ 判断不能として不合格`,
      );
    }
  }
  const checks = [...symbolic, ...jury.checks];
  const passed = symbolicPassed && jury.passed;
  return {
    available: true,
    passed,
    checks,
    model: `${results[0].transport}:${results.map((r) => bodyModelName(r.model)).join('+')}`,
    notes,
    blocking: isBlocking(passed, checks),
  };
}

/** 書き直しの指示（落ちた項目だけ）。 */
export function buildClefFeedback(verdict: ClefVerdict): string {
  const failed = verdict.checks.filter((c) => !c.passed);
  if (failed.length === 0) return '';
  return [
    '審査（Clef）で次の項目が基準に届きませんでした。ここだけを直してください:',
    ...failed.map((c) =>
      c.source === 'symbolic'
        ? `- ${c.label}: ${c.evidence ?? ''} を削除・言い換えること`
        : `- ${c.label}（${c.value == null ? '判定なし' : `${Math.round(c.value * 100)}%`} / 基準 ${Math.round(c.threshold * 100)}%）`,
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
        c.source === 'symbolic'
          ? `- ${c.passed ? '✅' : '❌'} [記号] ${c.label}${c.evidence ? `: ${c.evidence}` : ''}`
          : `- ${c.passed ? '✅' : '❌'} ${c.label}${c.veto ? '（veto）' : ''}: ${c.value == null ? '—' : `${Math.round(c.value * 100)}%`} / 基準 ${Math.round(c.threshold * 100)}%${c.jurors && c.jurors.length > 1 ? `（陪審 ${c.jurors.map((v) => (v == null ? '—' : Math.round(v * 100))).join(' / ')}）` : ''}`,
      );
    }
    for (const n of v.notes) lines.push(`- ${n}`);
    lines.push('');
  });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.appendFile(file, lines.join('\n'), 'utf-8');
}
