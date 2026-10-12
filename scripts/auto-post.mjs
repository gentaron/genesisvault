/**
 * Genesis Vault — Multi-Agent AI Blog Post Generator
 *
 * Phase γ — Modular Pipeline / Phase ι — Continuity Subsystem
 * Phase ν — Trend Radar（外部トレンド取り込み）＋ 継続性ゲート
 *
 * 9-Agent Pipeline (この工程で走るぶん):
 *   VE-010  Tessa Brandt      (Scout)    … AI/技術トレンドと相場の地合いを収集
 *   VE-004  Vera Holt         (Researcher)… 過去記事から確定事実を抽出（継続性）
 *   VE-005  Nova Harmon       (Balancer) … テーマバランス分析・ジャンル選定
 *   VE-001  Lena Strauss      (CEO)      … トピック・切り口・タイトルの決定
 *   VE-003  Chloe Verdant     (SEO)      … タグ・キーワード・メタディスクリプション生成
 *   VE-002  Sophia Nightingale(Writer)   … 本文執筆（1,000〜2,000字、日記体）
 *   VE-006  Iris Koenig       (Editor)   … 校正・品質チェック・ペルソナ一貫性確認
 *   VE-007  Edda Lindgren     (Summarizer)… 抽出事実を継続性台帳へ統合
 *   VE-008  Mira Falk         (Recorder) … 投稿記事の事実を台帳へ記録・更新
 *
 * 継続性サブシステム(Vera→Edda)が「過去記事と矛盾・逆行しない」ためのブリーフを
 * 生成し、CEO/Writer に注入する。投稿後に Mira が台帳を更新する。
 *
 * Persona: Mina Eureka Ernst — Genesis Vault の著者
 *
 * AI modules: src/lib/ai/providers.ts, generate.ts, telemetry.ts
 * Agent modules: src/lib/agents/schemas.ts, shared.ts, runners.ts, continuity.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Phase γ imports ──────────────────────────────────────────
import {
  THEME_KEYWORDS,
  REFERENCE_FILES,
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
import {
  findRelatedArticles,
  buildTopicContinuityBrief,
  detectDuplicateTitle,
  buildTitleDupFeedback,
} from '../src/lib/agents/continuity.ts';
import {
  runResearcher,
  runSummarizer,
  runRecorder,
  loadDiaryArticles,
  loadLedger,
  saveLedger,
  detectRegressions,
  buildRegressionFeedback,
} from '../src/lib/agents/continuity.ts';
import {
  runScout,
  buildTrendBrief,
  saveTrendRadar,
} from '../src/lib/agents/trends.ts';
import { readRecentTelemetry } from '../src/lib/ai/telemetry.ts';
import {
  runKaia,
  buildFinanceBrief,
  saveFinancePulse,
} from '../src/lib/finance/pulse.ts';
import { generateCandidates, reviewCandidates } from '../src/lib/selection/candidates.ts';
import { runJuno, buildSelectionBrief, appendSelectionLog } from '../src/lib/selection/select.ts';
import { semanticNearest } from '../src/lib/selection/semantic.ts';
import {
  runClefReview,
  buildClefFeedback,
  appendClefReviewLog,
} from '../src/lib/pipeline/clef-review.ts';
import {
  isIdeazFormat,
  buildIdeazWriterBrief,
  buildIdeazTitleRules,
  buildIdeazEditorRules,
} from '../src/lib/format/ideaz.ts';
import { SELECTION_CONFIG, CLEF_REVIEW_CONFIG } from '../src/lib/pipeline/config.ts';
import rawPipelineConfig from '../config/pipeline.json' with { type: 'json' };
import { runQualityGate } from '../src/lib/pipeline/quality-gate.ts';

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
  'VE-010': 'Tessa',
  'VE-011': 'Kaia',
  'VE-012': 'Juno',
  'VE-004': 'Vera',
  'VE-005': 'Nova',
  'VE-001': 'Lena',
  'VE-003': 'Chloe',
  'VE-002': 'Sophia',
  'VE-006': 'Iris',
  'VE-007': 'Edda',
  'VE-008': 'Mira',
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
  for (const filename of REFERENCE_FILES) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const titleRegex = /<title>\s*<!\[CDATA\[\s*(.+?)\s*\]\]>\s*<\/title>/g;
    for (let match = titleRegex.exec(raw); match !== null; match = titleRegex.exec(raw)) {
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
  for (const filename of REFERENCE_FILES) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const contentRegex = /<content:encoded>\s*<!\[CDATA\[\s*([\s\S]*?)\s*\]\]>\s*<\/content:encoded>/g;
    for (let match = contentRegex.exec(raw); match !== null; match = contentRegex.exec(raw)) {
      const text = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().substring(0, 500);
      if (text.length > 100) samples.push(text);
    }
  }
  return pickN(samples, maxSamples);
}

async function extractArticles() {
  const articles = [];
  for (const filename of REFERENCE_FILES) {
    const filepath = path.join(ROOT_DIR, filename);
    let raw;
    try {
      raw = await fs.readFile(filepath, 'utf-8');
    } catch {
      continue;
    }
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    for (let match = itemRegex.exec(raw); match !== null; match = itemRegex.exec(raw)) {
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
// ─── 工程の記録 ─────────────────────────────────────────────────
//
// どの日も、全工程を ✅（通った）/ ⚠️（劣化して通った）/ ❌（失敗）/ ⏭️（理由つきで飛ばした）
// のどれかで残す。「何も言わずに飛ばす」を構造的に起こさないため、工程は必ず stage() を通る。
// 最後に表にして標準出力と GitHub の Job Summary（$GITHUB_STEP_SUMMARY）へ出す。
const stages = [];
const STAGE_ICON = { ok: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
function stage(id, name, status, detail = '') {
  stages.push({ id, name, status, detail: String(detail ?? '') });
}

function summarizeChecks(verdict) {
  return verdict.checks.map(c => `${c.passed ? '✓' : '✗'}${c.id}${c.value == null ? '' : ` ${Math.round(c.value * 100)}%`}`).join(' ');
}

/** 監査ログのディレクトリ内の今月のファイルに、marker で始まる見出しがもうあるか。 */
async function hasLogEntry(dir, marker) {
  try {
    const text = await fs.readFile(path.join(dir, `${todayISO().slice(0, 7)}.md`), 'utf-8');
    return text.includes(marker);
  } catch {
    return false;
  }
}

