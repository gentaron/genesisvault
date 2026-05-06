/**
 * Genesis Vault — Multi-Agent AI Blog Post Generator
 *
 * Phase γ — Modular Pipeline
 *
 * 5-Agent Pipeline:
 *   VE-005  Nova Harmon       (Balancer) … テーマバランス分析・ジャンル選定
 *   VE-001  Lena Strauss      (CEO)      … トピック・切り口・タイトルの決定
 *   VE-003  Chloe Verdant     (SEO)      … タグ・キーワード・メタディスクリプション生成
 *   VE-002  Sophia Nightingale(Writer)   … 本文執筆（1,000〜2,000字、日記体）
 *   VE-006  Iris Koenig       (Editor)   … 校正・品質チェック・ペルソナ一貫性確認
 *
 * Persona: Mina Eureka Ernst — Genesis Vault の著者
 *
 * AI modules: src/lib/ai/providers.ts, generate.ts, telemetry.ts
 * Agent modules: src/lib/agents/schemas.ts, shared.ts, runners.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Phase γ imports ──────────────────────────────────────────
import {
  THEME_KEYWORDS,
  pick,
  pickN,
  todayISO,
  slugify,
  categorizeByTheme,
  buildThemePriorityList,
  generateFallbackPost,
} from '../src/lib/agents/shared.ts';
import {
  runNova,
  runLena,
  runChloe,
  runSophia,
  runIris,
} from '../src/lib/agents/runners.ts';
import { readRecentTelemetry } from '../src/lib/ai/telemetry.ts';

// ─── Phase η: Sentry for script errors (optional) ────────────
let captureException = (e) => console.error('[Sentry unavailable]', e);
try {
  const { initSentryNode } = await import('../src/lib/sentry-script.ts');
  initSentryNode();
  const sentryMod = await import('@sentry/node');
  captureException = sentryMod.captureException;
} catch {
  // Sentry optional — pipeline works without it
}

// ─── Paths ────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, 'src', 'content', 'posts');
const AGENT_RUNS_DIR = path.join(ROOT_DIR, 'docs', 'agent-runs');

const MOODS = ['🌿', '💭', '📖', '✨', '🌸', '🍃', '🔥', '🌊', '🌙', '☕'];
const WEATHERS = ['☀️', '☁️', '🌧️', '🌤️', '⛅', '🌈', '❄️', '🌬️'];

// ─── Phase η: Agent Telemetry Summary ─────────────────────────
const AGENT_NAMES = {
  'VE-005': 'Nova',
  'VE-001': 'Lena',
  'VE-003': 'Chloe',
  'VE-002': 'Sophia',
  'VE-006': 'Iris',
};

async function appendTelemetrySummary(articleSlug) {
  try {
    const telemetry = await readRecentTelemetry(10);
    if (telemetry.length === 0) return;

    const today = todayISO().substring(0, 7); // YYYY-MM
    const runsFile = path.join(AGENT_RUNS_DIR, `${today}.md`);
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    // Aggregate per-agent stats
    const agentStats = {};
    let totalLatency = 0;

    for (const entry of telemetry) {
      const key = entry.agentId;
      if (!agentStats[key]) {
        agentStats[key] = {
          agentName: AGENT_NAMES[entry.agentId] || entry.agentName || 'Unknown',
          provider: entry.provider,
          attempts: entry.attempts,
          latencyMs: entry.latencyMs,
          success: entry.success,
          errors: entry.errors || [],
        };
      }
      totalLatency += entry.latencyMs;
    }

    let summary = `\n${now}\n`;
    for (const [agentId, stats] of Object.entries(agentStats)) {
      const errorNote = !stats.success ? ` (FAILED: ${stats.errors.map(e => e.message).join(', ')})` : '';
      const fallbackNote = stats.provider !== 'gemini-flash-lite' ? ` (${stats.provider})` : '';
      summary += `- ${agentId} ${stats.agentName}: ${stats.provider}, ${stats.attempts} attempt${stats.attempts > 1 ? 's' : ''}, ${(stats.latencyMs / 1000).toFixed(1)}s${fallbackNote}${errorNote}\n`;
    }
    summary += `Total: ${(totalLatency / 1000).toFixed(1)}s | Article: src/content/posts/${articleSlug}.md\n`;

    await fs.mkdir(AGENT_RUNS_DIR, { recursive: true });
    await fs.appendFile(runsFile, summary, 'utf-8');
    console.log(`📋 Telemetry summary appended to docs/agent-runs/${today}.md`);
  } catch {
    // Telemetry summary is non-critical
  }
}

// ─── Structured Logging ───────────────────────────────────────
function logAgent(agentId, agentName, action, result, error) {
  const timestamp = new Date().toISOString();
  const log = {
    timestamp,
    agent: `${agentId} ${agentName}`,
    action,
    result: result ? result.substring(0, 100) : undefined,
    error,
  };
  console.log(JSON.stringify(log));
}

// ─── Pipeline State (Resume from Failure) ─────────────────────
const STATE_FILE = path.join(ROOT_DIR, '.pipeline-state.json');

async function savePipelineState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function loadPipelineState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function clearPipelineState() {
  try { await fs.unlink(STATE_FILE); } catch { /* ignore */ }
}

