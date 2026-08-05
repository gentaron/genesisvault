/**
 * Phase ν — Trend Radar (VE-010 Tessa Brandt / Scout)
 *
 * 記事を書く前に「外で何が起きているか」を取ってくる係。
 *
 *   1. AI・最先端技術の話題  … Hacker News (Algolia API) と arXiv の新着
 *   2. 株式市場の地合い      … Stooq の日足 CSV から指数・為替・BTC の傾向
 *
 * 集めた結果は自然言語のブリーフに落として Nova(テーマ選定)/Lena(企画)/
 * Sophia(執筆) に渡す。**日記の主題を外の話題に差し替えるためではない** —
 * ミナが今日どんな世界の中にいるのかを、書き手に一言ぶん持たせるため。
 *
 * 【設計上の決めごと】
 *
 * - **fail-soft**。審査層(review.ts)は「審査できなければ通さない」が、こちらは
 *   逆に「取れなければ黙って諦める」。トレンドは記事の必要条件ではないので、
 *   HN が落ちている日に日記が出ないほうがおかしい。取得失敗は degraded として
 *   記録し、パイプラインはそのまま続行する。
 * - **API キー不要のソースだけ**。鍵が要るソースを混ぜると、鍵の無い環境
 *   （フォーク・ローカル）でだけ挙動が変わる。INV-003 と同じ理由。
 * - **`bun run verify` からは呼ばない**。検証はオフラインで完結する（INV-004）。
 *   ネットワークに触るのは記事生成パイプラインの中だけ。
 * - 取得結果は `data/trend-radar.json` に保存する。次回取得に失敗しても、
 *   数日以内のスナップショットがあれば「昨日の地合い」で書ける。
 */

import fs from 'fs/promises';
import path from 'path';

import { TRENDS_CONFIG } from '../pipeline/config.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TechSignal {
  source: string; // 'Hacker News' | 'arXiv'
  title: string;
  url: string;
  /** HN のポイント等。無いソースは null。 */
  score: number | null;
  date: string; // YYYY-MM-DD
}

export type MarketDirection = '上昇' | '横ばい' | '下落';

export interface MarketSignal {
  symbol: string;
  label: string;
  close: number;
  changePct1d: number | null;
  changePct5d: number | null;
  sma20: number | null;
  aboveSma20: boolean | null;
  direction: MarketDirection;
  asOf: string; // YYYY-MM-DD（その銘柄の最終取引日）
}

export interface TrendRadar {
  capturedAt: string; // YYYY-MM-DD
  tech: TechSignal[];
  market: MarketSignal[];
  /** 一部でも取得できなかったか。true でもパイプラインは止めない。 */
  degraded: boolean;
  /** 何が取れて何が取れなかったかの記録（運用時に読む）。 */
  notes: string[];
}

export interface DailyBar {
  date: string;
  close: number;
}

// ─── HTTP ───────────────────────────────────────────────────────

/**
 * テキストを取ってくるだけの薄いラッパ。
 * 失敗は例外ではなく null を返す — 呼び出し側は必ず「取れなかった日」を
 * 通常の分岐として扱う必要があり、try/catch で包むのを忘れる余地を作らない。
 */
export async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'genesis-vault-trend-radar/1.0 (+https://github.com/gentaron/genesisvault)',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Tech signals: Hacker News (Algolia) ────────────────────────

interface HnHit {
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  objectID?: string;
  points?: number;
  created_at?: string;
}

/** Algolia のレスポンスを TechSignal に落とす（壊れた要素は黙って捨てる）。 */
export function parseHackerNews(body: string): TechSignal[] {
  let parsed: { hits?: HnHit[] };
  try {
    parsed = JSON.parse(body) as { hits?: HnHit[] };
  } catch {
    return [];
  }
  const hits = Array.isArray(parsed.hits) ? parsed.hits : [];
  const signals: TechSignal[] = [];
  for (const hit of hits) {
    const title = (hit.title ?? hit.story_title ?? '').trim();
    if (!title) continue;
    const url =
      hit.url ??
      hit.story_url ??
      (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : '');
    signals.push({
      source: 'Hacker News',
      title,
      url,
      score: typeof hit.points === 'number' ? hit.points : null,
      date: (hit.created_at ?? '').slice(0, 10),
    });
  }
  return signals;
}