/**
 * 観測モード: 公開済みの今日の記事を Clef で事後審査する。書き直しはしない（公開済みのため）。
 * 同じ記事を同じ日に何度も審査しない（gate-runs に記録があれば ⏭️）。
 */
async function auditExistingPost(filePath, dryRun) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    stage('Clef 審査', '公開済み記事の事後審査', 'warn', `記事を読めない: ${err.message?.substring(0, 80)}`);
    return;
  }
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const title = fm?.[1].match(/^title:\s*"?(.*?)"?\s*$/m)?.[1]?.replace(/\\"/g, '"') ?? path.basename(filePath);
  const body = fm ? raw.slice(fm[0].length).trim() : raw;
  const marker = `## ${todayISO()} Clef 審査 —「${title}」`;
  if (await hasLogEntry(path.join(ROOT_DIR, CLEF_REVIEW_CONFIG.auditLogDir), marker)) {
    stage('Clef 審査', '公開済み記事の事後審査', 'skip', `「${title}」は今日すでに審査済み（${CLEF_REVIEW_CONFIG.auditLogDir}）`);
    return;
  }
  console.log(`⚖️  Clef Review（事後）: 公開済みの「${title}」を審査しています…`);
  const verdict = await runClefReview(`題材: ${title}（公開済み記事の事後審査）`, title, body);
  if (!verdict.available) {
    console.log(`   ⏭️  審査なし（${verdict.notes.join(' / ') || '判断モデルが使えません'}）`);
    stage('Clef 審査', '公開済み記事の事後審査', CLEF_REVIEW_CONFIG.enabled ? 'warn' : 'skip', verdict.notes.join(' / ') || '判断モデルが使えない');
    return;
  }
  for (const c of verdict.checks) {
    console.log(`   ${c.passed ? '✅' : '❌'} ${c.label}: ${c.value == null ? '—' : `${Math.round(c.value * 100)}%`}`);
  }
  logAgent('SYSTEM', 'ClefReview', verdict.passed ? 'audit_passed' : 'audit_failed', summarizeChecks(verdict));
  stage('Clef 審査', '公開済み記事の事後審査', verdict.passed ? 'ok' : 'fail', `${verdict.model} / ${summarizeChecks(verdict)}`);
  if (!dryRun) {
    try {
      await appendClefReviewLog(ROOT_DIR, todayISO(), title, [verdict]);
    } catch { /* 記録の失敗で止めない */ }
  }
}

