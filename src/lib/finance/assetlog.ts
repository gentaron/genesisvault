/**
 * assetlog — ミナ自身の資産推移（公開 Google スプレッドシート）を読む。
 *
 * assetlog（gentaron/assetlog）のダッシュボードと同じシートを、同じ gviz の口
 * （鍵不要）から取る。パースの規則も assetlog の liveFeed と揃えてある:
 *   - 列0 = 日時、列1 = 資産額
 *   - #N/A・空欄は欠損（0 と混ぜない）
 *
 * ここから外に出すのは**変化率と向きだけ**。金額は PortfolioStats に載せない。
 * 公開リポジトリに毎日コミットされるスナップショットと公開記事の両方に流れる
 * 値なので、「実額が無い」ことを型で保証しておく（disclosure=relative）。
 */

export interface LogPoint {
  /** epoch ms */
  t: number;
  v: number;
}

/** 金額を持たない、変化率だけの要約。 */
export interface PortfolioStats {
  /** 最新の記録日（MYT の YYYY-MM-DD）。 */
  asOf: string;
  /** 前日比（%）。 */
  d1Pct: number | null;
  /** 7日前比（%）。 */
  d7Pct: number | null;
  /** 30日前比（%）。 */
  d30Pct: number | null;
  /** 取得できた期間の最高値からの下落率（%、0 以下）。 */
  fromHighPct: number;
  /** 最新が観測期間の最高値か。 */
  atHigh: boolean;
  /** 日次リターンの年率ボラティリティ（%、直近30日）。 */
  vol30Pct: number | null;
  /** 何日続けて同じ向きに動いたか（正 = 上昇、負 = 下落）。 */
  streak: number;
  /** 観測日数。 */
  days: number;
}

interface GvizCell {
  v: unknown;
}
interface GvizRow {
  c?: (GvizCell | null)[];
}

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** gviz のセルを epoch ms に。シートの時刻は MYT（UTC+8）で書かれている。 */
export function parseGvizDate(cell: GvizCell | null | undefined): number | null {
  if (!cell || cell.v == null) return null;
  const v = cell.v;
  if (typeof v === 'string') {
    const m = v.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
    if (m) {
      return (
        Date.UTC(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - MYT_OFFSET_MS
      );
    }
    const t = Date.parse(`${v.replace(/\//g, '-').replace(' ', 'T')}+08:00`);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'number') return Math.round((v - 25569) * 86_400_000) - MYT_OFFSET_MS;
  return null;
}

export function parseGvizNumber(cell: GvizCell | null | undefined): number | null {
  if (!cell || cell.v == null) return null;
  const n =
    typeof cell.v === 'number' ? cell.v : Number.parseFloat(String(cell.v).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** gviz の JSONP っぽい応答（`/*O_o*\/ google.visualization...(...)`）から行を取り出す。 */
export function parseGvizLogs(body: string): LogPoint[] {
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let json: { table?: { rows?: GvizRow[] } };
  try {
    json = JSON.parse(body.slice(start, end + 1));
  } catch {
    return [];
  }
  const out: LogPoint[] = [];
  for (const row of json.table?.rows ?? []) {
    const c = row.c ?? [];
    const t = parseGvizDate(c[0]);
    const v = parseGvizNumber(c[1]);
    if (t != null && v != null) out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function mytDay(t: number): string {
  return new Date(t + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

/** 1日に複数回ある記録を、その日の最後の値（終値）にまとめる。 */
export function toDailyCloses(points: LogPoint[]): { day: string; v: number }[] {
  const byDay = new Map<string, LogPoint>();
  for (const p of points) {
    const day = mytDay(p.t);
    const prev = byDay.get(day);
    if (!prev || p.t >= prev.t) byDay.set(day, p);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, p]) => ({ day, v: p.v }));
}

function pct(from: number | undefined, to: number): number | null {
  if (from == null || from <= 0) return null;
  return Math.round((to / from - 1) * 100 * 100) / 100;
}

/** n 日前（暦日）以前で最も新しい終値。 */
function closeOnOrBefore(closes: { day: string; v: number }[], day: string): number | undefined {
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i].day <= day) return closes[i].v;
  }
  return undefined;
}

function shiftDay(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function summarizePortfolio(points: LogPoint[]): PortfolioStats | null {
  const closes = toDailyCloses(points);
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  const high = Math.max(...closes.map((c) => c.v));
  const fromHighPct = Math.round((last.v / high - 1) * 100 * 100) / 100;

  const window = closes.slice(-31);
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) rets.push(Math.log(window[i].v / window[i - 1].v));
  let vol30Pct: number | null = null;
  if (rets.length >= 5) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    vol30Pct = Math.round(Math.sqrt(variance) * Math.sqrt(365) * 100 * 10) / 10;
  }

  let streak = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    const dir = Math.sign(closes[i].v - closes[i - 1].v);
    if (dir === 0) break;
    if (streak === 0 || Math.sign(streak) === dir) streak += dir;
    else break;
  }

  return {
    asOf: last.day,
    d1Pct: pct(prev.v, last.v),
    d7Pct: pct(closeOnOrBefore(closes, shiftDay(last.day, -7)), last.v),
    d30Pct: pct(closeOnOrBefore(closes, shiftDay(last.day, -30)), last.v),
    fromHighPct,
    atHigh: last.v >= high,
    vol30Pct,
    streak,
    days: closes.length,
  };
}

export function assetlogUrls(spreadsheetId: string, sheets: string[]): string[] {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`;
  return sheets.map((s) => {
    const [key, value] = s.split('=');
    return `${base}&${key}=${encodeURIComponent(value ?? '')}`;
  });
}
