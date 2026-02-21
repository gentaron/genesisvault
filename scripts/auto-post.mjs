/**
 * 🤖 AI自動ブログ投稿スクリプト
 *
 * gensnotes_1.md と gensnotes_2.md を参考にして、
 * Google Gemini API でブログ記事を毎日自動生成します。
 * API が使えない場合はテンプレートベースで記事を生成します。
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// ============================================================
// 設定
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 無料枠が使えるモデルを優先順に試行
const GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
];

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 5000;

const MOODS = ['🌿 平和', '💭 思索', '📖 静寂', '✨ 希望', '🌸 穏やか', '🍃 清々しい', '🔥 情熱', '🌊 深淵', '🌙 夜想', '☕ 余韻'];
const WEATHERS = ['☀️ 晴れ', '☁️ 曇り', '🌧️ 雨', '🌤️ 晴れ時々曇り', '⛅ 曇り時々晴れ', '🌈 虹', '❄️ 雪', '🌬️ 風'];

// ============================================================
// ユーティリティ関数
// ============================================================

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
}

function todayISO() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function slugify() {
    const rand = Math.random().toString(36).substring(2, 8);
    return `post-${rand}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// gensnotes 参考データの読み込み・要約
// ============================================================

/**
 * gensnotes_1.md / gensnotes_2.md から記事タイトルと短い本文抜粋を抽出
 */
async function extractArticleSummaries() {
    const summaries = [];

    for (const filename of ['gensnotes_1.md', 'gensnotes_2.md']) {
        const filepath = path.join(ROOT_DIR, filename);
        let raw;
        try {
            raw = await fs.readFile(filepath, 'utf-8');
        } catch {
            console.warn(`⚠️  ${filename} が見つかりません。スキップします。`);
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

/**
 * gensnotes から本文を数本分ランダムに抽出して「参考文体サンプル」を作る
 */
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
            const text = match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 500);
            if (text.length > 100) {
                samples.push(text);
            }
        }
    }

    const shuffled = samples.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, maxSamples);
}

/**
 * gensnotes から記事単位で抽出（タイトル＋本文ペア）
 */
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
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (text.length > 50) {
                    articles.push({ title, text });
                }
            }
        }
    }

    return articles;
}

// ============================================================
// Gemini API 呼び出し（リトライ＋複数モデル対応）
// ============================================================

