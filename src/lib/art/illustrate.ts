/**
 * AI の挿絵 — Cloudflare Workers AI の無料枠で FLUX.1 schnell に1枚だけ描かせる。
 *
 * 鍵は Clef と同じ CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（追加の登録は無い）。
 * 1枚あたり数十 Neurons で、1日 10,000 の無料枠のごく一部。Workers の無料プランは
 * 枠を超えると課金ではなくエラーになるので、費用は発生しない。
 *
 * 失敗はすべて「描かなかった」で終わる（例外を投げない）。その記事はビルド時の
 * SVG カバー絵（cover.ts）で埋まるので、見た目が欠けることはない。
 *
 * 描かせないもの: 人物（ミナの見た目が毎回変わってしまう）、文字（読めない偽の文字になる）、
 * ロゴ・実在のブランド。プロンプトはテーマの情景だけで組み、記事の本文は渡さない。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ART_CONFIG, SELECTION_CONFIG } from '../pipeline/config.js';
import { detectTheme } from './cover.js';

/** テーマ → 情景（英語の方が FLUX の再現が安定する）。 */
export const THEME_SCENES: Record<string, string> = {
  '貯金・節約': 'a small glass jar with coins on a wooden desk by a window, morning light',
  '投資・資産形成': 'a quiet desk with a notebook showing a gentle upward line chart, potted plant',
  ひとり旅: 'an empty train window view of distant mountains and a winding river at dusk',
  読書: 'a stack of books and a cup of tea on a windowsill, soft afternoon light',
  '瞑想・マインドフルネス': 'a calm lake with concentric ripples at dawn, mist over the water',
  ジャーナリング: 'an open notebook with a fountain pen on a linen tablecloth, warm lamp light',
  '散歩・日常': 'a tree-lined path in a quiet city park in the early morning, long shadows',
  暗号資産: 'abstract glowing hexagonal tiles connected by thin lines, night sky gradient',
  自己成長: 'a young sprout growing from stone steps, sunlight from above',
  'AI・テクノロジー': 'abstract network of soft glowing nodes over a pale blue gradient, minimal',
};

const STYLE =
  'flat minimal illustration, soft pastel palette, gentle grain texture, generous negative space, ' +
  'editorial blog header, no people, no text, no letters, no logos, no watermark';

export function buildIllustrationPrompt(title: string, tags: string[] = []): string {
  const theme = detectTheme(title, tags);
  return `${THEME_SCENES[theme] ?? THEME_SCENES['散歩・日常']}, ${STYLE}`;
}

/** 画像として本物か（JPEG / PNG / WebP のマジックバイト）。壊れた本文を保存しないため。 */
export function sniffImage(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png';
  if (
    bytes.length > 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp';
  return null;
}

/** Workers AI の応答から base64 の画像を取り出す（`{result:{image}}` と `{image}` の両方）。 */
export function extractImageBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const result = (root.result && typeof root.result === 'object' ? root.result : root) as Record<
    string,
    unknown
  >;
  return typeof result.image === 'string' && result.image.length > 0 ? result.image : null;
}

/** 公開パス（`/art/<slug>.jpg`）。保存先が public/ の下なら public を外す。 */
export function publicUrlFor(slug: string, ext = 'jpg', dir = ART_CONFIG.ai.dir): string {
  const rel = dir.replace(/^public\/?/, '').replace(/\/$/, '');
  return `/${rel ? `${rel}/` : ''}${slug}.${ext}`;
}

export interface IllustrationResult {
  file: string;
  url: string;
  bytes: number;
}

/**
 * 1枚描いて `<rootDir>/<dir>/<slug>.<ext>` に保存する。既にあれば描かない（Neurons の節約）。
 * 何が起きても例外を投げず、null と notes の理由を返す。
 */
export async function generateIllustration(
  rootDir: string,
  slug: string,
  title: string,
  tags: string[],
  notes: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<IllustrationResult | null> {
  const cfg = ART_CONFIG.ai;
  if (!cfg.enabled) {
    notes.push('art.ai.enabled=false');
    return null;
  }
  if (!/^[\w-]+$/.test(slug)) {
    notes.push(`slug が不正: ${slug}`);
    return null;
  }
  const dir = path.join(rootDir, cfg.dir);
  for (const ext of ['jpg', 'png', 'webp']) {
    try {
      await fs.access(path.join(dir, `${slug}.${ext}`));
      notes.push('挿絵は既にある');
      return null;
    } catch {
      /* 無ければ描く */
    }
  }

  const account = env[SELECTION_CONFIG.jev.accountIdEnv];
  const token = env[SELECTION_CONFIG.jev.tokenEnv];
  if (!account || !token) {
    notes.push('Cloudflare の鍵が未設定（SVG のカバー絵を使う）');
    return null;
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${cfg.model}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(cfg.timeoutMs),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ prompt: buildIllustrationPrompt(title, tags), steps: cfg.steps }),
      },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      notes.push(`HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
      return null;
    }
    const b64 = extractImageBase64(await res.json());
    if (!b64) {
      notes.push('応答に画像が無い');
      return null;
    }
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const ext = sniffImage(bytes);
    if (!ext) {
      notes.push('画像として読めない応答');
      return null;
    }
    if (bytes.length > cfg.maxBytes) {
      notes.push(`大きすぎる（${bytes.length} bytes > ${cfg.maxBytes}）`);
      return null;
    }
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${slug}.${ext}`);
    await fs.writeFile(file, bytes);
    return { file, url: publicUrlFor(slug, ext), bytes: bytes.length };
  } catch (err) {
    notes.push((err as Error).message?.substring(0, 120) ?? 'unknown error');
    return null;
  }
}
