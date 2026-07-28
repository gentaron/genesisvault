#!/usr/bin/env bun
/**
 * Phase κ — `bun run verify`
 *
 * One deterministic gate for the whole repository.
 *
 * Everything here runs with **no LLM, no network, and no API key**.
 * That is the point: generation is cheap and verification is the
 * bottleneck, so the checks that decide whether work is acceptable must
 * be reproducible, fast, and runnable offline on a laptop — the same
 * command a human runs before merging and CI runs on every push.
 *
 *   bun run verify            # everything
 *   bun run verify --quick    # config + content only (skips lint/types/tests)
 *
 * Exit code 0 = mergeable. Non-zero = do not merge.
 */

import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');

const results = [];

function heading(text) {
  console.log(`\n\x1b[1m▸ ${text}\x1b[0m`);
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(
    `  ${ok ? '\x1b[32m✅' : '\x1b[31m❌'} ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`,
  );
}

/** Run a command, streaming nothing; return {code, output}. */
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, shell: false });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (err) => resolve({ code: 1, output: String(err) }));
  });
}

// ─── 1. Declarative config ──────────────────────────────────────

heading('1. パイプライン設定（config/pipeline.json）');

let config = null;
try {
  const mod = await import('../src/lib/pipeline/config.ts');
  config = mod.PIPELINE_CONFIG;
  record(
    'スキーマ検証と整合性チェック',
    true,
    `v${config.version} / エージェント${config.agents.length}体 / プロバイダー${config.providers.chain.length}件`,
  );
} catch (err) {
  record('スキーマ検証と整合性チェック', false, err.message.split('\n').slice(0, 6).join(' '));
}

