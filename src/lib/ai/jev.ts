/**
 * Jev（TypeSafe AI の System One Model）を「選ぶ係」として呼ぶクライアント。
 *
 * Jev は文字列を生成しない。状態（state）を読んで、こちらが先に宣言した型の
 * 質問にだけ答える。プリミティブは3つ:
 *   - choice … 宣言した選択肢（最大255）のどれか + 各選択肢の確率
 *   - score  … 0〜1 の連続値
 *   - noul   … yes/no が真である確率
 *
 * 経路は2本。上から順に試す（config の selection.jev.transports）:
 *   1. `workers-ai` — Cloudflare Workers AI の無料枠（1日 10,000 Neurons）。
 *      CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN だけで叩ける。課金は発生しない
 *      （無料枠を超えた分は Workers 無料プランでは単にエラーになる）。
 *   2. `typesafe`   — TypeSafe の直接 API（早期アクセス。鍵があるときだけ）。
 *
 * 応答は**こちらで型検査し直す**。宣言に無い選択肢・範囲外の数値・欠けた答えは
 * 「答えなし」として捨てる。Jev が「型エラーを原理的に起こさない」と主張して
 * いても、それを確かめるのは受け取る側の仕事（INV-013 と同じ考え方）。
 *
 * 公開 API の細部（ボディの名前など）は早期アクセス中に動く前提で、
 * 応答の読み取りは複数の形を受け付ける。モデル ID とベース URL は env で差し替えられる。
 * どの経路も使えなければ null を返す — 呼び出し側は記号側の順位で決める。
 */

import { SELECTION_CONFIG } from '../pipeline/config.js';

// ─── Question / answer types ────────────────────────────────────

export type JevQuestion =
  | { name: string; type: 'choice'; prompt: string; options: string[] }
  | { name: string; type: 'score'; prompt: string }
  | { name: string; type: 'noul'; prompt: string };

export type JevAnswer =
  | { type: 'choice'; value: string; probability: number; distribution: Record<string, number> }
  | { type: 'score'; value: number }
  | { type: 'noul'; probability: number };

export interface JevResult {
  transport: 'workers-ai' | 'typesafe';
  model: string;
  answers: Record<string, JevAnswer>;
  latencyMs: number;
}

export type JevTransport = 'workers-ai' | 'typesafe';

// ─── Transport config ───────────────────────────────────────────

interface Endpoint {
  transport: JevTransport;
  url: string;
  headers: Record<string, string>;
  model: string;
}

