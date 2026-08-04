/**
 * Phase μ — Article → Video Brief
 *
 * The handoff from Genesis Vault to VAIZ. A published article becomes a
 * short-video brief filed as a Linear issue; VAIZ picks that issue up and
 * renders the video back onto it.
 *
 * The split of labour here mirrors the enclosure (INV-013): **the model
 * writes the content, the code decides the shape.** VE-009 returns five
 * fields and nothing else — it never produces the heading structure, the
 * target duration, the scene count, or the title prefix. Those are the
 * terms VAIZ's planner will be held to, so a model must not be able to
 * negotiate them by writing different markdown.
 *
 * Everything in this module is deterministic: no model call, no network,
 * no API key. `bun run verify` can therefore check it (INV-004).
 */

import { PIPELINE_CONFIG, VIDEO_BRIEF_CONFIG } from './config.js';
import { parsePost } from './content-lint.js';

const VB = VIDEO_BRIEF_CONFIG;

const PLACEHOLDER_PATTERNS = PIPELINE_CONFIG.qualityGate.placeholderPatterns.map(
  (p) => new RegExp(p, 'i'),
);

/** Marker embedded in every generated issue so a re-run can recognize its own work. */
export const SOURCE_MARKER_PREFIX = 'gv:source=';

// ─── Types ──────────────────────────────────────────────────────

/** The five fields VE-009 Runa produces. Everything else is rendered by code. */
export interface VideoBrief {
  video_title: string;
  theme: string;
  points: string[];
  tone: string;
  visual_direction: string;
}

/** A published article, reduced to what a brief may be built from. */
export interface ArticleSource {
  /** Post filename without extension — the site slug and the ledger key. */
  slug: string;
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  url: string;
  tags: string[];
  keywords: string[];
  description: string;
  body: string;
}

export interface BriefProblem {
  rule: string;
  message: string;
}

// ─── Parsing ────────────────────────────────────────────────────

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Read a post file into an `ArticleSource`. Returns null when the file is
 * not a usable post (no frontmatter, no title, no date) — the caller
 * should skip rather than guess.
 */
export function parseArticle(filename: string, raw: string, siteUrl: string): ArticleSource | null {
  const parsed = parsePost(raw);
  if (!parsed) return null;

  const { frontmatter, body } = parsed;
  const title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
  if (!title) return null;

  const slug = filename.replace(/\.mdx?$/, '');
  const dateMatch = slug.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;

  return {
    slug,
    title,
    date: dateMatch[1],
    url: `${siteUrl.replace(/\/+$/, '')}/posts/${slug}`,
    tags: stringArray(frontmatter.tags),
    keywords: stringArray(frontmatter.keywords),
    description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
    body: body.trim(),
  };
}

// ─── Rendering ──────────────────────────────────────────────────

export function briefTitle(brief: VideoBrief): string {
  return `${VB.titlePrefix}${brief.video_title.trim()}`;
}

export function sourceMarker(slug: string): string {
  return `<!-- ${SOURCE_MARKER_PREFIX}${slug} -->`;
}

/** Recover the source slug from an issue description written by this module. */
export function extractSourceSlug(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(new RegExp(`<!--\\s*${SOURCE_MARKER_PREFIX}([^\\s>]+?)\\s*-->`));
  return match ? match[1] : null;
}

/**
 * Render the issue body in the shape VAIZ already reads (GEN-6 / GEN-7).
 *
 * The 「想定尺」 section is written from config, never from the model: it is
 * the contract with `plan.mjs`, not an opinion about this particular video.
 */
export function renderVideoBrief(brief: VideoBrief, article: ArticleSource): string {
  const points = brief.points.map((p) => `* ${p.trim()}`).join('\n');

  return [
    `記事「${article.title}」（${article.date}）から起こした短尺動画のブリーフ。`,
    'VAIZ の video-loop がこの本文をそのまま企画素材として読む。',
    '',
    `出典: ${article.url}`,
    '',
    '## テーマ',
    '',
    brief.theme.trim(),
    '',
    '## 伝えたいこと',
    '',
    points,
    '',
    '## トーン',
    '',
    brief.tone.trim(),
    '',
    '## 想定尺',
    '',
    `${VB.minSeconds}〜${VB.maxSeconds}秒、縦型。${VB.minScenes}〜${VB.maxScenes}シーン。`,
    '',
    '## ビジュアルの方向性',
    '',
    brief.visual_direction.trim(),
    '',
    '---',
    '',
    `_この Issue は Genesis Vault の VE-009 Runa Vogel が自動生成しました（${article.slug}）。_`,
    sourceMarker(article.slug),
  ].join('\n');
}

// ─── Deterministic lint (the gate) ──────────────────────────────

