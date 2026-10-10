/**
 * IDEAZ の型 — 写し（prompts/ideaz/）から組み立てられること。
 *
 * 写しが壊れる（見出しが変わる）と、書き手は型の無いまま書く。それは
 * 例外にもならず「なんとなく前と違う記事」として静かに出ていくので、
 * 見出しが揃っていることをここで固定する。
 */

import { describe, expect, it } from 'vitest';
import {
  buildIdeazEditorRules,
  buildIdeazTitleRules,
  buildIdeazWriterBrief,
  isIdeazFormat,
  section,
} from '../src/lib/format/ideaz';
import { PIPELINE_CONFIG } from '../src/lib/pipeline/config';

describe('IDEAZ format', () => {
  it('is the active profile', () => {
    expect(isIdeazFormat()).toBe(true);
  });

  it('builds the writer brief with the gate, signals and voice', () => {
    const brief = buildIdeazWriterBrief({ isTech: false });
    for (const label of [
      '【書く前に必ず埋める一文。ここが関門】',
      '【必ず入れるシグナル5つ】',
      '【出力の形。ここ絶対】',
      '【文体】',
      '【読みやすさ】',
      '【永久禁止と安全条件】',
    ]) {
      expect(brief).toContain(label);
    }
    expect(brief).toContain('今日の題材は AI そのものではない');
    expect(brief).not.toContain('すでに使った題材の家族');
  });

  it('adds the exclusion families only for AI topics', () => {
    const brief = buildIdeazWriterBrief({ isTech: true });
    expect(brief).toContain('すでに使った題材の家族');
    expect(brief).not.toContain('今日の題材は AI そのものではない');
  });

  it('keeps the target length inside the quality gate', () => {
    expect(buildIdeazWriterBrief({ isTech: false })).toContain(
      `${PIPELINE_CONFIG.format.minChars}〜${PIPELINE_CONFIG.format.maxChars}字`,
    );
    expect(PIPELINE_CONFIG.format.maxChars).toBeLessThanOrEqual(
      PIPELINE_CONFIG.qualityGate.maxBodyLength,
    );
  });

  it('builds title and editor rules', () => {
    expect(buildIdeazTitleRules()).toContain('約束が一つ');
    expect(buildIdeazEditorRules()).toContain('【出力の形。ここ絶対】');
  });

  it('section() throws loudly on a missing heading', () => {
    expect(() => section('## a\nx', 'b')).toThrow(/section not found/);
  });
});
