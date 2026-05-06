import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'src/lib/**/*.ts',
        'api/**/*.ts',
        'src/content/config.ts',
        'scripts/**/*.mjs',
      ],
      exclude: [
        // ─── Framework/runtime-context files ───────────────────
        'src/content/config.ts',       // requires astro:content virtual module
        'src/scripts/**',              // client-side bundled scripts (tested via E2E)

        // ─── Vercel API handlers (logic tested via replication) ─
        'api/unlock.ts',
        'api/article/[slug].ts',
        'api/unlock-legacy.ts',

        // ─── External-service-dependent files ───────────────────
        'src/lib/agents/runners.ts',   // calls AI providers; tested via integration
        'src/lib/ai/generate.ts',      // calls AI SDK + REST; tested via integration
        'src/lib/web3/receipt.ts',     // calls Ethereum RPC; tested via integration
        'scripts/auto-post.mjs',       // main script with process.exit()
        'scripts/ipfs-archive.mjs',    // main script with process.exit()
        'scripts/nostr-broadcast.mjs', // main script with process.exit()
        'scripts/build-search.mjs',    // requires built site output

        // ─── Misc ──────────────────────────────────────────────
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        // Global minimum for all testable source files
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
    // Vitest 4 pool options
    pool: 'forks',
    maxForks: '50%',
  },
});
