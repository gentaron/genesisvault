/**
 * Phase γ — Agent Runners
 *
 * Individual agent runner functions that replace the inline agent
 * definitions from the original monolithic auto-post.mjs.
 *
 * Structured agents (Nova, Lena, Chloe) use `generateWithFallback` + Zod schemas.
 * Text agents (Sophia, Iris) use `generateTextWithFallback`.
 *
 * All runners preserve their existing fallback logic when AI fails completely.
 */

import { generateWithFallback, generateTextWithFallback } from '../ai/generate.js';
import { NovaOutputSchema, LenaOutputSchema, ChloeOutputSchema, ALL_THEMES } from './schemas.js';
import type { NovaOutput, LenaOutput, ChloeOutput } from './schemas.js';
import {
  PERSONA,
  THEME_KEYWORDS,
  pickN,
  pick,
  todayISO,
  THEMES,
  buildThemePriorityList,
} from './shared.js';
import type { ThemeBalance } from './shared.js';

// ═══════════════════════════════════════════════════════════════
// VE-005 Nova Harmon (Balancer) — テーマバランス分析・ジャンル選定
// ═══════════════════════════════════════════════════════════════

/**
 * Returns the selected theme string. Falls back to deterministic
 * selection from the least-used tier if all providers fail.
 */
export async function runNova(
  themeBalance: ThemeBalance,
  recentPostTitles: string[],
): Promise<string> {
  console.log('\n⚖️  [VE-005] Nova Harmon (Balancer): ジャンル選定中…');

  const priorityList = buildThemePriorityList(themeBalance);
  const { recentCount, gensnotesCount } = themeBalance;

  // Format data for the prompt
  const balanceTable = priorityList
    .map(p => {
      const recent = recentCount[p.theme] || 0;
      const gensnotes = gensnotesCount[p.theme] || 0;
      return `  - ${p.theme}：直近${recent}回 / gensnotes${gensnotes}件 / スコア${p.score}`;
    })
    .join('\n');

  const recentTitlesList = recentPostTitles.length > 0
    ? recentPostTitles.map(t => `  - ${t}`).join('\n')
    : '  （まだ記事がありません）';

  const themeListText = ALL_THEMES.map(t => `「${t}」`).join('、');

  const systemPrompt = 'あなたは Genesis Vault ブログの編集部で、話題の多様性とバランスを管理する分析官です。';

  const prompt = `あなたは Nova Harmon（ノヴァ・ハーモン）、Balancer Agent（VE-005）です。
Genesis Vault ブログの編集部で、話題の多様性とバランスを管理する分析官です。

## あなたの役割
直近の投稿履歴と旧ブログ（gensnotes）のデータを分析し、
次に書くべきテーマを **1つだけ** 選んでください。

## 選択可能なテーマ一覧
${themeListText}

## テーマ別の使用データ（スコアが低いほど最近使われていない）
${balanceTable}

## 直近の記事タイトル（時系列順、新しい順）
${recentTitlesList}

## 選定基準（優先度順）
1. **偏り解消**: スコアが低い（= 最近使われていない）テーマを優先する
2. **連続回避**: 直近の記事タイトルを見て、同じジャンルが2回以上続かないようにする
3. **gensnotes との補完**: gensnotes で少ないテーマは新鮮味があるので加点する
4. **季節感**: 今日は ${todayISO()} です。季節に合うテーマがあれば考慮する
5. **読者の飽き防止**: 似たようなテーマが短期間に集中しないようにする

## 出力形式
以下の JSON を出力してください（他の文は書かないで）:
{
  "selected_theme": "選んだテーマ名（上記一覧から正確にコピー）",
  "reason": "なぜこのテーマを選んだか（1〜2文で簡潔に）"
}`;

  try {
    const result = await generateWithFallback<NovaOutput>({
      schema: NovaOutputSchema,
      system: systemPrompt,
      prompt,
      agentId: 'VE-005',
      agentName: 'Nova Harmon',
    });

    const selectedTheme = result.value.selected_theme;
    if (selectedTheme && ALL_THEMES.includes(selectedTheme as any)) {
      console.log(`  ✅ 選定テーマ: ${selectedTheme}`);
      console.log(`  💬 理由: ${result.value.reason || '(なし)'}`);
      console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
      return selectedTheme;
    }
    console.warn(`  ⚠️  無効なテーマ「${selectedTheme}」が返却されました`);
  } catch (err) {
    console.warn(`  ⚠️  Nova generateObject failed: ${(err as Error).message?.substring(0, 120)}`);
  }

  // Fallback: deterministic — pick from least-used tier
  console.log('  ⚠️  Balancer Agent fallback（プログラムで選択）');
  const lowestScore = priorityList[0].score;
  const topTier = priorityList.filter(p => p.score === lowestScore);
  const fallbackTheme = pick(topTier).theme;
  console.log(`  🎲 Fallback テーマ: ${fallbackTheme}`);
  return fallbackTheme;
}