async function callGeminiWithModel(model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 4096,
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Gemini API エラー (${res.status}): ${err}`);
        error.status = res.status;
        throw error;
    }

    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * 複数モデルを試行し、リトライ付きで Gemini API を呼び出す。
 * すべて失敗した場合は null を返す（例外を投げない）。
 */
async function callGemini(prompt) {
    if (!GEMINI_API_KEY) {
        console.warn('⚠️  GEMINI_API_KEY が設定されていません。テンプレート生成にフォールバックします。');
        return null;
    }

    for (const model of GEMINI_MODELS) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`🤖 モデル ${model} で生成中... (試行 ${attempt + 1}/${MAX_RETRIES + 1})`);
                const result = await callGeminiWithModel(model, prompt);
                console.log(`✅ モデル ${model} で生成成功`);
                return result;
            } catch (err) {
                console.warn(`⚠️  ${model} 試行 ${attempt + 1} 失敗: ${err.message.substring(0, 200)}`);

                if (err.status === 429 && attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    console.log(`   ⏳ ${delay / 1000}秒後にリトライ...`);
                    await sleep(delay);
                    continue;
                }
                // 429以外のエラー、またはリトライ上限 → 次のモデルへ
                break;
            }
        }
        console.log(`⏭️  モデル ${model} をスキップし、次のモデルを試行します。`);
    }

    console.warn('⚠️  すべての Gemini モデルが失敗しました。テンプレート生成にフォールバックします。');
    return null;
}

// ============================================================
// テンプレートベース記事生成（API不要フォールバック）
// ============================================================

const THEMES = [
    {
        category: 'テクノロジー',
        titles: [
            'テクノロジーと日常の交差点',
            'デジタル時代に考えること',
            'テクノロジーの光と影',
            '未来はどこへ向かうのか',
        ],
        tags: ['テクノロジー', '思考'],
        headings: [
            ['技術の進化を感じる瞬間', '便利さの裏側', '今日の気づき'],
            ['デジタルの波', '私たちの選択', 'まとめ'],
        ],
    },
    {
        category: '日常',
        titles: [
            'ありふれた一日の中で',
            '何気ない瞬間の価値',
            '日常に潜む小さな驚き',
            'ふと立ち止まって思うこと',
        ],
        tags: ['日常', '気づき'],
        headings: [
            ['いつもの朝', '小さな変化', '今日の気づき'],
            ['何気ない風景', 'ふと気づいたこと', 'まとめ'],
        ],
    },
    {
        category: '文化',
        titles: [
            '文化の交差点で考えたこと',
            '言葉と文化の深い関係',
            '異なる視点を持つということ',
            '文化の多様性について',
        ],
        tags: ['文化', '思考'],
        headings: [
            ['文化に触れる瞬間', '異なる視点', '今日の気づき'],
            ['多様性の意味', '理解すること', 'まとめ'],
        ],
    },
    {
        category: '哲学',
        titles: [
            '問いかけの先にあるもの',
            '思考の旅路',
            '答えのない問いに向き合う',
            '考えることの価値',
        ],
        tags: ['哲学', '思考'],
        headings: [
            ['問いの始まり', '考え続けること', '今日の気づき'],
            ['深い問い', '答えを探す旅', 'まとめ'],
        ],
    },
    {
        category: '暗号資産',
        titles: [
            'ブロックチェーンの可能性を考える',
            '分散型の未来',
            'デジタル資産と社会の変化',
            'Web3がもたらすもの',
        ],
        tags: ['暗号資産', 'テクノロジー'],
        headings: [
            ['変化の兆し', '技術と社会', '今日の気づき'],
            ['分散化の意味', '未来への視座', 'まとめ'],
        ],
    },
    {
        category: '読書',
        titles: [
            '本から学んだこと',
            '読書という名の旅',
            'ページをめくる楽しみ',
            '言葉の力を感じた日',
        ],
        tags: ['読書', '日常'],
        headings: [
            ['本との出会い', '心に残った言葉', '今日の気づき'],
            ['読書の時間', '物語の力', 'まとめ'],
        ],
    },
];

const INTRO_TEMPLATES = [
    'ふと、{topic}について考えることがあった。きっかけは些細なことだったけれど、考え始めると意外と奥が深い。',
    '最近、{topic}に関する話題をよく目にする。自分なりに少し考えてみた。',
    '今日は{topic}について書いてみようと思う。日頃から感じていたことを、言葉にしてみたい。',
    '{topic}というテーマは、一見すると大げさに聞こえるかもしれない。でも、日常の中にそのヒントは確かにある。',
    '何気なく過ごしている毎日の中で、{topic}について考える瞬間がある。今日はそんな思索を書き留めておきたい。',
];

const CLOSING_TEMPLATES = [
    '結局のところ、大切なのは自分なりの視点を持つことなのかもしれない。明日もまた、新しい気づきがあることを楽しみにしている。',
    'こうして考えを文字にしてみると、自分の中で何かが整理される気がする。書くという行為の力を、改めて感じた一日だった。',
    '答えはすぐに出ないかもしれない。でも、問い続けることに意味がある。そう思えるようになったことが、今日の収穫だ。',
    '日々は淡々と過ぎていく。でも、こうして立ち止まって考える時間を持つことで、見える景色は少し変わるのかもしれない。',
    '完璧な答えなんて、きっとどこにもない。でも、自分なりに考え続けることで、少しずつ世界の輪郭が見えてくる。そんな気がしている。',
];

/**
 * gensnotes の本文断片を使って、テンプレートベースの記事を生成する
 */
async function generatePostFromTemplate(articles, titles) {
    const date = todayISO();
    const mood = pick(MOODS);
    const weather = pick(WEATHERS);
    const theme = pick(THEMES);
    const title = pick(theme.titles);
    const headingSet = pick(theme.headings);

    // 関連しそうな記事から引用を抽出
    const selectedArticles = pickN(articles, 5);
    const quotes = selectedArticles
        .map(a => {
            // 文単位で分割して、良さそうな一文を取り出す
            const sentences = a.text.split(/[。！？]/).filter(s => s.trim().length > 15 && s.trim().length < 120);
            if (sentences.length === 0) return null;
            return pick(sentences).trim();
        })
        .filter(Boolean);

    const intro = pick(INTRO_TEMPLATES).replace('{topic}', theme.category);
    const closing = pick(CLOSING_TEMPLATES);

    // 本文の段落を組み立て
    const bodyParagraphs = [];

    // セクション1
    bodyParagraphs.push(`## ${headingSet[0]}`);
    bodyParagraphs.push('');
    bodyParagraphs.push(intro);
    bodyParagraphs.push('');
    if (quotes[0]) {
        bodyParagraphs.push(`> 「${quotes[0]}」`);
        bodyParagraphs.push('');
        bodyParagraphs.push('この言葉が、ふと頭をよぎった。シンプルだけれど、考えさせられる。');
    }

    // セクション2
    bodyParagraphs.push('');
    bodyParagraphs.push(`## ${headingSet[1]}`);
    bodyParagraphs.push('');

    // 過去の記事タイトルから関連テーマを連想
    const relatedTitles = pickN(titles, 3);
    if (relatedTitles.length > 0) {
        bodyParagraphs.push('以前書いた記事を振り返ると、似たようなテーマに何度も立ち返っていることに気づく。');
        bodyParagraphs.push('');
        bodyParagraphs.push('- ' + relatedTitles.map(t => `「${t}」`).join('\n- '));
        bodyParagraphs.push('');
        bodyParagraphs.push('これらの記事を書いた時とは、また少し違った視点で物事が見えている。時間が経つと、同じテーマでも新しい発見があるものだ。');
    }

    if (quotes[1]) {
        bodyParagraphs.push('');
        bodyParagraphs.push(`**${quotes[1]}**——そんなことを考えながら、今日という日を過ごした。`);
    }

    // セクション3（まとめ）
    bodyParagraphs.push('');
    bodyParagraphs.push(`## ${headingSet[2]}`);
    bodyParagraphs.push('');

    const insights = pickN([
        '当たり前だと思っていたことを、改めて見つめ直すことの大切さ',
        '一つの物事にも、見方を変えれば全く違う側面が見えてくる',
        '情報の海の中で、自分なりの軸を持つことの重要性',
        '変化を恐れるのではなく、変化の中に可能性を見出すこと',
        '完璧を求めるより、まず一歩を踏み出すことの方が大切',
        '言葉にすることで、曖昧だった考えが少しずつ形になっていく',
        '誰かの視点に触れることで、自分の世界が広がる',
        '日常の中にこそ、見過ごしがちな宝物がある',
    ], 3);

    bodyParagraphs.push(insights.map(i => `- ${i}`).join('\n'));
    bodyParagraphs.push('');
    bodyParagraphs.push(closing);

    const body = bodyParagraphs.join('\n');

    const content = `---
title: ${title}
date: ${date}
mood: ${mood}
weather: ${weather}
tags: [${theme.tags.join(', ')}]
---

${body}
`;

    return content;
}