/** Strip markdown/punctuation so verbatim comparison is about words, not layout. */
function normalizeForComparison(text: string): string {
  return text.replace(/[\s　*_#>`\-—…、。「」『』（）()！？!?,.]/g, '');
}

/**
 * The longest run of characters the brief shares verbatim with the article.
 *
 * Both sides are normalized first, so this measures copied *content*, not
 * copied formatting. Used to keep a paywalled body from being republished
 * into a third-party tracker under the guise of a summary.
 */
export function longestVerbatimRun(brief: string, body: string): number {
  const a = normalizeForComparison(brief);
  const b = normalizeForComparison(body);
  if (a.length === 0 || b.length === 0) return 0;

  // Binary search on run length: if no window of length n matches, no
  // longer one can either. Keeps a 2,000-char article cheap to check.
  let low = 0;
  let high = Math.min(a.length, b.length);
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    let found = false;
    for (let i = 0; i + mid <= a.length; i++) {
      if (b.includes(a.slice(i, i + mid))) {
        found = true;
        break;
      }
    }
    if (found) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Check a brief before it is filed. An empty array means it may be filed.
 *
 * This runs *before* the issue is created, and a non-empty result stops
 * the run: a bad brief filed as `agent-ready` is not a warning, it is a
 * video generated overnight from the wrong material. Fail closed.
 */
export function lintVideoBrief(brief: VideoBrief, article: ArticleSource): BriefProblem[] {
  const problems: BriefProblem[] = [];
  const add = (rule: string, message: string) => problems.push({ rule, message });

  const modelText = [brief.theme, ...brief.points, brief.tone, brief.visual_direction].join('\n');

  // 1. The prefix belongs to the renderer. A model-supplied one doubles it.
  if (brief.video_title.startsWith(VB.titlePrefix)) {
    add(
      'title_prefix',
      `video_title に「${VB.titlePrefix}」が含まれています（接頭辞はレンダラーが付けます）`,
    );
  }
  if (/[\r\n]/.test(brief.video_title)) {
    add('title_shape', 'video_title に改行が含まれています');
  }

  // 2. Unfinished generation that shipped anyway.
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(modelText) || pattern.test(brief.video_title)) {
      add('placeholder', `未完成の生成物が残っています: ${pattern.source}`);
      break;
    }
  }

  // 3. Bullets are added by the renderer; a model-supplied one nests.
  const bulleted = brief.points.filter((p) => /^\s*[*\-・]/.test(p));
  if (bulleted.length > 0) {
    add('point_bullet', `points に箇条書き記号が含まれています: "${bulleted[0]}"`);
  }

  // 4. Repeats pad the list to the required length without adding content.
  const seen = new Set(brief.points.map((p) => p.trim()));
  if (seen.size !== brief.points.length) {
    add('point_duplicate', 'points に重複した項目があります');
  }

  // 5. Theme drift. The whole point of this handoff is that the video is
  //    about the article; a brief sharing no vocabulary with it is about
  //    something else, and nothing downstream will notice.
  const anchors = [...article.tags, ...article.keywords].filter((a) => a.length >= 2);
  if (anchors.length > 0 && !anchors.some((a) => modelText.includes(a))) {
    add(
      'topic_anchor',
      `記事のタグ・キーワード（${anchors.join('・')}）が1つもブリーフに現れません（テーマがすり替わっている可能性）`,
    );
  }

  // 6. A brief is a derivation, not a copy. See VB.maxVerbatimChars.
  const run = longestVerbatimRun(modelText, article.body);
  if (run > VB.maxVerbatimChars) {
    add(
      'verbatim_copy',
      `記事本文と ${run} 文字が逐語一致しています（上限 ${VB.maxVerbatimChars}）。ブリーフは要約であって転載ではありません`,
    );
  }

  return problems;
}

// ─── Ledger ─────────────────────────────────────────────────────

export interface LedgerEntry {
  slug: string;
  issue: string;
  url: string;
  filedAt: string;
}

export interface BriefLedger {
  version: number;
  comment?: string;
  briefs: LedgerEntry[];
}

export const EMPTY_LEDGER: BriefLedger = {
  version: 1,
  comment:
    '一度 Linear に送った記事の記録。再実行で同じ記事の Issue が二重に生えるのを防ぐ（scripts/linear-video-brief.mjs）。',
  briefs: [],
};

/** Parse a ledger file. Unreadable or malformed content yields an empty ledger. */
export function parseLedger(raw: string): BriefLedger {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.briefs)) {
      return { ...EMPTY_LEDGER, briefs: [] };
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      comment: typeof parsed.comment === 'string' ? parsed.comment : EMPTY_LEDGER.comment,
      briefs: parsed.briefs.filter(
        (e: unknown): e is LedgerEntry =>
          !!e && typeof e === 'object' && typeof (e as LedgerEntry).slug === 'string',
      ),
    };
  } catch {
    return { ...EMPTY_LEDGER, briefs: [] };
  }
}

export function ledgerHas(ledger: BriefLedger, slug: string): boolean {
  return ledger.briefs.some((e) => e.slug === slug);
}

/** Append an entry, keeping the ledger free of duplicate slugs. */
export function ledgerAppend(ledger: BriefLedger, entry: LedgerEntry): BriefLedger {
  return {
    ...ledger,
    briefs: [...ledger.briefs.filter((e) => e.slug !== entry.slug), entry],
  };
}

export function renderLedger(ledger: BriefLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}
