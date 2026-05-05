import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// TODO: Uncomment when @sentry/astro is verified compatible with Astro 5
// import sentry from '@sentry/astro';
// integrations: [mdx(), sentry()],

// https://astro.build/config
export default defineConfig({
  site: 'https://genesisvault.vercel.app',
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true
    }
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
