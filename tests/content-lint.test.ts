import { describe, expect, it } from 'vitest';
import {
  dateFromFilename,
  lintCorpus,
  lintPost,
  normalizeDate,
  parsePost,
} from '../src/lib/pipeline/content-lint';

const VALID = `---
title: "静かな朝の散歩"
date: 2026-07-27
tags: ["散歩", "マインドフルネス"]
description: "朝の散歩で見つけた小さな発見について。"
agents:
  writer: "VE-002 Sophia Nightingale"
  editor: "VE-006 Iris Koenig"
---

今朝は少し早く目が覚めたので、いつもより長めに歩いてみた。
`;

function issueRules(issues: { rule: string }[]) {
  return issues.map((i) => i.rule);
}

describe('Phase κ — Deterministic Content Lint', () => {
  describe('parsePost', () => {
    it('splits frontmatter and body', () => {
      const parsed = parsePost(VALID);
      expect(parsed).not.toBeNull();
      expect(parsed?.frontmatter.title).toBe('静かな朝の散歩');
      expect(parsed?.body).toContain('今朝は少し早く');
    });

    it('returns null without frontmatter', () => {
      expect(parsePost('本文だけのファイル')).toBeNull();
    });

    it('returns null on malformed YAML', () => {
      expect(parsePost('---\ntitle: "unclosed\n  bad: [\n---\nbody')).toBeNull();
    });
  });

  describe('dateFromFilename / normalizeDate', () => {
    it('reads the leading date from a filename', () => {
      expect(dateFromFilename('2026-07-27-post-abc123.md')).toBe('2026-07-27');
      expect(dateFromFilename('no-date-here.md')).toBeNull();
    });

    it('normalizes Date objects and strings', () => {
      expect(normalizeDate(new Date('2026-07-27T00:00:00Z'))).toBe('2026-07-27');
      expect(normalizeDate('2026-07-27')).toBe('2026-07-27');
      expect(normalizeDate('not a date')).toBeNull();
      expect(normalizeDate(undefined)).toBeNull();
    });
  });

  describe('lintPost', () => {
    it('accepts a well-formed post', () => {
      expect(lintPost('2026-07-27-post-abc123.md', VALID)).toEqual([]);
    });

    it('flags a filename/frontmatter date mismatch', () => {
      const issues = lintPost('2026-07-01-post-abc123.md', VALID);
      expect(issueRules(issues)).toContain('filename_date');
      expect(issues[0].severity).toBe('error');
    });

    it('flags a missing title', () => {
      const issues = lintPost(
        '2026-07-27-x.md',
        VALID.replace('title: "静かな朝の散歩"', 'title: ""'),
      );
      expect(issueRules(issues)).toContain('required_title');
    });

    it('flags an agent id that is not in config/pipeline.json', () => {
      const issues = lintPost(
        '2026-07-27-x.md',
        VALID.replace('VE-002 Sophia Nightingale', 'VE-404 Ghost Agent'),
      );
      expect(issueRules(issues)).toContain('agent_credit');
    });

    it('accepts every agent id that is in config/pipeline.json', () => {
      const issues = lintPost(
        '2026-07-27-x.md',
        VALID.replace('VE-002 Sophia Nightingale', 'VE-008 Mira Falk'),
      );
      expect(issueRules(issues)).not.toContain('agent_credit');
    });

    it('flags a placeholder that survived generation', () => {
      const issues = lintPost(
        '2026-07-27-x.md',
        VALID.replace(
          '今朝は少し早く目が覚めたので、いつもより長めに歩いてみた。',
          '[TODO] あとで書く',
        ),
      );
      expect(issueRules(issues)).toContain('placeholder');
    });

    it('flags an empty body', () => {
      const bodyless = '---\ntitle: "空の記事"\ndate: 2026-07-27\n---\n\n   \n';
      expect(issueRules(lintPost('2026-07-27-x.md', bodyless))).toContain('empty_body');
    });

    it('reports unparseable frontmatter once and stops', () => {
      const issues = lintPost('2026-07-27-x.md', 'no frontmatter at all');
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe('frontmatter_parse');
    });
  });

  describe('lintCorpus', () => {
    it('warns about two posts on the same date', () => {
      const issues = lintCorpus({
        '2026-07-27-a.md': VALID,
        '2026-07-27-b.md': VALID,
      });
      const dup = issues.find((i) => i.rule === 'duplicate_date');
      expect(dup).toBeDefined();
      expect(dup?.severity).toBe('warning');
    });

    it('is silent on a clean corpus', () => {
      const issues = lintCorpus({
        '2026-07-27-a.md': VALID,
        '2026-07-28-b.md': VALID.replace('date: 2026-07-27', 'date: 2026-07-28'),
      });
      expect(issues).toEqual([]);
    });
  });
});
