/**
 * Genesis Vault — Brief Gate
 *
 * 生成された記事が、Linear の企画指示に従っているかを採点する独立審査。
 *
 * 設計上の要点:
 *   審査は執筆と別のモデル呼び出しで行い、審査側には「仕様」と「成果物」しか渡さない。
 *   執筆時の文脈（過去記事・テーマバランス・文体サンプル）を一切見せないことで、
 *   書き手の自己評価ではなく外部からの採点になる。これが淵の条件。
 *
 * 落ちた場合は下書きを削除し、修正指示を GITHUB_OUTPUT に返す。
 * ワークフロー側がそれを次回の GV_BRIEF に足して再試行する。
 *
 * Usage:
 *   bun scripts/brief-gate.mjs
 *
 * Env:
 *   GV_THEME        (必須)  Linear のタイトル
 *   GV_BRIEF        (必須)  Linear の説明文
 *   GEMINI_API_KEY  (必須)
 *   GV_GATE_MIN     (任意)  合格ライン。既定 70
 */

import { readdir, readFile, stat, unlink, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const POSTS_DIR = 'src/content/posts';
const MIN_SCORE = Number(process.env.GV_GATE_MIN || 70);
const MODEL = 'gemini-2.5-flash';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** 今日の日付で始まる中から、最後に書かれたファイルを拾う */
async function findDraft() {
  const files = (await readdir(POSTS_DIR)).filter(
    (f) => f.startsWith(`${todayISO()}-`) && f.endsWith('.md'),
  );
  if (files.length === 0) throw new Error(`No draft found in ${POSTS_DIR}`);

  const withTime = await Promise.all(
    files.map(async (f) => ({ f, t: (await stat(join(POSTS_DIR, f))).mtimeMs })),
  );
  withTime.sort((a, b) => b.t - a.t);
  return join(POSTS_DIR, withTime[0].f);
}

async function judge(spec, article) {
  const prompt = `あなたは編集長です。以下の「企画指示」に対して「提出原稿」が従っているかを厳格に採点してください。

文章の巧拙は評価対象外です。**指示に従っているかどうかだけ**を見てください。
指示された論点が欠けている、別のテーマにすり替わっている、禁止事項を破っている——これらを見つけるのが仕事です。
原稿が読みやすいという理由で点を与えてはいけません。

# 企画指示
${spec}

# 提出原稿
${article}

# 出力
次のJSONのみを返してください。前置きもコードフェンスも不要です。

{
  "score": 0から100の整数,
  "covered": ["指示のうち実際に扱えている論点"],
  "missing": ["指示にあるのに原稿に無い論点"],
  "violations": ["禁止事項・制約への違反"],
  "drift": "テーマがすり替わっている場合、何にすり替わったかを一文で。無ければ空文字",
  "revision": "次の執筆者へ渡す修正指示を3文以内で。具体的に"
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Judge returned no content');

  const verdict = JSON.parse(text);
  if (typeof verdict.score !== 'number') throw new Error('Judge returned no score');
  return verdict;
}

async function setOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const lines = Object.entries(pairs)
    .map(([k, v]) => `${k}<<__GVEOF__\n${String(v ?? '')}\n__GVEOF__`)
    .join('\n');
  await appendFile(out, `${lines}\n`);
}

const spec = [
  process.env.GV_THEME ? `タイトル: ${process.env.GV_THEME}` : '',
  process.env.GV_BRIEF || '',
]
  .filter(Boolean)
  .join('\n\n');

if (!spec.trim()) {
  console.log('No brief supplied — gate skipped.');
  process.exit(0);
}

const path = await findDraft();
const article = await readFile(path, 'utf8');

const v = await judge(spec, article);

console.log(`\n── Brief Gate ──────────────────────────`);
console.log(`  file  : ${path}`);
console.log(`  score : ${v.score} / 100  (pass >= ${MIN_SCORE})`);
if (v.covered?.length) console.log(`  ok    : ${v.covered.join(' / ')}`);
if (v.missing?.length) console.log(`  missing   : ${v.missing.join(' / ')}`);
if (v.violations?.length) console.log(`  violations: ${v.violations.join(' / ')}`);
if (v.drift) console.log(`  drift : ${v.drift}`);
console.log(`────────────────────────────────────────\n`);

if (v.score >= MIN_SCORE) {
  console.log('Passed. The draft follows the brief.');
  await setOutput({ gate: 'pass', score: String(v.score) });
  process.exit(0);
}

// 落ちた原稿は残さない。残すと再試行時に二重に積み上がる。
await unlink(path);
console.error(`Rejected and removed: ${path}`);
console.error(v.revision || 'The draft does not follow the brief.');

await setOutput({
  gate: 'fail',
  score: String(v.score),
  revision: [
    '【前回の原稿は差し戻されました。以下を必ず反映すること】',
    v.drift ? `すり替わり: ${v.drift}` : '',
    v.missing?.length ? `欠落: ${v.missing.join(' / ')}` : '',
    v.violations?.length ? `違反: ${v.violations.join(' / ')}` : '',
    v.revision || '',
  ]
    .filter(Boolean)
    .join('\n'),
});

process.exit(1);
