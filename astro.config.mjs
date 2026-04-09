import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://genesisvault.vercel.app',
  integrations: [mdx(), react()],
  markdown: {
    shikiConfig: {
      theme: 'github-light',
      wrap: true
    }
  }
});
