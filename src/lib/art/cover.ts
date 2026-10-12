/**
 * 記事ごとのカバー絵（SVG）を、決定論的に組み立てる。
 *
 * Keynote / Slidev の Magic Move を作っている人がやっていることと同じ考え方:
 * 「動きと構図はテンプレートに固定し、差し替えるのは中身だけ」。
 * ここでは構図（モチーフ）をテーマごとに 10 種だけ持ち、記事の slug から作る
 * 乱数で位置・大きさ・色の濃淡を揺らす。同じ記事なら毎回同じ絵になる。
 *
 * ビルド時に Astro がこの文字列をそのまま埋め込む。ネットワークも鍵も使わないので、
 * 失敗しようがない。AI のイラスト（illustrate.ts）が取れた記事ではそちらを優先し、
 * 取れなかった記事はこの絵で必ず埋まる。
 */

import { THEME_KEYWORDS } from '../agents/shared.js';

export type ThemeName = keyof typeof THEME_KEYWORDS;

export interface CoverInput {
  slug: string;
  title: string;
  tags?: string[];
}

export interface Palette {
  sky: string;
  ground: string;
  accent: string;
  ink: string;
}

/** テーマ → 色。サイトの基調（warm white / gentle green / lavender）から外れない淡色だけ。 */
export const PALETTES: Record<string, Palette> = {
  '貯金・節約': { sky: '#F5F1E8', ground: '#E3D9C3', accent: '#C9A86A', ink: '#6B5B3E' },
  '投資・資産形成': { sky: '#EEF3EC', ground: '#CFE0CB', accent: '#7FA877', ink: '#3F5E3A' },
  ひとり旅: { sky: '#EAF1F6', ground: '#C9DBE6', accent: '#E9A86B', ink: '#3D5A6C' },
  読書: { sky: '#F6F0E9', ground: '#E6D6C3', accent: '#B07D5B', ink: '#5A4332' },
  '瞑想・マインドフルネス': {
    sky: '#F1EEF6',
    ground: '#DCD3EA',
    accent: '#A792C9',
    ink: '#4D4166',
  },
  ジャーナリング: { sky: '#FAF6EE', ground: '#ECE2CF', accent: '#8FA9C4', ink: '#4A4A4A' },
  '散歩・日常': { sky: '#EFF5EE', ground: '#D3E4CF', accent: '#E8B96B', ink: '#4B5E47' },
  暗号資産: { sky: '#EEF0F6', ground: '#D3D8E8', accent: '#8C7BD1', ink: '#3D3F66' },
  自己成長: { sky: '#F3F6EC', ground: '#DDE7C8', accent: '#9CBF6B', ink: '#4D5E33' },
  'AI・テクノロジー': { sky: '#ECF3F4', ground: '#CFE3E6', accent: '#5FA3AE', ink: '#2F5560' },
};

const DEFAULT_THEME = '散歩・日常';

/** FNV-1a 32bit。slug → 種。 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32。種から 0〜1 の列を作る（Math.random は使わない）。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** タグを先に、無ければタイトルを見てテーマを決める。どれにも当たらなければ「散歩・日常」。 */
export function detectTheme(title: string, tags: string[] = []): string {
  for (const tag of tags) if (tag in THEME_KEYWORDS) return tag;
  const haystack = `${tags.join(' ')} ${title}`;
  let best = DEFAULT_THEME;
  let bestHits = 0;
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    const hits = keywords.filter((k) => haystack.includes(k)).length;
    if (hits > bestHits) {
      best = theme;
      bestHits = hits;
    }
  }
  return best;
}

const W = 1200;
const H = 630;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Motif = (rand: () => number, p: Palette) => string;

