/**
 * Phase κ tests — タイトル重複チェック
 *
 * detectDuplicateTitle が投げると auto-post.mjs の try 全体が落ち、
 * 毎日テンプレート記事にフォールバックする（LM-017）。
 * ここで「投げずに判定を返す」ことを固定する。
 */
import { describe, expect, it } from 'vitest';
import { detectDuplicateTitle, type PastArticle } from '../src/lib/agents/continuity.js';

const today = new Date().toISOString().slice(0, 10);
const past: PastArticle[] = [{ title: '知らない駅で降りてみた', text: '', date: today }];

describe('detectDuplicateTitle', () => {
  it('does not throw and returns null for a fresh title', () => {
    expect(() => detectDuplicateTitle('判断だけ返すAIを手元で測った', past)).not.toThrow();
    expect(detectDuplicateTitle('判断だけ返すAIを手元で測った', past)).toBeNull();
  });

  it('flags an exact duplicate within the window', () => {
    const dup = detectDuplicateTitle('知らない駅で降りてみた！', past);
    expect(dup?.similarity).toBe(1);
  });

  it('ignores titles older than the window', () => {
    const old: PastArticle[] = [{ title: '知らない駅で降りてみた', text: '', date: '2000-01-01' }];
    expect(detectDuplicateTitle('知らない駅で降りてみた', old)).toBeNull();
  });
});
