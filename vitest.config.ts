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
        'src/lib/sentry-script.ts',    // Sentry SDK init only; no testable logic
        'src/lib/web3/receipt.ts',     // calls Ethereum RPC; tested via integration
        'scripts/auto-post.mjs',       // main script with process.exit()
        'scripts/ipfs-archive.mjs',    // main script with process.exit()
        'scripts/nostr-broadcast.mjs', // main script with process.exit()
        'scripts/build-search.mjs',    // requires built site output
        'scripts/e2e-server.mjs',      // E2E test infra; exercised by Playwright itself

        // 同じ「main() + process.exit() で export を持たない CLI」だが、
        // 書かれた当時にこの一覧へ足し忘れていたもの。除外されないまま
        // 0% として全体に混ざり、しきい値 (85%) を誰も満たせない状態に
        // していた（このジョブは main でもずっと赤かった）。
        // 実行そのものが検証になる種類のスクリプトで、単体テストは書けない。
        'scripts/verify.mjs',          // 検証ゲート本体; 実行が検証
        'scripts/brief-gate.mjs',      // 審査ゲート; main script with process.exit()
        'scripts/gate-eval.mjs',       // 審査役の捕捉率測定; APIキー必須
        'scripts/linear-sync.mjs',     // Linear CLI; main script with process.exit()
        'scripts/linear-video-brief.mjs', // Linear CLI; main script with process.exit()

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
    //
    // `maxForks` は Vitest 4 の設定キーとして存在しない（型定義にも無い）ため、
    // ここに書いてあっても黙って無視されていた。並列度を実際に絞るキーは
    // `maxWorkers`。意図（コア数の 50% まで）はそのままに、効くキーへ直す。
    pool: 'forks',
    maxWorkers: '50%',
  },
});
