#!/usr/bin/env bun
/**
 * Genesis Vault — Brief Gate（囲い）
 *
 * 生成された記事を、執筆とは独立した審査にかける。
 *
 * 判定ロジックは `src/lib/pipeline/review.ts` にある。このスクリプトは
 * 「原稿を見つける・審査を呼ぶ・結果を記録する」だけの薄い CLI で、
 * 合否の判断そのものは持たない（判断はテストできる場所に置くため）。
 *
 * 設計上の要点:
 *   - 審査側には仕様と成果物しか渡さない。執筆時の文脈（過去記事・
 *     テーマバランス・文体サンプル）を見せない。これが外部審査の条件。
 *   - モデルは観察だけを返し、合否はコード側が決定論的に集計する。
 *   - 減点には原稿からの逐語引用を要求し、実在しない引用は破棄する。
 *   - 審査できなかった原稿は通さない（fail-closed）。
 *   - 落ちた原稿は削除せず隔離する。消すと、なぜ落ちたかを後から検証できない。
 *
 * Usage:
 *   bun scripts/brief-gate.mjs
 *
 * Env:
 *   GV_THEME        (任意)  Linear のタイトル
 *   GV_BRIEF        (任意)  Linear の説明文。無い場合は指示に依存しない項目のみ審査
 *   GEMINI_API_KEY  (必須)  ほか各プロバイダーのキー
 *   GV_GATE_MIN     (任意)  合格ライン。既定は config/pipeline.json の review.minScore
 */

import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPELINE_CONFIG } from '../src/lib/pipeline/config.ts';
import { reviewArticle } from '../src/lib/pipeline/review.ts';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(rootDir, 'src/content/posts');
const REVIEW = PIPELINE_CONFIG.review;
const MIN_SCORE = Number(process.env.GV_GATE_MIN || REVIEW.minScore);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** 今日の日付で始まる中から、最後に書かれたファイルを拾う */
async function findDraft() {
  const files = (await readdir(POSTS_DIR)).filter(
    (f) => f.startsWith(`${todayISO()}-`) && f.endsWith('.md'),
  );
  if (files.length === 0) throw new Error(`No draft found in ${POSTS_DIR}`);

  const withTime = await Promise.all(
    files.map(async (f) => ({ f, t: (await stat(path.join(POSTS_DIR, f))).mtimeMs })),
  );
  withTime.sort((a, b) => b.t - a.t);
  return path.join(POSTS_DIR, withTime[0].f);
}

async function setOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}<<__GVEOF__\n${String(v ?? '')}\n__GVEOF__`)
    .join('\n');
  await appendFile(out, `${lines}\n`);
}

/**
 * 判定を月次の監査ログに追記する。通過も不合格も等しく記録する
 * ——「何を落としたか」だけでなく「何を通したか」も後から検証できないと、
 * 見逃しは永久に見つからない。
 */
async function recordAudit({ file, verdict, runs, hasBrief }) {
  const dir = path.join(rootDir, REVIEW.auditLogDir);
  await mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `${todayISO().slice(0, 7)}.md`);

  const breakdown = verdict.criteria
    .map((c) => `${c.id}:${c.score}${c.vetoed ? '(veto)' : ''}${c.unreported ? '(未報告)' : ''}`)
    .join(' / ');

  const entry = [
    `### ${new Date().toISOString()} — ${verdict.passed ? '通過' : '差し戻し'} (${verdict.score}/100)`,
    '',
    `- 原稿: \`${path.relative(rootDir, file)}\``,
    `- 企画指示: ${hasBrief ? 'あり' : 'なし（指示非依存の項目のみ審査）'}`,
    `- 合格ライン: ${MIN_SCORE}`,
    `- 審査モデル: ${runs.map((r) => `${r.providerUsed}(${r.attempts}回, ${r.latencyMs}ms)`).join(' → ')}`,
    `- 内訳: ${breakdown || '（なし）'}`,
    verdict.vetoedBy.length ? `- **veto**: ${verdict.vetoedBy.join(', ')}` : '',
    verdict.drift ? `- すり替わり: ${verdict.drift}` : '',
    verdict.missing.length ? `- 欠落: ${verdict.missing.join(' / ')}` : '',
    verdict.violations.length ? `- 違反: ${verdict.violations.join(' / ')}` : '',
    verdict.fabricatedEvidence.length
      ? `- ⚠️ 審査役が実在しない引用を ${verdict.fabricatedEvidence.length} 件出しました（該当指摘は破棄）`
      : '',
    verdict.reason ? `- 判定理由: ${verdict.reason}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  let header = '';
  try {
    await stat(logPath);
  } catch {
    header = `# Gate Runs — ${todayISO().slice(0, 7)}\n\n囲い（審査層）の全判定記録。通過分も残す。\n\n`;
  }
  await appendFile(logPath, header + entry, 'utf-8');
}

