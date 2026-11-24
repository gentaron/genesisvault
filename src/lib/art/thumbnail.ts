/**
 * サムネ決定機構 — 記事ごとに「どのテーマの、どの情景か」を決定論で決め、記録する。
 *
 * 以前は挿絵のプロンプトがテーマごとに1つしかなく、テーマもタグとタイトルだけで決めていた。
 * そのため散歩の記事は毎回まったく同じ絵になり、禁止トピックの「貯金・節約」の情景も
 * 残っていた。しかも Cloudflare の鍵がある日に新しい記事を1枚描くだけで、描けなかった
 * 記事は二度と描かれなかった（179記事中30枚、LM-023）。
 *
 * ここで決めること:
 *   1. テーマ — タグ（重み3）・タイトル（重み2）・本文（重み1、上限あり）の得点で決める
 *   2. 情景 — テーマごとに複数の情景を持ち、直近 avoidRepeatDays 日に使った情景を避ける
 *   3. 記録 — `data/thumbnails.json` に1記事1件。SVG のカバー絵もこの記録のテーマを使うので、
 *      AI の挿絵と SVG でテーマが食い違わない
 *
 * LLM もネットワークも使わない。描く（illustrate.ts）のは別の仕事で、描けなくても
 * 決定は残り、SVG が必ず出る。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { THEME_KEYWORDS } from '../agents/shared.js';
import { ART_CONFIG } from '../pipeline/config.js';
import { hashString } from './cover.js';

/** 生成しないテーマ（AGENTS.md §13.5）。サムネでも選ばない。 */
const RETIRED_THEMES: Record<string, string> = { '貯金・節約': '投資・資産形成' };
const DEFAULT_THEME = '散歩・日常';

/** テーマ → 情景の候補。英語の方が FLUX の再現が安定する。人物・文字は描かせない。 */
export const SCENE_POOL: Record<string, { id: string; scene: string }[]> = {
  '投資・資産形成': [
    {
      id: 'desk-chart',
      scene: 'a quiet desk with a notebook showing a gentle upward line chart, potted plant',
    },
    {
      id: 'globe-tiles',
      scene:
        'a small desk globe beside neatly stacked colored tiles of different heights, morning light',
    },
    {
      id: 'gold-cash-shelf',
      scene:
        'a wooden shelf holding a tiny gold bar, folded banknotes of several currencies and a seedling, soft light',
    },
    {
      id: 'balance-stones',
      scene: 'smooth stones balanced in a calm stack on a windowsill, city skyline blurred behind',
    },
  ],
  ひとり旅: [
    {
      id: 'train-window',
      scene: 'an empty train window view of distant mountains and a winding river at dusk',
    },
    {
      id: 'harbor-morning',
      scene: 'a quiet harbor at sunrise with small boats and soft reflections',
    },
    { id: 'old-street', scene: 'an empty old stone street with lanterns at twilight' },
  ],
  読書: [
    {
      id: 'tea-books',
      scene: 'a stack of books and a cup of tea on a windowsill, soft afternoon light',
    },
    {
      id: 'library-corner',
      scene: 'a cozy library corner with an armchair and warm reading lamp, rain on the window',
    },
    {
      id: 'open-book-garden',
      scene: 'an open book resting on a garden bench under dappled leaves',
    },
  ],
  '瞑想・マインドフルネス': [
    {
      id: 'lake-ripples',
      scene: 'a calm lake with concentric ripples at dawn, mist over the water',
    },
    { id: 'zen-sand', scene: 'raked sand garden with three stones, early morning shadows' },
    {
      id: 'candle-breath',
      scene: 'a single candle flame in a dim minimal room, steam rising from a cup',
    },
    { id: 'forest-light', scene: 'sunbeams through tall trees in a quiet forest clearing' },
  ],
  ジャーナリング: [
    {
      id: 'notebook-pen',
      scene: 'an open notebook with a fountain pen on a linen tablecloth, warm lamp light',
    },
    {
      id: 'night-desk',
      scene: 'a desk by a night window with a notebook, a small plant and city lights',
    },
    { id: 'cafe-notes', scene: 'a cafe table with a notebook, a latte and morning sunlight' },
  ],
  '散歩・日常': [
    {
      id: 'park-path',
      scene: 'a tree-lined path in a quiet city park in the early morning, long shadows',
    },
    { id: 'riverside', scene: 'a riverside walkway at golden hour with soft clouds' },
    {
      id: 'autumn-alley',
      scene: 'a narrow alley with autumn leaves and a bicycle leaning on a wall',
    },
    {
      id: 'rain-crosswalk',
      scene: 'a quiet crosswalk after rain with puddles reflecting streetlights',
    },
    { id: 'hill-view', scene: 'a gentle hilltop bench overlooking a calm town at dawn' },
  ],
  暗号資産: [
    {
      id: 'hex-tiles',
      scene: 'abstract glowing hexagonal tiles connected by thin lines, night sky gradient',
    },
    {
      id: 'chain-links',
      scene: 'translucent glass chain links floating over a soft violet gradient',
    },
    {
      id: 'node-constellation',
      scene: 'a constellation of small luminous nodes forming a loose lattice, minimal',
    },
  ],
  自己成長: [
    { id: 'sprout-steps', scene: 'a young sprout growing from stone steps, sunlight from above' },
    {
      id: 'mountain-trail',
      scene: 'a winding mountain trail rising toward a bright summit, clear sky',
    },
    { id: 'ladder-sky', scene: 'a simple wooden ladder leaning against a wall under an open sky' },
  ],
  'AI・テクノロジー': [
    {
      id: 'soft-network',
      scene: 'abstract network of soft glowing nodes over a pale blue gradient, minimal',
    },
    {
      id: 'circuit-garden',
      scene: 'a circuit board pattern blending into plant leaves, soft green light',
    },
    {
      id: 'terminal-window',
      scene:
        'a minimal laptop on a desk by a window, abstract light patterns on the screen, no text',
    },
    {
      id: 'data-waves',
      scene: 'flowing translucent waves of light particles over a dark teal gradient',
    },
  ],
};

