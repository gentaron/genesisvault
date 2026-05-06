/**
 * Phase η — Umami Analytics Self-Hosted Proxy Script
 *
 * This script acts as a privacy-compliant analytics bridge.
 * When Umami self-hosted instance is not yet deployed, it logs
 * pageviews to console (dev mode) only — no data leaves the browser.
 *
 * Configuration (set as HTML attributes on <html>):
 *   data-umami-id    — Your Umami site ID
 *   data-umami-host  — Your self-hosted Umami instance URL
 *   data-umami-domains — Allowed domains (defaults to current hostname)
 *
 * Deployment: Place Umami CE on Vercel/Railway/Fly.io with free Postgres.
 * See docs/adr/0007-observability.md for setup instructions.
 */
(function () {
  var websiteId = document.documentElement.getAttribute('data-umami-id');
  var host = document.documentElement.getAttribute('data-umami-host');
  var domains = document.documentElement.getAttribute('data-umami-domains') || location.hostname;

  if (!websiteId) {
    // No Umami configured — silent no-op (privacy-first)
    return;
  }

  var script = document.createElement('script');
  script.defer = true;
  script.src = host + '/script.js';
  script.setAttribute('data-website-id', websiteId);
  script.setAttribute('data-domains', domains);
  document.head.appendChild(script);
})();
