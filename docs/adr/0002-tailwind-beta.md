# ADR 0002: Tailwind CSS v4 Design System (Phase β)

**Date**: 2026-05-05
**Status**: Accepted
**Supersedes**: N/A

## Context

Genesis Vault's styling was entirely in `src/styles/global.css` (678 lines of custom CSS) with CSS custom properties, Google Fonts imports, glassmorphism effects, and dark mode via `.dark` class toggle. There was no utility-first CSS framework, making future component development slower and less consistent.

## Decision

### Tailwind CSS v4

- **Added**: `tailwindcss` ^4.0.0, `@tailwindcss/vite` ^4.0.0 as devDependencies
- **Integration**: `astro.config.mjs` adds `tailwindcss()` to `vite.plugins`
- **Entry point**: `src/styles/app.css` with `@import 'tailwindcss'` and `@theme` directive

**Why Tailwind v4 (not v3)**:
- Zero-config — no `tailwind.config.js` needed; configuration via CSS `@theme` directive
- CSS-first config — design tokens defined in CSS, not JS
- `@theme` directive replaces `theme.extend` with native CSS custom properties
- 10× faster than v3 (Rust-based engine, same as Biome)
- Automatic content detection — no `content: [...]` array needed
- `@tailwindcss/vite` is the official Vite plugin (replaces PostCSS plugin)

**Why not CSS-in-JS**:
- Runtime overhead not acceptable for a static site
- Astro's zero-JS philosophy conflicts with CSS-in-JS hydration
- Server-side rendering of CSS-in-JS adds build complexity

**Why not UnoCSS**:
- Smaller ecosystem, fewer community presets
- Tailwind v4's CSS-first config achieves the same DX goals
- UnoCSS's atomic generation can conflict with Astro's content collection types

### Design Tokens (via @theme)

```css
@theme {
  --color-warm-white: #FAF9F6;
  --color-soft-beige: #F5F1E8;
  --color-gentle-green: #A8C5A3;
  --color-lavender-mist: #C8B8DB;
  --color-charcoal: #2D2D2D;
  --color-gray-light: #E5E5E5;
  --color-gray-dark: #666;

  --font-serif: 'Noto Serif JP', serif;
  --font-sans: 'Noto Sans JP', sans-serif;

  --animate-shimmer: shimmer 3s infinite;
  --animate-pulse-ring: pulse-ring 2s ease-in-out infinite;
  --animate-float: float 3s ease-in-out infinite;
}
```

These tokens map to Tailwind utility classes: `bg-warm-white`, `text-gentle-green`, `font-serif`, `animate-shimmer`, etc.

### Migration Strategy: Gradual, Not Big-Bang

- `global.css` renamed to `global-legacy.css` — preserved for backwards compatibility
- Both `app.css` (Tailwind) and `global-legacy.css` (legacy custom CSS) imported in `BaseLayout.astro`
- Legacy CSS will be gradually replaced by Tailwind utilities in future phases
- No existing CSS was deleted or modified — this is purely additive

### Preserved Behaviors

- **Dark mode**: `.dark` class toggle with `localStorage('color-theme')` in `BaseLayout.astro` — unchanged
- **Glassmorphism**: `backdrop-filter: blur(12px)` in `gv-wallet-card` — preserved in legacy CSS
- **Noto Serif JP + Noto Sans JP**: Google Fonts import in `global-legacy.css` — preserved
- **Animations**: `shimmer`, `pulse-ring`, `float` keyframes — defined in both `app.css` (@theme) and `global-legacy.css` (as `gv-*` prefixed variants). Tailwind tokens use unprefixed names for utility class access.
- **Responsive breakpoints**: `@media (max-width: 640px)` in legacy CSS — preserved

## Consequences

- **Positive**: Utility classes available for new components, design tokens as Tailwind utilities, zero breaking changes
- **Negative**: Two CSS files imported (temporary — legacy will be phased out)
- **Neutral**: `global-legacy.css` uses `gv-` prefixed custom keyframes which do not conflict with Tailwind's `@theme` definitions
- **Not modified**: Paywall JS, dark mode toggle, wallet connection, content schema, scripts
