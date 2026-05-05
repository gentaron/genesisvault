# ADR 0001: Foundation (Phase α)

**Date**: 2026-05-05
**Status**: Accepted
**Supersedes**: N/A

## Context

Genesis Vault was built on Astro 4.16, Node.js 20, npm, TypeScript 5.6, and had no linting/formatting tooling. The project needed a foundation upgrade to enable faster builds, consistent DX, and stricter type safety before introducing a design system in Phase β.

## Decision

### Astro 5

- **Upgrade**: `astro` ^4.16.0 → ^5.0.0, `@astrojs/mdx` ^3.1.0 → ^4.0.0
- **Rationale**:
  - Content Layer API stability — collections have first-class support with clearer migration paths
  - View Transitions API built-in for SPA-like navigation without client-side frameworks
  - Faster builds via improved content hashing and parallel rendering
  - `@astrojs/check` ^0.9.0 retained as-is (Astro 5 compatible)
- **Risk**: Content Collections legacy API (`defineCollection({ type: 'content' })`) is supported in Astro 5 as deprecated-then-removed path. The existing `src/content/config.ts` with Zod schema continues to work.
- **Migration note**: `tsconfig.json` extends `astro/tsconfigs/strict` (unchanged — Astro 5 ships its own preset).

### Bun 1.3.12

- **Upgrade**: Added `"packageManager": "bun@1.3.12"` to package.json
- **Rationale**:
  - 3–5× faster `install` than npm
  - Native `.mjs`/`.ts` execution without `node` prefix
  - Consistency with other projects in the ecosystem
  - `bun.lockb` binary lockfile for faster installs (kept `package-lock.json` initially for CI compat)
- **Scripts updated**: `"auto-post": "bun scripts/auto-post.mjs"` (was `node scripts/auto-post.mjs`)
- **CI updated**: `.github/workflows/daily-post.yml` uses `oven-sh/setup-bun@v2` with `bun-version: '1'`

### Biome 2

- **Added**: `@biomejs/biome` ^2.0.0 as devDependency
- **Configuration**: `biome.json` with:
  - Import auto-organization
  - Recommended linter rules + `noUnusedVariables: "warn"`
  - Single-quote, semicolons, space indent, 100 char line width
  - Ignores: `node_modules`, `dist`, `.astro`, `src/content/posts/*.md`
- **Rationale**:
  - 25× faster than ESLint + Prettier combined
  - Single config file (no `.eslintrc`, `.prettierrc`, `.editorconfig`)
  - Rust-native, zero-config for TypeScript/JSX
  - `scripts.lint` and `scripts.format` added to package.json

### TypeScript 5.8

- **Upgrade**: `typescript` ^5.6.0 → ^5.8.0
- **Rationale**:
  - Stricter type narrowing (e.g., inferred `never` checks)
  - Better `satisfies` operator inference
  - Improved `--isolatedDeclarations` support for future library mode
  - No breaking changes from 5.6 → 5.8

## Consequences

- **Positive**: Faster builds, modern toolchain, stricter type safety, single lint/format tool
- **Negative**: Bun is not yet the default in all CI runners (mitigated by `oven-sh/setup-bun`)
- **Neutral**: `package-lock.json` retained alongside `bun.lockb` for gradual migration
- **Not modified**: All scripts in `scripts/`, paywall JS in `index.astro` and `[...slug].astro`, dark mode toggle in `BaseLayout.astro`
