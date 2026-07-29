import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { lintPost } from '../src/lib/pipeline/content-lint';
import { runQualityGate } from '../src/lib/pipeline/quality-gate';
import manifest from './fixtures/gate/manifest.json';

// ═══════════════════════════════════════════════════════════════
// Phase λ — Gate calibration
//
// A gate nobody measures is a gate nobody can trust. A miss produces no
// output at all: the run is green, the article ships, and the failure is
// discovered by a reader or never. The only way to know what the gate
// actually catches is to feed it known-bad work and assert it objects.
//
// This file covers the deterministic layer only (no model, no network).
// The LLM judge is measured separately by `bun run gate:eval`, which
// needs an API key and therefore cannot run in `bun run verify`.
// ═══════════════════════════════════════════════════════════════

const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures/gate');

type Fixture = (typeof manifest.fixtures)[number];

const files = new Map<string, string>();

beforeAll(async () => {
  for (const fixture of manifest.fixtures) {
    files.set(fixture.file, await readFile(path.join(FIXTURE_DIR, fixture.file), 'utf-8'));
  }
});

/** Strip frontmatter — runQualityGate scores the body only. */
function bodyOf(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : raw;
}

function failedChecks(raw: string): string[] {
  return runQualityGate(bodyOf(raw))
    .checks.filter((c) => !c.passed)
    .map((c) => c.name);
}

describe('Phase λ — Gate calibration: the deterministic layer', () => {
  for (const fixture of manifest.fixtures as Fixture[]) {
    describe(`${fixture.file} (${fixture.kind})`, () => {
      it('trips exactly the checks it is supposed to trip', () => {
        const raw = files.get(fixture.file)!;
        const failed = failedChecks(raw);

        for (const expected of fixture.deterministic.mustFailChecks) {
          expect(failed, `${fixture.file} は ${expected} を検出すべき — ${fixture.why}`).toContain(
            expected,
          );
        }
      });

      it(`${fixture.deterministic.mustPass ? 'passes' : 'fails'} the quality gate`, () => {
        const report = runQualityGate(bodyOf(files.get(fixture.file)!));
        expect(report.passed, `${fixture.file}: ${fixture.why}`).toBe(
          fixture.deterministic.mustPass,
        );
      });

      it(`is ${fixture.deterministic.mustLintClean ? 'clean' : 'flagged'} by the corpus linter`, () => {
        const issues = lintPost(fixture.file, files.get(fixture.file)!).filter(
          (i) => i.severity === 'error',
        );
        if (fixture.deterministic.mustLintClean) {
          expect(issues, `${fixture.file} に想定外の lint エラー`).toEqual([]);
        } else {
          expect(issues.length).toBeGreaterThan(0);
          for (const rule of fixture.deterministic.mustLintRules ?? []) {
            expect(issues.map((i) => i.rule)).toContain(rule);
          }
        }
      });
    });
  }
});

describe('Phase λ — Gate calibration: false positives', () => {
  it('does not flag the known-good article on any check', () => {
    // The expensive failure of a strict gate is rejecting good work until
    // someone loosens it. This is the control that keeps strictness honest.
    const good = (manifest.fixtures as Fixture[]).filter((f) => f.kind === 'good');
    expect(good.length).toBeGreaterThan(0);

    for (const fixture of good) {
      const report = runQualityGate(bodyOf(files.get(fixture.file)!));
      const failures = report.checks.filter((c) => !c.passed).map((c) => c.name);
      expect(failures, `${fixture.file} を誤検知しています`).toEqual([]);
      expect(report.score).toBe(100);
    }
  });
});

describe('Phase λ — Gate calibration: documented blind spots', () => {
  const blindspots = (manifest.fixtures as Fixture[]).filter((f) => f.kind === 'blindspot');

  it('has blind-spot fixtures on record', () => {
    expect(blindspots.length).toBeGreaterThan(0);
  });

  for (const fixture of blindspots) {
    it(`${fixture.file} slips past the deterministic layer, as documented`, () => {
      // These assertions encode a limitation, not a success. Rules cannot
      // see that prose is generic or that the subject was swapped — only
      // the judge can. If one of these ever starts failing deterministically
      // that is good news: move it out of `blindspot` and keep the check.
      const report = runQualityGate(bodyOf(files.get(fixture.file)!));
      expect(report.passed).toBe(true);
      expect(
        lintPost(fixture.file, files.get(fixture.file)!).filter((i) => i.severity === 'error'),
      ).toEqual([]);
    });
  }

  it('every blind spot is covered by a judge expectation', () => {
    // A blind spot with nothing downstream to catch it is an open hole.
    for (const fixture of blindspots) {
      expect(fixture.judge.expectPass, `${fixture.file} に審査側の期待がありません`).toBe(false);
      const covered =
        (fixture.judge.expectLowCriteria?.length ?? 0) > 0 ||
        (fixture.judge.expectVeto?.length ?? 0) > 0;
      expect(covered, `${fixture.file}: どの criterion が捕まえるのか宣言されていません`).toBe(
        true,
      );
    }
  });
});

describe('Phase λ — Gate calibration: manifest integrity', () => {
  it('references only criteria that exist in the rubric', async () => {
    const { PIPELINE_CONFIG } = await import('../src/lib/pipeline/config');
    const ids = new Set(PIPELINE_CONFIG.review.rubric.map((c) => c.id));

    for (const fixture of manifest.fixtures as Fixture[]) {
      for (const id of [
        ...(fixture.judge.expectLowCriteria ?? []),
        ...(fixture.judge.expectVeto ?? []),
      ]) {
        expect(ids, `${fixture.file} が未知の criterion "${id}" を参照しています`).toContain(id);
      }
    }
  });

  it('only expects a veto on criteria actually marked veto', async () => {
    const { PIPELINE_CONFIG } = await import('../src/lib/pipeline/config');
    const vetoIds = new Set(PIPELINE_CONFIG.review.rubric.filter((c) => c.veto).map((c) => c.id));

    for (const fixture of manifest.fixtures as Fixture[]) {
      for (const id of fixture.judge.expectVeto ?? []) {
        expect(vetoIds, `"${id}" は veto criterion ではありません`).toContain(id);
      }
    }
  });

  it('supplies a brief for any fixture whose expectation depends on one', () => {
    for (const fixture of manifest.fixtures as Fixture[]) {
      const needsBrief = (fixture.judge.expectVeto ?? []).includes('theme_drift');
      if (needsBrief) {
        expect(fixture.brief, `${fixture.file}: theme_drift の判定には brief が必要`).toBeTruthy();
      }
    }
  });
});
