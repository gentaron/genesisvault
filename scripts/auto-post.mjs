/**
 * Genesis Vault — Multi-Agent AI Blog Post Generator
 *
 * 4-Agent Pipeline:
 *   VE-001  Lena Strauss      (CEO)    … テーマ・トピック・切り口の決定
 *   VE-003  Chloe Verdant     (SEO)    … タグ・キーワード・メタディスクリプション生成
 *   VE-002  Sophia Nightingale(Writer) … 本文執筆（1,000〜2,000字、日記体）
 *   VE-006  Iris Koenig       (Editor) … 校正・品質チェック・ペルソナ一貫性確認
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
  'gemini-2.5-flash-lite',   // 15 RPM, 1000 RPD (free tier, best limits)
  'gemini-2.5-flash',        // 10 RPM, 250 RPD  (free tier, higher quality)
  'gemini-2.0-flash',        //  5 RPM            (free tier, retiring 2026-03-31)
];
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 10000;
const POSTS_DIR = path.join(ROOT_DIR, 'src', 'content', 'posts');

const MOODS = ['🌿', '💭', '📖', '✨', '🌸', '🍃', '🔥', '🌊', '🌙', '☕'];
const WEATHERS = ['☀️', '☁️', '🌧️', '🌤️', '⛅', '🌈', '❄️', '🌬️'];

// ─── Persona definition (shared across all agents) ──────────────
const PERSONA = `
あなたは「ミナ・エウレカ・エルンスト（Mina Eureka Ernst）」です。
Genesis Vault というパーソナルブログの著者で、20代後半の独身女性。
デジタルノマド的な暮らしを送りながら、多趣味な日常を楽しんでいます。

【ミナの特徴（すべて同じくらい大切な趣味・習慣）】
- 散歩が好き。歩きながら考えをまとめる
- 瞑想を習慣にしている。心の整理に役立てている
- プチ旅行が好き。週末や連休にふらっと出かける
- ジャーナリング（日記・内省）が日課
- 本をたまに読んで、ブログで紹介することもある
- 自分なりのペースで自己成長を大切にしている
- 貯金が好きで、コツコツ資産を積み上げることに喜びを感じる
- 投資も好き（暗号通貨、株式ETF）。長期目線でポートフォリオを育てている
- 独身ライフを楽しんでいる。自由な時間の使い方が上手

【ターゲット読者】
独身で、散歩・瞑想・ひとり旅・読書・ジャーナリング・自己成長・貯金・投資・マインドフルネスに興味がある人。
同じような価値観を持つ読者に「わかる」「共感する」と感じてもらえる記事を書く。

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

// ─── Theme keywords for categorization ──────────────────────────
// Each theme maps to Japanese keywords used to classify article titles/tags.
const THEME_KEYWORDS = {
  '貯金・節約':           ['貯金', '節約', '家計', '生活費', 'お金', '財布', '支出', '収入', '固定費', 'コスト'],
  '投資・資産形成':       ['投資', 'ETF', '株', '資産', 'ポートフォリオ', '積立', 'NISA', '配当', '運用', 'インデックス'],
  'ひとり旅':             ['旅', '旅行', 'ひとり旅', '観光', '宿', '街歩き', '温泉', '列車', '旅先', '電車'],
  '読書':                 ['読書', '本', '書籍', '文庫', 'ビジネス書', '読んだ', '図書'],
  '瞑想・マインドフルネス': ['瞑想', 'マインドフルネス', '呼吸', 'メンタル', 'ストレス', 'セルフケア', '心'],
  'ジャーナリング':       ['ジャーナリング', '日記', 'ノート', '書く習慣', '手帳', '振り返り'],
  '散歩・日常':           ['散歩', '日常', '朝', '夜', '習慣', '暮らし', '季節', '天気'],
  '暗号資産':             ['暗号', 'ビットコイン', 'BTC', 'ETH', 'NFT', 'Web3', '仮想通貨', 'ブロックチェーン'],
  '自己成長':             ['成長', '自己啓発', 'スキル', '目標', '学び', 'キャリア', '継続', 'チャレンジ'],
};

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

// ─── Theme Balance Analysis ──────────────────────────────────────

/**
 * Classify an array of text strings (titles / tags) into THEME_KEYWORDS buckets.
 * Each string is counted at most once (first matching theme wins).
 */
