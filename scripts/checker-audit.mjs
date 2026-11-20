#!/usr/bin/env bun
/**
 * Genesis Vault — Checker Audit
 *
 * Wraps the existing deterministic quality checker and runs three
 * oracle-labelled cases: a complete article, a partial one, and a valid
 * completion written without headings. It records only two counters:
 *
 *   phantomSuccess — partial work accepted as success
 *   silentFailure  — valid alternative completion rejected as failure
 *
 * The gate itself is untouched. This script only observes it.
 *
 * Usage:
 *   bun run audit:checkers
 *   bun run audit:checkers --json
 *   bun run audit:checkers --no-write
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditQualityChecker } from '../src/lib/pipeline/checker-audit.ts';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = path.join(rootDir, 'data/checker-audit-ledger.json');
const asJson = process.argv.includes('--json');
const noWrite = process.argv.includes('--no-write');

const report = auditQualityChecker();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const result of report.cases) {
    const mark = result.expectedPass === result.actualPass ? '✅' : '❌';
    const expected = result.expectedPass ? '成功' : '失敗';
    const actual = result.actualPass ? '成功' : '失敗';
    console.log(`${mark} ${result.id} (${result.kind}) 期待=${expected} 実際=${actual}`);
  }
  console.log(`\nphantom success: ${report.metrics.phantomSuccess}`);
  console.log(`silent failure : ${report.metrics.silentFailure}`);
}

if (!noWrite) {
  await writeFile(ledgerPath, `${JSON.stringify(report.metrics, null, 2)}\n`, 'utf-8');
  if (!asJson) console.log(`台帳を更新: ${path.relative(rootDir, ledgerPath)}`);
}

if (report.metrics.phantomSuccess > 0 || report.metrics.silentFailure > 0) {
  process.exit(1);
}
