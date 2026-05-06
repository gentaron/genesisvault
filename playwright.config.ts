import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration — Phase ζ
 *
 * 6 critical user journeys tested on Chromium:
 *   1. Homepage renders with posts
 *   2. Public article renders full content
 *   3. Gated article shows paywall overlay
 *   4. Paywall bypass fails (402 for gated content)
 *   5. Unlock flow (wallet → pay → cookie → access)
 *   6. Dark mode persistence
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run build && bun run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