// ═══════════════════════════════════════════════════════════════
// VE-001 Lena Strauss (CEO) — トピック・切り口・タイトルの決定
// ═══════════════════════════════════════════════════════════════

export interface CEOPlan {
  theme: string;
  topic: string;
  angle: string;
  title: string;
  mood_hint: string;
}

/**
 * Returns a CEO plan with theme, topic, angle, title, mood_hint.
 * Falls back to a deterministic title from THEMES if all providers fail.
 */
export async function runLena(
  titles: string[],
  styleSamples: string[],
  assignedTheme: string,
): Promise<CEOPlan> {
  console.log('\n🎯 [VE-001] Lena Strauss (CEO): トピック決定中…');

  const sampleTitles = pickN(titles, 10).join('\n- ');
  const sampleTexts = styleSamples.map((s, i) => `【サンプル${i + 1}】\n${s}`).join('\n\n');

  const prompt = `あなたは Lena Strauss（レナ・シュトラウス）、CEO Agent（VE-001）です。
Genesis Vault ブログの次の日記エントリーのトピック・切り口・タイトルを決めてください。

## 今日のテーマ（Balancer Agent が選定済み・変更不可）
「${assignedTheme}」

上記テーマに沿った内容にしてください。他のテーマに変えてはいけません。
たとえば「${assignedTheme}」がテーマなら、それに直接関係する話題だけを扱ってください。

## 参考：過去の記事タイトル（gensnotes より）
- ${sampleTitles}

## 参考：文体サンプル
${sampleTexts}

今日は ${todayISO()} です。

## タイトル作成の厳格ルール（最重要）
以下を必ず守ること。守れないタイトルは不合格とする。

1. **抽象・詩的な表現を禁止**: 「見つけたもの」「気づいたこと」「教えてくれたもの」「向き合う時間」「大切なこと」のような曖昧でありきたりな表現は絶対に使わない
2. **具体性を最優先**: タイトルを読んだだけで「何について書かれた記事か」が明確にわかること。抽象的な名詞（もの・こと・時間）で終わらせない
3. **動詞・数字・固有名詞を活用**: 具体的な行動、数字、場所名、商品名、メソッド名などを盛り込み、クリック率を高める
4. **パターン化を回避**: 以下のテンプレートは使い古されているので禁止:
   - 「〜で見つけた〜」「〜が教えてくれた〜」「〜と向き合う〜」
   - 「静かな〜」「小さな〜」「ひとりの〜」（冒頭に形容詞＋名詞のパターン）
   - 「〜という選択」「〜のすすめ」「〜について思うこと」
5. **15文字以内を目指す**: 短く、リズムよく、余韻を残す。長くても20文字まで
6. **読者の好奇心を刺激**: 「続きが読みたい」と思わせるフックを入れる。疑問形、意外な組み合わせ、逆説なども有効
7. **季節感・時事性**: 今日の日付（${todayISO()}）を意識し、季節に合ったリアリティのあるタイトルにする

### 良いタイトル例:
- 「朝5時の家計簿タイム」（具体的な時間＋行動）
- 「ETF積立3年目の通知表」（数字＋具体的な成果）
- 「鎌倉で迷子になった午後」（場所＋出来事）
- 「100円ノートが最強な理由」（具体物＋主張）
- 「瞑想をサボった週に起きたこと」（逆説＋好奇心）
- 「本棚の一軍を入れ替えた」（具体的な行動）
- 「深夜のビットコイン板を眺めながら」（臨場感）

### 悪いタイトル例（絶対に使わない）:
- 「散歩道で見つけた大切なこと」（抽象的すぎる）
- 「静かな朝の読書時間」（ありきたり）
- 「お金と向き合う日々」（何も伝わらない）
- 「ひとり旅が教えてくれたもの」（テンプレ的）

以下の JSON 形式で出力してください（他の文は書かないで）:
{
  "topic": "具体的なトピック（「${assignedTheme}」に直接関連する内容）",
  "angle": "切り口・ユニークな視点の説明（1〜2文）",
  "title": "上記ルールに従った具体的で魅力的なタイトル（15〜20文字以内）",
  "mood_hint": "この記事の雰囲気（静寂、思索、平和、発見、情熱、充実、自由 のいずれか）"
}`;

  try {
    const result = await generateWithFallback<LenaOutput>({
      schema: LenaOutputSchema,
      system: PERSONA,
      prompt,
      agentId: 'VE-001',
      agentName: 'Lena Strauss',
    });

    console.log(`  ✅ テーマ: ${assignedTheme}`);
    console.log(`  ✅ トピック: ${result.value.topic}`);
    console.log(`  ✅ タイトル: ${result.value.title}`);
    console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
    return {
      theme: assignedTheme,
      ...result.value,
    };
  } catch (err) {
    console.warn(`  ⚠️  Lena generateObject failed: ${(err as Error).message?.substring(0, 120)}`);
  }

  // Fallback: pick a concrete title from THEMES
  console.log('  ⚠️  CEO Agent fallback');
  const themeData = THEMES.find(t => t.category === assignedTheme);
  const fallbackTitle = themeData ? pick(themeData.titles) : '朝のルーティンを全部変えた';
  return {
    theme: assignedTheme,
    topic: `${assignedTheme}に関する具体的な体験談`,
    angle: '実体験をベースに、読者が追体験できるリアルな描写で伝える',
    title: fallbackTitle,
    mood_hint: '思索',
  };
}