// ─── Tech signals: arXiv (Atom feed) ────────────────────────────

const ENTITY: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, (m) => ENTITY[m] ?? m);
}

/** arXiv の Atom から新着論文のタイトルを拾う。XML パーサは持ち込まない。 */
export function parseArxiv(body: string): TechSignal[] {
  const signals: TechSignal[] = [];
  const entries = body.split('<entry>').slice(1);
  for (const entry of entries) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    if (!title) continue;
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? '';
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? '';
    signals.push({
      source: 'arXiv',
      title: decodeEntities(title.replace(/\s+/g, ' ').trim()),
      url: id.trim(),
      score: null,
      date: published.slice(0, 10),
    });
  }
  return signals;
}

// ─── Market signals: Stooq daily CSV ────────────────────────────

/**
 * Stooq の日足 CSV（`Date,Open,High,Low,Close,Volume`）を終値の系列にする。
 * データが無い銘柄には CSV ではなく "No data" のような本文が返るので、
 * 行の形が合わないものはすべて捨てる。
 */
export function parseStooqCsv(csv: string): DailyBar[] {
  const bars: DailyBar[] = [];
  for (const line of csv.trim().split(/\r?\n/)) {
    const cols = line.split(',');
    if (cols.length < 5) continue;
    const [date, , , , close] = cols;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; // ヘッダー行・エラー本文
    const value = Number(close);
    if (!Number.isFinite(value) || value <= 0) continue;
    bars.push({ date, close: value });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10; // 小数第1位まで
}

/**
 * 終値の系列を「地合い」に要約する。
 *
 * 予測はしない。5営業日の変化率と 20日移動平均との位置関係という、
 * 見ればわかることだけを言葉にする。判断は書き手に渡す。
 */
export function summarizeSeries(
  symbol: string,
  label: string,
  bars: DailyBar[],
  flatBandPct: number,
): MarketSignal | null {
  if (bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  const fiveAgo = bars.length >= 6 ? bars[bars.length - 6] : null;

  const window = bars.slice(-20);
  const sma20 =
    window.length === 20
      ? Math.round((window.reduce((sum, b) => sum + b.close, 0) / 20) * 100) / 100
      : null;

  const changePct5d = fiveAgo ? pctChange(fiveAgo.close, last.close) : null;
  const basis = changePct5d ?? (prev ? pctChange(prev.close, last.close) : null) ?? 0;
  const direction: MarketDirection =
    basis >= flatBandPct ? '上昇' : basis <= -flatBandPct ? '下落' : '横ばい';

  return {
    symbol,
    label,
    close: last.close,
    changePct1d: prev ? pctChange(prev.close, last.close) : null,
    changePct5d,
    sma20,
    aboveSma20: sma20 === null ? null : last.close >= sma20,
    direction,
    asOf: last.date,
  };
}

// ─── Collection ─────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function compact(d: Date): string {
  return isoDate(d).replace(/-/g, '');
}

function dedupeByTitle(signals: TechSignal[]): TechSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = s.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * AI・最先端技術の話題を集める。
 * ソースごとに独立して失敗させる（片方が落ちても、もう片方は使う）。
 */
export async function collectTechSignals(
  now = new Date(),
): Promise<{ signals: TechSignal[]; notes: string[] }> {
  const cfg = TRENDS_CONFIG;
  const notes: string[] = [];
  const collected: TechSignal[] = [];

  const since = Math.floor((now.getTime() - cfg.tech.lookbackHours * 3600_000) / 1000);
  for (const query of cfg.tech.queries) {
    const url =
      `${cfg.tech.hnEndpoint}?tags=story&hitsPerPage=${cfg.tech.maxSignals}` +
      `&numericFilters=created_at_i>${since},points>${cfg.tech.minPoints}` +
      `&query=${encodeURIComponent(query)}`;
    const body = await fetchText(url, cfg.timeoutMs);
    if (body === null) {
      notes.push(`Hacker News 取得失敗: ${query}`);
      continue;
    }
    const hits = parseHackerNews(body);
    if (hits.length === 0) notes.push(`Hacker News に該当なし: ${query}`);
    collected.push(...hits);
  }

  for (const category of cfg.tech.arxivCategories) {
    const url =
      `${cfg.tech.arxivEndpoint}?search_query=cat:${encodeURIComponent(category)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=${cfg.tech.maxSignals}`;
    const body = await fetchText(url, cfg.timeoutMs);
    if (body === null) {
      notes.push(`arXiv 取得失敗: ${category}`);
      continue;
    }
    collected.push(...parseArxiv(body));
  }

  const signals = dedupeByTitle(collected)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, cfg.tech.maxSignals);

  return { signals, notes };
}

