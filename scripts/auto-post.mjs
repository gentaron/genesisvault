/**
 * Genesis Vault — Multi-Agent AI Blog Post Generator
 *
 * 4-Agent Pipeline:
 *   VE-001  CEO Agent    … テーマ・トピック・切り口の決定
 *   VE-003  SEO Agent    … タグ・キーワード・メタディスクリプション生成
 *   VE-002  Writer Agent … 本文執筆（1,000〜2,000字、日記体）
 *   VE-006  Editor Agent … 校正・品質チェック・ペルソナ一貫性確認
 *
 * Persona: Mina Eureka Ernst — Genesis Vault の著者
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 5000;
const POSTS_DIR = path.join(ROOT_DIR, 'src', 'content', 'posts');

const MOODS = ['🌿', '💭', '📖', '✨', '🌸', '🍃', '🔥', '🌊', '🌙', '☕'];
const WEATHERS = ['☀️', '☁️', '🌧️', '🌤️', '⛅', '🌈', '❄️', '🌬️'];

// ─── Persona definition (shared across all agents) ──────────────
const PERSONA = `
あなたは「ミナ・エウレカ・エルンスト（Mina Eureka Ernst）」です。
Genesis Vault というパーソナルブログの著者で、20代後半のデジタルノマド。
テクノロジー、哲学、暗号資産、日常の美しさ、文化の交差点について
独自の視点で語る知的で好奇心旺盛な女性です。
文体は柔らかい日記調で、読者に語りかけるような親しみやすさがあります。
一人称は「わたし」、語尾は「〜だ」「〜と思う」「〜かもしれない」を混ぜます。
`;

// ─── Helpers ─────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function slugify() {
  return 'post-' + Math.random().toString(36).substring(2, 8);
}

// ─── Reference Data Extraction ──────────────────────────────────
async function extractArticleSummaries() {
  const summaries = [];
  for (const filename of ['gensnotes_1.md', 'gensnotes_2.md']) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const titleRegex = /<title>\s*<!\[CDATA\[\s*(.+?)\s*\]\]>\s*<\/title>/g;
    let match;
    while ((match = titleRegex.exec(raw)) !== null) {
      const title = match[1].trim();
      if (title && title !== 'Genesis Vault - 旧Gens Notes') {
        summaries.push(title);
      }
    }
  }
  return summaries;
}

async function extractStyleSamples(maxSamples = 3) {
  const samples = [];
  for (const filename of ['gensnotes_1.md', 'gensnotes_2.md']) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const contentRegex = /<content:encoded>\s*<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>\s*<\/content:encoded>/g;
    let match;
    while ((match = contentRegex.exec(raw)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 500);
      if (text.length > 100) samples.push(text);
    }
  }
  return pickN(samples, maxSamples);
}

async function extractArticles() {
  const articles = [];
  for (const filename of ['gensnotes_1.md', 'gensnotes_2.md']) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(raw)) !== null) {
      const item = match[1];
      const titleMatch = item.match(/<title>\s*<!\[CDATA\[\s*(.+?)\s*\]\]>\s*<\/title>/);
      const contentMatch = item.match(/<content:encoded>\s*<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>\s*<\/content:encoded>/);
      if (titleMatch && contentMatch) {
        const title = titleMatch[1].trim();
        if (title === 'Genesis Vault - 旧Gens Notes') continue;
        const text = contentMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
        if (text.length > 50) articles.push({ title, text });
      }
    }
  }
  return articles;
}

// ─── Gemini API Caller (multi-model + retry) ────────────────────
async function callGeminiWithModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const error = new Error(`Gemini API error (${res.status}): ${err.substring(0, 200)}`);
    error.status = res.status;
    throw error;
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    console.warn('  ⚠️  GEMINI_API_KEY not set');
    return null;
  }

  for (const model of MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callGeminiWithModel(model, prompt);
        if (result) return result.trim();
      } catch (err) {
        console.warn(`  ⚠️  ${model} attempt ${attempt + 1} failed: ${err.message.substring(0, 150)}`);
        if (err.status === 429 && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(`  ⏳ Retrying in ${delay / 1000}s...`);
          await sleep(delay);
          continue;
        }
        break;
      }
    }
    console.log(`  ⏭️  Skipping ${model}, trying next...`);
  }

  console.warn('  ⚠️  All Gemini models failed');
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Agent Definitions
// ═══════════════════════════════════════════════════════════════

/**
 * VE-001 CEO Agent — テーマ・トピック・切り口の決定
 */
