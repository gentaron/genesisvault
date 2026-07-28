#!/usr/bin/env bun
/**
 * Phase κ — Regenerate docs/almanac/INDEX.md
 *
 * Memory only works if it is findable. This walks `docs/adr/` and
 * `docs/runbooks/`, reads each document's title/status/date, and writes a
 * single index so a newcomer (human or agent) has one page to start from.
 *
 * The index is derived — never hand-edited. `bun run verify` fails if the
 * committed INDEX.md has drifted from what this script would produce, so
 * a new ADR cannot land without appearing in the index.
 *
 *   bun run almanac
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(rootDir, 'docs');
const target = path.join(docsDir, 'almanac', 'INDEX.md');

/** Pull the first Markdown H1 as the title. */
function extractTitle(content, fallback) {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return match ? match[1].trim() : fallback;
}

/** Pull a `**Status**: x` / `## Status\nx` style field, tolerating the repo's several formats. */
function extractField(content, label) {
  const inline = content.match(new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*(.+)`, 'i'));
  if (inline) return inline[1].trim().replace(/\s*\|.*$/, '');

  const bare = content.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  if (bare) return bare[1].trim();

  const heading = content.match(new RegExp(`^##\\s*${label}\\s*\\n+(.+)$`, 'im'));
  if (heading) return heading[1].trim();

  return '—';
}

/** ADR number from a filename like `0014-tiered-agent-routing.md`. */
function adrNumber(filename) {
  const match = filename.match(/^(\d{4})-/);
  return match ? match[1] : null;
}

async function collect(dir) {
  const entries = (await readdir(path.join(docsDir, dir))).filter((f) => f.endsWith('.md')).sort();
  const docs = [];
  for (const filename of entries) {
    const content = await readFile(path.join(docsDir, dir, filename), 'utf-8');
    docs.push({
      filename,
      title: extractTitle(content, filename),
      status: extractField(content, 'Status'),
      date: extractField(content, 'Date'),
    });
  }
  return docs;
}

/** Duplicate ADR numbers are a real failure mode — see LM-001. */
export function findDuplicateAdrNumbers(filenames) {
  const seen = new Map();
  for (const filename of filenames) {
    const num = adrNumber(filename);
    if (!num) continue;
    seen.set(num, [...(seen.get(num) ?? []), filename]);
  }
  return [...seen.entries()].filter(([, files]) => files.length > 1);
}

export async function renderIndex() {
  const adrs = await collect('adr');
  const runbooks = await collect('runbooks');

  const lines = [
    '<!-- 自動生成ファイル。手で編集しないこと。再生成: `bun run almanac` -->',
    '',
    '# INDEX — ADR と Runbook',
    '',
    'このリポジトリで「なぜそうなっているか」を探すときの入口。',
    '設計判断は ADR、壊れたときの手順は Runbook にある。',
    '',
    `## ADR — 設計判断の記録（${adrs.length}件）`,
    '',
    '不可逆な決定と、その理由。新しい ADR は次の番号を使うこと（番号の重複は `bun run verify` で失敗する）。',
    '',
    '| # | タイトル | Status | Date |',
    '|---|---------|--------|------|',
  ];

  for (const doc of adrs) {
    const num = adrNumber(doc.filename) ?? '—';
    lines.push(`| ${num} | [${doc.title}](../adr/${doc.filename}) | ${doc.status} | ${doc.date} |`);
  }

  lines.push(
    '',
    `## Runbook — 手順書（${runbooks.length}件）`,
    '',
    '壊れたとき・運用するときに読むもの。',
    '',
    '| 手順書 | Status |',
    '|--------|--------|',
  );

  for (const doc of runbooks) {
    lines.push(`| [${doc.title}](../runbooks/${doc.filename}) | ${doc.status} |`);
  }

  lines.push(
    '',
    '## その他の記憶',
    '',
    '| ファイル | 中身 |',
    '|---------|------|',
    '| [INVARIANTS.md](./INVARIANTS.md) | 壊してはいけない前提と、その守り方 |',
    '| [LANDMINES.md](./LANDMINES.md) | 一度踏んだ罠と回避策 |',
    '| [../lore-tech-mapping.md](../lore-tech-mapping.md) | 世界観と実装の対応 |',
    '| [../budgets.md](../budgets.md) | 無料枠の予算管理 |',
    '| [../security.md](../security.md) | セキュリティ方針 |',
    '',
  );

  return lines.join('\n');
}

if (import.meta.main) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(target, await renderIndex(), 'utf-8');
  console.log('✅ docs/almanac/INDEX.md を再生成しました');
}