// ─── Agent Result Validation ──────────────────────────────────
function validateCEOPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (!plan.title || typeof plan.title !== 'string') return false;
  if (!plan.theme || typeof plan.theme !== 'string') return false;
  if (plan.title.length > 50) return false;
  return true;
}

function validateSEOData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.tags) || data.tags.length === 0) return false;
  if (!data.description || data.description.length > 200) return false;
  return true;
}

// ─── Reference Data Extraction ────────────────────────────────
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

// ─── Theme Balance Analysis ───────────────────────────────────

async function analyzeThemeBalance(recentPostsLimit = 20) {
  // gensnotes: what topics already exist in the source material
  const gensnotesTitles = await extractArticleSummaries();
  const gensnotesCount = categorizeByTheme(gensnotesTitles);

  // Recent local posts: what themes were used lately
  const recentCount = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
  const recentPostTitles = [];
  try {
    const files = await fs.readdir(POSTS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort().slice(-recentPostsLimit);
    for (const file of mdFiles) {
      const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf-8');
      const titleMatch = raw.match(/^title:\s*"?(.+?)"?\s*$/m);
      const tagsMatch  = raw.match(/^tags:\s*\[([^\]]+)\]/m);
      const searchable = [
        titleMatch?.[1] ?? '',
        tagsMatch?.[1]  ?? '',
      ].join(' ');

      if (titleMatch?.[1]) recentPostTitles.push(titleMatch[1]);

      for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
        if (keywords.some(kw => searchable.includes(kw))) {
          recentCount[theme]++;
          break;
        }
      }
    }
  } catch { /* POSTS_DIR may not exist yet */ }

  return { gensnotesCount, recentCount, recentPostTitles: recentPostTitles.reverse() };
}