/** 落ちた原稿は消さずに隔離する。証拠を残さない却下は検証できない。 */
async function quarantine(file, verdict) {
  const dir = path.join(rootDir, REVIEW.quarantineDir);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${stamp}-${path.basename(file)}`);
  await rename(file, target);
  await writeFile(`${target}.verdict.json`, `${JSON.stringify(verdict, null, 2)}\n`, 'utf-8');
  return target;
}

// ─── main ───────────────────────────────────────────────────────

const spec = [
  process.env.GV_THEME ? `タイトル: ${process.env.GV_THEME}` : '',
  process.env.GV_BRIEF || '',
]
  .filter(Boolean)
  .join('\n\n');

const hasBrief = spec.trim().length > 0;

// 指示が無くてもゲートは開けっ放しにしない。指示に依存しない項目
// （具体性・ペルソナ・AI 特有表現・整合）は指示の有無と関係なく効く。
if (!hasBrief) {
  console.log('企画指示なし — 指示に依存しない項目のみで審査します。');
}

const file = await findDraft();
const article = await readFile(file, 'utf8');

const { verdict, runs } = await reviewArticle({
  spec,
  article,
  hasBrief,
  minScore: MIN_SCORE,
});

console.log('\n── Brief Gate ──────────────────────────');
console.log(`  file  : ${path.relative(rootDir, file)}`);
console.log(`  score : ${verdict.score} / 100  (pass >= ${MIN_SCORE})`);
console.log(`  judge : ${runs.map((r) => r.providerUsed).join(' → ')}`);
for (const c of verdict.criteria) {
  const mark = c.vetoed ? '✗veto' : c.score >= 70 ? '  ok ' : '  低 ';
  console.log(`  ${mark} ${c.id.padEnd(22)} ${String(c.score).padStart(3)}  ${c.finding}`);
}
if (verdict.missing.length) console.log(`  missing   : ${verdict.missing.join(' / ')}`);
if (verdict.violations.length) console.log(`  violations: ${verdict.violations.join(' / ')}`);
if (verdict.drift) console.log(`  drift : ${verdict.drift}`);
if (verdict.fabricatedEvidence.length) {
  console.log(
    `  ⚠️ 審査役が実在しない引用を ${verdict.fabricatedEvidence.length} 件出しました（破棄済み）`,
  );
}
console.log('────────────────────────────────────────\n');

await recordAudit({ file, verdict, runs, hasBrief });

if (verdict.passed) {
  console.log('Passed. The draft follows the brief.');
  await setOutput({ gate: 'pass', score: String(verdict.score) });
  process.exit(0);
}

const quarantined = await quarantine(file, verdict);
console.error(`Rejected — ${verdict.reason}`);
console.error(`隔離しました: ${path.relative(rootDir, quarantined)}`);
console.error(verdict.revision || 'The draft does not follow the brief.');

await setOutput({
  gate: 'fail',
  score: String(verdict.score),
  revision: [
    '【前回の原稿は差し戻されました。以下を必ず反映すること】',
    verdict.drift ? `すり替わり: ${verdict.drift}` : '',
    verdict.vetoedBy.length ? `一発不合格の項目: ${verdict.vetoedBy.join(' / ')}` : '',
    verdict.missing.length ? `欠落: ${verdict.missing.join(' / ')}` : '',
    verdict.violations.length ? `違反: ${verdict.violations.join(' / ')}` : '',
    ...verdict.criteria
      .filter((c) => c.score < 70)
      .map((c) => `${c.label}(${c.score}点): ${c.finding}`),
    verdict.revision || '',
  ]
    .filter(Boolean)
    .join('\n'),
});

process.exit(1);