if (config) {
  try {
    const { renderSchema } = await import('./sync-config-schema.mjs');
    const committed = await readFile(path.join(rootDir, 'config/pipeline.schema.json'), 'utf-8');
    const drifted = committed !== renderSchema();
    record(
      'JSON Schema が Zod スキーマと同期している',
      !drifted,
      drifted ? '`bun run config:schema` を実行して再生成してください' : '',
    );
  } catch (err) {
    record('JSON Schema が Zod スキーマと同期している', false, err.message);
  }

  // Every agent with a prompt directory should actually have one.
  try {
    const promptDirs = new Set(
      (await readdir(path.join(rootDir, 'prompts'), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    const missing = config.agents.filter((a) => !promptDirs.has(a.promptDir));
    record(
      'エージェントのプロンプトディレクトリが存在する',
      missing.length === 0,
      missing.length > 0
        ? `不足: ${missing.map((a) => `${a.id}→prompts/${a.promptDir}`).join(', ')}`
        : '',
    );
  } catch (err) {
    record('エージェントのプロンプトディレクトリが存在する', false, err.message);
  }
}

// ─── 2. Content lint ────────────────────────────────────────────

heading('2. 記事コーパスの決定論的リント');

try {
  const { lintCorpus } = await import('../src/lib/pipeline/content-lint.ts');
  const postsDir = path.join(rootDir, 'src/content/posts');
  const files = (await readdir(postsDir)).filter((f) => f.endsWith('.md') || f.endsWith('.mdx'));
  const posts = {};
  for (const f of files) posts[f] = await readFile(path.join(postsDir, f), 'utf-8');

  const issues = lintCorpus(posts);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  record(
    `記事 ${files.length} 件のリント`,
    errors.length === 0,
    `エラー ${errors.length} / 警告 ${warnings.length}`,
  );
  for (const issue of errors.slice(0, 20)) {
    console.log(`     \x1b[31m✗\x1b[0m ${issue.file}: [${issue.rule}] ${issue.message}`);
  }
  for (const issue of warnings.slice(0, 5)) {
    console.log(`     \x1b[33m!\x1b[0m ${issue.file}: [${issue.rule}] ${issue.message}`);
  }
  if (warnings.length > 5) console.log(`     … 他 ${warnings.length - 5} 件の警告`);
} catch (err) {
  record('記事コーパスのリント', false, err.message);
}

// ─── 3. Almanac (memory infrastructure) ─────────────────────────

heading('3. Almanac（記憶インフラ）');

try {
  const { renderIndex, findDuplicateAdrNumbers } = await import('./build-almanac.mjs');

  const adrFiles = (await readdir(path.join(rootDir, 'docs/adr'))).filter((f) => f.endsWith('.md'));
  const duplicates = findDuplicateAdrNumbers(adrFiles);
  record(
    'ADR 番号が一意である',
    duplicates.length === 0,
    duplicates.length > 0
      ? duplicates.map(([num, files]) => `${num}: ${files.join(' / ')}`).join('; ')
      : `${adrFiles.length} 件`,
  );

  const committed = await readFile(path.join(rootDir, 'docs/almanac/INDEX.md'), 'utf-8');
  const drifted = committed !== (await renderIndex());
  record(
    'docs/almanac/INDEX.md が最新',
    !drifted,
    drifted ? '`bun run almanac` を実行して再生成してください' : '',
  );
} catch (err) {
  record('Almanac のチェック', false, err.message);
}

// ─── 4. Lint / types / tests ────────────────────────────────────

if (!quick) {
  heading('4. Lint・型・テスト');

  const baseline = JSON.parse(
    await readFile(path.join(rootDir, 'config/quality-baseline.json'), 'utf-8'),
  );

  /**
   * Ratchet check: the repo carries a known backlog of Biome/type
   * findings. Fixing them all at once would be a formatting mega-diff
   * (AGENTS.md §3.3 forbids mixing formatting with logic), so instead we
   * mechanically guarantee the count never grows — and ask for the
   * baseline to be tightened whenever it shrinks.
   */
  function ratchet(name, current, baselineCount, hint) {
    if (current > baselineCount) {
      record(name, false, `${current} 件（基準 ${baselineCount} 件を超過）— ${hint}`);
    } else if (current < baselineCount) {
      record(
        name,
        true,
        `${current} 件（基準 ${baselineCount} 件より改善）— config/quality-baseline.json を ${current} に締めてください`,
      );
    } else {
      record(name, true, `${current} 件（基準どおり・増加なし）`);
    }
  }

  const lint = await run('bunx', ['biome', 'check', '.']);
  const lintErrors = Number(
    lint.output.match(/Found (\d+) errors?\./)?.[1] ?? (lint.code === 0 ? 0 : NaN),
  );
  if (Number.isNaN(lintErrors)) {
    record('Biome lint', false, 'Biome の出力を解析できませんでした');
  } else {
    ratchet(
      'Biome lint（既存指摘のラチェット）',
      lintErrors,
      baseline.biomeErrors,
      '`bun run lint` で詳細を確認',
    );
  }

  const types = await run('bunx', ['astro', 'check']);
  const typeErrors = Number(
    types.output.match(/-\s*(\d+)\s*errors?/)?.[1] ?? (types.code === 0 ? 0 : NaN),
  );
  if (Number.isNaN(typeErrors)) {
    record('TypeScript / Astro 型チェック', false, 'astro check の出力を解析できませんでした');
  } else {
    ratchet(
      'TypeScript / Astro 型チェック（既存指摘のラチェット）',
      typeErrors,
      baseline.astroCheckErrors,
      '`bunx astro check` で詳細を確認',
    );
  }

  const tests = await run('bunx', ['vitest', 'run']);
  const testMatch = tests.output.match(/Tests\s+(\d+)\s+passed/);
  record(
    'ユニットテスト',
    tests.code === 0,
    testMatch ? `${testMatch[1]} 件通過` : '`bun run test` で詳細を確認',
  );
} else {
  heading('4. Lint・型・テスト');
  console.log('  \x1b[2m⏭  --quick のためスキップ\x1b[0m');
}

// ─── Summary ────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
console.log(`\n${'─'.repeat(56)}`);
if (failed.length === 0) {
  console.log(`\x1b[32m\x1b[1m✅ 検証ゲート通過\x1b[0m — ${results.length} 項目すべて合格`);
  process.exit(0);
} else {
  console.log(
    `\x1b[31m\x1b[1m❌ 検証ゲート不合格\x1b[0m — ${failed.length}/${results.length} 項目が失敗`,
  );
  for (const f of failed) console.log(`   • ${f.name}`);
  process.exit(1);
}
