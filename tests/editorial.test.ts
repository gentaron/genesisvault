/**
 * 編集方針ブリーフ（IDEAZ / edutext / QAIZ）とテーマ設定の整合
 * ネットワークには触らない。IDEAZ の JSON は文字列で与える。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildEditorialBrief,
  type IdeazSlot,
  parseIdeazCurrent,
  pickSlots,
} from '../src/lib/agents/editorial.js';
import { ALL_THEMES } from '../src/lib/agents/schemas.js';
import { THEME_KEYWORDS, THEMES } from '../src/lib/agents/shared.js';
import { EDITORIAL_CONFIG } from '../src/lib/pipeline/config.js';

const SLOTS: IdeazSlot[] = [
  { label: '7時枠', kind: 'open', lens: '中身が見えるようになったもの', topic: null },
  { label: '9時枠', kind: 'judgement', lens: '分類器が手元で回るようになったもの', topic: null },
  {
    label: '11時枠',
    kind: 'open',
    lens: '自分でできるようになったもの',
    topic: { title: '4Bなのに100万トークン入る', whatChanged: '長い資料をノートPCで読める' },
  },
];

describe('editorial config', () => {
  it('targets cover exactly the selectable themes', () => {
    expect(Object.keys(EDITORIAL_CONFIG.themeTargets).sort()).toEqual([...ALL_THEMES].sort());
    expect(Object.keys(THEME_KEYWORDS).sort()).toEqual([...ALL_THEMES].sort());
    expect(THEMES.map((t) => t.category).sort()).toEqual([...ALL_THEMES].sort());
  });

  it('keeps AI as the main axis (AI themes ≥ 60%)', () => {
    const ai = Object.entries(EDITORIAL_CONFIG.themeTargets)
      .filter(([t]) => t.startsWith('AI'))
      .reduce((a, [, v]) => a + v, 0);
    expect(ai).toBeGreaterThanOrEqual(0.6);
  });

  it('does not offer a theme whose core words are forbidden in the body', () => {
    // Zod が qualityGate.forbiddenTopics を落とすので、生の JSON から読む
    const raw = JSON.parse(readFileSync('config/pipeline.json', 'utf-8'));
    const forbidden: string[] = raw.qualityGate.forbiddenTopics.terms;
    for (const theme of ALL_THEMES) {
      for (const kw of THEME_KEYWORDS[theme]) expect(forbidden).not.toContain(kw);
    }
  });
});

describe('parseIdeazCurrent', () => {
  it('reads slots and topics from IDEAZ current.json', () => {
    const body = JSON.stringify({
      slots: [
        { label: 'a', kind: 'open', lens: 'L1', topic: null },
        { label: 'b', kind: 'judgement', lens: 'L2', topic: { title: 'T', whatChanged: 'W' } },
      ],
    });
    const slots = parseIdeazCurrent(body);
    expect(slots).toHaveLength(2);
    expect(slots[1].topic?.title).toBe('T');
  });

  it('returns [] on broken input instead of throwing', () => {
    expect(parseIdeazCurrent('<html>404</html>')).toEqual([]);
    expect(parseIdeazCurrent('{"slots":"x"}')).toEqual([]);
  });
});

describe('pickSlots', () => {
  it('puts the judgement slot first for 判断AI', () => {
    expect(pickSlots(SLOTS, 'AI・判断するAI', 2)[0].kind).toBe('judgement');
  });

  it('prefers slots with a decided topic for other AI themes', () => {
    const picked = pickSlots(SLOTS, 'AI・手元で動くAI', 2);
    expect(picked[0].topic?.title).toBe('4Bなのに100万トークン入る');
    expect(picked.every((s) => s.kind !== 'judgement')).toBe(true);
  });
});

describe('buildEditorialBrief', () => {
  it('gives Nova the axis and today’s angles only', () => {
    const brief = buildEditorialBrief(SLOTS, null);
    expect(brief).toContain(EDITORIAL_CONFIG.axis);
    expect(brief).toContain('IDEAZ');
    expect(brief).not.toContain('ギガポリス');
  });

  it('adds gate and lore for an AI theme, QAIZ only for 市場分析', () => {
    const ai = buildEditorialBrief(SLOTS, 'AI・手元で動くAI');
    expect(ai).toContain('書く前に埋める一文');
    expect(ai).toContain('ギガポリス');
    expect(ai).not.toContain('QAIZ');

    const market = buildEditorialBrief(SLOTS, 'AI×市場分析');
    expect(market).toContain('QAIZ');
    expect(market).toContain('投資助言にしない');
  });

  it('keeps lore but drops AI material for a life theme', () => {
    const walk = buildEditorialBrief(SLOTS, '散歩・日常');
    expect(walk).toContain('ギガポリス');
    expect(walk).not.toContain('今日の角度');
  });

  it('still produces a brief when IDEAZ could not be read', () => {
    expect(buildEditorialBrief([], 'AI・判断するAI')).toContain(EDITORIAL_CONFIG.gate);
  });
});
