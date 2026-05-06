import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

import cloudflare from "@astrojs/cloudflare";
import sentry from '@sentry/astro';

// NOTE: API routes (unlock, article, unlock-legacy) are deployed as Vercel
// serverless functions in the `api/` directory. They use `@vercel/node`.
// The Astro build remains static (SSG) — gated article bodies are NOT rendered
// in the static output and are fetched client-side from the Vercel API.

// https://astro.build/config
export default defineConfig({
  site: 'https://genesisvault.vercel.app',
  integrations: [
    mdx(),
    sentry({
      sourceMapsUploadOptions: {
        project: 'genesisvault',
        authToken: process.env.SENTRY_AUTH_TOKEN,
      },
    }),
  ],

  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true
    }
  },

  vite: {
    plugins: [tailwindcss()],
    sourcemap: true,  // Required for Sentry source maps
  },

  adapter: cloudflare()
});