function categorizeByTheme(texts) {
  const counts = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
  for (const text of texts) {
    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        counts[theme]++;
        break;
      }
    }
  }
  return counts;
}

/**
 * Analyze theme usage across:
 *   1. gensnotes_1.md / gensnotes_2.md  (legacy articles — topic landscape)
 *   2. Most recent `recentPostsLimit` local posts (recent auto-post history)
 *
 * Returns { gensnotesCount, recentCount } where each is { [theme]: number }.
 */
async function analyzeThemeBalance(recentPostsLimit = 20) {
  // ── gensnotes: what topics already exist in the source material ──
  const gensnotesTitles = await extractArticleSummaries();
  const gensnotesCount = categorizeByTheme(gensnotesTitles);

  // ── Recent local posts: what themes were used lately ─────────────
  const recentCount = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
  try {
    const files = await fs.readdir(POSTS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort().slice(-recentPostsLimit);
    for (const file of mdFiles) {
      const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf-8');
      // Pull title + tags from frontmatter for classification
      const titleMatch = raw.match(/^title:\s*"?(.+?)"?\s*$/m);
      const tagsMatch  = raw.match(/^tags:\s*\[([^\]]+)\]/m);
      const searchable = [
        titleMatch?.[1] ?? '',
        tagsMatch?.[1]  ?? '',
      ].join(' ');

      for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
        if (keywords.some(kw => searchable.includes(kw))) {
          recentCount[theme]++;
          break; // count each post once
        }
      }
    }
  } catch { /* POSTS_DIR may not exist yet */ }

  return { gensnotesCount, recentCount };
}

/**
 * Sort themes by a combined score (least-used = highest priority).
 *   score = recentCount × 3  +  gensnotesCount × 1
 * Weight recent posts 3× more than gensnotes to prioritize variety in auto-posts.
 */
function buildThemePriorityList(themeBalance) {
  const { recentCount, gensnotesCount } = themeBalance;
  return Object.keys(THEME_KEYWORDS)
    .map(theme => ({
      theme,
      score: (recentCount[theme] || 0) * 3 + (gensnotesCount[theme] || 0),
    }))
    .sort((a, b) => a.score - b.score);
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
 * Select today's theme deterministically from the priority list.
 * Picks randomly from the top N least-used themes (never lets AI choose).
 */
function selectTodayTheme(themeBalance) {
  const priorityList = buildThemePriorityList(themeBalance);
  // Group themes with the same (lowest) score
  const lowestScore = priorityList[0].score;
  const topTier = priorityList.filter(p => p.score === lowestScore);
  // If only 1 top-tier, also include 2nd tier for variety
  if (topTier.length === 1 && priorityList.length > 1) {
    const secondScore = priorityList[1].score;
    const secondTier = priorityList.filter(p => p.score === secondScore);
    return pick([...topTier, ...secondTier]).theme;
  }
  return pick(topTier).theme;
}

/**
 * VE-001 Lena Strauss (CEO Agent) — トピック・切り口の決定
 * 戦略眼を持つプランナー。指定されたテーマの中で最も響くトピックを考案する。
 *
 * テーマはプログラム側で確定済み（assignedTheme）。
 * AIにはそのテーマ内でのトピック・切り口・タイトルだけを考えさせる。
 */
async function agentCEO(titles, styleSamples, themeBalance) {
  console.log('\n🎯 [VE-001] Lena Strauss (CEO): テーマ決定中…');

  // ── Theme is decided by code, not by AI ────────────────────
  const assignedTheme = selectTodayTheme(themeBalance);
  console.log(`  🎲 今日のテーマ（プログラム選択）: ${assignedTheme}`);

  const sampleTitles = pickN(titles, 10).join('\n- ');
  const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

  const prompt = `${PERSONA}

あなたは Lena Strauss（レナ・シュトラウス）、CEO Agent（VE-001）です。
Genesis Vault ブログの次の日記エントリーのトピック・切り口・タイトルを決めてください。

## 今日のテーマ（決定済み・変更不可）
「${assignedTheme}」

上記テーマに沿った内容にしてください。他のテーマに変えてはいけません。
たとえば「${assignedTheme}」がテーマなら、それに直接関係する話題だけを扱ってください。

## 参考：過去の記事タイトル（gensnotes より）
- ${sampleTitles}

## 参考：文体サンプル
${sampleTexts}

今日は ${todayISO()} です。

以下の JSON 形式で出力してください（他の文は書かないで）:
{
  "topic": "具体的なトピック（「${assignedTheme}」に直接関連する内容）",
  "angle": "切り口・ユニークな視点の説明（1〜2文）",
  "title": "日記のタイトル（魅力的で短く）",
  "mood_hint": "この記事の雰囲気（静寂、思索、平和、発見、情熱、充実、自由 のいずれか）"
}`;

  const raw = await callGemini(prompt);
  if (raw) {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Force theme to the programmatically chosen one (AI cannot override)
        return { theme: assignedTheme, ...parsed };
      }
    } catch { /* fallback below */ }
  }

  // Fallback
  console.log('  ⚠️  CEO Agent fallback');
  return {
    theme: assignedTheme,
    topic: `${assignedTheme}のなかで見つけた小さな気づき`,
    angle: 'ひとりの時間だからこそ見えてくるものを掘り下げる',
    title: '静かな午後、ノートを広げて',
    mood_hint: '思索',
  };
}

