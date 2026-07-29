#!/usr/bin/env bun
/**
 * Genesis Vault — Gate Eval（囲いの較正）
 *
 * 審査役そのものを採点する。
 *
 * 記事の品質は審査役が測る。では審査役の品質は誰が測るのか——という
 * 問いに答えるための道具。既知の不良原稿（tests/fixtures/gate/）を
 * 審査役に通し、**何を捕まえ、何を見逃したか**を数える。
 *
 * 見逃しは画面に何も表示されない。全部緑で通る。だから
 * 「意図的に壊した原稿を入れて、落ちることを確認する」以外に、
 * 審査役が働いているかを知る方法がない。
 *
 * モデルを変えたとき・rubric を変えたとき・合格ラインを動かしたときは、
 * これを走らせて捕捉率が下がっていないことを確認すること。
 *
 * Usage:
 *   bun run gate:eval
 *   bun run gate:eval --json          # 機械可読な出力
 *   bun run gate:eval --min-recall 1  # 捕捉率の下限（既定 1.0 = 全件捕捉）
 *
 * Env:
 *   GEMINI_API_KEY ほか、審査役が使うプロバイダーのキー（最低1つ必須）
 *
 * `bun run verify` には含めない。モデル呼び出しとネットワークが要るため、
 * 決定論ゲートの「オフラインで同じ答えが出る」性質を壊してしまう。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProviderChain } from '../src/lib/ai/providers.ts';
import { reviewArticle } from '../src/lib/pipeline/review.ts';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = path.join(rootDir, 'tests/fixtures/gate');

const asJson = process.argv.includes('--json');
const minRecallArg = process.argv.indexOf('--min-recall');
const MIN_RECALL = minRecallArg !== -1 ? Number(process.argv[minRecallArg + 1]) : 1;

const manifest = JSON.parse(await readFile(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8'));

if (buildProviderChain().length === 0) {
  console.error('審査に使えるプロバイダーがありません。GEMINI_API_KEY 等を設定してください。');
  process.exit(2);
}

const results = [];

for (const fixture of manifest.fixtures) {
  const article = await readFile(path.join(FIXTURE_DIR, fixture.file), 'utf-8');
  const spec = fixture.brief ?? '';
  const hasBrief = spec.trim().length > 0;

  const { verdict, runs } = await reviewArticle({ spec, article, hasBrief });

  const expectPass = fixture.judge.expectPass;
  const correct = verdict.passed === expectPass;

  // 期待した criterion が実際に低評価/veto になったか
  const lowIds = verdict.criteria.filter((c) => c.score < 70).map((c) => c.id);
  const expectedLow = fixture.judge.expectLowCriteria ?? [];
  const expectedVeto = fixture.judge.expectVeto ?? [];
  const caughtLow = expectedLow.filter((id) => lowIds.includes(id));
  const caughtVeto = expectedVeto.filter((id) => verdict.vetoedBy.includes(id));

  results.push({
    file: fixture.file,
    kind: fixture.kind,
    expectPass,
    actualPass: verdict.passed,
    correct,
    score: verdict.score,
    reason: verdict.reason,
    judges: runs.map((r) => r.providerUsed),
    expectedLow,
    caughtLow,
    expectedVeto,
    caughtVeto,
    fabricated: verdict.fabricatedEvidence.length,
    unreported: verdict.criteria.filter((c) => c.unreported).map((c) => c.id),
  });
}

// ─── 集計 ───────────────────────────────────────────────────────

const shouldFail = results.filter((r) => !r.expectPass);
const shouldPass = results.filter((r) => r.expectPass);

const caught = shouldFail.filter((r) => !r.actualPass);
const missed = shouldFail.filter((r) => r.actualPass);
const falsePositives = shouldPass.filter((r) => !r.actualPass);

const recall = shouldFail.length === 0 ? 1 : caught.length / shouldFail.length;
const blindspots = results.filter((r) => r.kind === 'blindspot');
const blindspotsCaught = blindspots.filter((r) => !r.actualPass);

const summary = {
  recall,
  caught: caught.length,
  shouldFail: shouldFail.length,
  falsePositives: falsePositives.length,
  blindspotsCaught: blindspotsCaught.length,
  blindspots: blindspots.length,
  fabricatedEvidenceTotal: results.reduce((s, r) => s + r.fabricated, 0),
};

if (asJson) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log('\n═══ Gate Eval — 審査役の捕捉率 ═══════════════════\n');
  for (const r of results) {
    const mark = r.correct ? '✅' : '❌';
    const verdictText = r.actualPass ? '通過' : '差し戻し';
    const expected = r.expectPass ? '通過' : '差し戻し';
    console.log(`${mark} ${r.file}`);
    console.log(`    期待: ${expected} / 実際: ${verdictText} (${r.score}点) ${r.reason}`);
    console.log(`    審査: ${r.judges.join(' → ')}`);
    if (r.expectedLow.length) {
      console.log(
        `    低評価すべき項目: ${r.expectedLow.join(', ')} → 検出 ${r.caughtLow.join(', ') || 'なし'}`,
      );
    }
    if (r.expectedVeto.length) {
      console.log(
        `    veto すべき項目: ${r.expectedVeto.join(', ')} → 検出 ${r.caughtVeto.join(', ') || 'なし'}`,
      );
    }
    if (r.fabricated) console.log(`    ⚠️ 実在しない引用 ${r.fabricated} 件`);
    if (r.unreported.length) console.log(`    ⚠️ 未報告の項目: ${r.unreported.join(', ')}`);
    console.log('');
  }

  console.log('─────────────────────────────────────────────────');
  console.log(
    `  捕捉率      : ${(recall * 100).toFixed(0)}%  (${caught.length}/${shouldFail.length})`,
  );
  console.log(`  見逃し      : ${missed.length}件  ${missed.map((r) => r.file).join(', ')}`);
  console.log(
    `  誤検知      : ${falsePositives.length}件  ${falsePositives.map((r) => r.file).join(', ')}`,
  );
  console.log(
    `  死角の捕捉  : ${blindspotsCaught.length}/${blindspots.length}  ← 決定論では捕まえられない分`,
  );
  console.log(`  捏造引用    : ${summary.fabricatedEvidenceTotal}件`);
  console.log('─────────────────────────────────────────────────\n');
}

if (missed.length > 0) {
  console.error(
    `見逃しが ${missed.length} 件あります。審査役のモデルを上げるか rubric を見直してください。`,
  );
}
if (falsePositives.length > 0) {
  console.error(
    `正常な記事を ${falsePositives.length} 件落としています。厳しすぎる審査は運用で緩められて終わります。`,
  );
}

process.exit(recall >= MIN_RECALL && falsePositives.length === 0 ? 0 : 1);
