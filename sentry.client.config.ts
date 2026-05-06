/**
 * Phase η — Sentry Client Configuration
 *
 * Captures client-side errors, unhandled promise rejections,
 * and performance traces at 10% sampling rate.
 * Replays are disabled for privacy (Mina's brand promise).
 */
import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  environment: import.meta.env.MODE,
  release: import.meta.env.PUBLIC_GIT_SHA || undefined,
  integrations: [
    Sentry.browserTracingIntegration(),
    // No replay integration — privacy-first
  ],
  // Don't capture 402 paywall hits as errors — normal traffic
  ignoreErrors: [
    'Request failed with status code 402',
    'Non-Error promise rejection captured',
  ],
});
