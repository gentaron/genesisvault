/**
 * Phase η — Sentry Server Configuration
 *
 * Captures server-side errors from Astro SSR and API routes.
 * Used in hybrid mode or for Cloudflare Workers edge functions.
 */
import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: import.meta.env.MODE,
  release: import.meta.env.PUBLIC_GIT_SHA || undefined,
  integrations: [
    Sentry.nodeContextIntegration(),
  ],
  // Performance monitoring
  profilesSampleRate: 0,
});
