/**
 * IDEAZ の型（memory/）と公開済み見出しを取り寄せ直す。
 *
 *   bun scripts/sync-ideaz.mjs              # GitHub の raw から
 *   bun scripts/sync-ideaz.mjs ../IDEAZ     # 手元のチェックアウトから
 *
 * 取れなかったファイルは上書きしない（写しのまま書けるように）。
 * 見出しが欠けた応答（エラーページ等）も上書きしない — 型が壊れた写しで
 * 書くより、昨日の写しで書くほうがいい。
 *
 * 公開済みの見出し（note の過去記事）は data/published-titles.json に
 * タイトルだけ落とす。テーマ選定の「既出と似すぎ」の規則が使う。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config/pipeline.json'), 'utf-8'));
const { dir, upstream } = config.format;

const FILES = {
  'canon.md': ['## 書く前に必ず埋める一文。ここが関門', '## 必ず入れるシグナル5つ'],
  'title.md': ['# タイトル'],
  'voice.md': ['## 出力の形。ここ絶対', '## 文体'],
  'forbidden.md': ['## 安全条件'],
  'winning-patterns.md': ['## いちばん強い型'],
  'exclusions.md': [],
};

const localRoot = process.argv[2] ? path.resolve(process.argv[2], 'memory') : null;

async function read(name) {
  try {
    if (localRoot) return await fs.readFile(path.join(localRoot, name), 'utf-8');
    const res = await fetch(new URL(name, upstream), { signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

let updated = 0;
let kept = 0;
for (const [name, required] of Object.entries(FILES)) {
  const text = await read(name);
  if (!text || !required.every((h) => text.includes(h))) {
    console.warn(`⚠️  ${name}: 取れないか形が違うので写しのまま`);
    kept++;
    continue;
  }
  const dest = path.join(ROOT, dir, name);
  const prev = await fs.readFile(dest, 'utf-8').catch(() => '');
  if (prev !== text) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, text, 'utf-8');
    updated++;
  }
}

const published = await read('published.json');
try {
  const db = published ? JSON.parse(published) : null;
  const titles = (db?.titles ?? [])
    .map((t) => (typeof t === 'string' ? t : t?.title))
    .filter(Boolean);
  if (titles.length > 0) {
    await fs.writeFile(
      path.join(ROOT, 'data/published-titles.json'),
      `${JSON.stringify({ syncedAt: db.syncedAt ?? null, count: titles.length, titles }, null, 2)}\n`,
      'utf-8',
    );
    console.log(`📚 公開済みの見出し ${titles.length}件`);
  }
} catch {
  console.warn('⚠️  published.json を読めませんでした（既出チェックは過去の写しで続けます）');
}

console.log(`✅ IDEAZ の型: 更新 ${updated} / 写しのまま ${kept}`);
