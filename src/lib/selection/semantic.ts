/**
 * 意味で既出を見分ける（EmbeddingGemma on Workers AI）。
 *
 * bigram の類似度は「同じ字面」しか捕まえない。「上がり続ける週に本を読んだ」と
 * 「連騰中に読書した」は字面が違うので、bigram では別物になる。候補と既出の見出しを
 * Google の EmbeddingGemma（`@cf/google/embeddinggemma-300m`、Workers AI の無料枠）で
 * ベクトルにして、コサイン類似度で「言い換えの被り」を拾う。
 *
 * これは記号側の**補助**。埋め込みが取れない日（鍵が無い・無料枠切れ・ネットワーク）は
 * null を返し、記号側は bigram だけで続ける（fail-soft）。結果は決定論ではないので、
 * 「落とす」判断の閾値は config に置き、記録にも残す。
 */

import { SELECTION_CONFIG } from '../pipeline/config.js';

export interface SemanticHit {
  /** 候補ごとの、既出見出しとの最大コサイン類似度（0〜1）。 */
  similarity: number;
  nearest: string;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Workers AI の応答（`{ result: { shape, data } }` / `{ data }`）からベクトル列を取り出す。 */
export function parseEmbeddings(payload: unknown, expected: number): number[][] | null {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const body = (root?.result && typeof root.result === 'object' ? root.result : root) as Record<
    string,
    unknown
  > | null;
  const data = body?.data;
  if (!Array.isArray(data) || data.length !== expected) return null;
  if (
    !data.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number'))
  ) {
    return null;
  }
  return data as number[][];
}

export async function embed(
  texts: string[],
  notes: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number[][] | null> {
  const cfg = SELECTION_CONFIG;
  const account = env[cfg.jev.accountIdEnv];
  const token = env[cfg.jev.tokenEnv];
  if (!account || !token) {
    notes.push('embed: Cloudflare の鍵が未設定（意味での既出チェックは省略）');
    return null;
  }
  const out: number[][] = [];
  // 1回の要求を小さく保つ（入力上限と、失敗したときに失うぶんを小さくするため）
  for (let i = 0; i < texts.length; i += cfg.semantic.batchSize) {
    const batch = texts.slice(i, i + cfg.semantic.batchSize);
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${cfg.semantic.model}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(cfg.jev.timeoutMs),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: batch }),
        },
      );
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        notes.push(`embed(${cfg.semantic.model}): HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
        return null;
      }
      const vectors = parseEmbeddings(await res.json(), batch.length);
      if (!vectors) {
        notes.push(`embed(${cfg.semantic.model}): 応答の形が想定と違う`);
        return null;
      }
      out.push(...vectors);
    } catch (err) {
      notes.push(`embed(${cfg.semantic.model}): ${(err as Error).message?.substring(0, 80)}`);
      return null;
    }
  }
  return out;
}

/**
 * 候補ごとに、既出見出しのうち意味がいちばん近いものを返す。
 * 既出は新しい順に `maxPastTitles` 件まで（無料枠の Neurons を食べすぎないため）。
 */
export async function semanticNearest(
  candidates: { id: string; hook: string }[],
  pastTitles: string[],
  notes: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, SemanticHit> | null> {
  const cfg = SELECTION_CONFIG.semantic;
  if (!cfg.enabled || candidates.length === 0 || pastTitles.length === 0) return null;
  const past = [...new Set(pastTitles)].slice(0, cfg.maxPastTitles);
  const vectors = await embed([...candidates.map((c) => c.hook), ...past], notes, env);
  if (!vectors) return null;
  const candVecs = vectors.slice(0, candidates.length);
  const pastVecs = vectors.slice(candidates.length);
  const out: Record<string, SemanticHit> = {};
  candidates.forEach((c, i) => {
    let best = 0;
    let nearest = '';
    pastVecs.forEach((v, j) => {
      const s = cosine(candVecs[i], v);
      if (s > best) {
        best = s;
        nearest = past[j];
      }
    });
    out[c.id] = { similarity: Math.round(best * 1000) / 1000, nearest };
  });
  return out;
}
