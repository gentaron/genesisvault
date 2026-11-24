#!/usr/bin/env bun
/**
 * note.com/gensnotes → data/vault/note/*.md（Obsidian 風ノート）
 *
 *   bun run vault:sync            # 新しい記事だけ取る（増分）
 *   bun run vault:sync --full     # 全記事の本文を取り直す
 *
 * 外へ通信するので fail-soft（INV-020 と同じ作法）。取れなければ既存の vault の
 * まま終わり、終了コードは 0。`bun run verify` からは絶対に呼ばない（INV-004）。
 * 鍵は要らない（公開 API のみ）。間隔を空けて叩く（note に負荷をかけない）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  noteFileName,
  parseNoteDetail,
  parseNoteListPage,
  parseVaultNote,
  renderMoc,
  renderNoteMarkdown,
} from '../src/lib/vault/note.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = path.join(ROOT, 'data/vault');
const NOTE_DIR = path.join(VAULT, 'note');
const CREATOR = 'gensnotes';
const DELAY_MS = 350;
const MAX_PAGES = 200;
const full = process.argv.includes('--full');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'User-Agent': 'genesisvault-vault-sync' },
      });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      /* 再試行 */
    }
    await sleep(1000 * (attempt + 1));
  }
  return null;
}

async function main() {
  await fs.mkdir(NOTE_DIR, { recursive: true });
  const existing = new Map();
  for (const f of await fs.readdir(NOTE_DIR)) {
    if (!f.endsWith('.md')) continue;
    const doc = parseVaultNote(await fs.readFile(path.join(NOTE_DIR, f), 'utf-8'));
    if (doc) existing.set(doc.key, { doc, file: f });
  }
  console.log(`📚 vault: 既存 ${existing.size} ノート`);

  const listed = [];
  let knownStreak = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await getJson(
      `https://note.com/api/v2/creators/${CREATOR}/contents?kind=note&page=${page}`,
    );
    if (!json) {
      console.warn(`  ⚠️  一覧 ${page} ページ目が取れない — ここで打ち切り（fail-soft）`);
      break;
    }
    const { items, isLastPage } = parseNoteListPage(json);
    listed.push(...items);
    // 増分モード: 既知の記事が2ページぶん続いたら、それより古いページは見なくてよい
    knownStreak = items.every((i) => existing.has(i.key)) ? knownStreak + 1 : 0;
    if (isLastPage || items.length === 0 || (!full && knownStreak >= 2)) break;
    await sleep(DELAY_MS);
  }
  console.log(`  🔎 一覧から ${listed.length} 記事`);

  let written = 0;
  for (const item of listed) {
    const known = existing.get(item.key);
    if (known && !full && known.doc.title === item.title) continue;
    const detail = await getJson(`https://note.com/api/v3/notes/${item.key}`);
    const body = parseNoteDetail(detail) ?? item.excerpt;
    if (!body) continue;
    const file = noteFileName(item);
    if (known && known.file !== file) await fs.rm(path.join(NOTE_DIR, known.file), { force: true });
    await fs.writeFile(path.join(NOTE_DIR, file), renderNoteMarkdown({ ...item, body }));
    existing.set(item.key, { doc: { ...item, body }, file });
    written++;
    await sleep(DELAY_MS);
  }

  const all = [...existing.values()].map((e) => e.doc);
  const syncedAt = new Date().toISOString();
  await fs.writeFile(path.join(VAULT, 'MOC.md'), renderMoc(all, syncedAt.slice(0, 10)));
  console.log(`  ✅ 書き込み ${written} / vault 合計 ${all.length} ノート`);
}

main().catch((err) => {
  // fail-soft: 同期に失敗しても日記パイプラインは止めない
  console.warn(`⚠️  vault 同期に失敗: ${err?.message ?? err}`);
  process.exit(0);
});
