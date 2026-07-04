/**
 * Phase θ tests — Quality Gate
 */
import { describe, it, expect } from 'vitest';
import { runQualityGate, validateFrontmatter, detectAiSlop } from '../src/lib/pipeline/quality-gate.js';

describe('Quality Gate', () => {
  describe('runQualityGate', () => {
    it('passes for a well-formed article', () => {
      const body = [
        '## 朝のルーティン',
        '',
        '今日は5時に目が覚めた。カーテンの隙間から差し込む朝の光が心地よくて、そのまま5分間ベッドに横たわっていた。この何もしない時間が意外と大切だと思っている。頭の中を空っぽにするだけで、一日の始まりが違って感じる。',
        '',
        '## 散歩のコース',
        '',
        'いつものコースを歩いた。駅前の大通りから公園へ抜けて、神社の脇を通って帰る。全長約4キロ。このコースを歩き始めて3年になる。季節によって全く違う景色が広がるから、飽きない。今日は新緑がきれいで、木々の葉が透き通るような緑色をしていた。',
        '',
        '## カフェでの発見',
        '',
        '公園の帰りにいつも行くカフェで、新しいブレンドコーヒーを試した。ブラジル産の豆を浅煎りにしたもので、フルーティーな香りが口いっぱいに広がる。店主の田中さんが「この豆は今年の新入荷ですよ」と笑顔で教えてくれた。こういう小さなやり取りが、毎日の生活に彩りを添えてくれる。',
        '',
        '## ジャーナリング',
        '',
        '夜、ノートを開いて今日のことを書いた。「早朝の静寂の中で過ごす5分間が、一日を丁寧に生きるためのインストール作業のようなものだ」。そう書いていて、自分でも納得した。明日もまた、5時に起きてこの時間を大切にしたい。',
      ].join('\n');
      const report = runQualityGate(body);
      expect(report.passed).toBe(true);
      expect(report.score).toBe(100);
    });

    it('fails for empty body', () => {
      const report = runQualityGate('');
      expect(report.passed).toBe(false);
      expect(report.score).toBeLessThan(100);
    });

    it('fails for body with [TODO] placeholder', () => {
      const body = `## 導入\n\n[TODO] ここに本文を書く\n\n## まとめ\n\n完了。`;
      const report = runQualityGate(body);
      expect(report.passed).toBe(false);
      const placeholderCheck = report.checks.find(c => c.name === 'no_placeholders');
      expect(placeholderCheck?.passed).toBe(false);
    });

    it('fails for body with [TBD]', () => {
      const report = runQualityGate(`## test\n\n[TBD] more content needed\n\n## end`);
      expect(report.passed).toBe(false);
    });

    it('fails for body wrapped in code fences', () => {
      const body = '```\n## test\n\nsome content here\n```\n';
      const report = runQualityGate(body);
      expect(report.passed).toBe(false);
      const fenceCheck = report.checks.find(c => c.name === 'no_code_fences');
      expect(fenceCheck?.passed).toBe(false);
    });

    it('fails for AI disclaimer', () => {
      const body = [
        '## 導入',
        '',
        '私はAI言語モデルとして、この記事を執筆しました。',
        'これはテスト用のサンプルテキストです。',
        '何度も繰り返して言いますが、この記事はテスト用です。',
        '散歩の季節になったので、今日は久しぶりに公園まで足を伸ばした。',
        '気持ちの良い風が吹いていて、葉っぱが舞うのを見ながら歩くのは最高だ。',
        '帰り道に立ち寄ったカフェで、初めてtryするブレンドを注文した。',
        'ミルクの甘さとコーヒーの苦味が絶妙にマッチして、至福の時間だった。',
        '瞑想の時間に、今日の散歩を振り返った。',
        '自然の中で過ごす時間は、心に余白を作ってくれる。',
        '明日はどこへ行こうかな。',
      ].join('\n');
      const report = runQualityGate(body);
      const aiCheck = report.checks.find(c => c.name === 'no_ai_disclaimer');
      expect(aiCheck?.passed).toBe(false);
    });

    it('warns for missing headings', () => {
      const body = `今日は散歩に行った。とても楽しかった。新しいカフェを見つけた。美味しいコーヒーを飲んだ。`;
      const report = runQualityGate(body);
      // Should pass overall (only warning, not error) but check exists
      const structureCheck = report.checks.find(c => c.name === 'markdown_structure');
      expect(structureCheck?.passed).toBe(false);
      expect(structureCheck?.severity).toBe('warning');
    });
  });

  describe('detectAiSlop (stop-ai-slop-jp inspired heuristics)', () => {
    it('flags grandiose proposition-style headings', () => {
      const body = '## 散歩が教えてくれたもの\n\n本文。';
      const result = detectAiSlop(body);
      expect(result.grandioseHeadings.length).toBeGreaterThan(0);
    });

    it('does not flag concrete, specific headings', () => {
      const body = '## 朝5時の家計簿タイム\n\n本文。';
      const result = detectAiSlop(body);
      expect(result.grandioseHeadings).toHaveLength(0);
    });

    it('flags cliché universal-truth vocabulary', () => {
      const result = detectAiSlop('散歩をしていると、生きることの真理に触れた気がした。');
      expect(result.clicheWords).toContain('真理');
    });

    it('counts repeated binary-contrast rhetoric', () => {
      const body = 'これは贅沢ではなく必要だ。焦りではなく余裕だ。義務ではなく喜びだ。';
      const result = detectAiSlop(body);
      expect(result.binaryContrastCount).toBe(3);
    });

    it('counts decorative full-width dash runs', () => {
      const result = detectAiSlop('今日は――そう、あの日と同じように――静かだった。');
      expect(result.decorativeDashCount).toBeGreaterThan(0);
    });

    it('counts stray markdown bold remnants', () => {
      const result = detectAiSlop('これは**とても重要**なポイントだ。');
      expect(result.boldRemnantCount).toBe(1);
    });

    it('reports zero artifacts for clean diary prose', () => {
      const result = detectAiSlop('## 朝のコーヒー\n\n今日は近所のカフェで新しい豆を試した。');
      expect(result.grandioseHeadings).toHaveLength(0);
      expect(result.clicheWords).toHaveLength(0);
      expect(result.binaryContrastCount).toBe(0);
      expect(result.decorativeDashCount).toBe(0);
      expect(result.boldRemnantCount).toBe(0);
    });
  });

  describe('runQualityGate — AI slop checks are warnings, not blockers', () => {
    it('does not fail the gate on slop alone (only degrades score)', () => {
      const body = [
        '## 散歩が教えてくれたもの',
        '',
        '今日は近所を歩いた。'.repeat(30),
        '',
        '## まとめ',
        '',
        'それではなく、これでもなく、あれでもなかった。'.repeat(10),
      ].join('\n');
      const report = runQualityGate(body);
      const headingCheck = report.checks.find(c => c.name === 'no_grandiose_headings');
      expect(headingCheck?.passed).toBe(false);
      expect(headingCheck?.severity).toBe('warning');
      // Warnings alone must not flip `passed` to false.
      expect(report.passed).toBe(true);
    });
  });

  describe('validateFrontmatter', () => {
    it('passes for complete frontmatter', () => {
      const checks = validateFrontmatter({
        title: 'テスト記事',
        date: '2026-05-06',
        tags: ['テスト', '日記'],
        description: 'これはテスト記事の説明です。',
        keywords: ['テスト'],
      });
      expect(checks.every(c => c.passed)).toBe(true);
    });

    it('fails for missing title', () => {
      const checks = validateFrontmatter({ date: '2026-05-06' });
      expect(checks.find(c => c.name === 'fm_title')?.passed).toBe(false);
    });

    it('fails for missing date', () => {
      const checks = validateFrontmatter({ title: 'Test' });
      expect(checks.find(c => c.name === 'fm_date')?.passed).toBe(false);
    });

    it('warns for missing tags', () => {
      const checks = validateFrontmatter({ title: 'Test', date: '2026-05-06' });
      expect(checks.find(c => c.name === 'fm_tags')?.passed).toBe(false);
      expect(checks.find(c => c.name === 'fm_tags')?.severity).toBe('warning');
    });

    it('warns for short description', () => {
      const checks = validateFrontmatter({ title: 'Test', date: '2026-05-06', description: '短い' });
      expect(checks.find(c => c.name === 'fm_description')?.passed).toBe(false);
    });
  });
});
