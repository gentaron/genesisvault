#!/usr/bin/env bun
/**
 * 判断 AI（Clef on Workers AI）が「本当に答えるか」を、本番と同じ鍵で確かめる。
 *
 *   1. Workers AI に実在するモデル名を検索する（clef / embeddinggemma / flux）
 *   2. 設定のモデルごとに、公式の入力スキーマを取り寄せて表示する
 *   3. 本番と同じ形（buildRequestBody）で Clef に choice / noul / score を1問ずつ投げ、
 *      生の応答と、こちらの型検査（normalizeAnswers）を通った答えを並べて出す
 *   4. 選定（runJuno）と原稿審査（runClefReview）を、本番のコードのまま1回ずつ通す
 *   5. EmbeddingGemma（意味の既出チェック）を1回
 *   6. --with-image のときだけ FLUX.1 schnell を1枚（保存はしない）
 *
 * 鍵の値は出さない。Clef が型どおりに1問も答えなければ exit 1（赤くして気づかせる）。
 */

import { buildRequestBody, normalizeAnswers, resolveEndpoints } from '../src/lib/ai/jev.ts';
import { extractImageBase64, sniffImage } from '../src/lib/art/illustrate.ts';
import { runClefReview } from '../src/lib/pipeline/clef-review.ts';
import { ART_CONFIG, SELECTION_CONFIG } from '../src/lib/pipeline/config.ts';
import { runJuno } from '../src/lib/selection/select.ts';
import { embed } from '../src/lib/selection/semantic.ts';

const account = process.env[SELECTION_CONFIG.jev.accountIdEnv];
const token = process.env[SELECTION_CONFIG.jev.tokenEnv];
const withImage = process.argv.includes('--with-image');
const summary = [];
const row = (ok, name, detail) => {
  summary.push(
    `| ${ok === true ? '✅' : ok === false ? '❌' : '⚠️'} | ${name} | ${String(detail).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`,
  );
  console.log(`${ok === true ? '✅' : ok === false ? '❌' : '⚠️'} ${name}: ${detail}`);
};

async function flushSummary() {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const fs = await import('node:fs/promises');
  await fs.appendFile(
    file,
    ['## 判断 AI の実地確認', '', '| | 項目 | 結果 |', '|---|---|---|', ...summary, ''].join('\n'),
  );
}