const STYLE =
  'flat minimal illustration, soft pastel palette, gentle grain texture, generous negative space, ' +
  'editorial blog header, no people, no text, no letters, no logos, no watermark';

export interface ThumbnailInput {
  slug: string;
  date: string;
  title: string;
  tags?: string[];
  body?: string;
}

export interface ThumbnailDecision {
  slug: string;
  date: string;
  theme: string;
  sceneId: string;
  prompt: string;
  /** 決めた理由（得点）。監査用。 */
  scores: Record<string, number>;
}

export interface ThumbnailRecord {
  schema: 1;
  entries: ThumbnailDecision[];
}

/** タグ3・タイトル2・本文1（1テーマあたり本文は最大6点）で得点を付ける。 */
export function scoreThemes(title: string, tags: string[] = [], body = ''): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    const target = RETIRED_THEMES[theme] ?? theme;
    let s = 0;
    if (tags.includes(theme)) s += 6;
    for (const k of keywords) {
      if (tags.some((t) => t.includes(k))) s += 3;
      if (title.includes(k)) s += 2;
    }
    let bodyHits = 0;
    for (const k of keywords) bodyHits += Math.min(body.split(k).length - 1, 3);
    s += Math.min(bodyHits, 6);
    if (s > 0) scores[target] = (scores[target] ?? 0) + s;
  }
  return scores;
}

export function chooseTheme(scores: Record<string, number>): string {
  let best = DEFAULT_THEME;
  let bestScore = 0;
  // 同点ならキー順（決定論）。SCENE_POOL に無いテーマは選ばない。
  for (const theme of Object.keys(SCENE_POOL)) {
    const s = scores[theme] ?? 0;
    if (s > bestScore) {
      best = theme;
      bestScore = s;
    }
  }
  return best;
}

const DAY = 86_400_000;

/** 記事1本ぶんの決定。history は過去の決定（同じ slug は無視）。 */
export function decideThumbnail(
  input: ThumbnailInput,
  history: ThumbnailDecision[],
  avoidRepeatDays = ART_CONFIG.thumbnail.avoidRepeatDays,
): ThumbnailDecision {
  const scores = scoreThemes(input.title, input.tags ?? [], input.body ?? '');
  const theme = chooseTheme(scores);
  const pool = SCENE_POOL[theme];
  const t0 = Date.parse(`${input.date}T00:00:00Z`);
  const recent = history.filter((h) => {
    const t = Date.parse(`${h.date}T00:00:00Z`);
    return (
      h.slug !== input.slug && Number.isFinite(t) && t <= t0 && t0 - t <= avoidRepeatDays * DAY
    );
  });
  const usedRecently = new Set(recent.filter((h) => h.theme === theme).map((h) => h.sceneId));
  const fresh = pool.filter((p) => !usedRecently.has(p.id));
  let pick: { id: string; scene: string };
  if (fresh.length > 0) {
    pick = fresh[hashString(input.slug) % fresh.length];
  } else {
    // 全部使っていたら、最後に使ったのが一番古い情景
    const lastUsed = (id: string) =>
      Math.max(...history.filter((h) => h.sceneId === id).map((h) => Date.parse(h.date)), 0);
    pick = [...pool].sort((a, b) => lastUsed(a.id) - lastUsed(b.id) || a.id.localeCompare(b.id))[0];
  }
  return {
    slug: input.slug,
    date: input.date,
    theme,
    sceneId: pick.id,
    prompt: `${pick.scene}, ${STYLE}`,
    scores,
  };
}

export function recordPath(rootDir: string): string {
  return path.join(rootDir, ART_CONFIG.thumbnail.recordFile);
}

export async function loadThumbnailRecord(rootDir: string): Promise<ThumbnailRecord> {
  try {
    const raw = JSON.parse(await fs.readFile(recordPath(rootDir), 'utf-8'));
    if (raw?.schema === 1 && Array.isArray(raw.entries)) return raw as ThumbnailRecord;
  } catch {
    /* 無ければ空から */
  }
  return { schema: 1, entries: [] };
}

/** 決定を記録に入れる（同じ slug は置き換え）。日付順に並べて保存する。 */
export function upsertDecision(record: ThumbnailRecord, d: ThumbnailDecision): ThumbnailRecord {
  const entries = record.entries.filter((e) => e.slug !== d.slug);
  entries.push(d);
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  return { schema: 1, entries };
}

export async function saveThumbnailRecord(rootDir: string, record: ThumbnailRecord): Promise<void> {
  const file = recordPath(rootDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
}

/** 記事を日付順に流して、全記事ぶんの決定を作り直す（決定論・バックフィル用）。 */
export function decideAll(inputs: ThumbnailInput[]): ThumbnailRecord {
  let record: ThumbnailRecord = { schema: 1, entries: [] };
  const sorted = [...inputs].sort(
    (a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug),
  );
  for (const input of sorted)
    record = upsertDecision(record, decideThumbnail(input, record.entries));
  return record;
}