// ============================================================
// ブログ記事生成
// ============================================================

async function generatePost() {
    console.log('📚 gensnotes から参考データを読み込み中...');
    const titles = await extractArticleSummaries();
    const styleSamples = await extractStyleSamples(3);
    const articles = await extractArticles();

    const date = todayISO();
    const mood = pick(MOODS);
    const weather = pick(WEATHERS);

    const sampleTitles = titles.sort(() => Math.random() - 0.5).slice(0, 8).join('\n- ');
    const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

    // ── プロンプト ──
    const prompt = `
あなたは「Genesis Vault」というブログの著者「ミナ・エウレカ」です。
以下の過去記事タイトルと文体サンプルを参考にして、今日の日付（${date}）のブログ記事を **1本** 書いてください。

## 過去の記事タイトル（参考テーマ）
- ${sampleTitles}

## 過去の記事の文体サンプル（参考スタイル）
${sampleTexts}

## 執筆ルール
1. テーマは上記の過去記事と関連があっても無くても構いません。著者の興味（テクノロジー、暗号資産、地政学、ゲーム、哲学、日常の気づき、文化論）から自由に選んでください。
2. 文体は **知的だが堅すぎず、エッセイ的で個人の視点が色濃い** スタイルにしてください。
3. 記事の長さは 800〜1500 文字程度。
4. 見出し（## h2）を 2〜4 個使ってください。
5. 箇条書きや引用（>）を適度に使ってください。
6. 最後に簡単な「まとめ」や「気づき」で締めてください。

## 出力フォーマット（このまま .md ファイルとして保存します）
\`\`\`
---
title: <記事タイトル>
date: ${date}
mood: ${mood}
weather: ${weather}
tags: [<タグ1>, <タグ2>]
---

<本文 Markdown>
\`\`\`

**重要**: 出力はフロントマター（---で囲まれた部分）から始めてください。
コードブロック(\`\`\`)で囲まないでください。フロントマターと本文だけを出力してください。
`;

    // Gemini API を試行（複数モデル＋リトライ＋フォールバック）
    console.log('🤖 Gemini API で記事を生成中...');
    let content = await callGemini(prompt);

    if (content) {
        // API成功時の後処理
        content = content.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/i, '').trim();
        if (!content.startsWith('---')) {
            content = '---\n' + content;
        }
        return content;
    }

    // API失敗時 → テンプレートベース生成
    console.log('📝 テンプレートベースで記事を生成中...');
    content = await generatePostFromTemplate(articles, titles);
    return content;
}

// ============================================================
// ファイル保存
// ============================================================

async function savePost(content) {
    const date = todayISO();
    const slug = slugify();
    const filename = `${date}-${slug}.md`;
    const postsDir = path.join(ROOT_DIR, 'src', 'content', 'posts');

    await fs.mkdir(postsDir, { recursive: true });
    const filepath = path.join(postsDir, filename);
    await fs.writeFile(filepath, content, 'utf-8');

    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '(タイトル不明)';

    console.log('');
    console.log('✅ 新しい記事を作成しました!');
    console.log(`   📄 ファイル: ${filename}`);
    console.log(`   📝 タイトル: ${title}`);
    console.log(`   📅 日付: ${date}`);
    console.log('');

    return filepath;
}

// ============================================================
// メイン
// ============================================================

async function main() {
    console.log('');
    console.log('🌿 === Genesis Vault 自動投稿システム ===');
    console.log(`   日時: ${new Date().toLocaleString('ja-JP')}`);
    console.log('');

    try {
        const content = await generatePost();
        await savePost(content);
    } catch (err) {
        console.error('❌ エラーが発生しました:', err.message);
        process.exit(1);
    }
}

main();
