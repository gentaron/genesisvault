import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ArticleMemory,
  appendMemory,
  formatMemoryBrief,
  recall_memories,
} from '../src/lib/agents/memory';

let root: string;
let filePath: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-memory-'));
  filePath = path.join('data', 'recall-memories.jsonl');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('recall_memories', () => {
  it('returns the top 3 tag matches so duplicates are avoided and good patterns are reused', async () => {
    const memories: ArticleMemory[] = [
      {
        date: '2026-11-01',
        title: 'ETF積立3年目の通知表',
        summary: '積立を続けた3年間の変化を数字で振り返った。',
        tags: ['投資', '資産形成', 'ETF'],
        patterns: ['数字をタイトルに入れる'],
      },
      {
        date: '2026-11-02',
        title: '下落相場で買い増した日',
        summary: '市場が下がった日に淡々と買い増した記録。',
        tags: ['投資', '資産形成', '市場'],
        patterns: ['感情と行動を分けて書く'],
      },
      {
        date: '2026-11-03',
        title: '資産形成は朝の散歩から',
        summary: '散歩で考えた長期投資の距離感。',
        tags: ['投資', '資産形成', '散歩'],
        patterns: ['日常の出来事からテーマへ接続する'],
      },
      {
        date: '2026-11-04',
        title: '投資ノートを1冊使い切った',
        summary: '投資判断を書き残すノートの使い方。',
        tags: ['投資', '資産形成', 'ノート'],
        patterns: ['具体的な道具を主役にする'],
      },
      {
        date: '2026-11-05',
        title: '鎌倉で迷子になった午後',
        summary: '散歩の途中で道に迷った日の記録。',
        tags: ['散歩', '旅行'],
        patterns: ['場所と出来事をタイトルに入れる'],
      },
    ];
    for (const memory of memories) await appendMemory(root, memory, filePath);

    const recalled = await recall_memories(root, '投資・資産形成', { filePath });

    expect(recalled).toHaveLength(3);
    expect(recalled.map((m) => m.date)).toEqual(['2026-11-04', '2026-11-03', '2026-11-02']);
    expect(recalled.some((m) => m.title === '鎌倉で迷子になった午後')).toBe(false);

    const brief = formatMemoryBrief(recalled);
    expect(brief).toContain('重複テーマの回避');
    expect(brief).toContain('再利用');
    expect(brief).toContain('投資ノートを1冊使い切った');
    expect(brief).toContain('具体的な道具を主役にする');
  });
});
