/**
 * Phase η — Sentry Configuration for Node.js Scripts
 *
 * Used by auto-post.mjs and other Node.js scripts that run outside
 * the Astro context (GitHub Actions, local dev). Not bundled by Vite.
 *
 * Usage:
 *   import { initSentryNode, captureException } from './sentry-script.js';
 *   initSentryNode();
 *   try { ... } catch (e) { captureException(e); }
 */
import * as Sentry from '@sentry/node';

export function initSentryNode() {
  const dsn = process.env.PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] No DSN configured — skipping initialization');
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV || 'production',
    release: process.env.PUBLIC_GIT_SHA || process.env.GITHUB_SHA || undefined,
  });

  console.log('[Sentry] Node.js SDK initialized');
}

export { captureException } from '@sentry/node';
export { startSpan } from '@sentry/node';
export { Sentry };