// ═══════════════════════════════════════════════════════════════
// Main Pipeline
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Genesis Vault — Multi-Agent Post Generator       ║');
  console.log('║  Phase γ — Modular AI Pipeline                     ║');
  console.log('║  Persona: Mina Eureka Ernst                       ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`📅 Date: ${todayISO()}`);

  const DRY_RUN = process.env.DRY_RUN === 'true';
  if (DRY_RUN) {
    console.log('🔧 DRY RUN MODE — post will not be saved to disk');
  }
  console.log('');

  // ── Idempotency: skip if today's post already exists ──────────
  const todayFile = `${todayISO()}-`;
  try {
    const existingFiles = await fs.readdir(POSTS_DIR);
    const alreadyExists = existingFiles.some(f => f.startsWith(todayFile));
    if (alreadyExists) {
      console.log(`Post for ${todayISO()} already exists. Skipping.`);
      logAgent('SYSTEM', 'Idempotency', 'skip', `Post for ${todayISO()} already exists`);
      process.exit(0);
    }
  } catch {
    // POSTS_DIR may not exist yet — that's fine, continue
  }

  // ── Resume from failure: check for saved pipeline state ────────
  const savedState = await loadPipelineState();
  if (savedState && savedState.date === todayISO()) {
    console.log(`Resuming pipeline from step: ${savedState.step}`);
    logAgent('SYSTEM', 'Resume', 'resumed', `Step: ${savedState.step}`);
  }

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
    // ── Agent 0: Balancer (Nova) ──────────────────────────
    const assignedTheme = await runNova(themeBalance, themeBalance.recentPostTitles);
    logAgent('VE-005', 'Nova Harmon', 'theme_selected', assignedTheme);
    await savePipelineState({ step: 'balancer', data: { assignedTheme }, date: todayISO() });
    console.log('');

    // ── Agent 1: CEO (Lena) ────────────────────────────────
    ceoPlan = await runLena(titles, styleSamples, assignedTheme);
    if (!validateCEOPlan(ceoPlan)) {
      console.warn('  ⚠️  CEO plan validation failed — using fallback');
      logAgent('VE-001', 'Lena Strauss', 'validation_failed', JSON.stringify(ceoPlan));
      throw new Error('CEO plan validation failed');
    }
    logAgent('VE-001', 'Lena Strauss', 'topic_selected', ceoPlan.title);
    await savePipelineState({ step: 'ceo', data: ceoPlan, date: todayISO() });
    console.log('');

    // ── Agent 2: SEO (Chloe) ───────────────────────────────
    seoData = await runChloe(ceoPlan);
    if (!validateSEOData(seoData)) {
      console.warn('  ⚠️  SEO data validation failed — using fallback');
      logAgent('VE-003', 'Chloe Verdant', 'validation_failed', JSON.stringify(seoData));
      throw new Error('SEO data validation failed');
    }
    logAgent('VE-003', 'Chloe Verdant', 'seo_generated', seoData.tags.join(', '));
    await savePipelineState({ step: 'seo', data: seoData, date: todayISO() });
    console.log('');

    // ── Agent 3: Writer (Sophia) ───────────────────────────
    const draft = await runSophia(ceoPlan, seoData, styleSamples);
    if (!draft) throw new Error('Writer Agent returned empty');
    logAgent('VE-002', 'Sophia Nightingale', 'draft_written', `${draft.length} chars`);
    await savePipelineState({ step: 'writer', data: { draftLength: draft.length }, date: todayISO() });
    console.log('');

    // ── Agent 4: Editor (Iris) ─────────────────────────────
    const edited = await runIris(ceoPlan, seoData, draft);
    finalBody = edited || draft; // If editor fails, use the draft
    logAgent('VE-006', 'Iris Koenig', 'editing_complete', `${finalBody.length} chars`);
    console.log('');

  } catch (err) {
    logAgent('SYSTEM', 'Pipeline', 'error', undefined, err.message);
    console.error(`❌ Agent Pipeline Error: ${err.message}`);
    console.log('📋 Falling back to template...');
    const fallback = generateFallbackPost(themeBalance);
    ceoPlan = fallback.ceoPlan;
    seoData = fallback.seoData;
    finalBody = fallback.body;
    // Phase η: Report to Sentry
    try { captureException(err); } catch { /* best effort */ }
  }

  // ── Clear pipeline state on success ───────────────────────
  await clearPipelineState();

  // ── Build frontmatter & save ──────────────────────────────
  const moodMap = { '静寂': '📖', '思索': '💭', '平和': '🌿', '発見': '✨', '情熱': '🔥', '充実': '🌸', '自由': '🍃' };
  const moodEmoji = moodMap[ceoPlan.mood_hint] || mood;
  const moodLabel = ceoPlan.mood_hint || '思索';

  // Clean finalBody: remove any accidental frontmatter, code fences, or title
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
  // Strip leading title line (# or ##) if it matches the planned title
  const titlePattern = ceoPlan.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cleanBody = cleanBody.replace(new RegExp(`^#{1,2}\\s*${titlePattern}\\s*\n+`), '').trim();

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
  balancer: "VE-005 Nova Harmon"
  ceo: "VE-001 Lena Strauss"
  seo: "VE-003 Chloe Verdant"
  writer: "VE-002 Sophia Nightingale"
  editor: "VE-006 Iris Koenig"
---

${cleanBody}
`;

  if (DRY_RUN) {
    console.log('═══════════════════════════════════════════════════');
    console.log('🔧 DRY RUN — skipping file write');
    console.log(`📝 Title: ${ceoPlan.title}`);
    console.log(`🏷️  Tags: ${seoData.tags.join(', ')}`);
    console.log(`🔑 Keywords: ${seoData.keywords.join(', ')}`);
    console.log(`📄 Body preview (${cleanBody.length} chars):`);
    console.log(cleanBody.substring(0, 300) + '...');
    console.log('═══════════════════════════════════════════════════');
    return;
  }

  await fs.mkdir(POSTS_DIR, { recursive: true });
  const filePath = path.join(POSTS_DIR, filename);
  await fs.writeFile(filePath, content, 'utf-8');

  // Phase η: Append agent telemetry summary to public log
  await appendTelemetrySummary(`${todayISO()}-${slug}`);

  console.log('═══════════════════════════════════════════════════');
  console.log('✅ 記事生成完了！');
  console.log(`📄 File: ${filePath}`);
  console.log(`📝 Title: ${ceoPlan.title}`);
  console.log(`🏷️  Tags: ${seoData.tags.join(', ')}`);
  console.log(`🔑 Keywords: ${seoData.keywords.join(', ')}`);
  console.log('');
  console.log('Agent Pipeline:');
  console.log('  VE-005 Nova Harmon      (Balancer) → ジャンル選定 ✅');
  console.log('  VE-001 Lena Strauss     (CEO)      → トピック決定 ✅');
  console.log('  VE-003 Chloe Verdant    (SEO)      → SEO最適化   ✅');
  console.log('  VE-002 Sophia Nightingale(Writer)  → 本文執筆    ✅');
  console.log('  VE-006 Iris Koenig      (Editor)   → 校正・品質  ✅');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
