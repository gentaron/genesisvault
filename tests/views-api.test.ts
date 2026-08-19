import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPipeline,
  MAX_PATH_LENGTH,
  normalizePagePath,
  PAGE_KEY_PREFIX,
  pageKey,
  parseCounts,
  readCounterConfig,
  runPipeline,
  TOTAL_KEY,
} from '../api/_lib/views';

// ═══════════════════════════════════════════════════════════════
// Access counter — path normalisation (key hygiene)
// ═══════════════════════════════════════════════════════════════

describe('normalizePagePath', () => {
  it('keeps a plain absolute path', () => {
    expect(normalizePagePath('/about')).toBe('/about');
    expect(normalizePagePath('/')).toBe('/');
  });

  it('drops query string and fragment so one page has one key', () => {
    expect(normalizePagePath('/posts/2026-08-18-post?utm_source=x')).toBe('/posts/2026-08-18-post');
    expect(normalizePagePath('/about#profile')).toBe('/about');
  });

  it('treats a trailing slash as the same page', () => {
    expect(normalizePagePath('/about/')).toBe('/about');
  });

  it('rejects anything that is not a same-origin absolute path', () => {
    expect(normalizePagePath('https://evil.example.com/x')).toBeNull();
    expect(normalizePagePath('//evil.example.com/x')).toBeNull();
    expect(normalizePagePath('about')).toBeNull();
    expect(normalizePagePath('')).toBeNull();
  });

  it('rejects traversal and separator tricks', () => {
    expect(normalizePagePath('/../../etc/passwd')).toBeNull();
    expect(normalizePagePath('/a\\b')).toBeNull();
  });

  it('rejects characters that do not belong in a path', () => {
    expect(normalizePagePath('/a b')).toBeNull();
    expect(normalizePagePath('/a\nb')).toBeNull();
    expect(normalizePagePath('/a:b')).toBeNull();
  });

  it('rejects non-strings and over-long paths', () => {
    expect(normalizePagePath(undefined)).toBeNull();
    expect(normalizePagePath(42)).toBeNull();
    expect(normalizePagePath(['/a'])).toBeNull();
    expect(normalizePagePath(`/${'a'.repeat(MAX_PATH_LENGTH)}`)).toBeNull();
  });
});

describe('pageKey', () => {
  it('namespaces the path under the views prefix', () => {
    expect(pageKey('/about')).toBe(`${PAGE_KEY_PREFIX}/about`);
  });
});

// ═══════════════════════════════════════════════════════════════
// Access counter — configuration (optional feature)
// ═══════════════════════════════════════════════════════════════

describe('readCounterConfig', () => {
  it('returns null when nothing is configured (counter simply disabled)', () => {
    expect(readCounterConfig({})).toBeNull();
  });

  it('returns null when only one half of the credentials is present', () => {
    expect(readCounterConfig({ KV_REST_API_URL: 'https://kv.example.com' })).toBeNull();
    expect(readCounterConfig({ KV_REST_API_TOKEN: 'token' })).toBeNull();
  });

  it('accepts the Vercel KV variable names', () => {
    expect(
      readCounterConfig({ KV_REST_API_URL: 'https://kv.example.com/', KV_REST_API_TOKEN: 't' }),
    ).toEqual({ url: 'https://kv.example.com', token: 't' });
  });

  it('accepts the Upstash variable names', () => {
    expect(
      readCounterConfig({
        UPSTASH_REDIS_REST_URL: 'https://up.example.com',
        UPSTASH_REDIS_REST_TOKEN: 'u',
      }),
    ).toEqual({ url: 'https://up.example.com', token: 'u' });
  });
});

// ═══════════════════════════════════════════════════════════════
// Access counter — pipeline building and parsing
// ═══════════════════════════════════════════════════════════════

describe('buildPipeline', () => {
  it('increments both counters in one round trip', () => {
    expect(buildPipeline('/about', 'increment')).toEqual([
      ['INCR', TOTAL_KEY],
      ['INCR', `${PAGE_KEY_PREFIX}/about`],
    ]);
  });

  it('reads without side effects', () => {
    expect(buildPipeline('/about', 'read')).toEqual([
      ['GET', TOTAL_KEY],
      ['GET', `${PAGE_KEY_PREFIX}/about`],
    ]);
  });
});

describe('parseCounts', () => {
  it('reads numeric and string replies', () => {
    expect(parseCounts([{ result: 12 }, { result: '3' }])).toEqual({ total: 12, page: 3 });
  });

  it('treats a never-viewed page as zero, not as a failure', () => {
    expect(parseCounts([{ result: 12 }, { result: null }])).toEqual({ total: 12, page: 0 });
  });

  it('returns null for a malformed or partial reply', () => {
    expect(parseCounts(null)).toBeNull();
    expect(parseCounts([{ result: 1 }])).toBeNull();
    expect(parseCounts([{ result: 1 }, { error: 'WRONGTYPE' }])).toBeNull();
    expect(parseCounts(['1', '2'])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Access counter — REST transport
// ═══════════════════════════════════════════════════════════════

describe('runPipeline', () => {
  const config = { url: 'https://kv.example.com', token: 'secret' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the commands with the bearer token and returns the counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 7 }, { result: 2 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const counts = await runPipeline(config, buildPipeline('/about', 'increment'));

    expect(counts).toEqual({ total: 7, page: 2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kv.example.com/pipeline');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual([
      ['INCR', TOTAL_KEY],
      ['INCR', `${PAGE_KEY_PREFIX}/about`],
    ]);
  });

  it('throws on a non-2xx response instead of inventing a number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(runPipeline(config, buildPipeline('/', 'read'))).rejects.toThrow('401');
  });

  it('throws when the payload cannot be parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: true }) }),
    );
    await expect(runPipeline(config, buildPipeline('/', 'read'))).rejects.toThrow('unexpected');
  });

  it('aborts a stalled request rather than hanging the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await expect(runPipeline(config, buildPipeline('/', 'read'), 10)).rejects.toThrow('aborted');
  });
});
