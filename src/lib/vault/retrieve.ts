/**
 * Vault 検索（RAG）— 書く前に「過去に何を書いたか」を引いて、書き手に渡す。
 *
 * 跳躍（過去の記事と繋がらない唐突な設定・経歴）は、書き手が過去を知らないから起きる。
 * 継続性台帳は数値と出来事しか持たないので、文脈は落ちる。ここでは note の写し
 * （data/vault/note）と日記記事の両方を文字 bigram の BM25 で引き、関係の深い記述を
 * 出典つきで数件だけ渡す。
 *
 * 埋め込みもネットワークも使わない（INV-004 の範囲で、verify やテストでも同じ答えになる）。
 * 事実の正本ではない——正本は data/canon/canon.json。ここは「矛盾させない・飛ばない」
 * ための参照。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { VAULT_CONFIG } from '../pipeline/config.js';
import { parseVaultNote } from './note.js';

export interface VaultDoc {
  id: string;
  source: 'note' | 'diary';
  date: string;
  title: string;
  url: string;
  text: string;
}

export interface VaultHit {
  doc: VaultDoc;
  score: number;
  snippet: string;
}

const STRIP = /[\s「」『』【】（）()［］[\]、。，．,.!！?？:：;；・〜~"'”“…―\-|｜/#*_>`]/g;

/** NFKC + 記号除去 + 小文字化した文字 bigram。日本語でも分かち書きが要らない。 */
export function bigrams(text: string): string[] {
  const s = text.normalize('NFKC').toLowerCase().replace(STRIP, '');
  const out: string[] = [];
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
  return out;
}

export interface VaultIndex {
  docs: VaultDoc[];
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avgLen: number;
}

export function buildIndex(docs: VaultDoc[]): VaultIndex {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const grams = bigrams(`${d.title} ${d.title} ${d.text}`);
    const m = new Map<string, number>();
    for (const g of grams) m.set(g, (m.get(g) ?? 0) + 1);
    for (const g of m.keys()) df.set(g, (df.get(g) ?? 0) + 1);
    tf.push(m);
    len.push(grams.length);
  }
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  return { docs, tf, len, df, avgLen };
}

/** 文の中で、問い合わせの bigram を最も多く含む文を抜き出す。 */
export function bestSnippet(text: string, queryGrams: Set<string>, maxChars: number): string {
  let best = '';
  let bestHits = -1;
  for (const sentence of text.split(/(?<=[。！？\n])/)) {
    const s = sentence.trim();
    // 短すぎる文と、ハッシュタグだけの行（note の末尾）は引用にならない
    if (s.length < 8 || /^#\S/.test(s)) continue;
    const hits = new Set(bigrams(s).filter((g) => queryGrams.has(g))).size;
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best.length > maxChars ? `${best.slice(0, maxChars)}…` : best;
}

/** BM25（k1=1.2, b=0.75）。スコアは問い合わせの長さで割って 0〜数程度に揃える。 */
export function searchVault(
  index: VaultIndex,
  query: string,
  opts: {
    topK?: number;
    minScore?: number;
    maxSnippetChars?: number;
    exclude?: (d: VaultDoc) => boolean;
  } = {},
): VaultHit[] {
  const topK = opts.topK ?? VAULT_CONFIG.topK;
  const minScore = opts.minScore ?? VAULT_CONFIG.minScore;
  const maxSnippet = opts.maxSnippetChars ?? VAULT_CONFIG.maxSnippetChars;
  const q = [...new Set(bigrams(query))];
  if (q.length === 0 || index.docs.length === 0) return [];
  const N = index.docs.length;
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (opts.exclude?.(index.docs[i])) continue;
    let s = 0;
    for (const g of q) {
      const f = index.tf[i].get(g);
      if (!f) continue;
      const n = index.df.get(g) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * (f * 2.2)) / (f + 1.2 * (0.25 + (0.75 * index.len[i]) / index.avgLen));
    }
    s /= q.length;
    if (s >= minScore) scored.push({ i, score: s });
  }
  scored.sort(
    (a, b) => b.score - a.score || index.docs[b.i].date.localeCompare(index.docs[a.i].date),
  );
  const qs = new Set(q);
  return scored.slice(0, topK).map(({ i, score }) => ({
    doc: index.docs[i],
    score: Math.round(score * 1000) / 1000,
    snippet: bestSnippet(index.docs[i].text, qs, maxSnippet),
  }));
}

/** 書き手に渡す「過去に書いたこと」。出典を必ず添える。 */
export function buildVaultBrief(hits: VaultHit[]): string {
  if (hits.length === 0) return '';
  return [
    '【過去に書いたこと（Vault 検索）— これと矛盾させない。急に新しい経歴・設定を足さない】',
    ...hits.map(
      (h) =>
        `  - [${h.doc.source === 'note' ? 'note' : '日記'} ${h.doc.date}]「${h.doc.title}」: ${h.snippet}${h.doc.url ? `（${h.doc.url}）` : ''}`,
    ),
  ].join('\n');
}

/** note の写し + 日記記事を読む。どちらかが無くても空で続ける。 */
export async function loadVaultDocs(rootDir: string): Promise<VaultDoc[]> {
  const docs: VaultDoc[] = [];
  const noteDir = path.join(rootDir, VAULT_CONFIG.noteDir);
  try {
    for (const f of (await fs.readdir(noteDir)).filter((f) => f.endsWith('.md'))) {
      const n = parseVaultNote(await fs.readFile(path.join(noteDir, f), 'utf-8'));
      if (n) {
        docs.push({
          id: `note:${n.key}`,
          source: 'note',
          date: n.date,
          title: n.title,
          url: n.url,
          text: n.body,
        });
      }
    }
  } catch {
    /* vault 未同期 */
  }
  const postsDir = path.join(rootDir, 'src/content/posts');
  try {
    for (const f of (await fs.readdir(postsDir)).filter((f) => /\.mdx?$/.test(f))) {
      const raw = await fs.readFile(path.join(postsDir, f), 'utf-8');
      const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!m) continue;
      const title = m[1].match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';
      const slug = f.replace(/\.mdx?$/, '');
      docs.push({
        id: `diary:${slug}`,
        source: 'diary',
        date: f.slice(0, 10),
        title,
        url: `/posts/${slug}/`,
        text: m[2],
      });
    }
  } catch {
    /* 記事が無い */
  }
  return docs;
}
