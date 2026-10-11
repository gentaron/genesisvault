/**
 * VE-011 Kaia — 財務パルス
 *
 * 守りたいのは3つ:
 *   1. 壊れた応答で落ちないこと（fail-soft）
 *   2. 金額が外に出ないこと（disclosure=relative）— 型にも、ブリーフにも
 *   3. 記号の事実が閾値どおりに出ること（選定規則がこの名前を食べる）
 *
 * ネットワークには触らない。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type LogPoint,
  parseGvizDate,
  parseGvizLogs,
  summarizePortfolio,
  toDailyCloses,
} from '../src/lib/finance/assetlog';
import {
  buildFinanceBrief,
  collectFinancePulse,
  derivePredicates,
  type FinancePulse,
  isPulseFresh,
  loadFinancePulse,
  runKaia,
  saveFinancePulse,
} from '../src/lib/finance/pulse';
import { parseQaizOverview, quadrantOf } from '../src/lib/finance/qaiz';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 4); // 2026-09-01 12:00 MYT

function series(values: number[]): LogPoint[] {
  return values.map((v, i) => ({ t: T0 + i * DAY, v }));
}

describe('assetlog — gviz parsing', () => {
  it('reads Date(y,m,d,h,m,s) cells as MYT and skips #N/A rows', () => {
    const body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
      table: {
        rows: [
          { c: [{ v: 'Date(2026,9,9,12,25,8)' }, { v: 65000.5 }] },
          { c: [{ v: 'Date(2026,9,10,0,25,8)' }, { v: '#N/A' }] },
          { c: [{ v: 'Date(2026,9,10,12,25,8)' }, { v: 65500 }] },
          { c: [null, { v: 1 }] },
        ],
      },
    })});`;
    const points = parseGvizLogs(body);
    expect(points).toHaveLength(2);
    expect(new Date(points[0].t).toISOString()).toBe('2026-10-09T04:25:08.000Z');
  });

  it('returns [] for an HTML error page instead of throwing', () => {
    expect(parseGvizLogs('<html>quota exceeded</html>')).toEqual([]);
  });

  it('parses the "YYYY/MM/DD H:MM:SS" text form too', () => {
    expect(parseGvizDate({ v: '2025/04/10 21:02:08' })).toBe(
      Date.parse('2025-04-10T21:02:08+08:00'),
    );
  });

  it('keeps the last value of each MYT day', () => {
    const closes = toDailyCloses([
      { t: T0, v: 1 },
      { t: T0 + 3_600_000, v: 2 },
      { t: T0 + DAY, v: 3 },
    ]);
    expect(closes.map((c) => c.v)).toEqual([2, 3]);
  });
});

describe('assetlog — summarizePortfolio', () => {
  it('reports change rates and distance from the high, never an amount', () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    values.push(120); // 139 → 120
    const stats = summarizePortfolio(series(values));
    expect(stats).not.toBeNull();
    expect(stats?.d1Pct).toBeCloseTo((120 / 139 - 1) * 100, 1);
    expect(stats?.fromHighPct).toBeCloseTo((120 / 139 - 1) * 100, 1);
    expect(stats?.atHigh).toBe(false);
    expect(stats?.streak).toBe(-1);
    // 金額を持つフィールドが無いこと
    const leaked = Object.values(stats ?? {}).filter((v) => v === 120 || v === 139);
    expect(leaked).toEqual([]);
  });

  it('flags a new high and an up streak', () => {
    const stats = summarizePortfolio(series([100, 101, 102, 103, 104, 105]));
    expect(stats?.atHigh).toBe(true);
    expect(stats?.streak).toBe(5);
  });

  it('needs at least two days', () => {
    expect(summarizePortfolio(series([100]))).toBeNull();
  });
});

describe('QAIZ — parseQaizOverview', () => {
  const overview = {
    generatedAt: '2026-10-10T00:00:00Z',
    regime: { trend: 'bull', volatility: 'elevated', riskAppetite: 'risk-off' },
    breadth: [{ scope: 'us', label: 'narrow-rally' }],
    sectors: [
      { nameJa: 'テクノロジー', region: 'us', r1w: 0.032 },
      { nameJa: '公益', region: 'jp', r1w: -0.021 },
      { nameJa: '金融', region: 'eu', r1w: 0.004 },
      { nameJa: '不明', region: 'us', r1w: null },
    ],
    rotation: [
      {
        name: '半導体',
        region: 'us',
        quadrant: 'leading',
        trail: [
          { rsRatio: 98, rsMomentum: 103 },
          { rsRatio: 101, rsMomentum: 102 },
        ],
      },
      {
        name: '素材',
        region: 'jp',
        quadrant: 'lagging',
        trail: [
          { rsRatio: 97, rsMomentum: 98 },
          { rsRatio: 96, rsMomentum: 97 },
        ],
      },
    ],
  };

  it('turns ratios into percentages and finds quadrant transitions', () => {
    const m = parseQaizOverview(JSON.stringify(overview));
    expect(m?.trend).toBe('bull');
    expect(m?.strongest[0]).toEqual({ name: 'テクノロジー', region: '米国', r1wPct: 3.2 });
    expect(m?.weakest[0].name).toBe('公益');
    expect(m?.rotations).toEqual([
      { name: '半導体', region: '米国', from: 'improving', to: 'leading' },
    ]);
  });

  it('ignores unknown enum values instead of passing them through', () => {
    const m = parseQaizOverview(JSON.stringify({ ...overview, regime: { trend: 'moon' } }));
    expect(m?.trend).toBeNull();
  });

  it('returns null for the 503 "generating" payload', () => {
    expect(parseQaizOverview(JSON.stringify({ status: 'generating' }))).toBeNull();
    expect(parseQaizOverview('not json')).toBeNull();
  });

  it('quadrantOf matches the RRG convention', () => {
    expect(quadrantOf(101, 101)).toBe('leading');
    expect(quadrantOf(101, 99)).toBe('weakening');
    expect(quadrantOf(99, 99)).toBe('lagging');
    expect(quadrantOf(99, 101)).toBe('improving');
  });
});

describe('derivePredicates', () => {
  const t = { bigMovePct: 1.5, drawdownPct: 5, nearHighPct: 1 };

  it('derives symbolic facts from thresholds', () => {
    const preds = derivePredicates(
      {
        asOf: '2026-10-10',
        d1Pct: -2,
        d7Pct: -1,
        d30Pct: -4,
        fromHighPct: -6,
        atHigh: false,
        vol30Pct: 12,
        streak: -4,
        days: 100,
      },
      {
        generatedAt: null,
        trend: 'bull',
        volatility: 'stress',
        riskAppetite: 'risk-off',
        breadth: 'narrow-rally',
        strongest: [],
        weakest: [],
        rotations: [],
      },
      t,
    );
    expect(preds).toEqual([
      'divergence.market_up_me_down',
      'market.bull',
      'market.narrow',
      'market.risk_off',
      'market.vol_high',
      'portfolio.big_down_day',
      'portfolio.down_streak',
      'portfolio.drawdown',
      'portfolio.month_down',
    ]);
  });

  it('is empty when nothing was collected', () => {
    expect(derivePredicates(null, null, t)).toEqual([]);
  });
});

describe('buildFinanceBrief', () => {
  it('always ships the usage constraints and no amount', () => {
    const pulse: FinancePulse = {
      capturedAt: '2026-10-10',
      portfolio: {
        asOf: '2026-10-10',
        d1Pct: 0.4,
        d7Pct: 1.2,
        d30Pct: 3.1,
        fromHighPct: 0,
        atHigh: true,
        vol30Pct: 9,
        streak: 3,
        days: 200,
      },
      market: null,
      predicates: ['portfolio.new_high'],
      degraded: true,
      notes: [],
    };
    const brief = buildFinanceBrief(pulse);
    expect(brief).toContain('前日比 +0.4%');
    expect(brief).toContain('金額は書かない');
    expect(brief).toContain('投資助言をしない');
    expect(brief).not.toMatch(/\$|ドル\d|円\d/);
  });

  it('is empty without data', () => {
    expect(buildFinanceBrief(null)).toBe('');
  });
});

describe('collectFinancePulse / runKaia (fetch stubbed)', () => {
  const logsBody = `x(${JSON.stringify({
    table: {
      rows: [
        { c: [{ v: 'Date(2026,9,8,12,0,0)' }, { v: 100 }] },
        { c: [{ v: 'Date(2026,9,9,12,0,0)' }, { v: 103 }] },
      ],
    },
  })})`;
  const overviewBody = JSON.stringify({
    regime: { trend: 'bear', riskAppetite: 'risk-off' },
    sectors: [],
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reads assetlog and QAIZ and derives predicates', async () => {
    vi.stubEnv('QAIZ_BASE_URL', 'https://qaiz.example.workers.dev/');
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(String(url).includes('qaiz') ? overviewBody : logsBody, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pulse = await collectFinancePulse(new Date('2026-10-10T00:00:00Z'));
    expect(pulse.portfolio?.d1Pct).toBe(3);
    expect(pulse.market?.trend).toBe('bear');
    expect(pulse.predicates).toContain('market.risk_off');
    expect(pulse.predicates).toContain('portfolio.big_up_day');
    // 2日ぶんしか無いので1週間の変化率は出ない → 「ずれ」の記号も出ない
    expect(pulse.predicates).not.toContain('divergence.market_down_me_up');
    expect(pulse.degraded).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([u]) => String(u) === 'https://qaiz.example.workers.dev/api/overview',
      ),
    ).toBe(true);
  });

  it('notes a missing QAIZ_BASE_URL and keeps going', async () => {
    vi.stubEnv('QAIZ_BASE_URL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(logsBody, { status: 200 })),
    );
    const pulse = await collectFinancePulse();
    expect(pulse.market).toBeNull();
    expect(pulse.degraded).toBe(true);
    expect(pulse.notes.join()).toContain('QAIZ_BASE_URL');
  });

  it('falls back to a fresh snapshot, then to null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-fin-'));
    vi.stubEnv('QAIZ_BASE_URL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const now = new Date('2026-10-10T12:00:00Z');
    expect(await runKaia(dir, now)).toBeNull();

    const snap: FinancePulse = {
      capturedAt: '2026-10-09',
      portfolio: null,
      market: null,
      predicates: ['market.bull'],
      degraded: true,
      notes: [],
    };
    await saveFinancePulse(dir, snap);
    expect(await loadFinancePulse(dir)).toEqual(snap);
    expect(isPulseFresh(snap, now)).toBe(true);
    expect(isPulseFresh({ ...snap, capturedAt: '2026-09-01' }, now)).toBe(false);
    expect((await runKaia(dir, now))?.predicates).toEqual(['market.bull']);
  });
});
