/**
 * QAIZ — 地域 × セクターの地形を読む。
 *
 * QAIZ（gentaron/QAIZ）は Cloudflare Workers の無料プランで動く分析ターミナルで、
 * `GET /api/overview` 1往復でレジーム・市場の幅・セクター・ローテーションが返る。
 * ここではそれを「今日の地形」の数行に畳むだけで、相場の予測はしない。
 *
 * 応答の型は QAIZ の src/types.ts（Regime / Breadth / SectorAggregate /
 * RotationPoint）に合わせてあるが、全部任意として読む。QAIZ 側の版が上がって
 * フィールドが消えても、ここが例外を投げて日記が止まることは無い。
 */

export type Quadrant = 'leading' | 'weakening' | 'lagging' | 'improving';

export interface MarketTerrain {
  generatedAt: string | null;
  trend: 'bull' | 'bear' | 'range' | null;
  volatility: 'low' | 'normal' | 'elevated' | 'stress' | null;
  riskAppetite: 'risk-on' | 'neutral' | 'risk-off' | null;
  breadth: string | null;
  /** 1週間で強かったセクター（名前 + 地域 + 変化率%）。 */
  strongest: SectorMove[];
  weakest: SectorMove[];
  /** 象限が切り替わったセクター（前回→今回）。 */
  rotations: { name: string; region: string; from: Quadrant; to: Quadrant }[];
}

export interface SectorMove {
  name: string;
  region: string;
  r1wPct: number;
}

interface OverviewPayload {
  generatedAt?: string;
  regime?: { trend?: string; volatility?: string; riskAppetite?: string } | null;
  breadth?: { scope?: string; label?: string }[] | null;
  sectors?: { nameJa?: string; region?: string; r1w?: number | null }[] | null;
  rotation?:
    | {
        name?: string;
        region?: string;
        quadrant?: string;
        trail?: { rsRatio: number; rsMomentum: number }[];
      }[]
    | null;
}

/**
 * QAIZ の RegionId（src/types.ts）→ 日本語。GLOBAL は地域名を付けない。
 * 初回本番で地域コードがそのまま本文に出た（「GLOBALビットコイン」「US米国 情報技術」）ので、
 * 大文字のコードを正本にし、名前にすでに地域名が入っているときは重ねない。
 */
const REGION_JA: Record<string, string> = {
  US: '米国',
  JP: '日本',
  EU: '欧州',
  UK: '英国',
  CN: '中国',
  HK: '香港',
  IN: 'インド',
  KR: '韓国',
  TW: '台湾',
  AU: '豪州',
  CA: 'カナダ',
  BR: 'ブラジル',
  EM: '新興国',
  GLOBAL: '',
};

export function regionJa(region: unknown): string {
  const key = String(region ?? '').toUpperCase();
  return key in REGION_JA ? REGION_JA[key] : String(region ?? '');
}

/** 「米国」+「米国 情報技術」→「米国 情報技術」、「」+「ビットコイン」→「ビットコイン」 */
export function labelWithRegion(region: string, name: string): string {
  if (!region || name.startsWith(region)) return name;
  return `${region}の${name}`;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function quadrantOf(rsRatio: number, rsMomentum: number): Quadrant {
  if (rsRatio >= 100) return rsMomentum >= 100 ? 'leading' : 'weakening';
  return rsMomentum >= 100 ? 'improving' : 'lagging';
}

/** r1w は QAIZ では比率（0.012 = 1.2%）。%表記に直す。 */
function toPct(r: number): number {
  return Math.round(r * 1000) / 10;
}

export function parseQaizOverview(body: string): MarketTerrain | null {
  let p: OverviewPayload;
  try {
    p = JSON.parse(body) as OverviewPayload;
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object' || (!p.regime && !p.sectors)) return null;

  const sectors: SectorMove[] = (p.sectors ?? [])
    .filter((s) => typeof s.r1w === 'number' && Number.isFinite(s.r1w) && s.nameJa)
    .map((s) => ({
      name: String(s.nameJa),
      region: regionJa(s.region),
      r1wPct: toPct(s.r1w as number),
    }))
    .sort((a, b) => b.r1wPct - a.r1wPct);

  const rotations: MarketTerrain['rotations'] = [];
  for (const r of p.rotation ?? []) {
    const to = oneOf(r.quadrant, ['leading', 'weakening', 'lagging', 'improving'] as const);
    const trail = r.trail ?? [];
    if (!to || trail.length < 2 || !r.name) continue;
    const prev = trail[trail.length - 2];
    const from = quadrantOf(prev.rsRatio, prev.rsMomentum);
    if (from !== to) {
      rotations.push({
        name: r.name,
        region: regionJa(r.region),
        from,
        to,
      });
    }
  }

  const breadth = (p.breadth ?? []).find((b) => b?.label)?.label ?? null;

  return {
    generatedAt: p.generatedAt ?? null,
    trend: oneOf(p.regime?.trend, ['bull', 'bear', 'range'] as const),
    volatility: oneOf(p.regime?.volatility, ['low', 'normal', 'elevated', 'stress'] as const),
    riskAppetite: oneOf(p.regime?.riskAppetite, ['risk-on', 'neutral', 'risk-off'] as const),
    breadth,
    strongest: sectors.slice(0, 3),
    weakest: sectors.slice(-3).reverse(),
    rotations: rotations.slice(0, 5),
  };
}
