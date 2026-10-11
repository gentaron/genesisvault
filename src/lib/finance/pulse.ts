/**
 * VE-011 Kaia Brennan (Treasurer) — 財務パルス
 *
 * QAIZ（外の地形）と assetlog（自分の資産推移）を毎朝読み、
 *   1. 変化率だけの要約（金額は持たない）
 *   2. 記号の事実（predicates）— テーマ選定の規則が食べる形
 *   3. 書き手に渡すブリーフ（使い方の制約つき）
 * に落とす。
 *
 * 記号の事実は「見ればわかること」だけ。予測・推奨は一切作らない。
 * `portfolio.drawdown` は「高値から5%以上離れている」という観測であって、
 * 「買い場」でも「危険」でもない。解釈は書き手の日記の仕事。
 *
 * fail-soft: どちらも取れなければ直近 maxCacheAgeDays 日以内のスナップショット、
 * それも無ければ null。記事は財務パルス無しでも書ける。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from '../agents/trends.js';
import { FINANCE_CONFIG } from '../pipeline/config.js';
import {
  assetlogUrls,
  type PortfolioStats,
  parseGvizLogs,
  summarizePortfolio,
} from './assetlog.js';
import { type MarketTerrain, parseQaizOverview } from './qaiz.js';

export interface FinancePulse {
  /** 取得日（YYYY-MM-DD, UTC）。 */
  capturedAt: string;
  portfolio: PortfolioStats | null;
  market: MarketTerrain | null;
  /** 記号の事実。`portfolio.new_high` のような安定した名前。 */
  predicates: string[];
  degraded: boolean;
  notes: string[];
}

// ─── Symbolic facts ─────────────────────────────────────────────

/**
 * 観測値 → 記号。閾値は config の finance.thresholds が正本。
 * 名前は選定規則（src/lib/selection/candidates.ts）とテストが参照するので、
 * 変えるときは両方を同時に直すこと。
 */
export function derivePredicates(
  portfolio: PortfolioStats | null,
  market: MarketTerrain | null,
  t = FINANCE_CONFIG.thresholds,
): string[] {
  const out = new Set<string>();

  if (portfolio) {
    if (portfolio.atHigh) out.add('portfolio.new_high');
    else if (portfolio.fromHighPct > -t.nearHighPct) out.add('portfolio.near_high');
    if (portfolio.fromHighPct <= -t.drawdownPct) out.add('portfolio.drawdown');
    if (portfolio.d1Pct != null && portfolio.d1Pct >= t.bigMovePct) out.add('portfolio.big_up_day');
    if (portfolio.d1Pct != null && portfolio.d1Pct <= -t.bigMovePct)
      out.add('portfolio.big_down_day');
    if (portfolio.d1Pct != null && Math.abs(portfolio.d1Pct) < t.bigMovePct / 3)
      out.add('portfolio.quiet_day');
    if (portfolio.streak >= 4) out.add('portfolio.up_streak');
    if (portfolio.streak <= -4) out.add('portfolio.down_streak');
    if (portfolio.d30Pct != null && portfolio.d30Pct >= 3) out.add('portfolio.month_up');
    if (portfolio.d30Pct != null && portfolio.d30Pct <= -3) out.add('portfolio.month_down');
  }

  if (market) {
    if (market.trend) out.add(`market.${market.trend}`);
    if (market.riskAppetite === 'risk-off') out.add('market.risk_off');
    if (market.riskAppetite === 'risk-on') out.add('market.risk_on');
    if (market.volatility === 'stress' || market.volatility === 'elevated')
      out.add('market.vol_high');
    if (market.volatility === 'low') out.add('market.vol_low');
    if (market.breadth?.startsWith('narrow')) out.add('market.narrow');
    if (market.rotations.some((r) => r.to === 'leading')) out.add('market.rotation_new_leader');
  }

  // 自分の資産と外の地形が逆を向いている日 — 日記にいちばん向いている「ずれ」。
  if (portfolio?.d7Pct != null && market?.trend) {
    if (market.trend === 'bull' && portfolio.d7Pct < 0) out.add('divergence.market_up_me_down');
    if (market.trend === 'bear' && portfolio.d7Pct > 0) out.add('divergence.market_down_me_up');
  }

  return [...out].sort();
}

// ─── Brief ──────────────────────────────────────────────────────

