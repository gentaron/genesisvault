/**
 * VE-012 Juno Albrecht (Arbiter) — ニューロシンボリック選定
 *
 *   記号側（candidates.ts）: 候補を作る → 硬い規則で落とす → 特徴量 → symbolic スコア
 *   神経側（Jev）          : 生き残った候補にだけ Choice / Noul で答える → neural スコア
 *   融合                    : final = ws·symbolic + wn·neural（Jev が棄権したら記号のみ）
 *
 * Jev の答えはそのまま採用しない。
 *   - 選択肢は候補 ID の enum だけ。規則で落ちた候補は選択肢に存在しない
 *   - 確信度（Choice の確率）が minConfidence 未満なら「棄権」として扱う
 *     → 自信の無い判断で記号側の順位をひっくり返させない（選択的予測）
 *   - 合否はコードが決める（INV-013 と同じ: モデルは観察だけを返す）
 *
 * Jev の経路が無い日は、無料 LLM チェーンに同じ enum で選ばせる。それも無ければ
 * 記号側の順位だけで決める。どの経路でも選定は止まらない。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { generateWithFallback } from '../ai/generate.js';
import { askJev, type JevQuestion } from '../ai/jev.js';
import { SELECTION_CONFIG } from '../pipeline/config.js';
import type { Rejection, ScoredCandidate } from './candidates.js';

export type SelectionMethod = 'jev' | 'llm' | 'symbolic';

export interface RankedCandidate extends ScoredCandidate {
  neural: number | null;
  final: number;
}

export interface SelectionResult {
  winner: RankedCandidate;
  ranked: RankedCandidate[];
  rejected: Rejection[];
  method: SelectionMethod;
  /** Jev / LLM の確信度（記号のみのときは null）。 */
  confidence: number | null;
  /** Jev が答えたが確信度不足で棄権扱いにしたか。 */
  abstained: boolean;
  transport: string | null;
  notes: string[];
}

/** Jev の「関門」質問を何件まで投げるか（入力料金と Neurons の節約）。 */
const GATE_QUESTIONS = 6;

export const GATE_PROMPT =
  'この候補で「これまで【制約】で【できなかったこと】が、【今日の変化】によって、【ふつうの個人の暮らし】でもできる。その根拠は【確認できる事実】。」という一文を、誇張せずに埋められるか。';

export function buildState(today: string, candidates: ScoredCandidate[], context: string): string {
  const lines = [
    `日付: ${today}`,
    '媒体: 個人の日記ブログ。読者は散歩・瞑想・ひとり旅・投資・AI に興味がある、ふつうの個人。',
    '目的: 今日いちばん「読者が自分に置き換えられて、約束を事実で支えられる」1本を選ぶ。',
    '',
    context.trim(),
    '',
    '候補:',
    ...candidates.map((c) => `${c.id} [${c.theme}] ${c.hook}（根拠: ${c.why.join(' / ')}）`),
  ];
  return lines.join('\n');
}

export function buildQuestions(candidates: ScoredCandidate[]): JevQuestion[] {
  return [
    {
      name: 'pick',
      type: 'choice',
      prompt: '今日書く1本として、最も読者の役に立ち、事実で約束を支えられる候補はどれか。',
      options: candidates.map((c) => c.id),
    },
    ...candidates.slice(0, GATE_QUESTIONS).map(
      (c): JevQuestion => ({
        name: `gate_${c.id}`,
        type: 'noul',
        prompt: `${c.id}: ${GATE_PROMPT}`,
      }),
    ),
  ];
}

/**
 * Jev / LLM の答え → 候補ごとの neural スコア（0〜1）。
 * Choice の分布が返らないときは、選ばれた候補に確率 p、残りに (1-p)/(n-1) を配る。
 */