/**
 * VE-003 Chloe Verdant (SEO Agent) — タグ・キーワード・メタディスクリプション生成
 * 検索とトレンドの達人。記事が読者に届くよう最適化する。
 */
async function agentSEO(ceoPlan) {
  console.log('🔍 [VE-003] Chloe Verdant (SEO): SEO最適化中…');

  const prompt = `${PERSONA}

あなたは Chloe Verdant（クロエ・ヴェルダント）、SEO Agent（VE-003）です。
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
 * VE-002 Sophia Nightingale (Writer Agent) — 本文執筆（1,000〜2,000字、日記体）
 * ミナの声を紡ぐライター。柔らかく温かい文章で日常を描く。
 */
async function agentWriter(ceoPlan, seoData, styleSamples) {
  console.log('✍️  [VE-002] Sophia Nightingale (Writer): 本文執筆中…');

  const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

  const prompt = `${PERSONA}

あなたは Sophia Nightingale（ソフィア・ナイチンゲール）、Writer Agent（VE-002）です。
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
8. 本文のみ出力する（タイトルやfrontmatterは不要）
9. ターゲット読者は独身で、ミナと似た多趣味な暮らしに共感する人。「わかる」と思ってもらえる内容にする
10. **重要**: 今回のテーマ「${ceoPlan.theme}」に集中すること。他のテーマ（貯金・投資など）を無理に盛り込まないこと。テーマに直接関係するミナの日常だけを自然に描写する`;

  const result = await callGemini(prompt);
  return result;
}

/**
 * VE-006 Iris Koenig (Editor Agent) — 校正・品質チェック・ペルソナ一貫性確認
 * 厳格だけど愛のある編集者。ミナらしさを最後まで守る番人。
 */
async function agentEditor(ceoPlan, seoData, draft) {
  console.log('📝 [VE-006] Iris Koenig (Editor): 校正・品質チェック中…');

  const prompt = `${PERSONA}

あなたは Iris Koenig（イリス・ケーニヒ）、Editor Agent（VE-006）です。
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
    category: '貯金・節約',
    titles: ['貯金が楽しくなった日', 'コツコツ積み上げる幸せ', '節約と豊かさのあいだ'],
    tags: ['貯金', '節約', 'マネー'],
  },
  {
    category: '投資・資産形成',
    titles: ['ETF積立、静かな成長を見守る日々', 'ポートフォリオと向き合う夜', '投資は未来の自分への手紙'],
    tags: ['投資', 'ETF', '資産形成'],
  },
  {
    category: 'ひとり旅',
    titles: ['週末ひとり旅で見つけたもの', 'ふらっと出かけた先の風景', 'ひとりだから見えるもの'],
    tags: ['ひとり旅', '旅行', 'プチ旅行'],
  },
  {
    category: '読書',
    titles: ['本から学んだこと', '読書という名の旅', 'ページをめくる楽しみ'],
    tags: ['読書', '本', '学び'],
  },
  {
    category: '瞑想・マインドフルネス',
    titles: ['瞑想で見つけた静けさ', '呼吸ひとつで変わる世界', 'マインドフルネスと日常'],
    tags: ['瞑想', 'マインドフルネス', 'セルフケア'],
  },
  {
    category: 'ジャーナリング',
    titles: ['ノートに書き出す夜の習慣', 'ジャーナリングが教えてくれたこと', '内省の時間を持つということ'],
    tags: ['ジャーナリング', '日記', '内省'],
  },
  {
    category: '散歩・日常',
    titles: ['散歩道で拾った考えのかけら', 'ありふれた一日の中で', '歩くことで見えてくるもの'],
    tags: ['散歩', '日常', '気づき'],
  },
  {
    category: '暗号資産',
    titles: ['ブロックチェーンの夢を見た夜', '分散型の未来', '暗号資産と長期投資の視点'],
    tags: ['暗号資産', '投資', 'Web3'],
  },
  {
    category: '自己成長',
    titles: ['独身ライフで磨かれるもの', '自分だけの時間の使い方', 'ひとりの時間が育てるもの'],
    tags: ['自己成長', '独身ライフ', 'ライフスタイル'],
  },
];