const TREND_JA = { bull: '上昇基調', bear: '下落基調', range: 'もみ合い' } as const;
const VOL_JA = {
  low: '静か',
  normal: 'ふつう',
  elevated: '荒れ気味',
  stress: 'かなり荒れている',
} as const;
const RISK_JA = {
  'risk-on': 'リスクを取りにいく空気',
  neutral: 'どっちつかず',
  'risk-off': '守りに入る空気',
} as const;
const QUAD_JA = { leading: '先行', weakening: '失速', lagging: '劣後', improving: '改善' } as const;

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`;
}

export function buildFinanceBrief(pulse: FinancePulse | null): string {
  if (!pulse || (!pulse.portfolio && !pulse.market)) return '';
  const lines: string[] = [];

  const p = pulse.portfolio;
  if (p) {
    const parts = [
      p.d1Pct != null ? `前日比 ${signed(p.d1Pct)}` : null,
      p.d7Pct != null ? `1週間 ${signed(p.d7Pct)}` : null,
      p.d30Pct != null ? `1か月 ${signed(p.d30Pct)}` : null,
      p.atHigh ? '記録の中で一番高いところ' : `一番高かったときから ${p.fromHighPct}%`,
    ].filter(Boolean);
    lines.push(`自分のポートフォリオ（${p.asOf}時点。変化率だけ）: ${parts.join(' / ')}`);
    if (Math.abs(p.streak) >= 3) {
      lines.push(
        `  ${Math.abs(p.streak)}日続けて${p.streak > 0 ? '上がっている' : '下がっている'}`,
      );
    }
  }

  const m = pulse.market;
  if (m) {
    const terrain = [
      m.trend ? TREND_JA[m.trend] : null,
      m.volatility ? `値動きは${VOL_JA[m.volatility]}` : null,
      m.riskAppetite ? RISK_JA[m.riskAppetite] : null,
    ].filter(Boolean);
    if (terrain.length) lines.push(`外の地形（QAIZ）: ${terrain.join('、')}`);
    if (m.strongest.length) {
      lines.push(
        `  1週間で強かった: ${m.strongest.map((s) => `${s.region}${s.name} ${signed(s.r1wPct)}`).join('、')}`,
      );
    }
    if (m.weakest.length) {
      lines.push(
        `  1週間で弱かった: ${m.weakest.map((s) => `${s.region}${s.name} ${signed(s.r1wPct)}`).join('、')}`,
      );
    }
    for (const r of m.rotations.slice(0, 2)) {
      lines.push(`  ${r.region}${r.name}が「${QUAD_JA[r.from]}」から「${QUAD_JA[r.to]}」へ`);
    }
  }

  lines.push(
    '',
    '使い方の制約（必ず守る）:',
    '- 金額は書かない。変化率と向き、そのときの気持ちだけを書く',
    '- 予測しない。買う・売る・増やす・減らすを読者に勧めない（投資助言をしない）',
    '- 数字は記事全体で2つまで。相場解説にしない。主役はその数字を見たときの自分の頭の中',
    '- 「貯金」系の言葉は使わない（品質ゲートの禁止語）',
  );
  return lines.join('\n');
}

// ─── Collection ─────────────────────────────────────────────────

export async function collectFinancePulse(now = new Date()): Promise<FinancePulse> {
  const cfg = FINANCE_CONFIG;
  const notes: string[] = [];

  let portfolio: PortfolioStats | null = null;
  for (const url of assetlogUrls(cfg.assetlog.spreadsheetId, cfg.assetlog.sheets)) {
    const body = await fetchText(url, cfg.timeoutMs);
    if (!body) continue;
    portfolio = summarizePortfolio(parseGvizLogs(body));
    if (portfolio) break;
  }
  if (!portfolio) notes.push('assetlog: シートを読めませんでした');

  let market: MarketTerrain | null = null;
  const base = process.env[cfg.qaiz.baseUrlEnv]?.replace(/\/$/, '');
  if (!base) {
    notes.push(`qaiz: ${cfg.qaiz.baseUrlEnv} が未設定のため読みませんでした`);
  } else {
    const body = await fetchText(`${base}${cfg.qaiz.endpoint}`, cfg.timeoutMs);
    market = body ? parseQaizOverview(body) : null;
    if (!market) notes.push('qaiz: overview を読めませんでした（初回生成中の 503 を含む）');
  }

  return {
    capturedAt: now.toISOString().slice(0, 10),
    portfolio,
    market,
    predicates: derivePredicates(portfolio, market),
    degraded: !portfolio || !market,
    notes,
  };
}

// ─── Cache ──────────────────────────────────────────────────────

export function financeCachePath(rootDir: string): string {
  return path.join(rootDir, FINANCE_CONFIG.cacheFile);
}

export async function loadFinancePulse(rootDir: string): Promise<FinancePulse | null> {
  try {
    return JSON.parse(await fs.readFile(financeCachePath(rootDir), 'utf-8')) as FinancePulse;
  } catch {
    return null;
  }
}

export async function saveFinancePulse(rootDir: string, pulse: FinancePulse): Promise<void> {
  const full = financeCachePath(rootDir);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, `${JSON.stringify(pulse, null, 2)}\n`, 'utf-8');
}

export function isPulseFresh(pulse: FinancePulse | null, now = new Date()): boolean {
  if (!pulse?.capturedAt) return false;
  const age = (now.getTime() - Date.parse(`${pulse.capturedAt}T00:00:00Z`)) / 86_400_000;
  return age >= 0 && age <= FINANCE_CONFIG.maxCacheAgeDays;
}

export async function runKaia(rootDir: string, now = new Date()): Promise<FinancePulse | null> {
  console.log('\n💹 [VE-011] Kaia Brennan (Treasurer): QAIZ と assetlog を読んでいます…');
  if (!FINANCE_CONFIG.enabled) {
    console.log('  ⏭️  finance.enabled=false のためスキップします');
    return null;
  }

  let pulse: FinancePulse | null = null;
  try {
    pulse = await collectFinancePulse(now);
  } catch (err) {
    console.warn(`  ⚠️  財務パルスで例外: ${(err as Error).message?.substring(0, 120)}`);
  }

  if (pulse && (pulse.portfolio || pulse.market)) {
    for (const note of pulse.notes) console.log(`  ⚠️  ${note}`);
    console.log(`  ✅ 記号の事実: ${pulse.predicates.join(', ') || '（なし）'}`);
    return pulse;
  }

  const cached = await loadFinancePulse(rootDir);
  if (isPulseFresh(cached, now)) {
    console.log(`  ↩️  取得に失敗したため ${cached?.capturedAt} のスナップショットを使います`);
    return cached;
  }
  console.log('  ⚠️  財務パルスなしで続行します（記事は通常どおり書けます）');
  return null;
}
