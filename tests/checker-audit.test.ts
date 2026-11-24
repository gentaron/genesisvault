import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditQualityChecker, CHECKER_AUDIT_CASES } from '../src/lib/pipeline/checker-audit.js';
import { runQualityGate } from '../src/lib/pipeline/quality-gate.js';

describe('Checker audit — phantom success / silent failure', () => {
  it('has one oracle-labelled case for each completion kind', () => {
    expect(CHECKER_AUDIT_CASES.map((c) => c.kind)).toEqual(['complete', 'partial', 'alternate']);
  });

  it('rejects the partial case instead of calling it a success', () => {
    const partial = CHECKER_AUDIT_CASES.find((c) => c.kind === 'partial');
    if (!partial) throw new Error('partial case is missing');
    expect(runQualityGate(partial.body).passed).toBe(false);
  });

  it('accepts the valid alternative completion', () => {
    const alternate = CHECKER_AUDIT_CASES.find((c) => c.kind === 'alternate');
    if (!alternate) throw new Error('alternate case is missing');
    expect(runQualityGate(alternate.body).passed).toBe(true);
  });

  it('reports no phantom successes or silent failures with the current gate', () => {
    const report = auditQualityChecker();
    expect(report.metrics).toEqual({ phantomSuccess: 0, silentFailure: 0 });
  });

  it('counts a checker that accepts everything as a phantom success', () => {
    const report = auditQualityChecker(CHECKER_AUDIT_CASES, () => ({ passed: true }));
    expect(report.metrics.phantomSuccess).toBe(1);
    expect(report.metrics.silentFailure).toBe(0);
  });

  it('counts a checker that rejects everything as a silent failure', () => {
    const report = auditQualityChecker(CHECKER_AUDIT_CASES, () => ({ passed: false }));
    expect(report.metrics.phantomSuccess).toBe(0);
    expect(report.metrics.silentFailure).toBe(2);
  });

  it('keeps the ledger to the two audit counters', async () => {
    const ledgerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'data/checker-audit-ledger.json',
    );
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf-8'));

    expect(Object.keys(ledger).sort()).toEqual(['phantomSuccess', 'silentFailure']);
    expect(ledger).toEqual(auditQualityChecker().metrics);
  });
});
