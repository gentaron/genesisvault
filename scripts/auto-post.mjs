import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// gensnotes_1.md と gensnotes_2.md からテーマを抽出
const THEMES = [
    'Web3とブロックチェーン技術',
    '暗号資産と金融の未来',
    'テクノロジーと社会',
    'アフリカの経済発展',
    'ゲームとメタバース',
    '日常の気づき',
    '読書と思索',
    '都市と文化',
    '未来予測',
    '哲学的考察'
];

const MOODS = ['🌿 平和', '💭 思索', '📖 静寂', '✨ 希望', '🌸 穏やか', '🍃 清々しい'];
const WEATHERS = ['☀️ 晴れ', '☁️ 曇り', '🌧️ 雨', '🌤️ 晴れ時々曇り', '⛅ 曇り時々晴れ'];

function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50);
}

async function generateBlogPost() {
    const theme = getRandomElement(THEMES);
    const mood = getRandomElement(MOODS);
    const weather = getRandomElement(WEATHERS);
    const date = getTodayDate();

    // ここでAI APIを使って記事を生成することもできます
    // 今回はシンプルなテンプレートベースの生成
    const title = `${theme}について考える`;
    const slug = generateSlug(title);

    const content = `---
title: ${title}
date: ${date}
mood: ${mood}
weather: ${weather}
tags: [${theme.split('と')[0]}, 思考, 日記]
---

今日は「${theme}」について考えてみた。

## 序論

最近、この分野について深く考える機会があった。日々の生活の中で、ふとした瞬間に気づくことがある。

## 本論

${theme}は、私たちの生活に大きな影響を与えている。特に注目すべきは以下の点だ:

- 第一に、技術の進化がもたらす変化
- 第二に、社会構造への影響
- 第三に、個人の生活様式の変容

これらは相互に関連し合い、複雑なシステムを形成している。

## 気づき

今日の思索を通じて、いくつかの重要な気づきを得た:

1. **変化は避けられない**: 世界は常に動いている
2. **適応の重要性**: 柔軟な思考が求められる
3. **本質を見極める**: 表面的な現象に惑わされない

## 結び

${theme}について考えることは、自分自身を見つめ直すことでもある。

明日もまた、新しい発見があるだろう。
`;

    const filename = `${date}-${slug}.md`;
    const filepath = path.join(__dirname, '..', 'src', 'content', 'posts', filename);

    await fs.writeFile(filepath, content, 'utf-8');
    console.log(`✅ 新しい記事を作成しました: ${filename}`);
    console.log(`   タイトル: ${title}`);
    console.log(`   日付: ${date}`);
    console.log(`   気分: ${mood}`);
    console.log(`   天気: ${weather}`);
}

// メイン実行
generateBlogPost().catch(console.error);
