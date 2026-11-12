import { describe, expect, it } from 'vitest';
import {
  chooseTheme,
  decideAll,
  decideThumbnail,
  SCENE_POOL,
  scoreThemes,
  upsertDecision,
} from '../src/lib/art/thumbnail';

describe('thumbnail — サムネ決定機構（LM-023）', () => {
  it('テーマは本文まで見て決める', () => {
    const s = scoreThemes('今日のこと', [], '瞑想をして、呼吸を整えた。瞑想は心の整理になる。');
    expect(chooseTheme(s)).toBe('瞑想・マインドフルネス');
  });

  it('禁止トピック（貯金・節約）のテーマは選ばない', () => {
    const s = scoreThemes('貯金と節約の話', ['貯金・節約'], '家計 節約 貯金');
    expect(chooseTheme(s)).not.toBe('貯金・節約');
    expect(SCENE_POOL['貯金・節約']).toBeUndefined();
  });

  it('決定論: 同じ入力なら同じ決定', () => {
    const input = {
      slug: '2026-11-13-post-a',
      date: '2026-11-13',
      title: '散歩の朝',
      tags: ['散歩'],
    };
    expect(decideThumbnail(input, [])).toEqual(decideThumbnail(input, []));
  });

  it('直近に使った情景は避ける', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({
      slug: `2026-11-0${i + 1}-post-x${i}`,
      date: `2026-11-0${i + 1}`,
      title: '散歩の日',
      tags: ['散歩'],
    }));
    const record = decideAll(inputs);
    const scenes = record.entries.map((e) => e.sceneId);
    expect(new Set(scenes).size).toBe(SCENE_POOL['散歩・日常'].length);
  });

  it('プロンプトは人物・文字を描かせない', () => {
    const d = decideThumbnail({ slug: 's', date: '2026-11-13', title: 'AIの話', tags: ['AI'] }, []);
    expect(d.prompt).toContain('no people');
    expect(d.prompt).toContain('no text');
  });

  it('upsert は同じ slug を置き換える', () => {
    const d = decideThumbnail({ slug: 's', date: '2026-11-13', title: 't' }, []);
    const r = upsertDecision(upsertDecision({ schema: 1, entries: [] }, d), { ...d, sceneId: 'x' });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].sceneId).toBe('x');
  });
});