/** テーマごとの構図。どれも「draw」クラスの線が描かれていく動き（motion.css）に対応する。 */
const MOTIFS: Record<string, Motif> = {
  '散歩・日常': (rand, p) => {
    const sunX = r1(200 + rand() * 800);
    const path = `M0 ${r1(470 + rand() * 40)} C ${r1(300 + rand() * 100)} ${r1(400 + rand() * 60)}, ${r1(700 + rand() * 100)} ${r1(540 + rand() * 40)}, ${W} ${r1(460 + rand() * 40)}`;
    return [
      `<circle class="gv-art-float" cx="${sunX}" cy="${r1(150 + rand() * 60)}" r="${r1(48 + rand() * 20)}" fill="${p.accent}" opacity="0.85"/>`,
      `<path d="M0 ${H} L0 ${r1(430 + rand() * 40)} Q ${W / 2} ${r1(330 + rand() * 60)} ${W} ${r1(420 + rand() * 40)} L${W} ${H} Z" fill="${p.ground}"/>`,
      `<path class="gv-art-draw" d="${path}" fill="none" stroke="${p.ink}" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>`,
    ].join('');
  },
  '瞑想・マインドフルネス': (rand, p) => {
    const cx = r1(500 + rand() * 200);
    const cy = r1(280 + rand() * 60);
    const rings = Array.from({ length: 5 }, (_, i) => {
      const r = 50 + i * (38 + rand() * 10);
      return `<circle class="gv-art-draw" cx="${cx}" cy="${cy}" r="${r1(r)}" fill="none" stroke="${p.accent}" stroke-width="${r1(3 - i * 0.4)}" opacity="${r1(0.9 - i * 0.15)}"/>`;
    });
    return [
      ...rings,
      `<circle class="gv-art-pulse" cx="${cx}" cy="${cy}" r="22" fill="${p.ink}" opacity="0.7"/>`,
    ].join('');
  },
  ひとり旅: (rand, p) => {
    const horizon = r1(380 + rand() * 50);
    const mountains = Array.from({ length: 4 }, (_, i) => {
      const x = i * 320 - 60 + rand() * 80;
      const h = 120 + rand() * 120;
      return `<path d="M${r1(x)} ${horizon} L${r1(x + 200)} ${r1(horizon - h)} L${r1(x + 420)} ${horizon} Z" fill="${p.ground}" opacity="${r1(0.6 + rand() * 0.4)}"/>`;
    });
    return [
      `<circle class="gv-art-float" cx="${r1(800 + rand() * 250)}" cy="${r1(140 + rand() * 60)}" r="40" fill="${p.accent}"/>`,
      ...mountains,
      `<rect x="0" y="${horizon}" width="${W}" height="${r1(H - horizon)}" fill="${p.ground}"/>`,
      `<path class="gv-art-draw" d="M0 ${r1(horizon + 90)} L${W} ${r1(horizon + 70)}" stroke="${p.ink}" stroke-width="4" stroke-dasharray="40 24"/>`,
    ].join('');
  },
  読書: (rand, p) => {
    const books = Array.from({ length: 7 }, (_, i) => {
      const w = 60 + rand() * 40;
      const h = 200 + rand() * 120;
      const x = 260 + i * 100 + rand() * 10;
      return `<rect class="gv-art-rise" style="animation-delay:${i * 60}ms" x="${r1(x)}" y="${r1(500 - h)}" width="${r1(w)}" height="${r1(h)}" rx="6" fill="${i % 2 ? p.accent : p.ground}" stroke="${p.ink}" stroke-width="2"/>`;
    });
    return [
      `<rect x="200" y="500" width="800" height="14" rx="7" fill="${p.ink}"/>`,
      ...books,
    ].join('');
  },
  ジャーナリング: (rand, p) => {
    const lines = Array.from({ length: 7 }, (_, i) => {
      const y = 190 + i * 48;
      const len = 380 + rand() * 260;
      return `<path class="gv-art-draw" style="animation-delay:${i * 80}ms" d="M330 ${y} L${r1(330 + len)} ${y}" stroke="${i === 0 ? p.accent : p.ink}" stroke-width="${i === 0 ? 6 : 3}" stroke-linecap="round" opacity="${i === 0 ? 1 : 0.55}"/>`;
    });
    return [
      `<rect x="270" y="120" width="660" height="420" rx="18" fill="#fff" stroke="${p.ground}" stroke-width="4"/>`,
      ...lines,
    ].join('');
  },
  '投資・資産形成': (rand, p) => {
    let y = 430;
    const pts: string[] = [];
    for (let i = 0; i <= 12; i++) {
      y += (rand() - 0.62) * 50;
      y = Math.max(140, Math.min(500, y));
      pts.push(`${r1(120 + i * 80)} ${r1(y)}`);
    }
    return [
      ...Array.from(
        { length: 5 },
        (_, i) =>
          `<path d="M120 ${160 + i * 85} L1080 ${160 + i * 85}" stroke="${p.ground}" stroke-width="2"/>`,
      ),
      `<path class="gv-art-draw" d="M${pts.join(' L')}" fill="none" stroke="${p.accent}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<circle class="gv-art-pulse" cx="${pts.at(-1)?.split(' ')[0]}" cy="${pts.at(-1)?.split(' ')[1]}" r="12" fill="${p.ink}"/>`,
    ].join('');
  },
  '貯金・節約': (rand, p) => {
    const stacks = Array.from({ length: 5 }, (_, s) => {
      const n = 2 + Math.floor(rand() * 5) + s;
      return Array.from(
        { length: n },
        (_, i) =>
          `<ellipse class="gv-art-rise" style="animation-delay:${(s * 4 + i) * 40}ms" cx="${330 + s * 135}" cy="${500 - i * 26}" rx="52" ry="14" fill="${i % 2 ? p.accent : p.ground}" stroke="${p.ink}" stroke-width="2"/>`,
      ).join('');
    });
    return stacks.join('');
  },
  暗号資産: (rand, p) => {
    const hex = (cx: number, cy: number, r: number) =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`;
      }).join(' L');
    const nodes = Array.from({ length: 5 }, (_, i) => ({
      x: 200 + i * 200,
      y: 315 + (rand() - 0.5) * 160,
    }));
    return [
      `<path class="gv-art-draw" d="M${nodes.map((n) => `${n.x} ${r1(n.y)}`).join(' L')}" fill="none" stroke="${p.ink}" stroke-width="3" stroke-dasharray="8 10"/>`,
      ...nodes.map(
        (n, i) =>
          `<path class="gv-art-rise" style="animation-delay:${i * 80}ms" d="M${hex(n.x, n.y, 56)} Z" fill="${i % 2 ? p.accent : p.ground}" stroke="${p.ink}" stroke-width="2"/>`,
      ),
    ].join('');
  },
  自己成長: (rand, p) => {
    const steps = Array.from({ length: 6 }, (_, i) => {
      const h = 70 + i * 60 + rand() * 20;
      return `<rect class="gv-art-rise" style="animation-delay:${i * 70}ms" x="${240 + i * 120}" y="${r1(520 - h)}" width="100" height="${r1(h)}" rx="8" fill="${i === 5 ? p.accent : p.ground}"/>`;
    });
    return [
      ...steps,
      `<path class="gv-art-draw" d="M240 480 Q 600 ${r1(200 + rand() * 60)} 960 140" fill="none" stroke="${p.ink}" stroke-width="3" stroke-dasharray="6 10"/>`,
    ].join('');
  },
  'AI・テクノロジー': (rand, p) => {
    const nodes = Array.from({ length: 9 }, (_, i) => ({
      x: 260 + (i % 3) * 340 + (rand() - 0.5) * 80,
      y: 160 + Math.floor(i / 3) * 155 + (rand() - 0.5) * 50,
    }));
    const edges: string[] = [];
    nodes.forEach((a, i) => {
      nodes.forEach((b, j) => {
        if (j > i && rand() < 0.38) {
          edges.push(
            `<path class="gv-art-draw" d="M${r1(a.x)} ${r1(a.y)} L${r1(b.x)} ${r1(b.y)}" stroke="${p.ink}" stroke-width="2" opacity="0.45"/>`,
          );
        }
      });
    });
    return [
      ...edges,
      ...nodes.map(
        (n, i) =>
          `<circle class="${i === 4 ? 'gv-art-pulse' : 'gv-art-rise'}" cx="${r1(n.x)}" cy="${r1(n.y)}" r="${i === 4 ? 26 : 16}" fill="${i === 4 ? p.accent : p.ground}" stroke="${p.ink}" stroke-width="2"/>`,
      ),
    ].join('');
  },
};

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );
}

/**
 * カバー絵の SVG 文字列。文字は入れない（タイトルは HTML 側で出す。絵の中の文字は
 * 読み上げられず、検索にも乗らない）。代わりに `<title>` で代替テキストを持たせる。
 */
export function buildCoverSvg(input: CoverInput): string {
  const theme = detectTheme(input.title, input.tags);
  const palette = PALETTES[theme] ?? PALETTES[DEFAULT_THEME];
  const rand = seededRandom(hashString(input.slug));
  const motif = (MOTIFS[theme] ?? MOTIFS[DEFAULT_THEME])(rand, palette);
  const grain = Array.from(
    { length: 14 },
    () =>
      `<circle cx="${r1(rand() * W)}" cy="${r1(rand() * H * 0.6)}" r="${r1(1.5 + rand() * 3)}" fill="${palette.ink}" opacity="0.12"/>`,
  ).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(`「${input.title}」の挿絵（${theme}）`)}" preserveAspectRatio="xMidYMid slice">`,
    `<title>${escapeXml(`「${input.title}」の挿絵（${theme}）`)}</title>`,
    `<rect width="${W}" height="${H}" fill="${palette.sky}"/>`,
    grain,
    motif,
    '</svg>',
  ].join('');
}