async function agentCEO(titles, styleSamples) {
  console.log('\n🎯 [VE-001] CEO Agent: テーマ決定中…');

  const sampleTitles = pickN(titles, 10).join('\n- ');
  const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

  const prompt = `${PERSONA}

あなたは CEO Agent（VE-001）です。
Genesis Vault ブログの次の日記エントリーのテーマ・トピック・切り口を決めてください。

以下は過去の記事タイトルです：
- ${sampleTitles}

以下は過去の記事の文体サンプルです：
${sampleTexts}

今日は ${todayISO()} です。

以下の JSON 形式で出力してください（他の文は書かないで）:
{
  "theme": "大テーマ（テクノロジー、日常、文化、哲学、暗号資産、読書 のいずれか）",
  "topic": "具体的なトピック（例：朝のコーヒーとAIの共通点）",
  "angle": "切り口・ユニークな視点の説明（1〜2文）",
  "title": "日記のタイトル（魅力的で短く）",
  "mood_hint": "この記事の雰囲気（静寂、思索、平和、発見、情熱 のいずれか）"
}`;

  const raw = await callGemini(prompt);
  if (raw) {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch { /* fallback below */ }
  }

  console.log('  ⚠️  CEO Agent fallback');
  return {
    theme: pick(['テクノロジー', '日常', '文化', '哲学', '暗号資産', '読書']),
    topic: '日常の小さな発見について',
    angle: '何気ない瞬間に潜む哲学的な問いを掘り下げる',
    title: '静かな午後に考えたこと',
    mood_hint: '思索',
  };
}

/**
 * VE-003 SEO Agent — タグ・キーワード・メタディスクリプション生成
 */
async function agentSEO(ceoPlan) {
  console.log('🔍 [VE-003] SEO Agent: SEO最適化中…');

  const prompt = `${PERSONA}

あなたは SEO Agent（VE-003）です。
以下のブログ記事プランに対して、SEO に最適なタグ・キーワード・メタディスクリプションを生成してください。

記事プラン:
- テーマ: ${ceoPlan.theme}
- トピック: ${ceoPlan.topic}
- タイトル: ${ceoPlan.title}
- 切り口: ${ceoPlan.angle}

以下の JSON 形式で出力してください（他の文は書かないで）:
{
  "tags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5"],
  "keywords": ["SEOキーワード1", "SEOキーワード2", "SEOキーワード3"],
  "description": "120文字以内のメタディスクリプション。記事の内容を簡潔に魅力的に伝える文。"
}`;

  const raw = await callGemini(prompt);
  if (raw) {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch { /* fallback below */ }
  }

  console.log('  ⚠️  SEO Agent fallback');
  return {
    tags: [ceoPlan.theme, '日記', '思考'],
    keywords: [ceoPlan.theme, ceoPlan.topic],
    description: `${ceoPlan.title} — ミナ・エウレカが${ceoPlan.theme}について綴る日記。`,
  };
}

/**
 * VE-002 Writer Agent — 本文執筆（1,000〜2,000字、日記体）
 */
async function agentWriter(ceoPlan, seoData, styleSamples) {
  console.log('✍️  [VE-002] Writer Agent: 本文執筆中…');

  const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

  const prompt = `${PERSONA}

あなたは Writer Agent（VE-002）です。
以下のプランに基づいて、ミナ・エウレカ視点のブログ日記を執筆してください。

## プラン
- テーマ: ${ceoPlan.theme}
- トピック: ${ceoPlan.topic}
- タイトル: ${ceoPlan.title}
- 切り口: ${ceoPlan.angle}
- 雰囲気: ${ceoPlan.mood_hint}

## SEO キーワード（自然に織り込む）
${seoData.keywords.join(', ')}

## 過去の文体サンプル（参考スタイル）
${sampleTexts}

## 執筆ルール
1. 文字数: 1,000〜2,000字（厳守）
2. 文体: 柔らかい日記調（「です・ます」ではなく「だ・である・と思う」体）
3. 構成: 導入 → 本題（2〜3セクション）→ まとめ
4. Markdown の h2（##）でセクション分けする
5. 一人称は「わたし」
6. 具体的なエピソードや比喩を交える
7. 読者に語りかけるような温かみを持たせる
8. 本文のみ出力する（タイトルやfrontmatterは不要）`;

  const result = await callGemini(prompt);
  return result;
}