/** 株式指数・為替・BTC の地合いを集める。 */
export async function collectMarketSignals(
  now = new Date(),
): Promise<{ signals: MarketSignal[]; notes: string[] }> {
  const cfg = TRENDS_CONFIG;
  const notes: string[] = [];
  const signals: MarketSignal[] = [];

  const from = new Date(now.getTime() - cfg.market.lookbackDays * 86_400_000);
  for (const entry of cfg.market.symbols) {
    const url =
      `${cfg.market.endpoint}?s=${encodeURIComponent(entry.symbol)}&i=d` +
      `&d1=${compact(from)}&d2=${compact(now)}`;
    const body = await fetchText(url, cfg.timeoutMs);
    if (body === null) {
      notes.push(`相場データ取得失敗: ${entry.label}`);
      continue;
    }
    const summary = summarizeSeries(
      entry.symbol,
      entry.label,
      parseStooqCsv(body),
      cfg.market.flatBandPct,
    );
    if (summary === null) {
      notes.push(`相場データが空: ${entry.label}`);
      continue;
    }
    signals.push(summary);
  }

  return { signals, notes };
}

/**
 * レーダー1回ぶん。片方でも取れなかったら degraded を立てるが、例外は投げない。
 */
export async function collectTrendRadar(now = new Date()): Promise<TrendRadar> {
  const tech = await collectTechSignals(now);
  const market = await collectMarketSignals(now);
  const notes = [...tech.notes, ...market.notes];
  return {
    capturedAt: isoDate(now),
    tech: tech.signals,
    market: market.signals,
    degraded: tech.signals.length === 0 || market.signals.length === 0 || notes.length > 0,
    notes,
  };
}

// ─── Brief ──────────────────────────────────────────────────────

function formatMarketLine(s: MarketSignal): string {
  const parts: string[] = [];
  if (s.changePct1d !== null) parts.push(`前日比 ${s.changePct1d > 0 ? '+' : ''}${s.changePct1d}%`);
  if (s.changePct5d !== null) parts.push(`5日 ${s.changePct5d > 0 ? '+' : ''}${s.changePct5d}%`);
  if (s.aboveSma20 !== null) parts.push(`20日平均の${s.aboveSma20 ? '上' : '下'}`);
  const detail = parts.length > 0 ? `（${parts.join(' / ')}）` : '';
  return `  - ${s.label}：${s.close.toLocaleString('ja-JP')}${detail} ＝ ${s.direction}`;
}

/**
 * 執筆陣に渡すトレンド・ブリーフ。
 *
 * 「使い方」の節が本体。材料だけ渡すと、日記が相場解説やニュース要約に
 * 化ける — それは Genesis Vault の記事ではない。何を書かないかまで書く。
 */
