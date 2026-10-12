import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildPipeline,
  type CounterMode,
  normalizePagePath,
  readCounterConfig,
  runPipeline,
} from './_lib/views';

/**
 * Access counter endpoint.
 *
 * - `GET  /api/views?path=/foo` — read the counts without changing them
 * - `POST /api/views` (`{ "path": "/foo" }`) — count one view, return the new counts
 *
 * Responses are `no-store` (see `vercel.json`), so the widget always shows the
 * live value. When no KV credentials are configured the endpoint answers
 * `{ enabled: false }` and the widget hides itself.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mode: CounterMode | null =
    req.method === 'GET' ? 'read' : req.method === 'POST' ? 'increment' : null;

  if (!mode) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawPath =
    (req.body && typeof req.body === 'object'
      ? (req.body as { path?: unknown }).path
      : undefined) ?? req.query.path;
  const path = normalizePagePath(rawPath);
  if (!path) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const config = readCounterConfig();
  if (!config) {
    // Not configured is a supported state, not a failure: the site simply
    // ships without a counter until a KV database is linked.
    return res.status(200).json({ enabled: false });
  }

  try {
    const counts = await runPipeline(config, buildPipeline(path, mode));
    return res.status(200).json({ enabled: true, path, ...counts });
  } catch (err) {
    console.error('Views endpoint error:', err);
    return res.status(502).json({ error: 'Counter unavailable' });
  }
}
