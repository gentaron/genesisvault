/**
 * Phase κ — Deterministic Content Lint
 *
 * Rule-based checks over the published corpus (`src/content/posts/`).
 * No model call, no network, no API key — every finding here is
 * reproducible offline and identical on every machine.
 *
 * This is the "verification" half of the workflow: generation is cheap,
 * judging correctness is the bottleneck, so anything a rule can catch is
 * caught by a rule and never sent to an LLM.
 *
 * Astro's content collection schema already validates frontmatter types
 * at build time. These checks cover what the build cannot see:
 *   - filename ↔ frontmatter date agreement
 *   - agent credits that reference agents not in config/pipeline.json
 *   - placeholder / unfinished-generation artifacts that shipped anyway
 *   - empty or truncated bodies
 */

import { parse as parseYaml } from 'yaml';
import { PIPELINE_CONFIG } from './config.js';

export interface ContentIssue {
  file: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedPost {
  frontmatter: Record<string, unknown>;
  body: string;
}

/** Split a Markdown file into YAML frontmatter and body. Returns null if absent/invalid. */
export function parsePost(raw: string): ParsedPost | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = parseYaml(match[1]);
    if (!frontmatter || typeof frontmatter !== 'object') return null;
    return { frontmatter: frontmatter as Record<string, unknown>, body: match[2] ?? '' };
  } catch {
    return null;
  }
}

/** Extract the leading `YYYY-MM-DD` from a post filename. */
export function dateFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
  return match ? match[1] : null;
}

/** Normalize a frontmatter date (Date object or string) to `YYYY-MM-DD`. */
export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  return null;
}

const KNOWN_AGENT_IDS = new Set(PIPELINE_CONFIG.agents.map((a) => a.id));
const PLACEHOLDER_PATTERNS = PIPELINE_CONFIG.qualityGate.placeholderPatterns.map(
  (p) => new RegExp(p, 'i'),
);

/**
 * Lint one post. `filename` is the basename used for the date check.
 */
export function lintPost(filename: string, raw: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (rule: string, message: string, severity: 'error' | 'warning' = 'error') =>
    issues.push({ file: filename, rule, message, severity });

  const parsed = parsePost(raw);
  if (!parsed) {
    add('frontmatter_parse', 'フロントマターを解析できません（--- で囲まれた YAML が必要）');
    return issues;
  }

  const { frontmatter, body } = parsed;

  // 1. Required fields
  const title = frontmatter.title;
  if (typeof title !== 'string' || title.trim().length === 0) {
    add('required_title', 'title が空または文字列ではありません');
  }

  const fmDate = normalizeDate(frontmatter.date);
  if (!fmDate) {
    add('required_date', 'date が無いか YYYY-MM-DD として解釈できません');
  }

  // 2. Filename ↔ frontmatter date agreement
  const fileDate = dateFromFilename(filename);
  if (!fileDate) {
    add('filename_date', 'ファイル名が YYYY-MM-DD- で始まっていません', 'warning');
  } else if (fmDate && fileDate !== fmDate) {
    add('filename_date', `ファイル名の日付 (${fileDate}) と frontmatter.date (${fmDate}) が不一致`);
  }

  // 3. Agent credits must exist in config/pipeline.json
  const agents = frontmatter.agents;
  if (agents && typeof agents === 'object') {
    for (const [role, credit] of Object.entries(agents as Record<string, unknown>)) {
      if (typeof credit !== 'string') continue;
      const idMatch = credit.match(/VE-\d{3}/);
      if (!idMatch) {
        add(
          'agent_credit',
          `agents.${role} にエージェント ID (VE-xxx) がありません: "${credit}"`,
          'warning',
        );
      } else if (!KNOWN_AGENT_IDS.has(idMatch[0])) {
        add(
          'agent_credit',
          `agents.${role} が config/pipeline.json に無いエージェントを指しています: ${idMatch[0]}`,
        );
      }
    }
  }

  // 4. Body must exist and not be a stub
  const strippedBody = body.replace(/\s/g, '');
  if (strippedBody.length === 0) {
    add('empty_body', '本文が空です');
  }

  // 5. Placeholders that survived generation
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(body)) {
      add('placeholder', `未完成のプレースホルダーが残っています: /${pattern.source}/`);
    }
  }

  return issues;
}

/**
 * Lint a whole corpus. `posts` maps filename → raw file contents.
 * Also reports cross-file problems (duplicate dates are allowed but
 * flagged, since the pipeline is idempotent per day).
 */
export function lintCorpus(posts: Record<string, string>): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const byDate = new Map<string, string[]>();

  for (const [filename, raw] of Object.entries(posts)) {
    issues.push(...lintPost(filename, raw));

    const parsed = parsePost(raw);
    const date = parsed ? normalizeDate(parsed.frontmatter.date) : dateFromFilename(filename);
    if (date) {
      const list = byDate.get(date) ?? [];
      list.push(filename);
      byDate.set(date, list);
    }
  }

  for (const [date, files] of byDate) {
    if (files.length > 1) {
      issues.push({
        file: files.join(', '),
        rule: 'duplicate_date',
        message: `同じ日付 (${date}) の記事が ${files.length} 件あります（パイプラインは1日1記事が前提）`,
        severity: 'warning',
      });
    }
  }

  return issues;
}
