/**
 * Phase ν tests — Trend Radar (VE-010 Tessa)
 *
 * 外部データを取り込む唯一のサブシステム。ここで守りたいのは2つ:
 *
 *   1. **壊れた応答で落ちないこと**。HN が HTML のエラーページを返した日に
 *      日記が出ないのは、明らかに割に合わない（fail-soft）。
 *   2. **相場の数字が個人の事実に化けないこと**。ブリーフに「使い方」が
 *      無いと、日記が相場解説になる。
 *
 * ネットワークには触らない。fetch はすべて差し替える。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTrendBrief,
  collectMarketSignals,
  collectTechSignals,
  collectTrendRadar,
  fetchText,
  isRadarFresh,
  loadTrendRadar,
  parseArxiv,
  parseHackerNews,
  parseStooqCsv,
  saveTrendRadar,
  summarizeSeries,
  type TrendRadar,
} from '../src/lib/agents/trends';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Stooq CSV ──────────────────────────────────────────────────

const CSV = [
  'Date,Open,High,Low,Close,Volume',
  ...Array.from({ length: 25 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    const close = 100 + i; // 単調増加のダミー系列
    return `2026-07-${day},${close},${close},${close},${close},1000`;
  }),
].join('\n');

describe('parseStooqCsv', () => {
  it('reads the daily close series and sorts it by date', () => {
    const bars = parseStooqCsv(CSV);
    expect(bars).toHaveLength(25);
    expect(bars[0].date).toBe('2026-07-01');
    expect(bars[bars.length - 1].close).toBe(124);
  });

  it('returns nothing for an error body instead of throwing', () => {
    // 銘柄が無いとき Stooq は CSV ではなく素のテキストを返す
    expect(parseStooqCsv('No data')).toEqual([]);
    expect(parseStooqCsv('')).toEqual([]);
    expect(parseStooqCsv('<html><body>429</body></html>')).toEqual([]);
  });

  it('skips malformed rows rather than emitting NaN closes', () => {
    const bars = parseStooqCsv(
      `Date,Open,High,Low,Close,Volume\n2026-07-01,1,1,1,abc,1\n2026-07-02,1,1,1,2,1`,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(2);
  });
});

describe('summarizeSeries', () => {
  it('describes direction from the 5-day change and the 20-day average', () => {
    const signal = summarizeSeries('^spx', 'S&P500', parseStooqCsv(CSV), 1.5);
    expect(signal).not.toBeNull();
    expect(signal?.close).toBe(124);
    expect(signal?.direction).toBe('上昇');
    expect(signal?.aboveSma20).toBe(true);
    expect(signal?.asOf).toBe('2026-07-25');
  });

  it('calls a flat market flat', () => {
    const flat = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      close: 100,
    }));
    expect(summarizeSeries('x', 'X', flat, 1.5)?.direction).toBe('横ばい');
  });

  it('still summarizes a short series (no SMA yet)', () => {
    const bars = [
      { date: '2026-07-01', close: 100 },
      { date: '2026-07-02', close: 90 },
    ];
    const signal = summarizeSeries('x', 'X', bars, 1.5);
    expect(signal?.sma20).toBeNull();
    expect(signal?.changePct5d).toBeNull();
    expect(signal?.direction).toBe('下落');
  });

  it('returns null for an empty series', () => {
    expect(summarizeSeries('x', 'X', [], 1.5)).toBeNull();
  });
});

// ─── Tech sources ───────────────────────────────────────────────

describe('parseHackerNews', () => {
  it('reads hits and falls back to the HN item URL', () => {
    const signals = parseHackerNews(
      JSON.stringify({
        hits: [
          {
            title: 'A new model',
            url: 'https://example.com/a',
            points: 320,
            created_at: '2026-08-04T10:00:00Z',
          },
          {
            story_title: 'Ask HN: agents?',
            objectID: '42',
            points: 150,
            created_at: '2026-08-04T11:00:00Z',
          },
          { points: 900 }, // タイトルの無い壊れた要素は捨てる
        ],
      }),
    );
    expect(signals).toHaveLength(2);
    expect(signals[0].score).toBe(320);
    expect(signals[1].url).toContain('news.ycombinator.com/item?id=42');
    expect(signals[1].date).toBe('2026-08-04');
  });

  it('returns nothing for non-JSON instead of throwing', () => {
    expect(parseHackerNews('<html>502</html>')).toEqual([]);
    expect(parseHackerNews('')).toEqual([]);
  });
});

describe('parseArxiv', () => {
  it('reads entry titles and decodes entities', () => {
    const feed = `<feed><entry><title>Scaling  Laws &amp; Limits</title>
      <id>http://arxiv.org/abs/2608.00001</id><published>2026-08-04T00:00:00Z</published></entry></feed>`;
    const signals = parseArxiv(feed);
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('Scaling Laws & Limits');
    expect(signals[0].source).toBe('arXiv');
    expect(signals[0].score).toBeNull();
  });

  it('returns nothing for a body with no entries', () => {
    expect(parseArxiv('<feed></feed>')).toEqual([]);
  });
});

// ─── fetch behaviour (fail-soft) ────────────────────────────────

describe('fetchText', () => {
  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'nope' }));
    expect(await fetchText('https://example.com', 100)).toBeNull();
  });

  it('returns null when the request throws (timeout, DNS, offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    expect(await fetchText('https://example.com', 100)).toBeNull();
  });
});

describe('collection is fail-soft', () => {
  it('records a note per dead source and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const radar = await collectTrendRadar(new Date('2026-08-05T00:00:00Z'));
    expect(radar.tech).toEqual([]);
    expect(radar.market).toEqual([]);
    expect(radar.degraded).toBe(true);
    expect(radar.notes.length).toBeGreaterThan(0);
  });

  it('keeps the sources that did answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('stooq')) return { ok: true, text: async () => CSV };
        return { ok: false, text: async () => '' };
      }),
    );
    const market = await collectMarketSignals(new Date('2026-08-05T00:00:00Z'));
    expect(market.signals.length).toBeGreaterThan(0);
    const tech = await collectTechSignals(new Date('2026-08-05T00:00:00Z'));
    expect(tech.signals).toEqual([]);
    expect(tech.notes.length).toBeGreaterThan(0);
  });
});

// ─── Brief ──────────────────────────────────────────────────────

const RADAR: TrendRadar = {
  capturedAt: '2026-08-05',
  tech: [
    {
      source: 'Hacker News',
      title: 'A new model',
      url: 'https://e.com',
      score: 320,
      date: '2026-08-04',
    },
  ],
  market: [
    {
      symbol: '^spx',
      label: 'S&P500',
      close: 6120.5,
      changePct1d: 0.4,
      changePct5d: 1.8,
      sma20: 6000,
      aboveSma20: true,
      direction: '上昇',
      asOf: '2026-08-04',
    },
  ],
  degraded: false,
  notes: [],
};

describe('buildTrendBrief', () => {
  it('carries both halves of the radar', () => {
    const brief = buildTrendBrief(RADAR);
    expect(brief).toContain('A new model');
    expect(brief).toContain('S&P500');
    expect(brief).toContain('上昇');
  });

  it('always states how the trend may be used', () => {
    // 材料だけ渡すと日記がニュース要約になる。制約こそがこのブリーフの本体。
    const brief = buildTrendBrief(RADAR);
    expect(brief).toContain('主題はあくまでミナの生活');
    expect(brief).toContain('投資助言');
    expect(brief).toContain('貯金額・資産額として書かない');
  });

  it('is empty when there is nothing to say (no empty section headers)', () => {
    expect(buildTrendBrief(null)).toBe('');
    expect(buildTrendBrief({ ...RADAR, tech: [], market: [] })).toBe('');
  });

  it('warns the writer when the radar is partial', () => {
    expect(buildTrendBrief({ ...RADAR, degraded: true })).toContain(
      '一部のデータが取得できていません',
    );
  });
});

// ─── Cache ──────────────────────────────────────────────────────

describe('radar snapshot', () => {
  it('round-trips through disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gv-trends-'));
    try {
      expect(await loadTrendRadar(dir)).toBeNull();
      await saveTrendRadar(dir, RADAR);
      expect((await loadTrendRadar(dir))?.capturedAt).toBe('2026-08-05');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('treats an old or missing snapshot as unusable', () => {
    const now = new Date('2026-08-05T12:00:00Z');
    expect(isRadarFresh(RADAR, now)).toBe(true);
    expect(isRadarFresh({ ...RADAR, capturedAt: '2026-07-01' }, now)).toBe(false);
    expect(isRadarFresh(null, now)).toBe(false);
    expect(isRadarFresh({ ...RADAR, capturedAt: 'nonsense' }, now)).toBe(false);
  });
});
