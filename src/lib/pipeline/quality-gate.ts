/**
 * Phase θ — Quality Gate
 *
 * Post-generation quality checks before committing an article.
 * Enforces minimum content standards and catches common AI artifacts.
 */

export interface QualityReport {
  passed: boolean;
  score: number;        // 0-100
  checks: QualityCheck[];
}

export interface QualityCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning';
}

/** Minimum body length in Japanese characters (excluding whitespace). */
const MIN_BODY_LENGTH = 400;
const MAX_BODY_LENGTH = 5000;

/** Placeholder patterns that indicate incomplete AI output. */
const PLACEHOLDER_PATTERNS = [
  /\[TODO\]/i,
  /\[TBD\]/i,
  /\[要補完\]/,
  /\[後で書く\]/,
  /\[PLACEHOLDER\]/i,
  /ここに本文を入力/,
  /本文は後で追加/,
];

/**
 * "AI slop" heading patterns — grandiose, generic proposition-style H2s
 * (e.g. 「〜が教えてくれたもの」「〜と向き合う時間」) that Lena's title rules
 * already ban for article titles (see prompts/lena) but which the Writer/Editor
 * agents can still slip into section headings. Modeled on the detection
 * categories in the stop-ai-slop-jp Claude Skill (structural/構造 issues).
 */
const GRANDIOSE_HEADING_PATTERNS = [
  /見つけたもの/,
  /気づいたこと/,
  /教えてくれ(た|る)/,
  /向き合う時間/,
  /大切なこと/,
  /という(選択|生き方)/,
];

/** Vocabulary that inflates a small diary moment into a universal truth (stop-ai-slop-jp: 語彙/vocabulary). */
const CLICHE_VOCABULARY = ['真理', '美学', '境地', '本質'];

export interface AiSlopReport {
  grandioseHeadings: string[];
  clicheWords: string[];
  binaryContrastCount: number;
  decorativeDashCount: number;
  boldRemnantCount: number;
}

/**
 * Heuristic detector for common Japanese "AI slop" writing artifacts,
 * inspired by the stop-slop / stop-ai-slop-jp Claude Skills: grandiose
 * proposition-style headings, cliché "universal truth" vocabulary,
 * repetitive "A ではなく B" binary-contrast rhetoric, decorative full-width
 * dash runs, and stray Markdown bold emphasis left in diary-style prose.
 */