export function buildTrendBrief(radar: TrendRadar | null): string {
  if (!radar || (radar.tech.length === 0 && radar.market.length === 0)) return '';

  const lines: string[] = ['【今日の外の景色（トレンド・レーダー / VE-010 Tessa Brandt）】'];

  if (radar.tech.length > 0) {
    lines.push('■ AI・最先端技術でいま話題になっていること');
    for (const t of radar.tech) {
      const score = t.score !== null ? `・${t.score}pt` : '';
      lines.push(`  - ${t.title}（${t.source}${score}）`);
    }
  }

  if (radar.market.length > 0) {
    lines.push(`■ マーケットの地合い（${radar.market[0].asOf} 時点の終値）`);
    for (const m of radar.market) lines.push(formatMarketLine(m));
  }

  lines.push('【トレンドの使い方（厳守）】');
  lines.push('  - これは日記の入口に使う材料。ニュース解説・相場解説を書くのではない');
  lines.push('  - 触れるとしても1〜2文まで。記事の主題はあくまでミナの生活のほう');
  lines.push('  - 相場の予想・投資助言・個別銘柄の推奨は書かない');
  lines.push('  - ここに出てくる数字をミナ自身の貯金額・資産額として書かない');
  lines.push('  - タイトルや見出しに指数の数値をそのまま入れない');
  lines.push('  - ピンとこない話題なら、無理に触れずに捨ててよい');

  if (radar.degraded) {
    lines.push('  ※ 一部のデータが取得できていません。取れている範囲だけを使ってください');
  }

  return lines.join('\n');
}

// ─── Cache ──────────────────────────────────────────────────────

export function trendCachePath(rootDir: string): string {
  return path.join(rootDir, TRENDS_CONFIG.cacheFile);
}

export async function loadTrendRadar(rootDir: string): Promise<TrendRadar | null> {
  try {
    const raw = await fs.readFile(trendCachePath(rootDir), 'utf-8');
    return JSON.parse(raw) as TrendRadar;
  } catch {
    return null;
  }
}

export async function saveTrendRadar(rootDir: string, radar: TrendRadar): Promise<void> {
  const full = trendCachePath(rootDir);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, `${JSON.stringify(radar, null, 2)}\n`, 'utf-8');
}

/** 何日前までのスナップショットなら「今日の地合い」として使ってよいか。 */
export function isRadarFresh(radar: TrendRadar | null, now = new Date()): boolean {
  if (!radar?.capturedAt) return false;
  const captured = Date.parse(`${radar.capturedAt}T00:00:00Z`);
  if (Number.isNaN(captured)) return false;
  const ageDays = (now.getTime() - captured) / 86_400_000;
  return ageDays >= 0 && ageDays <= TRENDS_CONFIG.maxCacheAgeDays;
}

/**
 * VE-010 Tessa Brandt (Scout) の本体。
 *
 * 取得 → 失敗したら手元のスナップショット → それも無ければ空。
 * どの経路でも例外は投げない。トレンドが無い日は、トレンドの無い日記が出る。
 */
export async function runScout(rootDir: string, now = new Date()): Promise<TrendRadar | null> {
  console.log('\n📡 [VE-010] Tessa Brandt (Scout): AI/技術トレンドと相場を収集中…');

  if (!TRENDS_CONFIG.enabled) {
    console.log('  ⏭️  trends.enabled=false のためスキップします');
    return null;
  }

  const cached = await loadTrendRadar(rootDir);
  let radar: TrendRadar | null = null;
  try {
    radar = await collectTrendRadar(now);
  } catch (err) {
    console.warn(`  ⚠️  トレンド収集で例外: ${(err as Error).message?.substring(0, 120)}`);
  }

  if (radar && (radar.tech.length > 0 || radar.market.length > 0)) {
    console.log(`  ✅ 技術トピック${radar.tech.length}件 / 相場${radar.market.length}件`);
    for (const note of radar.notes) console.log(`  ⚠️  ${note}`);
    return radar;
  }

  if (isRadarFresh(cached, now)) {
    console.log(`  ↩️  取得に失敗したため ${cached?.capturedAt} のスナップショットを使います`);
    return cached;
  }

  console.log('  ⚠️  トレンド情報なしで続行します（記事は通常どおり書けます）');
  return null;
}
