#!/usr/bin/env bun
/**
 * サムネの決定記録（data/thumbnails.json）を、記録の無い記事について埋める。
 *
 *   bun run thumbnails          # 記録の無い記事だけ決める（既存の決定は変えない）
 *
 * LLM もネットワークも使わない。描くのは auto-post の挿絵工程（illustrate.ts）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideThumbnail,
  loadThumbnailRecord,
  saveThumbnailRecord,
  upsertDecision,
} from '../src/lib/art/thumbnail.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 記事ファイル → サムネ決定の入力。auto-post と verify も使う。 */
export async function loadThumbnailInputs(rootDir = ROOT) {
  const dir = path.join(rootDir, 'src/content/posts');
  const out = [];
  for (const f of (await fs.readdir(dir)).filter((f) => /\.mdx?$/.test(f)).sort()) {
    const raw = await fs.readFile(path.join(dir, f), 'utf-8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fm) continue;
    const title = fm[1].match(/^title:\s*"?(.*?)"?\s*$/m)?.[1]?.replace(/\\"/g, '"') ?? '';
    const date = fm[1].match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1] ?? f.slice(0, 10);
    const tags = [...(fm[1].match(/^tags:\s*\[(.*)\]\s*$/m)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    out.push({ slug: f.replace(/\.mdx?$/, ''), date, title, tags, body: fm[2] });
  }
  return out;
}

export async function fillMissingDecisions(rootDir = ROOT) {
  const inputs = await loadThumbnailInputs(rootDir);
  let record = await loadThumbnailRecord(rootDir);
  const known = new Set(record.entries.map((e) => e.slug));
  let added = 0;
  for (const input of inputs.sort((a, b) => a.date.localeCompare(b.date))) {
    if (known.has(input.slug)) continue;
    record = upsertDecision(record, decideThumbnail(input, record.entries));
    added++;
  }
  if (added > 0) await saveThumbnailRecord(rootDir, record);
  return { record, added, inputs };
}

if (import.meta.main) {
  const { record, added } = await fillMissingDecisions();
  console.log(`🖼️  サムネの決定: 追加 ${added} / 記録 ${record.entries.length} 件`);
}