// ═══════════════════════════════════════════════════════════════
// VE-003 Chloe Verdant (SEO) — タグ・キーワード・メタディスクリプション
// ═══════════════════════════════════════════════════════════════

export interface SEOData {
  tags: string[];
  keywords: string[];
  description: string;
}

/**
 * Returns SEO data: tags, keywords, description.
 * Falls back to basic SEO data if all providers fail.
 */
export async function runChloe(ceoPlan: CEOPlan): Promise<SEOData> {
  console.log('🔍 [VE-003] Chloe Verdant (SEO): SEO最適化中…');

  const prompt = `あなたは Chloe Verdant（クロエ・ヴェルダント）、SEO Agent（VE-003）です。
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

  try {
    const result = await generateWithFallback<ChloeOutput>({
      schema: ChloeOutputSchema,
      system: PERSONA,
      prompt,
      agentId: 'VE-003',
      agentName: 'Chloe Verdant',
    });

    console.log(`  ✅ タグ: ${result.value.tags.join(', ')}`);
    console.log(`  ✅ キーワード: ${result.value.keywords.join(', ')}`);
    console.log(`  ✅ Description: ${result.value.description}`);
    console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
    return result.value;
  } catch (err) {
    console.warn(`  ⚠️  Chloe generateObject failed: ${(err as Error).message?.substring(0, 120)}`);
  }

  // Fallback
  console.log('  ⚠️  SEO Agent fallback');
  return {
    tags: [ceoPlan.theme, '日記', '思考'],
    keywords: [ceoPlan.theme, ceoPlan.topic],
    description: `${ceoPlan.title} — ミナ・エウレカが${ceoPlan.theme}について綴る日記。`,
  };
}

// ═══════════════════════════════════════════════════════════════
// VE-002 Sophia Nightingale (Writer) — 本文執筆（1,000〜2,000字）
// ═══════════════════════════════════════════════════════════════

/**
 * Returns the article body text (Markdown). Returns null if all providers fail.
 */
export async function runSophia(
  ceoPlan: CEOPlan,
  seoData: SEOData,
  styleSamples: string[],
): Promise<string | null> {
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

  try {
    const result = await generateTextWithFallback({
      system: PERSONA,
      prompt,
      agentId: 'VE-002',
      agentName: 'Sophia Nightingale',
      maxTokens: 4096,
      temperature: 0.85,
    });

    console.log(`  ✅ 原稿完成 (${result.text.length}文字)`);
    console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
    return result.text;
  } catch (err) {
    console.warn(`  ⚠️  Sophia text generation failed: ${(err as Error).message?.substring(0, 120)}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// VE-006 Iris Koenig (Editor) — 校正・品質チェック
// ═══════════════════════════════════════════════════════════════

/**
 * Returns the edited article body text. Returns null if all providers fail.
 */
export async function runIris(
  ceoPlan: CEOPlan,
  seoData: SEOData,
  draft: string,
): Promise<string | null> {
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

  try {
    const result = await generateTextWithFallback({
      system: PERSONA,
      prompt,
      agentId: 'VE-006',
      agentName: 'Iris Koenig',
      maxTokens: 4096,
      temperature: 0.85,
    });

    console.log(`  ✅ 校正完了 (${result.text.length}文字)`);
    console.log(`  📡 Provider: ${result.providerUsed} (${result.attempts} attempts, ${result.latencyMs}ms)`);
    return result.text;
  } catch (err) {
    console.warn(`  ⚠️  Iris text generation failed: ${(err as Error).message?.substring(0, 120)}`);
    return null;
  }
}
