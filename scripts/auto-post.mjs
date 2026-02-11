/**
 * 🤖 AI自動ブログ投稿スクリプト
 * 
 * gensnotes_1.md と gensnotes_2.md を参考にして、
 * Google Gemini API でブログ記事を毎日自動生成します。
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
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const MOODS = ['🌿 平和', '💭 思索', '📖 静寂', '✨ 希望', '🌸 穏やか', '🍃 清々しい', '🔥 情熱', '🌊 深淵', '🌙 夜想', '☕ 余韻'];
const WEATHERS = ['☀️ 晴れ', '☁️ 曇り', '🌧️ 雨', '🌤️ 晴れ時々曇り', '⛅ 曇り時々晴れ', '🌈 虹', '❄️ 雪', '🌬️ 風'];

// ============================================================
// ユーティリティ関数
// ============================================================

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function todayISO() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function slugify(text) {
    // 日本語をローマ字的スラッグに変換するのは難しいので、
    // ランダムな英数字スラッグを使用
    const rand = Math.random().toString(36).substring(2, 8);
    return `post-${rand}`;
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

        // タイトルを正規表現で抽出 (<![CDATA[ TITLE ]]>)
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

        // content:encoded の中身を抽出
        const contentRegex = /<content:encoded>\s*<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>\s*<\/content:encoded>/g;
        let match;
        while ((match = contentRegex.exec(raw)) !== null) {
            // HTMLタグを除去してテキストだけ取り出す
            const text = match[1]
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 500); // 500文字まで
            if (text.length > 100) {
                samples.push(text);
            }
        }
    }

    // ランダムに maxSamples 本選ぶ
    const shuffled = samples.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, maxSamples);
}

// ============================================================
// Gemini API 呼び出し
// ============================================================

async function callGemini(prompt) {
    if (!GEMINI_API_KEY) {
        throw new Error(
            '❌ GEMINI_API_KEY が設定されていません。\n' +
            '   GitHub リポジトリの Settings → Secrets → Actions に GEMINI_API_KEY を追加してください。\n' +
            '   ローカル実行時は環境変数 GEMINI_API_KEY を設定してください。'
        );
    }

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 4096,
        }
    };

    const res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API エラー (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ============================================================
// ブログ記事生成
// ============================================================

async function generatePost() {
    console.log('📚 gensnotes から参考データを読み込み中...');
    const titles = await extractArticleSummaries();
    const styleSamples = await extractStyleSamples(3);

    const date = todayISO();
    const mood = pick(MOODS);
    const weather = pick(WEATHERS);

    // 過去の記事タイトルからランダムにいくつか提示してテーマの方向性を示す
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

    console.log('🤖 Gemini API で記事を生成中...');
    let content = await callGemini(prompt);

    // コードブロックの囲みがあれば除去
    content = content.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/i, '').trim();

    // frontmatter の --- で始まっているか確認
    if (!content.startsWith('---')) {
        content = '---\n' + content;
    }

    return content;
}

// ============================================================
// ファイル保存
// ============================================================

async function savePost(content) {
    const date = todayISO();
    const slug = slugify('');
    const filename = `${date}-${slug}.md`;
    const postsDir = path.join(ROOT_DIR, 'src', 'content', 'posts');

    await fs.mkdir(postsDir, { recursive: true });
    const filepath = path.join(postsDir, filename);
    await fs.writeFile(filepath, content, 'utf-8');

    // title を抽出して表示
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
