# Phase 1 — Animation Token Contract

**Mission 1.5 — Look & Feel**
**Date:** 2026-06-15

---

## Changes Made

### 1. `static/js/theme.js` — `applyColors()` extended

New animation tokens set on `document.documentElement` inline style (same mechanism as --bg/--fg):

| Token | Derivation |
|-------|-----------|
| `--glow` | `color-mix(in srgb, --red 25%, transparent)` |
| `--grid-line` | `color-mix(in srgb, --border 30%, transparent)` |
| `--particle` | `color-mix(in srgb, --fg 55%, transparent)` |
| `--globe-wire` | `color-mix(in srgb, --red 35%, transparent)` |
| `--globe-atmo` | `color-mix(in srgb, --red 60%, transparent)` |

These tokens are also included in the postMessage payload sent to the CC iframe on every theme change.

### 2. `static/js/theme.js` — `prefers-reduced-motion` class

Added `_applyReducedMotion()` function that:
- Runs once at module load
- Listens to `matchMedia('(prefers-reduced-motion: reduce)').change` events
- Toggles `.reduced-motion` class on `document.documentElement`

Canvas animations should gate on: `document.documentElement.classList.contains('reduced-motion')`

### 3. `static/cc-app/index.html` — `_applyTheme()` extended

The iframe's theme applier now receives and sets all 5 new animation tokens. Falls back to locally-derived values if the payload doesn't include them (backwards-compatible with old postMessage senders).

### 4. `static/js/cyberapps/command-center/styles.css` — Reduced motion rules

Added three layers of reduced-motion support:
1. `.cc-shell .reduced-motion *` — catches all animated descendants when class is on shell
2. `:root.reduced-motion` — specific animation properties set to `none !important`
3. `@media (prefers-reduced-motion: reduce)` — standard media query for belt-and-suspenders

---

## Canvas Helper Pattern

When reading CSS custom property tokens in canvas animations, use:

```js
function getColor() {
  const s = getComputedStyle(document.documentElement);
  return s.getPropertyValue('--bg-effect-color').trim()
      || s.getPropertyValue('--fg').trim()
      || '#c5c9d0'; // fallback
}

// For animation-specific tokens:
function getGlow() {
  return getComputedStyle(document.documentElement).getPropertyValue('--glow').trim()
      || 'rgba(192,57,43,0.25)'; // fallback
}
```

Never hardcode hex in canvas draw functions — always read from CSS custom properties at draw time so theme switches update without a page reload.

---

## Verification: Globe re-colours on theme switch

The existing CSS globe already uses:
- `var(--cc-crimson)` for wireframe SVG color
- `var(--red)` for particle background
- `color-mix(in srgb, var(--red) ...)` for sphere gradients, halo, active state box-shadows

This means the globe already re-colours on theme switch because `--cc-crimson` and `--red` are set on `documentElement` inline styles and the CC iframe receives them via postMessage. No fix needed here — the chain is: `applyColors()` → inline style → CSS var cascade.

---

## Commit

`feat(theme): animation token contract + prefers-reduced-motion baseline`
