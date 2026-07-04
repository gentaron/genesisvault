/**
 * Genesis Vault — E2E Static + API Server
 *
 * `astro preview` serves only the static build, so the Vercel
 * serverless functions under api/ were never reachable in E2E runs —
 * every /api/* request 404'd and the paywall/unlock journeys failed.
 *
 * This server serves dist/ (same clean-URL rules as astro preview)
 * and mounts the real Vercel handlers under /api via a minimal
 * (req, res) adapter, so Playwright exercises the actual handler code.
 *
 * Run with bun (it imports the TS handlers directly):
 *   bun run build && bun scripts/e2e-server.mjs
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import articleHandler from '../api/article/[slug].ts';
import unlockHandler from '../api/unlock.ts';
import unlockLegacyHandler from '../api/unlock-legacy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
};

// ─── Minimal Vercel (req, res) adapter ─────────────────────────

// Prototype-pollution-safe cookie parsing: null-prototype target and
// an explicit denylist for prototype-related keys (CodeQL js/remote-property-injection).
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function parseCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (FORBIDDEN_KEYS.has(key)) continue;
    cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function adaptVercel(handler, params = {}) {
  return async (req, res, url) => {
    req.query = { ...Object.fromEntries(url.searchParams), ...params };
    req.cookies = parseCookies(req.headers.cookie);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.body = await readBody(req);
    }

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (obj) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(obj));
      return res;
    };
    res.send = (data) => {
      res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
      return res;
    };
    res.redirect = (code, location) => {
      res.statusCode = typeof code === 'number' ? code : 307;
      res.setHeader('location', typeof code === 'number' ? location : code);
      res.end();
      return res;
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error('[e2e-server] handler error:', err);
      if (!res.writableEnded) res.status(500).json({ error: 'Internal error' });
    }
  };
}

// ─── Static file resolution (astro preview clean-URL rules) ────

async function resolveStatic(pathname) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const base = path.join(DIST, safe);
  if (!base.startsWith(DIST)) return null;

  const candidates = [base];
  if (safe.endsWith('/')) {
    candidates.push(path.join(base, 'index.html'));
  } else if (!path.extname(safe)) {
    candidates.push(path.join(base, 'index.html'), `${base}.html`);
  }
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ─── Server ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  // API routes (Vercel handlers)
  if (pathname === '/api/unlock') {
    return adaptVercel(unlockHandler)(req, res, url);
  }
  if (pathname === '/api/unlock-legacy') {
    return adaptVercel(unlockLegacyHandler)(req, res, url);
  }
  if (pathname === '/api/article' || pathname.startsWith('/api/article/')) {
    const slug = decodeURIComponent(pathname.replace(/^\/api\/article\/?/, ''));
    // Vercel only routes when the [slug] segment is present
    if (!slug) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    return adaptVercel(articleHandler, { slug })(req, res, url);
  }
  if (pathname.startsWith('/api/')) {
    res.statusCode = 404;
    return res.end('Not found');
  }

  // Static files from dist/
  const filePath = await resolveStatic(pathname);
  if (!filePath) {
    const notFound = await resolveStatic('/404.html');
    res.statusCode = 404;
    if (notFound) {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(await fs.readFile(notFound));
    }
    return res.end('Not found');
  }
  res.statusCode = 200;
  res.setHeader('content-type', MIME[path.extname(filePath)] || 'application/octet-stream');
  res.end(await fs.readFile(filePath));
});

server.listen(PORT, () => {
  console.log(`[e2e-server] serving dist/ + /api on http://localhost:${PORT}`);
});