export function resolveEndpoints(env: NodeJS.ProcessEnv = process.env): Endpoint[] {
  const cfg = SELECTION_CONFIG.jev;
  const out: Endpoint[] = [];
  for (const transport of cfg.transports) {
    if (transport === 'workers-ai') {
      const account = env[cfg.accountIdEnv];
      const token = env[cfg.tokenEnv];
      if (!account || !token) continue;
      const model = env.JEV_WORKERS_AI_MODEL ?? cfg.workersAiModel;
      out.push({
        transport,
        model,
        url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`,
        headers: { Authorization: `Bearer ${token}` },
      });
    } else {
      const key = env.TYPESAFE_API_KEY;
      if (!key) continue;
      const base = (env.TYPESAFE_API_BASE_URL ?? 'https://api.typesafe.ai').replace(/\/$/, '');
      const model = env.TYPESAFE_MODEL ?? 'jev';
      out.push({
        transport,
        model,
        url: `${base}/v1/decisions`,
        headers: { Authorization: `Bearer ${key}`, 'X-Typesafe-Model': model },
      });
    }
  }
  return out;
}

export function isJevAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveEndpoints(env).length > 0;
}

// ─── Request body ───────────────────────────────────────────────

export function buildRequestBody(model: string, state: string, questions: JevQuestion[]) {
  return {
    model,
    state,
    questions: questions.map((q) =>
      q.type === 'choice'
        ? { name: q.name, type: 'choice', question: q.prompt, options: q.options }
        : { name: q.name, type: q.type, question: q.prompt },
    ),
  };
}

// ─── Response normalization ─────────────────────────────────────

type Loose = Record<string, unknown>;

function asRecord(v: unknown): Loose | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : null;
}

function prob(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  // 0-100 で返ってきても 0-1 に揃える
  const p = n > 1 && n <= 100 ? n / 100 : n;
  return p >= 0 && p <= 1 ? p : null;
}

/** 応答の中の「答えの集まり」を、名前 → 生の答え の形に揃える。 */
function collectRawAnswers(payload: unknown): Map<string, Loose> {
  const out = new Map<string, Loose>();
  const root = asRecord(payload);
  if (!root) return out;
  const body = asRecord(root.result) ?? root;
  const container = body.answers ?? body.decisions ?? body.outputs;

  if (Array.isArray(container)) {
    for (const item of container) {
      const rec = asRecord(item);
      if (rec && typeof rec.name === 'string') out.set(rec.name, rec);
    }
  } else {
    const rec = asRecord(container);
    if (rec) {
      for (const [name, value] of Object.entries(rec)) {
        const v = asRecord(value);
        out.set(name, v ?? { value });
      }
    }
  }
  return out;
}

/**
 * 生の応答を、宣言した質問の型に照らして検査する。
 * 宣言に合わない答えは載せない（＝その質問には答えなかった扱い）。
 */
export function normalizeAnswers(
  payload: unknown,
  questions: JevQuestion[],
): Record<string, JevAnswer> {
  const raw = collectRawAnswers(payload);
  const out: Record<string, JevAnswer> = {};

  for (const q of questions) {
    const a = raw.get(q.name);
    if (!a) continue;

    if (q.type === 'choice') {
      const distribution: Record<string, number> = {};
      const probs = asRecord(a.probabilities) ?? asRecord(a.distribution);
      if (probs) {
        for (const [opt, p] of Object.entries(probs)) {
          const pp = prob(p);
          if (pp != null && q.options.includes(opt)) distribution[opt] = pp;
        }
      }
      const picked = [a.choice, a.value, a.answer].find((v) => typeof v === 'string') as
        | string
        | undefined;
      let value = picked && q.options.includes(picked) ? picked : undefined;
      if (!value && Object.keys(distribution).length) {
        value = Object.entries(distribution).sort((x, y) => y[1] - x[1])[0][0];
      }
      if (!value) continue; // 宣言外の選択肢は答えとして扱わない
      const p = prob(a.probability) ?? distribution[value] ?? prob(a.confidence);
      if (p == null) continue;
      out[q.name] = { type: 'choice', value, probability: p, distribution };
    } else if (q.type === 'score') {
      const v = prob(a.score ?? a.value ?? a.answer);
      if (v != null) out[q.name] = { type: 'score', value: v };
    } else {
      const v = prob(a.probability ?? a.p ?? a.value ?? a.answer);
      if (v != null) out[q.name] = { type: 'noul', probability: v };
    }
  }
  return out;
}

// ─── Call ───────────────────────────────────────────────────────

/**
 * 経路を上から順に試し、最初に「1つ以上の質問に型どおり答えた」ものを返す。
 * 全滅なら null（例外は投げない）。理由は notes に積む。
 */
export async function askJev(
  state: string,
  questions: JevQuestion[],
  notes: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<JevResult | null> {
  const endpoints = resolveEndpoints(env);
  if (endpoints.length === 0) {
    notes.push(
      'jev: 経路の鍵が未設定（CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN か TYPESAFE_API_KEY）',
    );
    return null;
  }

  for (const ep of endpoints) {
    const started = Date.now();
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        signal: AbortSignal.timeout(SELECTION_CONFIG.jev.timeoutMs),
        headers: { ...ep.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildRequestBody(ep.model, state, questions)),
      });
      if (!res.ok) {
        notes.push(`jev(${ep.transport}): HTTP ${res.status}`);
        continue;
      }
      const answers = normalizeAnswers(await res.json(), questions);
      if (Object.keys(answers).length === 0) {
        notes.push(`jev(${ep.transport}): 型どおりの答えが1つも無かった`);
        continue;
      }
      return { transport: ep.transport, model: ep.model, answers, latencyMs: Date.now() - started };
    } catch (err) {
      notes.push(`jev(${ep.transport}): ${(err as Error).message?.substring(0, 80)}`);
    }
  }
  return null;
}
