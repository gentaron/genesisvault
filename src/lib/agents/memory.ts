/**
 * Adopted-article memory (Phase Ω) — a tiny JSONL recall store.
 *
 * 過去に採用した記事の要約・タグ・良かった型を JSONL に残し、新しいテーマから
 * タグ一致で上位3件を引く。ベクトルDBも外部APIも使わない（標準ライブラリのみ）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const MEMORY_REL_PATH = path.join('data', 'recall-memories.jsonl');

export interface ArticleMemory {
  date: string;
  title: string;
  summary: string;
  tags: string[];
  patterns: string[];
}

export interface RecallOptions {
  limit?: number;
  filePath?: string;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s・/、,，]+/g, '');
}

function queryTerms(theme: string): string[] {
  const parts = theme
    .split(/[\s・/、,，]+/)
    .map(normalize)
    .filter(Boolean);
  return [...new Set([normalize(theme), ...parts].filter(Boolean))];
}

function isMemory(value: unknown): value is ArticleMemory {
  if (!value || typeof value !== 'object') return false;
  const memory = value as Record<string, unknown>;
  return (
    typeof memory.date === 'string' &&
    typeof memory.title === 'string' &&
    typeof memory.summary === 'string' &&
    Array.isArray(memory.tags) &&
    memory.tags.every((tag) => typeof tag === 'string') &&
    Array.isArray(memory.patterns) &&
    memory.patterns.every((pattern) => typeof pattern === 'string')
  );
}

function memoryFile(rootDir: string, filePath = MEMORY_REL_PATH): string {
  return path.join(rootDir, filePath);
}

export async function loadMemories(
  rootDir: string,
  filePath = MEMORY_REL_PATH,
): Promise<ArticleMemory[]> {
  try {
    const raw = await fs.readFile(memoryFile(rootDir, filePath), 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isMemory(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Append one adopted article. Same date + title is replaced, so reruns do not duplicate. */
export async function appendMemory(
  rootDir: string,
  memory: ArticleMemory,
  filePath = MEMORY_REL_PATH,
): Promise<void> {
  const entry: ArticleMemory = {
    date: memory.date,
    title: memory.title.trim(),
    summary: memory.summary.trim(),
    tags: [...new Set(memory.tags.map((tag) => tag.trim()).filter(Boolean))],
    patterns: [...new Set(memory.patterns.map((pattern) => pattern.trim()).filter(Boolean))],
  };
  if (!entry.title) return;

  const existing = await loadMemories(rootDir, filePath);
  const kept = existing.filter((m) => !(m.date === entry.date && m.title === entry.title));
  const target = memoryFile(rootDir, filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (kept.length !== existing.length) {
    const lines = [...kept, entry].map((m) => JSON.stringify(m)).join('\n');
    await fs.writeFile(target, `${lines}\n`, 'utf-8');
    return;
  }
  await fs.appendFile(target, `${JSON.stringify(entry)}\n`, 'utf-8');
}

/** Recall memories whose tags overlap the new theme's tags. Newest wins ties. */
export async function recall_memories(
  rootDir: string,
  theme: string,
  options: RecallOptions = {},
): Promise<ArticleMemory[]> {
  const terms = queryTerms(theme);
  if (terms.length === 0) return [];

  const memories = await loadMemories(rootDir, options.filePath);
  const scored = memories
    .map((memory) => {
      const tags = new Set(memory.tags.map(normalize).filter(Boolean));
      let score = 0;
      for (const term of terms) {
        if (tags.has(term)) {
          score += 2;
        } else if ([...tags].some((tag) => tag.includes(term) || term.includes(tag))) {
          score += 1;
        }
      }
      return { memory, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.memory.date.localeCompare(a.memory.date));

  return scored.slice(0, options.limit ?? 3).map(({ memory }) => memory);
}

export const recallMemories = recall_memories;

/** Render the top memories as reference text for the CEO/Writer prompts. */
export function formatMemoryBrief(memories: ArticleMemory[]): string {
  if (memories.length === 0) return '';

  const lines = [
    `## 過去に採用した記事の記憶（上位${memories.length}件）`,
    '同じテーマ・切り口・タイトルを繰り返さないこと（重複テーマの回避）。',
    '下の「良かった型」は再利用してよい。ただし前回の内容の焼き直しにはしない。',
    '',
  ];
  for (const memory of memories) {
    lines.push(`- ${memory.date || '日付不明'}「${memory.title}」`);
    if (memory.summary) lines.push(`  要約: ${memory.summary}`);
    if (memory.tags.length > 0) lines.push(`  タグ: ${memory.tags.join(', ')}`);
    if (memory.patterns.length > 0) lines.push(`  良かった型: ${memory.patterns.join(' / ')}`);
  }
  return lines.join('\n');
}