async function reportStages(mode) {
  const label = { publish: '新規投稿', observe: '観測（記事は既にあり）', 'dry-run': 'DRY RUN' }[mode] ?? mode;
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log(`🧾 工程の記録 — ${todayISO()} / ${label}`);
  for (const s of stages) {
    console.log(`  ${STAGE_ICON[s.status]} ${s.id.padEnd(22)} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  }
  const count = st => stages.filter(s => s.status === st).length;
  console.log(`  計 ${stages.length} 工程: ✅${count('ok')} ⚠️${count('warn')} ❌${count('fail')} ⏭️${count('skip')}`);
  console.log('═══════════════════════════════════════════════════');

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  const esc = t => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = [
    `## 🧾 Genesis Vault — ${todayISO()}（${label}）`,
    '',
    '| | 係 | 工程 | 内容 |',
    '|---|---|---|---|',
    ...stages.map(s => `| ${STAGE_ICON[s.status]} | ${esc(s.id)} | ${esc(s.name)} | ${esc(s.detail)} |`),
    '',
    `✅${count('ok')} ⚠️${count('warn')} ❌${count('fail')} ⏭️${count('skip')}`,
    '',
  ].join('\n');
  try {
    await fs.appendFile(summaryFile, md, 'utf-8');
  } catch { /* Job Summary が書けなくても本処理は止めない */ }
}

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

  // ── Idempotency: 今日の記事が既にある日は「観測モード」 ─────────────
  //
  // 以前はここで process.exit(0) していた。手動実行で先に記事を書いた日は、
  // 定期実行が財務パルスも選定も審査も一切通らずに 0 秒で終わっていた
  // （2026-10-11 の #248）。「毎日財務を見る」が手動実行1回で崩れる。
  // 今は二重投稿だけを止め、観測系（Tessa・Kaia・台帳・選定・Clef 審査）は毎回通す。
  const todayFile = `${todayISO()}-`;
  let existingPost = null;
  try {
    const existingFiles = await fs.readdir(POSTS_DIR);
    existingPost = existingFiles.find(f => f.startsWith(todayFile)) ?? null;
  } catch {
    // POSTS_DIR may not exist yet — that's fine, continue
  }
  const observeOnly = Boolean(existingPost) && !process.env.GV_THEME;
  if (observeOnly) {
    console.log(`👁️  ${todayISO()} の記事は既にあります（${existingPost}）。二重投稿はせず、観測系の工程だけを全部通します。`);
    logAgent('SYSTEM', 'Idempotency', 'observe', `Post for ${todayISO()} already exists: ${existingPost}`);
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

  // ── VE-010 Tessa (Scout): 今日の外の景色 ───────────────────────
  // AI・最先端技術の話題と株式市場の地合いを集めて企画/執筆に渡す。
  // fail-soft: 取れなければトレンド無しで続行する（記事は書ける）。
  let trendRadar = null;
  try {
    trendRadar = await runScout(ROOT_DIR);
    if (trendRadar && !DRY_RUN) await saveTrendRadar(ROOT_DIR, trendRadar);
    if (trendRadar) {
      logAgent(
        'VE-010',
        'Tessa Brandt',
        'trends_collected',
        `tech=${trendRadar.tech.length} market=${trendRadar.market.length}`,
      );
    }
  } catch (err) {
    console.warn(`  ⚠️  Scout failed: ${err.message?.substring(0, 120)}`);
  }
  stage(
    'VE-010 Tessa', 'トレンド収集',
    !trendRadar ? 'warn' : trendRadar.degraded || trendRadar.capturedAt !== todayISO() ? 'warn' : 'ok',
    trendRadar
      ? `${trendRadar.capturedAt !== todayISO() ? `${trendRadar.capturedAt} のスナップショットで代用 / ` : ''}技術${trendRadar.tech.length}件 / 相場${trendRadar.market.length}件${trendRadar.notes.length ? `（${trendRadar.notes.join(' / ')}）` : ''}`
      : '取得できず',
  );
  // ── VE-011 Kaia (Treasurer): QAIZ と assetlog の財務パルス ────────
  // 金額は持たず、変化率と記号の事実だけ。fail-soft（取れなければ無しで書く）。
  let financePulse = null;
  try {
    financePulse = await runKaia(ROOT_DIR);
    if (financePulse && !DRY_RUN) await saveFinancePulse(ROOT_DIR, financePulse);
    if (financePulse) {
      logAgent('VE-011', 'Kaia Brennan', 'pulse_collected', financePulse.predicates.join(',') || 'none');
    }
  } catch (err) {
    console.warn(`  ⚠️  Treasurer failed: ${err.message?.substring(0, 120)}`);
  }
  stage(
    'VE-011 Kaia', '財務パルス（assetlog・QAIZ）',
    financePulse && financePulse.portfolio && financePulse.market ? 'ok' : 'warn',
    financePulse
      ? `assetlog ${financePulse.portfolio ? '✓' : '✗'} / QAIZ ${financePulse.market ? '✓' : '✗'} / 記号: ${financePulse.predicates.join(', ') || 'なし'}`
      : '取得できず',
  );
  const financeBrief = buildFinanceBrief(financePulse);

  const trendBrief = [buildTrendBrief(trendRadar), financeBrief ? `【今日のお金の景色】\n${financeBrief}` : '']
    .filter(Boolean)
    .join('\n\n');
  if (trendBrief) console.log(`  📡 トレンド・財務ブリーフを執筆陣へ注入します（${trendBrief.length}字）`);
  console.log('');

  // ── Continuity subsystem (過去記事整合性) ──────────────────────
  // VE-004 Vera (Researcher) → VE-007 Edda (Summarizer) で台帳を構築し、
  // 「継続性ブリーフ」を執筆陣(Lena/Sophia)に注入して過去との逆行を防ぐ。
  // VE-008 Mira (Recorder) は投稿後に台帳を更新する（本処理の末尾）。
  //
  // 台帳は毎回 src/content/posts から作り直す。以前はファイルが在れば
  // そのまま使っていたが、日次ジョブは台帳をコミットしていなかったので、
  // 記事が増えても正典が数週間前のまま凍りついていた（LM-013）。
  // 走査は 170 本強のローカルファイルで、LLM もネットワークも使わない。
  // 「導出できるものは導出する」ほうが、更新漏れの心配より安い。
  console.log('🧭 Building continuity ledger (過去記事との整合性)...');
  let ledger = await loadLedger(ROOT_DIR);
  const pastArticles = await loadDiaryArticles(ROOT_DIR);
  try {
    const mined = runResearcher(pastArticles);
    ledger = runSummarizer(mined, ledger);
    ledger.diaryArticleCount = pastArticles.length;
    if (!DRY_RUN) await saveLedger(ROOT_DIR, ledger);
    logAgent('VE-004', 'Vera Holt', 'facts_mined', `${mined.length} facts`);
    logAgent('VE-007', 'Edda Lindgren', 'ledger_built', `${ledger.facts.length} canon facts`);
    stage('VE-004/007 Vera・Edda', '継続性台帳', 'ok', `過去記事${pastArticles.length}本 → 確定事実${ledger.facts.length}件`);
  } catch (err) {
    stage('VE-004/007 Vera・Edda', '継続性台帳', 'warn', `作り直し失敗: ${err.message?.substring(0, 80)}`);
    console.warn(`  ⚠️  Continuity build failed: ${err.message?.substring(0, 120)}`);
    // 作り直しに失敗したら、読み込んだ既存台帳のまま進む（無いよりはよい）
  }
  const continuityBrief = [
    process.env.GV_BRIEF ? `【今回の企画指示・最優先】\n${process.env.GV_BRIEF}` : '',
    ledger?.brief ?? '',
  ].filter(Boolean).join('\n\n');
  if (continuityBrief) console.log(`  🧭 継続性ブリーフを執筆陣へ注入します（${continuityBrief.length}字）`);
  console.log('');

  /** タイトル重複チェック（Phase κ: 90日以内の類似タイトルを拒否） */
  const checkTitleDup = (title) => {
    const dup = detectDuplicateTitle(title, pastArticles);
    if (dup) {
      console.warn(`  ⚠️  タイトル重複: ${dup.date}「${dup.title}」(類似度${Math.round(dup.similarity * 100)}%)`);
      return buildTitleDupFeedback(dup);
    }
    return null;
  };
  console.log('');

  /** 原稿が台帳の到達点を逆行していないか（タイトルも本文の一部として見る）。 */
  const findRegressions = (title, body) =>
    detectRegressions({ title, text: `${title}。${body}`, date: todayISO() }, ledger);

  const mood = pick(MOODS);
  const weather = pick(WEATHERS);
  const slug = slugify();
  const filename = `${todayISO()}-${slug}.md`;

  let ceoPlan, seoData, finalBody;
  const clefVerdicts = [];

  // ── VE-012 Juno (Arbiter): ニューロシンボリックなテーマ選定 ────────
  //
  // 記号側が候補を作って規則で落とし、Jev が生き残りの中からだけ選ぶ。
  // Jev が無い日は無料 LLM、それも無い日は記号の順位で決める。
  // GV_THEME で手動指定された日は選定しない（人間の指示が最優先）。
  let selection = null;
  if (!process.env.GV_THEME && SELECTION_CONFIG.enabled) {
    try {
      let publishedTitles = [];
      try {
        const db = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'data', 'published-titles.json'), 'utf-8'));
        publishedTitles = db.titles ?? [];
      } catch { /* 既出見出しの写しが無くても選定は続ける */ }

      const candidates = generateCandidates(financePulse, trendRadar, priorityList, SELECTION_CONFIG.maxCandidates);
      const recentPosts = [...pastArticles]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(a => ({ date: a.date, title: a.title }));

      // EmbeddingGemma（Workers AI 無料枠）で、言い換えの既出を意味で見分ける。取れなければ字面だけで続ける。
      const semanticNotes = [];
      const semantic = await semanticNearest(
        candidates,
        [...recentPosts.map(p => p.title), ...publishedTitles],
        semanticNotes,
      );
      console.log(`  🧬 意味の既出チェック（EmbeddingGemma）: ${semantic ? '✅' : `⏭️ ${semanticNotes.join(' / ') || '無効'}`}`);
      stage(
        'EmbeddingGemma', '意味の既出チェック',
        semantic ? 'ok' : SELECTION_CONFIG.semantic.enabled ? 'warn' : 'skip',
        semantic ? `候補${Object.keys(semantic).length}件を既出と照合` : semanticNotes.join(' / ') || '無効',
      );

      const { accepted, rejected } = reviewCandidates(candidates, {
        priority: priorityList,
        recentPosts,
        semantic: semantic ?? undefined,
        maxSemanticSimilarity: SELECTION_CONFIG.semantic.maxSimilarity,
        publishedTitles,
        // qualityGate.forbiddenTopics はスキーマ未宣言で PIPELINE_CONFIG からは落ちる（LM-018）。
        // 選定では生の JSON から読んで、禁止語を含む候補を記号側で落とす。
        forbiddenTerms: rawPipelineConfig.qualityGate?.forbiddenTopics?.terms ?? [],
        themeCooldownDays: SELECTION_CONFIG.themeCooldownDays,
        maxTitleSimilarity: SELECTION_CONFIG.maxTitleSimilarity,
        today: todayISO(),
      });
      console.log(`  🔣 記号の規則: 候補 ${candidates.length}件 → 通過 ${accepted.length}件 / 落選 ${rejected.length}件`);
      selection = await runJuno(todayISO(), accepted, rejected, trendBrief);
      if (selection) {
        logAgent('VE-012', 'Juno Albrecht', `selected_by_${selection.method}`, `${selection.winner.theme} | ${selection.winner.hook}`);
        // 観測モードの選定は「今日書くなら何を選んだか」の記録。同じ日に何度走っても1件だけ残す。
        if (!DRY_RUN && !(observeOnly && (await hasLogEntry(path.join(ROOT_DIR, SELECTION_CONFIG.auditLogDir), `## ${todayISO()} `)))) {
          await appendSelectionLog(ROOT_DIR, todayISO(), selection, observeOnly ? '観測のみ（記事は既にあり）' : '');
        }
      }
      const systemOne = selection && (selection.method === 'clef' || selection.method === 'jev');
      stage(
        'VE-012 Juno', `テーマ選定${observeOnly ? '（観測のみ）' : ''}`,
        !selection ? 'warn' : systemOne ? 'ok' : 'warn',
        selection
          ? `method=${selection.method}${selection.transport ? ` (${selection.transport})` : ''} → [${selection.winner.theme}] ${selection.winner.hook}${selection.notes.length ? `（${selection.notes.join(' / ').slice(0, 200)}）` : ''}`
          : `記号の規則を通った候補なし（落選 ${rejected.length}件）`,
      );
    } catch (err) {
      stage('VE-012 Juno', 'テーマ選定', 'warn', `失敗: ${err.message?.substring(0, 80)} — Nova に戻す`);
      console.warn(`  ⚠️  Arbiter failed: ${err.message?.substring(0, 120)} — Nova の選定に戻します`);
    }
  } else {
    stage('VE-012 Juno', 'テーマ選定', 'skip', process.env.GV_THEME ? `手動テーマ指定（GV_THEME=${process.env.GV_THEME}）` : 'selection.enabled=false');
  }
  const selectionBrief = buildSelectionBrief(selection);

  // ── 観測モード: 書かない日も、公開済みの今日の記事を Clef で事後審査して終える ──
  if (observeOnly) {
    await auditExistingPost(path.join(POSTS_DIR, existingPost), DRY_RUN);
    stage('VE-005〜006 Nova→Iris', '執筆・品質ゲート・継続性ゲート', 'skip', `今日の記事は既にある（${existingPost}）。二重投稿しない`);
    stage('VE-008 Mira', '台帳更新', 'skip', '新しい記事なし');
    await reportStages('observe');
    return;
  }

  // ── IDEAZ の型 ─────────────────────────────────────────────────
  let format = { writer: '', title: '', editor: '' };
  if (isIdeazFormat()) {
    try {
      const isTech = (selection?.winner.theme ?? process.env.GV_THEME) === 'AI・テクノロジー';
      format = {
        writer: buildIdeazWriterBrief({ isTech }),
        title: buildIdeazTitleRules(),
        editor: buildIdeazEditorRules(),
      };
      console.log(`  📐 IDEAZ の型を執筆陣へ渡します（${format.writer.length}字）`);
    } catch (err) {
      console.warn(`  ⚠️  IDEAZ の型を読めませんでした: ${err.message?.substring(0, 120)} — 既定の日記体で書きます`);
    }
  }

  try {
    // ── Agent 0: Balancer (Nova) ──────────────────────────
    // Juno が選んだ日は Juno のテーマ。選べなかった日だけ Nova に戻る。
    const assignedTheme = process.env.GV_THEME
      ? process.env.GV_THEME
      : selection
        ? selection.winner.theme
        : await runNova(themeBalance, themeBalance.recentPostTitles, trendBrief);
    logAgent('VE-005', 'Nova Harmon', 'theme_selected', assignedTheme);
    await savePipelineState({ step: 'balancer', data: { assignedTheme }, date: todayISO() });
    console.log('');

    // ── Agent 1: CEO (Lena) ────────────────────────────────
    // Phase κ: 同テーマの過去記事を検索し、トピック継続性ブリーフを追加
    const relatedArticles = findRelatedArticles(pastArticles, assignedTheme, assignedTheme);
    const topicBrief = buildTopicContinuityBrief(relatedArticles, assignedTheme);
    const selectionSection = selectionBrief ? `【今回の企画指示・最優先】\n${selectionBrief}` : '';
    const enhancedContinuityBrief = [selectionSection, continuityBrief, topicBrief].filter(Boolean).join('\n\n');
    if (topicBrief) {
      console.log(`  🔗 同テーマの過去記事${relatedArticles.length}件を参照:`);
      for (const a of relatedArticles.slice(0, 3)) {
        console.log(`     - ${a.date}「${a.title}」`);
      }
    }

    // Phase κ: タイトル重複チェック付きでCEOを実行（最大3回リトライ）
    let titleRetries = 0;
    let titleFeedback = '';
    do {
      ceoPlan = await runLena(titles, styleSamples, assignedTheme, enhancedContinuityBrief || continuityBrief, trendBrief, titleFeedback, format.title);
      titleFeedback = checkTitleDup(ceoPlan.title) || '';
      titleRetries++;
    } while (titleFeedback && titleRetries < 3);

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
    //
    // 継続性の逆行だけは、書き直させれば直る種類の不合格なので、ここで
    // 1度だけ差し戻す。ブリーフに「逆行するな」と書いてあっても、守られた
    // かどうかは誰も確認しない限り分からない — 指示ではなく検査で担保する。
    const writerBrief = [selectionSection, continuityBrief].filter(Boolean).join('\n\n');
    let draft = await runSophia(ceoPlan, seoData, styleSamples, writerBrief, trendBrief, '', format.writer);
    if (!draft) throw new Error('Writer Agent returned empty');

    let regressions = findRegressions(ceoPlan.title, draft);
    if (regressions.length > 0) {
      const feedback = buildRegressionFeedback(regressions);
      console.warn('  ⚠️  継続性の逆行を検出。書き直しを指示します:');
      for (const reg of regressions) {
        console.warn(`     - ${reg.metric}: 本文「${reg.claimed}」< 到達済み「${reg.canon}」`);
      }
      logAgent('VE-004', 'Vera Holt', 'regression_detected', regressions.map(r => r.metric).join(', '));
      const rewritten = await runSophia(
        ceoPlan,
        seoData,
        styleSamples,
        writerBrief,
        trendBrief,
        feedback,
        format.writer,
      );
      if (rewritten) {
        const remaining = findRegressions(ceoPlan.title, rewritten);
        if (remaining.length === 0) {
          console.log('  ✅ 書き直しで逆行が解消しました');
          draft = rewritten;
          regressions = [];
        } else {
          regressions = remaining;
        }
      }
    }
    logAgent('VE-002', 'Sophia Nightingale', 'draft_written', `${draft.length} chars`);
    await savePipelineState({ step: 'writer', data: { draftLength: draft.length }, date: todayISO() });
    console.log('');

    // ── Agent 4: Editor (Iris) ─────────────────────────────
    const edited = await runIris(ceoPlan, seoData, draft, format.editor);
    finalBody = edited || draft; // If editor fails, use the draft
    logAgent('VE-006', 'Iris Koenig', 'editing_complete', `${finalBody.length} chars`);
    console.log('');

    // ── Quality Gate (Phase θ — wired in Phase ι) ──────────
    let gate = runQualityGate(finalBody);
    console.log(`🚦 Quality Gate: score=${gate.score}/100 ${gate.passed ? '✅ PASSED' : '❌ FAILED'}`);
    for (const check of gate.checks) {
      if (!check.passed) console.log(`   - [${check.severity}] ${check.name}: ${check.message}`);
    }
    if (!gate.passed && edited && finalBody !== draft) {
      // The edited version failed — maybe the editor damaged the draft.
      const draftGate = runQualityGate(draft);
      if (draftGate.passed) {
        console.log('   ↩️  校正版が品質基準を下回ったため、Writer の原稿を採用します');
        logAgent('SYSTEM', 'QualityGate', 'reverted_to_draft', `edited score=${gate.score}, draft score=${draftGate.score}`);
        finalBody = draft;
        gate = draftGate;
      }
    }
    if (!gate.passed) {
      logAgent('SYSTEM', 'QualityGate', 'failed', JSON.stringify(gate.checks.filter(c => !c.passed).map(c => c.name)));
      throw new Error(`Quality gate failed (score=${gate.score})`);
    }
    logAgent('SYSTEM', 'QualityGate', 'passed', `score=${gate.score}`);
    console.log('');

    // ── Continuity Gate (逆行は公開しない) ──────────────────────
    //
    // 校正(Iris)は本文を書き換えるので、書き手の原稿が通っていても
    // 校正後にもう一度見る。ここまで来ても逆行が残っているなら、
    // 逆行した記事を出すより、テンプレートの日記を出すほうがましだ。
    const finalRegressions = findRegressions(ceoPlan.title, finalBody);
    if (finalRegressions.length > 0) {
      if (regressions.length === 0) {
        console.warn('   ⚠️  校正後に逆行が再発しました（Writer の原稿では解消していた）');
      }
      logAgent(
        'SYSTEM',
        'ContinuityGate',
        'failed',
        finalRegressions.map(r => `${r.metric}:${r.claimed}<${r.canon}`).join(', '),
      );
      throw new Error(
        `Continuity gate failed: ${finalRegressions.map(r => `${r.metric} ${r.claimed} < ${r.canon}`).join(' / ')}`,
      );
    }
    console.log('🧭 Continuity Gate: ✅ 過去記事の到達点と矛盾なし');
    logAgent('SYSTEM', 'ContinuityGate', 'passed', `${ledger?.facts.length ?? 0} canon facts checked`);
    stage('VE-005〜006 Nova→Iris', '執筆・品質ゲート・継続性ゲート', 'ok', `「${ceoPlan.title}」${format.writer ? '（IDEAZ の型）' : ''}`);
    console.log('');

    // ── Clef 審査（判断モデル・Workers AI 無料枠） ─────────────────
    //
    // yes/no の確率と順序レベルだけで審査し、合否は閾値が決める。不合格なら
    // 落ちた項目だけを指摘して1度だけ書き直させ、書き直しも決定論ゲートを通す。
    const reviewBrief = [
      selectionBrief,
      `テーマ: ${ceoPlan.theme}\nトピック: ${ceoPlan.topic}\n切り口: ${ceoPlan.angle}`,
    ].filter(Boolean).join('\n');
    console.log('⚖️  Clef Review: 判断モデルで原稿を審査しています…');
    let verdict = await runClefReview(reviewBrief, ceoPlan.title, finalBody);
    clefVerdicts.push(verdict);
    const failedCount = v => v.checks.filter(c => !c.passed).length;
    if (!verdict.available) {
      console.log(`   ⏭️  審査なし（${verdict.notes.join(' / ') || '判断モデルが使えません'}）`);
      stage('Clef 審査', '公開前の審査', CLEF_REVIEW_CONFIG.enabled ? 'warn' : 'skip', verdict.notes.join(' / ') || '判断モデルが使えない');
    } else {
      for (const c of verdict.checks) {
        console.log(`   ${c.passed ? '✅' : '❌'} ${c.label}: ${c.value == null ? '—' : `${Math.round(c.value * 100)}%`}`);
      }
      if (!verdict.passed) {
        console.warn('   ⚠️  Clef 審査で不合格。落ちた項目だけを指摘して書き直します');
        const rewritten = await runSophia(
          ceoPlan,
          seoData,
          styleSamples,
          [selectionSection, continuityBrief].filter(Boolean).join('\n\n'),
          trendBrief,
          buildClefFeedback(verdict),
          format.writer,
        );
        if (rewritten && runQualityGate(rewritten).passed && findRegressions(ceoPlan.title, rewritten).length === 0) {
          const second = await runClefReview(reviewBrief, ceoPlan.title, rewritten);
          clefVerdicts.push(second);
          if (second.passed || (second.available && failedCount(second) < failedCount(verdict))) {
            finalBody = rewritten;
            verdict = second;
            console.log(`   ↩️  書き直し版を採用（${second.passed ? '合格' : '不合格項目が減った'}）`);
          }
        }
      }
      logAgent('SYSTEM', 'ClefReview', verdict.passed ? 'passed' : 'failed', verdict.checks.filter(c => !c.passed).map(c => c.id).join(','));
      stage('Clef 審査', '公開前の審査', verdict.passed ? 'ok' : 'fail', `${verdict.model} / ${summarizeChecks(verdict)}${clefVerdicts.length > 1 ? ` / 書き直し${clefVerdicts.length - 1}回` : ''}`);
      if (!verdict.passed && CLEF_REVIEW_CONFIG.mode === 'enforce') {
        throw new Error(`Clef review failed: ${verdict.checks.filter(c => !c.passed).map(c => c.id).join(', ')}`);
      }
    }
    console.log('');

  } catch (err) {
    logAgent('SYSTEM', 'Pipeline', 'error', undefined, err.message);
    stage('VE-005〜006 Nova→Iris', '執筆・品質ゲート・継続性ゲート', 'fail', `テンプレートに落ちた: ${err.message?.substring(0, 120)}`);
    if (!clefVerdicts.length) stage('Clef 審査', '公開前の審査', 'skip', 'テンプレート原稿のため審査しない');
    console.error(`❌ Agent Pipeline Error: ${err.message}`);
    console.log('📋 Falling back to template...');
    // テンプレートにも同じ継続性チェックを通す。AI が全滅した日にだけ
    // 逆行が出るのが、一番見つけにくい壊れ方だから。
    const fallback = generateFallbackPost(
      themeBalance,
      text => detectRegressions({ title: '', text, date: todayISO() }, ledger).length === 0,
    );
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
  scout: "VE-010 Tessa Brandt"
  treasurer: "VE-011 Kaia Brennan"
  arbiter: "VE-012 Juno Albrecht"
  researcher: "VE-004 Vera Holt"
  balancer: "VE-005 Nova Harmon"
  ceo: "VE-001 Lena Strauss"
  seo: "VE-003 Chloe Verdant"
  writer: "VE-002 Sophia Nightingale"
  editor: "VE-006 Iris Koenig"
  summarizer: "VE-007 Edda Lindgren"
  recorder: "VE-008 Mira Falk"
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
    stage('保存', '記事ファイル', 'skip', 'DRY_RUN');
    await reportStages('dry-run');
    return;
  }

  await fs.mkdir(POSTS_DIR, { recursive: true });
  const filePath = path.join(POSTS_DIR, filename);
  await fs.writeFile(filePath, content, 'utf-8');

  // Phase η: Append agent telemetry summary to public log
  await appendTelemetrySummary(`${todayISO()}-${slug}`);
  if (clefVerdicts.length > 0) {
    try {
      await appendClefReviewLog(ROOT_DIR, todayISO(), ceoPlan.title, clefVerdicts);
    } catch { /* 記録の失敗で公開は止めない */ }
  }

  // ── VE-008 Mira (Recorder): 投稿した記事の確定事実を台帳へ記録・更新 ──
  if (ledger) {
    try {
      ledger = runRecorder(ledger, {
        title: ceoPlan.title,
        // タイトルも走査対象に含める（「貯金300万達成！」のような確定事実は
        // 本文ではなくタイトルにだけ現れることがある。loadDiaryArticles と同じ形）
        text: `${ceoPlan.title}。${cleanBody}`,
        date: todayISO(),
      });
      await saveLedger(ROOT_DIR, ledger);
      logAgent('VE-008', 'Mira Falk', 'ledger_updated', `${ledger.facts.length} facts`);
      stage('VE-008 Mira', '台帳更新', 'ok', `確定事実${ledger.facts.length}件`);
    } catch (err) {
      stage('VE-008 Mira', '台帳更新', 'warn', err.message?.substring(0, 80));
      console.warn(`⚠️  Recorder failed: ${err.message?.substring(0, 120)}`);
    }
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('✅ 記事生成完了！');
  console.log(`📄 File: ${filePath}`);
  console.log(`📝 Title: ${ceoPlan.title}`);
  console.log(`🏷️  Tags: ${seoData.tags.join(', ')}`);
  console.log(`🔑 Keywords: ${seoData.keywords.join(', ')}`);
  console.log('');
  stage('保存', '記事ファイル', 'ok', filename);
  await reportStages('publish');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
