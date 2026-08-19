/**
 * Shared helpers for the access counter API (`/api/views`).
 *
 * The site itself is static (SSG on Vercel), so a page view can only be
 * counted from the browser. This module owns the two things that need to be
 * right regardless of who calls them:
 *
 *   1. **Key hygiene** — the page path arrives from the client and is used as
 *      part of a storage key. `normalizePagePath` is the only way in.
 *   2. **Storage access** — an Upstash/Vercel KV Redis REST endpoint, spoken
 *      over plain `fetch` so the API route needs no extra dependency.
 *
 * The counter is optional: with no credentials configured the endpoint reports
 * `enabled: false` and the widget stays hidden, exactly like the Umami
 * integration in `BaseLayout.astro`. Files prefixed with `_` are treated by
 * Vercel as non-route helpers.
 *
 * @module api/_lib/views
 */

// ─── Constants ─────────────────────────────────────────────────

/** Redis key holding the site-wide view count. */
export const TOTAL_KEY = 'gv:views:total';

/** Prefix for per-page view counts. */
export const PAGE_KEY_PREFIX = 'gv:views:page:';

/** Longest path we are willing to turn into a key. */
export const MAX_PATH_LENGTH = 128;

/** Upper bound for one REST round trip, so a stalled KV never hangs a request. */
const FETCH_TIMEOUT_MS = 3000;

// ─── Path handling ─────────────────────────────────────────────

/**
 * Normalise a client-supplied page path into a safe storage key component.
 *
 * Accepts only same-origin absolute paths: no scheme, no host, no traversal.
 * Query strings and fragments are dropped so `/posts/x?utm=1` and `/posts/x`
 * count as the same page. Returns `null` when the path cannot be trusted —
 * callers must treat that as a 400, never as "count it anyway".
 */
export function normalizePagePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  let path = raw.split('#')[0].split('?')[0].trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('..') || path.includes('\\')) return null;
  if (!/^[\w\-./%~]*$/.test(path.slice(1))) return null;

  // `/about/` and `/about` are one page; `/` stays `/`.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  if (path.length > MAX_PATH_LENGTH) return null;
  return path;
}

/** Build the per-page Redis key for an already-normalised path. */
export function pageKey(path: string): string {
  return `${PAGE_KEY_PREFIX}${path}`;
}

// ─── Storage configuration ─────────────────────────────────────

export interface CounterConfig {
  url: string;
  token: string;
}

/**
 * Resolve the Redis REST credentials from the environment.
 *
 * Both the Vercel KV (`KV_REST_API_*`) and the Upstash (`UPSTASH_REDIS_REST_*`)
 * variable names are accepted, because the same free-tier database is exposed
 * under either name depending on how it was linked to the project.
 *
 * Returns `null` when the counter is not configured — that is a supported
 * state, not an error.
 */
export function readCounterConfig(env: NodeJS.ProcessEnv = process.env): CounterConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

// ─── Redis pipeline ────────────────────────────────────────────

export type CounterMode = 'read' | 'increment';

/**
 * Build the Redis pipeline for one request.
 *
 * `increment` bumps both counters and returns their new values in the same
 * round trip (INCR replies with the value), so a view never needs a second
 * call to be displayed.
 */
export function buildPipeline(path: string, mode: CounterMode): string[][] {
  const command = mode === 'increment' ? 'INCR' : 'GET';
  return [
    [command, TOTAL_KEY],
    [command, pageKey(path)],
  ];
}

/** A count that is absent (page never viewed) reads as 0, not as an error. */
function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

export interface Counts {
  total: number;
  page: number;
}

/**
 * Read the two counts out of an Upstash pipeline response.
 *
 * The response is an array of `{ result }` (or `{ error }`) objects in command
 * order. A malformed or partial reply yields `null` so the caller can fail
 * loudly rather than display a fabricated zero.
 */
export function parseCounts(payload: unknown): Counts | null {
  if (!Array.isArray(payload) || payload.length < 2) return null;

  const entries = payload.slice(0, 2) as Array<{ result?: unknown; error?: unknown }>;
  if (entries.some((entry) => !entry || typeof entry !== 'object' || entry.error)) return null;

  return {
    total: toCount(entries[0].result),
    page: toCount(entries[1].result),
  };
}

/**
 * Execute a pipeline against the Redis REST endpoint.
 *
 * Throws on transport failure, non-2xx status, or an unparseable body; the
 * route turns that into a 502. The counter is decorative, so the caller may
 * swallow the failure — but this layer never invents a number.
 */
export async function runPipeline(
  config: CounterConfig,
  commands: string[][],
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Counts> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`KV responded ${response.status}`);
    }

    const counts = parseCounts(await response.json());
    if (!counts) throw new Error('KV returned an unexpected payload');
    return counts;
  } finally {
    clearTimeout(timer);
  }
}