export function neuralScores(
  candidates: ScoredCandidate[],
  pick: { value: string; probability: number; distribution: Record<string, number> },
  gates: Record<string, number>,
): Record<string, number> {
  const n = candidates.length;
  const hasDist = Object.keys(pick.distribution).length > 0;
  const out: Record<string, number> = {};
  for (const c of candidates) {
    const choiceP = hasDist
      ? (pick.distribution[c.id] ?? 0)
      : c.id === pick.value
        ? pick.probability
        : n > 1
          ? (1 - pick.probability) / (n - 1)
          : 0;
    const gate = gates[c.id];
    out[c.id] = gate == null ? choiceP : 0.6 * choiceP + 0.4 * gate;
  }
  // 分布の最大値を 1 に揃える（候補数で neural の効き方が変わらないように）
  const max = Math.max(...Object.values(out), 1e-9);
  for (const id of Object.keys(out)) out[id] = Math.round((out[id] / max) * 1000) / 1000;
  return out;
}

export function fuse(
  candidates: ScoredCandidate[],
  neural: Record<string, number> | null,
  weights = SELECTION_CONFIG.weights,
): RankedCandidate[] {
  const ws = weights.symbolic;
  const wn = neural ? weights.neural : 0;
  const total = ws + wn || 1;
  return candidates
    .map((c) => {
      const nScore = neural ? (neural[c.id] ?? 0) : null;
      const final = (ws * c.symbolic + wn * (nScore ?? 0)) / total;
      return { ...c, neural: nScore, final: Math.round(final * 1000) / 1000 };
    })
    .sort((a, b) => b.final - a.final || b.symbolic - a.symbolic || a.id.localeCompare(b.id));
}

async function askLlm(
  state: string,
  candidates: ScoredCandidate[],
  notes: string[],
): Promise<{ value: string; probability: number } | null> {
  const ids = candidates.map((c) => c.id) as [string, ...string[]];
  try {
    const result = await generateWithFallback({
      schema: z.object({ pick: z.enum(ids), confidence: z.number().min(0).max(1) }),
      system: 'あなたは候補 ID を1つ選んで JSON で返すだけの判定係です。文章は書きません。',
      prompt: `${state}\n\n上の候補から今日書く1本を選び、{"pick": 候補ID, "confidence": 0〜1} だけを返してください。\n判定基準: ${GATE_PROMPT}`,
      agentId: 'VE-012',
      agentName: 'Juno Albrecht',
    });
    return { value: result.value.pick, probability: result.value.confidence };
  } catch (err) {
    notes.push(`llm: ${(err as Error).message?.substring(0, 80)}`);
    return null;
  }
}

export async function runJuno(
  today: string,
  accepted: ScoredCandidate[],
  rejected: Rejection[],
  context: string,
): Promise<SelectionResult | null> {
  console.log('\n⚖️  [VE-012] Juno Albrecht (Arbiter): 記号で絞った候補を Jev に判定させています…');
  const notes: string[] = [];
  if (accepted.length === 0) {
    console.log(`  ⚠️  記号の規則を通った候補がありません（落ちた候補 ${rejected.length}件）`);
    return null;
  }

  const pool = accepted.slice(0, SELECTION_CONFIG.maxCandidates);
  const state = buildState(today, pool, context);
  const minConf = SELECTION_CONFIG.jev.minConfidence;

  let method: SelectionMethod = 'symbolic';
  let neural: Record<string, number> | null = null;
  let confidence: number | null = null;
  let abstained = false;
  let transport: string | null = null;

  if (pool.length > 1) {
    const jev = await askJev(state, buildQuestions(pool), notes);
    const pick = jev?.answers.pick;
    if (jev && pick?.type === 'choice') {
      transport = `${jev.transport}:${jev.model} ${jev.latencyMs}ms`;
      confidence = pick.probability;
      if (pick.probability >= minConf) {
        const gates: Record<string, number> = {};
        for (const c of pool) {
          const g = jev.answers[`gate_${c.id}`];
          if (g?.type === 'noul') gates[c.id] = g.probability;
        }
        neural = neuralScores(pool, pick, gates);
        method = 'jev';
      } else {
        abstained = true;
        notes.push(`jev: 確信度 ${pick.probability.toFixed(2)} < ${minConf} のため棄権扱い`);
      }
    } else if (SELECTION_CONFIG.llmFallback) {
      const llm = await askLlm(state, pool, notes);
      if (llm) {
        confidence = llm.probability;
        if (llm.probability >= minConf) {
          neural = neuralScores(pool, { ...llm, distribution: {} }, {});
          method = 'llm';
        } else {
          abstained = true;
          notes.push(`llm: 確信度 ${llm.probability.toFixed(2)} < ${minConf} のため棄権扱い`);
        }
      }
    }
  }

  const ranked = fuse(pool, neural);
  const winner = ranked[0];
  console.log(`  ✅ 選定: ${winner.id} [${winner.theme}] ${winner.hook}`);
  console.log(
    `  🧮 method=${method} final=${winner.final} symbolic=${winner.symbolic} neural=${winner.neural ?? '—'}${abstained ? '（神経側は棄権）' : ''}`,
  );
  for (const note of notes) console.log(`  ℹ️  ${note}`);

  return { winner, ranked, rejected, method, confidence, abstained, transport, notes };
}