if (!account || !token) {
  row(
    false,
    '鍵',
    `${SELECTION_CONFIG.jev.accountIdEnv} / ${SELECTION_CONFIG.jev.tokenEnv} が渡っていない`,
  );
  await flushSummary();
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/ai`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const short = (v, n = 1500) => JSON.stringify(v)?.slice(0, n);

// ── 1. 実在するモデル名 ──────────────────────────────────────────
for (const q of ['clef', 'jev', 'embeddinggemma', 'flux-1-schnell']) {
  try {
    const res = await fetch(`${base}/models/search?search=${encodeURIComponent(q)}`, { headers });
    const json = await res.json();
    const names = (json.result ?? []).map((m) => m.name);
    row(
      res.ok && names.length > 0 ? true : res.ok ? null : false,
      `モデル検索「${q}」`,
      res.ok ? names.join(', ') || '該当なし' : `HTTP ${res.status} ${short(json.errors, 200)}`,
    );
  } catch (err) {
    row(false, `モデル検索「${q}」`, err.message);
  }
}

// ── 2. 公式の入力スキーマ ────────────────────────────────────────
for (const model of SELECTION_CONFIG.jev.workersAiModels) {
  try {
    const res = await fetch(`${base}/models/schema?model=${encodeURIComponent(model)}`, {
      headers,
    });
    const json = await res.json();
    console.log(
      `\n── schema ${model} (HTTP ${res.status}) ──\n${JSON.stringify(json.result ?? json.errors, null, 1).slice(0, 4000)}\n`,
    );
    row(
      res.ok ? true : false,
      `スキーマ ${model}`,
      res.ok ? '取得（ログに全文）' : `HTTP ${res.status} ${short(json.errors, 200)}`,
    );
  } catch (err) {
    row(false, `スキーマ ${model}`, err.message);
  }
}

// ── 3. 生の呼び出し ──────────────────────────────────────────────
const questions = [
  {
    name: 'pick',
    type: 'choice',
    prompt: 'Which candidate is the better daily blog topic for an ordinary reader?',
    options: ['c01', 'c02'],
    descriptions: {
      c01: '雨の朝、駅まで遠回りして歩いた15分',
      c02: '量子重力理論の最新論文の数式を全部解説する',
    },
  },
  { name: 'is_personal', type: 'noul', prompt: 'c01 is a concrete, personal everyday scene.' },
  {
    name: 'readability',
    type: 'score',
    prompt: 'How easy is c01 to read on a phone?',
    levels: ['hard', 'somewhat hard', 'ok', 'easy', 'very easy'],
  },
];
const state =
  '日記ブログの今日の題材を選ぶ。読者はふつうの個人。\nc01: 雨の朝、駅まで遠回りして歩いた15分\nc02: 量子重力理論の最新論文の数式を全部解説する';

let anyAnswered = false;
for (const ep of resolveEndpoints(process.env)) {
  const started = Date.now();
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { ...ep.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(ep.model, state, questions)),
    });
    const text = await res.text();
    console.log(
      `\n── raw ${ep.transport}:${ep.model} HTTP ${res.status} (${Date.now() - started}ms) ──\n${text.slice(0, 3000)}\n`,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    const answers = parsed ? normalizeAnswers(parsed, questions) : {};
    const n = Object.keys(answers).length;
    if (n > 0) anyAnswered = true;
    const pick = answers.pick;
    row(
      n === questions.length ? true : n > 0 ? null : false,
      `${ep.model} 生呼び出し`,
      res.ok
        ? `型どおりの答え ${n}/${questions.length}: ${short(answers, 400)}${pick?.type === 'choice' && pick.value !== 'c01' ? '（⚠ 明らかな正解 c01 を選ばなかった）' : ''}`
        : `HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 250)}`,
    );
  } catch (err) {
    row(false, `${ep.model} 生呼び出し`, err.message);
  }
}

// ── 4. 本番のコードのまま ───────────────────────────────────────
try {
  const cand = (id, theme, hook, symbolic) => ({
    id,
    theme,
    source: 'balance',
    hook,
    why: ['smoke'],
    features: { deficit: 0.5, salience: 0.5, novelty: 0.5 },
    symbolic,
  });
  const sel = await runJuno(
    '2026-10-12',
    [
      cand('c01', '散歩・日常', '雨の朝、駅まで遠回りして歩いた15分', 0.5),
      cand('c02', 'AI・テクノロジー', '量子重力理論の論文の数式を全部解説する', 0.5),
    ],
    [],
    '',
  );
  row(
    sel?.method === 'clef' || sel?.method === 'jev' ? true : false,
    '選定 runJuno',
    sel
      ? `method=${sel.method} winner=${sel.winner.id} 確信度=${sel.confidence ?? '—'} ${sel.notes.join(' / ')}`
      : 'null',
  );
} catch (err) {
  row(false, '選定 runJuno', err.message);
}
try {
  const v = await runClefReview(
    '題材: 雨の朝に遠回りして歩いた15分',
    '雨の朝、駅まで15分遠回りした',
    '雨の朝、いつもの道をやめて、川沿いを歩いた。傘に当たる音が細かくなったところで足を止めた。15分遅れて駅に着いたけれど、頭の中は静かだった。今日あなたも、ひとつ手前の角で曲がってみてほしい。',
  );
  row(
    v.available ? true : false,
    '原稿審査 runClefReview',
    v.available
      ? `${v.passed ? '合格' : '不合格'} ${v.checks.map((c) => `${c.id}=${c.value == null ? '—' : Math.round(c.value * 100) + '%'}`).join(' ')}`
      : v.notes.join(' / '),
  );
} catch (err) {
  row(false, '原稿審査 runClefReview', err.message);
}

// ── 5. EmbeddingGemma ───────────────────────────────────────────
try {
  const notes = [];
  const vecs = await embed(['雨の朝の散歩', '雨の日に遠回りして歩いた', '量子重力理論'], notes);
  row(
    vecs ? true : false,
    'EmbeddingGemma',
    vecs ? `${vecs.length}本 × ${vecs[0]?.length}次元` : notes.join(' / '),
  );
} catch (err) {
  row(false, 'EmbeddingGemma', err.message);
}

// ── 6. FLUX.1 schnell（任意） ───────────────────────────────────
if (withImage) {
  try {
    const res = await fetch(`${base}/run/${ART_CONFIG.ai.model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'a calm lake at dawn, flat minimal illustration, no people, no text',
        steps: ART_CONFIG.ai.steps,
      }),
    });
    const json = await res.json().catch(() => null);
    const b64 = extractImageBase64(json);
    const bytes = b64 ? Buffer.from(b64, 'base64') : null;
    row(
      bytes && sniffImage(bytes) ? true : false,
      'FLUX.1 schnell',
      res.ok
        ? bytes
          ? `${sniffImage(bytes) ?? '画像ではない'} ${Math.round(bytes.length / 1024)}KB`
          : `画像なし ${short(json, 200)}`
        : `HTTP ${res.status} ${short(json?.errors, 200)}`,
    );
  } catch (err) {
    row(false, 'FLUX.1 schnell', err.message);
  }
}

await flushSummary();
if (!anyAnswered) {
  console.error('\n❌ Clef が型どおりに1問も答えなかった。上の raw とスキーマを見て直すこと。');
  process.exit(1);
}