/**
 * VE-006 Editor Agent — 校正・品質チェック・ペルソナ一貫性確認
 */
async function agentEditor(ceoPlan, seoData, draft) {
  console.log('📝 [VE-006] Editor Agent: 校正・品質チェック中…');

  const prompt = `${PERSONA}

あなたは Editor Agent（VE-006）です。
以下の日記記事を校正・品質チェックしてください。

## 記事タイトル: ${ceoPlan.title}
## 期待される雰囲気: ${ceoPlan.mood_hint}

## 原稿
${draft}

## チェック項目
1. ペルソナ一貫性: ミナ・エウレカの口調・人物像と一致しているか
2. 文字数: 1,000〜2,000字に収まっているか（超過の場合は削る）
3. 誤字脱字・文法エラー
4. セクション構成が読みやすいか
5. SEOキーワード（${seoData.keywords.join(', ')}）が自然に含まれているか
6. 不自然な表現・AI っぽい言い回しの修正

## 出力ルール
- 校正済みの本文のみを出力してください
- タイトルやfrontmatterは含めないでください
- 修正理由のコメントは不要です
- Markdown形式で出力してください`;

  const result = await callGemini(prompt);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Fallback Template (API が完全に使えない場合)
// ═══════════════════════════════════════════════════════════════

const THEMES = [
  {
    category: 'テクノロジー',
    titles: ['窓辺のコーヒーと、デジタルの夜明け', 'テクノロジーと日常の交差点', 'デジタル時代に考えること'],
    tags: ['テクノロジー', '思考', 'デジタル'],
  },
  {
    category: '日常',
    titles: ['ありふれた一日の中で', '何気ない瞬間の価値', '日常に潜む小さな驚き'],
    tags: ['日常', '気づき', 'ライフスタイル'],
  },
  {
    category: '哲学',
    titles: ['散歩道で拾った哲学のかけら', '問いかけの先にあるもの', '思考の旅路'],
    tags: ['哲学', '思考', '内省'],
  },
  {
    category: '暗号資産',
    titles: ['ブロックチェーンの夢を見た夜', '分散型の未来', 'デジタル資産と社会の変化'],
    tags: ['暗号資産', 'テクノロジー', 'Web3'],
  },
  {
    category: '文化',
    titles: ['文化の交差点で考えたこと', '言葉と文化の深い関係', '異なる視点を持つということ'],
    tags: ['文化', '思考', '多様性'],
  },
  {
    category: '読書',
    titles: ['本から学んだこと', '読書という名の旅', 'ページをめくる楽しみ'],
    tags: ['読書', '日常', '学び'],
  },
];

const FALLBACK_BODIES = [
  {
    title: '窓辺のコーヒーと、デジタルの夜明け',
    theme: 'テクノロジー',
    body: `## 朝のルーティン

わたしの一日は、窓辺に座ってコーヒーを淹れるところから始まる。湯気が立ち上るカップを眺めながら、スマートフォンに並ぶ通知を眺める。この小さな画面の向こうに、世界が広がっている。

テクノロジーは、わたしたちの日常にすっかり溶け込んでいる。朝のアラーム、天気予報、ニュースフィード——意識しないうちに、わたしたちはデジタルの海を泳いでいる。

## テクノロジーと距離感

でも、時々立ち止まって考える。この便利さの中で、わたしたちは何を得て、何を手放しているのだろう。

手書きの日記を書いていた頃のことを思い出す。ペンを走らせる感触、紙の匂い。あの時間には、デジタルでは味わえない豊かさがあった。かといって、今のスピード感のある情報の流れも、わたしは嫌いではない。

大切なのは「選ぶ」ということだと思う。テクノロジーに使われるのではなく、自分の意志で使うこと。その境界線を意識し続けることが、デジタル時代を生きるわたしたちの小さな挑戦なのかもしれない。

## 今日の気づき

窓辺のコーヒーのように、自分のペースで、自分の時間を大切にすること。

明日もきっと、この窓辺でコーヒーを飲みながら、新しい一日を迎えるのだろう。そのシンプルな繰り返しが、わたしにとっては何よりの贅沢だ。`,
  },
  {
    title: '散歩道で拾った哲学のかけら',
    theme: '哲学',
    body: `## 足元に広がる世界

今日の散歩道で、小さな石ころに目が留まった。丸みを帯びたその形は、長い年月をかけて水に磨かれた証だ。ひとつの石ころが語る時間のスケールに、わたしはしばし立ち尽くした。

哲学というと大げさに聞こえるかもしれないけれど、こうした小さな気づきの積み重ねこそが、日常の中の哲学なのだと思う。

## 問いかけること

「なぜ？」と問いかけること。これは人間に与えられた特別な能力だと思う。子どもの頃は何にでも「なぜ？」と聞いていたのに、大人になるとその回数は減っていく。

でも、問いかけをやめた瞬間から、世界は色あせ始めるのかもしれない。あの石ころだって、「なぜこんな形なんだろう」と思わなければ、ただの石ころに過ぎない。

わたしはなるべく、日常の中で「なぜ」を忘れないようにしたい。それが世界を面白く保つ、わたしなりの方法だから。

## 夕暮れの哲学

帰り道、空がオレンジ色に染まっていた。美しいと感じるこの心の動きもまた、小さな哲学だ。世界は問いかける者にだけ、その秘密を見せてくれる。

明日も散歩に出よう。きっとまた、小さな哲学のかけらが落ちているはずだから。`,
  },
  {
    title: 'ブロックチェーンの夢を見た夜',
    theme: '暗号資産',
    body: `## 不思議な夢

昨夜、不思議な夢を見た。透明なブロックが空中に浮かんでいて、それぞれがチェーンで繋がっている。ブロックの中には、人々の約束や信頼が光として輝いていた。

目が覚めて、この夢のことをずっと考えている。ブロックチェーンの本質は、技術そのものではなく、「信頼」の新しい形なのだと、夢の中のわたしは理解していた気がする。

## 分散化という思想

暗号資産やブロックチェーンの世界に触れていると、「分散化」という言葉をよく耳にする。中央の管理者がいなくても、システムが機能する仕組み。

これは技術の話であると同時に、社会の話でもある。信頼を誰か一人に委ねるのではなく、ネットワーク全体で支え合う。それはまるで、村の共同体のようでもあり、とても人間的だと思う。

もちろん、理想と現実のギャップはまだ大きい。でも、その理想に向かって少しずつ進んでいるという事実が、わたしにとっては希望に感じられる。

## 未来への期待

まだまだ発展途上のこの技術が、わたしたちの暮らしをどう変えていくのか。正直なところ、わくわくしている。もちろん課題もたくさんあるけれど、新しいものが生まれる瞬間に立ち会えることの幸運を、わたしは感じている。

今夜もまた、あの透明なブロックの夢を見られるだろうか。`,
  },
];

function generateFallbackPost(articles, titles) {
  console.log('📋 テンプレートフォールバックを使用…');

  const chosen = pick(FALLBACK_BODIES);
  const theme = THEMES.find(t => t.category === chosen.theme) || THEMES[0];

  return {
    ceoPlan: {
      theme: chosen.theme,
      topic: chosen.title,
      title: chosen.title,
      angle: '日常と専門知識の交差点',
      mood_hint: '思索',
    },
    seoData: {
      tags: theme.tags,
      keywords: [chosen.theme, '日記', 'Genesis Vault'],
      description: `${chosen.title} — ミナ・エウレカが日常から見つけた気づきを綴る。`,
    },
    body: chosen.body,
  };
}

// ═══════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Genesis Vault — Multi-Agent Post Generator       ║');
  console.log('║  Persona: Mina Eureka Ernst                       ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`📅 Date: ${todayISO()}`);
  console.log('');

  // Load reference data
  console.log('📚 Loading reference data...');
  const titles = await extractArticleSummaries();
  const styleSamples = await extractStyleSamples(3);
  const articles = await extractArticles();
  console.log(`  ✅ ${titles.length} titles, ${styleSamples.length} style samples, ${articles.length} articles loaded`);

  const mood = pick(MOODS);
  const weather = pick(WEATHERS);
  const slug = slugify();
  const filename = `${todayISO()}-${slug}.md`;

  let ceoPlan, seoData, finalBody;

  try {
    // ── Agent 1: CEO ────────────────────────────────────────
    ceoPlan = await agentCEO(titles, styleSamples);
    console.log(`  ✅ テーマ: ${ceoPlan.theme}`);
    console.log(`  ✅ トピック: ${ceoPlan.topic}`);
    console.log(`  ✅ タイトル: ${ceoPlan.title}`);
    console.log('');

    // ── Agent 2: SEO ────────────────────────────────────────
    seoData = await agentSEO(ceoPlan);
    console.log(`  ✅ タグ: ${seoData.tags.join(', ')}`);
    console.log(`  ✅ キーワード: ${seoData.keywords.join(', ')}`);
    console.log(`  ✅ Description: ${seoData.description}`);
    console.log('');

    // ── Agent 3: Writer ─────────────────────────────────────
    const draft = await agentWriter(ceoPlan, seoData, styleSamples);
    if (!draft) throw new Error('Writer Agent returned empty');
    console.log(`  ✅ 原稿完成 (${draft.length}文字)`);
    console.log('');

    // ── Agent 4: Editor ─────────────────────────────────────
    const edited = await agentEditor(ceoPlan, seoData, draft);
    finalBody = edited || draft; // If editor fails, use the draft
    console.log(`  ✅ 校正完了 (${finalBody.length}文字)`);
    console.log('');

  } catch (err) {
    console.error(`❌ Agent Pipeline Error: ${err.message}`);
    console.log('📋 Falling back to template...');
    const fallback = generateFallbackPost(articles, titles);
    ceoPlan = fallback.ceoPlan;
    seoData = fallback.seoData;
    finalBody = fallback.body;
  }

  // ── Build frontmatter & save ──────────────────────────────
  const moodMap = { '静寂': '📖', '思索': '💭', '平和': '🌿', '発見': '✨', '情熱': '🔥' };
  const moodEmoji = moodMap[ceoPlan.mood_hint] || mood;
  const moodLabel = ceoPlan.mood_hint || '思索';

  // Clean finalBody: remove any accidental frontmatter or code fences
  let cleanBody = finalBody
    .replace(/^```(?:markdown|md)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
  if (cleanBody.startsWith('---')) {
    const endFm = cleanBody.indexOf('---', 3);
    if (endFm !== -1) {
      cleanBody = cleanBody.slice(endFm + 3).trim();
    }
  }

  const escapedTitle = ceoPlan.title.replace(/"/g, '\\"');
  const escapedDesc = (seoData.description || '').replace(/"/g, '\\"');

  const content = `---
title: "${escapedTitle}"
date: ${todayISO()}
mood: "${moodEmoji} ${moodLabel}"
weather: "${weather}"
tags: [${seoData.tags.map(t => `"${t}"`).join(', ')}]
description: "${escapedDesc}"
keywords: [${seoData.keywords.map(k => `"${k}"`).join(', ')}]
agents:
  ceo: "VE-001"
  seo: "VE-003"
  writer: "VE-002"
  editor: "VE-006"
---

${cleanBody}
`;

  await fs.mkdir(POSTS_DIR, { recursive: true });
  const filePath = path.join(POSTS_DIR, filename);
  await fs.writeFile(filePath, content, 'utf-8');

  console.log('═══════════════════════════════════════════════════');
  console.log('✅ 記事生成完了！');
  console.log(`📄 File: ${filePath}`);
  console.log(`📝 Title: ${ceoPlan.title}`);
  console.log(`🏷️  Tags: ${seoData.tags.join(', ')}`);
  console.log(`🔑 Keywords: ${seoData.keywords.join(', ')}`);
  console.log('');
  console.log('Agent Pipeline:');
  console.log('  VE-001 CEO Agent    → テーマ決定   ✅');
  console.log('  VE-003 SEO Agent    → SEO最適化    ✅');
  console.log('  VE-002 Writer Agent → 本文執筆     ✅');
  console.log('  VE-006 Editor Agent → 校正・品質   ✅');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