/** 書き手（Lena / Sophia）に渡す企画指示。 */
export function buildSelectionBrief(result: SelectionResult | null): string {
  if (!result) return '';
  const w = result.winner;
  return [
    `今日の題材（選定済み・変更不可）: ${w.hook}`,
    `テーマ: ${w.theme}`,
    `この題材が出てきた理由: ${w.why.join(' / ')}`,
    `書く前に、この一文を自分の言葉で埋めること: ${GATE_PROMPT.replace('この候補で', '')}`,
  ].join('\n');
}

// ─── Audit log ──────────────────────────────────────────────────

/**
 * 選んだものだけでなく、落としたもの・負けたものも残す。
 * 選定の見逃し（毎日同じテーマばかり勝つ等）は、負けた側の記録からしか見つからない。
 */
export async function appendSelectionLog(
  rootDir: string,
  today: string,
  result: SelectionResult,
): Promise<void> {
  const dir = path.join(rootDir, SELECTION_CONFIG.auditLogDir);
  const file = path.join(dir, `${today.slice(0, 7)}.md`);
  const lines = [
    '',
    `## ${today} — ${result.method}${result.abstained ? '（神経側は棄権）' : ''}`,
    '',
    `- 採用: ${result.winner.id} [${result.winner.theme}] ${result.winner.hook}`,
    `- 確信度: ${result.confidence == null ? '—' : result.confidence.toFixed(2)} / 経路: ${result.transport ?? '—'}`,
    '',
    '| ID | テーマ | 由来 | symbolic | neural | final |',
    '|----|--------|------|---------:|-------:|------:|',
    ...result.ranked.map(
      (c) =>
        `| ${c.id} | ${c.theme} | ${c.source} | ${c.symbolic} | ${c.neural ?? '—'} | ${c.final} |`,
    ),
    ...(result.rejected.length
      ? [
          '',
          '落とした候補:',
          ...result.rejected.map(
            (r) => `- ${r.candidate.id} [${r.candidate.theme}] ${r.rule}: ${r.detail}`,
          ),
        ]
      : []),
    ...(result.notes.length ? ['', ...result.notes.map((n) => `- ${n}`)] : []),
    '',
  ];
  await fs.mkdir(dir, { recursive: true });
  let header = '';
  try {
    await fs.access(file);
  } catch {
    header = `# テーマ選定ログ ${today.slice(0, 7)}\n\nVE-012 Juno のニューロシンボリック選定の記録。採用だけでなく、負けた候補と規則で落とした候補も残す。\n`;
  }
  await fs.appendFile(file, header + lines.join('\n'), 'utf-8');
}