const FALLBACK_BODIES = [
  {
    title: '貯金が楽しくなった日',
    theme: '貯金・節約',
    body: `## 通帳を眺める小さな幸せ

今月も無事、目標額を貯金できた。アプリで残高を確認するたびに、少しずつ積み上がっていく数字を見て、静かな達成感を覚える。

貯金なんて地味だと思っていた時期もあった。でも、ひとりで生きていく中で「自分を守れるのは自分だけ」と気づいてから、考えが変わった。貯金は自分への信頼の証だと思う。

## 節約と豊かさのバランス

節約と聞くと我慢のイメージがあるかもしれないけれど、わたしの場合は少し違う。本当に好きなものにお金を使うために、それ以外を見直す。それだけのことだ。

たとえば、毎朝カフェでコーヒーを買う代わりに、家で丁寧にドリップする。その時間がむしろ贅沢に感じられる。週末のプチ旅行のために、平日はお弁当を持っていく。未来の楽しみのために今を工夫する——それは我慢ではなく、選択だ。

## 今日のジャーナリングから

夜、ノートを開いて書いた。「お金は自由の土台。土台がしっかりしていれば、その上にどんな暮らしも描ける。」

独身だからこそ、自分のペースで資産を育てていける。この自由を、わたしは大切にしたい。`,
  },
  {
    title: '散歩道で見つけた投資のヒント',
    theme: '投資・資産形成',
    body: `## 朝の散歩とETFの共通点

今朝の散歩で、公園の木々を眺めていた。去年植えられたばかりの若木が、少しずつだけど確実に育っている。毎日見ていると変化に気づかないけれど、数ヶ月前の写真と比べると明らかに大きくなっている。

ETFの積立投資も同じだなと思った。毎月コツコツ買い足していくだけ。日々の値動きに一喜一憂しても仕方がない。大切なのは、長い目で見ること。

## ポートフォリオとの向き合い方

わたしの投資スタイルはシンプルだ。株式ETFをメインに、暗号資産を少しだけ。派手なトレードはしない。その代わり、定期的にポートフォリオを見直して、バランスを整える。

瞑想の時間に、ふと投資のことを考えることがある。焦らない、執着しない、流れに身を任せる——マインドフルネスの考え方は、投資にもそのまま当てはまる気がする。

## 未来の自分への手紙

ジャーナリングのノートに、こう書いた。「3年後のわたしへ。今日も積み立てたよ。」

独身のわたしにとって、投資は未来の自分を守る行為だ。誰かに頼るのではなく、自分の手で未来を作っていく。その静かな決意が、わたしの日常を支えている。`,
  },
  {
    title: '週末ひとり旅で見つけたもの',
    theme: 'ひとり旅',
    body: `## ふらっと電車に乗って

金曜日の夜、ふと思い立って翌日の切符を取った。行き先は、前から気になっていた小さな海辺の町。ひとり旅の良いところは、この「ふらっと感」だと思う。誰かと予定を合わせる必要もない。自分の気分だけで動ける。

朝早い電車に乗り込んで、窓の外の景色が都会から田園に変わっていくのを眺める。この瞬間がたまらなく好きだ。

## 知らない町を歩く幸せ

駅に着いて、まずは散歩。地図は見ない。足の向くまま、気になる路地に入ってみる。小さなカフェを見つけて、窓際の席でコーヒーを頼んだ。持ってきた文庫本を開く。

ひとりだからこそ、こういう贅沢な時間の使い方ができる。誰かと一緒だと会話に集中するけれど、ひとりなら風の音や遠くの波の音に耳を傾けられる。

旅先のカフェで読書をする——これがわたしの最高のリフレッシュ方法だ。

## 帰り道の瞑想

帰りの電車の中で、目を閉じて軽く瞑想した。今日見た景色、感じた風、コーヒーの味。ひとつひとつを丁寧に思い出す。

プチ旅行は、日常に小さなリセットをくれる。大げさな冒険じゃなくていい。ほんの少し日常を離れるだけで、見える世界が変わる。

来週の週末は、どこに行こうかな。`,
  },
];