export function detectAiSlop(body: string): AiSlopReport {
  const headingLines = body.match(/^##\s+.+$/gm) || [];
  const grandioseHeadings = headingLines.filter(line =>
    GRANDIOSE_HEADING_PATTERNS.some(pattern => pattern.test(line)),
  );

  const clicheWords = CLICHE_VOCABULARY.filter(word => body.includes(word));

  const binaryContrastCount = (body.match(/ではなく/g) || []).length;
  const decorativeDashCount = (body.match(/――+|—{2,}/g) || []).length;
  const boldRemnantCount = (body.match(/\*\*[^*\n]+\*\*/g) || []).length;

  return { grandioseHeadings, clicheWords, binaryContrastCount, decorativeDashCount, boldRemnantCount };
}

/** Run all quality checks on the article body. */
export function runQualityGate(body: string): QualityReport {
  const checks: QualityCheck[] = [];

  // 1. Body length check
  const strippedBody = body.replace(/\s/g, '');
  const bodyLength = strippedBody.length;
  checks.push({
    name: 'body_length',
    passed: bodyLength >= MIN_BODY_LENGTH && bodyLength <= MAX_BODY_LENGTH,
    message: `本文の文字数: ${bodyLength}文字（基準: ${MIN_BODY_LENGTH}〜${MAX_BODY_LENGTH}文字）`,
    severity: 'error',
  });

  // 2. Placeholder detection
  const foundPlaceholders: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(body)) {
      foundPlaceholders.push(pattern.source);
    }
  }
  checks.push({
    name: 'no_placeholders',
    passed: foundPlaceholders.length === 0,
    message: foundPlaceholders.length > 0
      ? `プレースホルダー検出: ${foundPlaceholders.join(', ')}`
      : 'プレースホルダーなし',
    severity: 'error',
  });

  // 3. Markdown structure — at least one h2 heading
  const h2Count = (body.match(/^##\s+.+$/gm) || []).length;
  checks.push({
    name: 'markdown_structure',
    passed: h2Count >= 1,
    message: `見出し (##) の数: ${h2Count}（最低1つ必要）`,
    severity: 'warning',
  });

  // 4. No leftover code fences wrapping the entire body
  const startsWithFence = /^```/m.test(body);
  const endsWithFence = /```\s*$/m.test(body);
  checks.push({
    name: 'no_code_fences',
    passed: !(startsWithFence && endsWithFence),
    message: startsWithFence && endsWithFence
      ? '本文がコードフェンスで囲まれている（AIアーティファクトの可能性）'
      : 'コードフェンス問題なし',
    severity: 'error',
  });

  // 5. No "As an AI" disclaimer
  const aiDisclaimer = /AIとして|as an AI|私はAI/i.test(body);
  checks.push({
    name: 'no_ai_disclaimer',
    passed: !aiDisclaimer,
    message: aiDisclaimer ? 'AI免責事項が含まれている' : 'AI免責事項なし',
    severity: 'error',
  });

  // 6-10. AI slop heuristics (stop-ai-slop-jp inspired) — warnings, not blockers.
  const slop = detectAiSlop(body);
  checks.push({
    name: 'no_grandiose_headings',
    passed: slop.grandioseHeadings.length === 0,
    message: slop.grandioseHeadings.length > 0
      ? `使い古された見出し表現を検出: ${slop.grandioseHeadings.join(' / ')}`
      : '見出しに定型的な表現なし',
    severity: 'warning',
  });
  checks.push({
    name: 'no_cliche_vocabulary',
    passed: slop.clicheWords.length === 0,
    message: slop.clicheWords.length > 0
      ? `大げさな語彙を検出: ${slop.clicheWords.join('、')}`
      : '大げさな語彙なし',
    severity: 'warning',
  });
  checks.push({
    name: 'no_binary_contrast_repetition',
    passed: slop.binaryContrastCount < 3,
    message: `「ではなく」の使用回数: ${slop.binaryContrastCount}（3回以上で定型的な対比表現とみなす）`,
    severity: 'warning',
  });
  checks.push({
    name: 'no_decorative_dashes',
    passed: slop.decorativeDashCount === 0,
    message: slop.decorativeDashCount > 0
      ? `装飾的な全角ダッシュを検出: ${slop.decorativeDashCount}箇所`
      : '装飾的な全角ダッシュなし',
    severity: 'warning',
  });
  checks.push({
    name: 'no_bold_remnants',
    passed: slop.boldRemnantCount === 0,
    message: slop.boldRemnantCount > 0
      ? `Markdown太字の残留を検出: ${slop.boldRemnantCount}箇所`
      : 'Markdown太字の残留なし',
    severity: 'warning',
  });

  // Calculate score: each error = -25, each warning = -10
  let score = 100;
  for (const check of checks) {
    if (!check.passed) {
      score -= check.severity === 'error' ? 25 : 10;
    }
  }
  score = Math.max(0, score);

  const errors = checks.filter(c => !c.passed && c.severity === 'error');
  const passed = errors.length === 0;

  return { passed, score, checks };
}

/** Check if frontmatter has all required fields. */
export function validateFrontmatter(frontmatter: {
  title?: string;
  date?: string;
  tags?: string[];
  description?: string;
  keywords?: string[];
}): QualityCheck[] {
  const checks: QualityCheck[] = [];

  if (!frontmatter.title || frontmatter.title.length < 3) {
    checks.push({ name: 'fm_title', passed: false, message: 'タイトルが不足または短すぎる', severity: 'error' });
  } else {
    checks.push({ name: 'fm_title', passed: true, message: `タイトル: ${frontmatter.title}`, severity: 'error' });
  }

  if (!frontmatter.date) {
    checks.push({ name: 'fm_date', passed: false, message: '日付が不足', severity: 'error' });
  } else {
    checks.push({ name: 'fm_date', passed: true, message: `日付: ${frontmatter.date}`, severity: 'error' });
  }

  if (!frontmatter.tags || frontmatter.tags.length === 0) {
    checks.push({ name: 'fm_tags', passed: false, message: 'タグが不足', severity: 'warning' });
  } else {
    checks.push({ name: 'fm_tags', passed: true, message: `タグ: ${frontmatter.tags.length}件`, severity: 'warning' });
  }

  if (!frontmatter.description || frontmatter.description.length < 10) {
    checks.push({ name: 'fm_description', passed: false, message: 'メタディスクリプションが不足または短すぎる', severity: 'warning' });
  } else {
    checks.push({ name: 'fm_description', passed: true, message: `description: ${frontmatter.description.length}文字`, severity: 'warning' });
  }

  return checks;
}