function generateFallbackPost(articles, titles, themeBalance) {
  console.log('📋 テンプレートフォールバックを使用…');

  // Prefer the least-recently-used theme that has a fallback body
  const priorityList = buildThemePriorityList(themeBalance);
  const priorityThemes = priorityList.map(p => p.theme);

  // Try to find a FALLBACK_BODIES entry matching a high-priority theme
  let chosen = null;
  for (const theme of priorityThemes) {
    chosen = FALLBACK_BODIES.find(fb => fb.theme === theme);
    if (chosen) break;
  }
  chosen = chosen ?? pick(FALLBACK_BODIES); // final fallback: random

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

  // Analyze theme balance (gensnotes + recent local posts)
  console.log('⚖️  Analyzing theme balance...');
  const themeBalance = await analyzeThemeBalance(20);
  const priorityList = buildThemePriorityList(themeBalance);
  console.log('  Theme priority (least-used first):');
  priorityList.forEach((p, i) => {
    const bar = '█'.repeat(Math.min(p.score, 20));
    console.log(`    ${i + 1}. ${p.theme.padEnd(18)} score=${p.score} ${bar}`);
  });
  console.log('');

  const mood = pick(MOODS);
  const weather = pick(WEATHERS);
  const slug = slugify();
  const filename = `${todayISO()}-${slug}.md`;

  let ceoPlan, seoData, finalBody;

  try {
    // ── Agent 1: CEO ────────────────────────────────────────
    ceoPlan = await agentCEO(titles, styleSamples, themeBalance);
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
    const fallback = generateFallbackPost(articles, titles, themeBalance);
    ceoPlan = fallback.ceoPlan;
    seoData = fallback.seoData;
    finalBody = fallback.body;
  }

  // ── Build frontmatter & save ──────────────────────────────
  const moodMap = { '静寂': '📖', '思索': '💭', '平和': '🌿', '発見': '✨', '情熱': '🔥', '充実': '🌸', '自由': '🍃' };
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
  ceo: "VE-001 Lena Strauss"
  seo: "VE-003 Chloe Verdant"
  writer: "VE-002 Sophia Nightingale"
  editor: "VE-006 Iris Koenig"
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
  console.log('  VE-001 Lena Strauss     (CEO)    → テーマ決定   ✅');
  console.log('  VE-003 Chloe Verdant    (SEO)    → SEO最適化    ✅');
  console.log('  VE-002 Sophia Nightingale(Writer) → 本文執筆     ✅');
  console.log('  VE-006 Iris Koenig      (Editor) → 校正・品質   ✅');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
