# Phase 2 — Animations

**Mission 1.5 — Look & Feel**
**Date:** 2026-06-15

---

## 2a. CC Shield-and-Code Loader

**Files changed:** `static/cc-app/index.html`, `static/js/cyberapps/command-center/loader.js`

The loader was built directly in `cc-app/index.html` as inline HTML/CSS/SVG (superior to the canvas-only approach because SVG `<animate>` gives a hardware-accelerated stroke-dashoffset draw animation with no JavaScript required):

- Shield SVG: uses `stroke-dashoffset` animated from 300→0 over 1.2s with ease-in-out spline
- Inner arc paths animate after 0.8s (Cerberus three-heads suggestion)
- Code rain canvas: JavaScript `requestAnimationFrame` loop behind the shield using `--cc-crimson` for character color
- Status text: "INITIALIZING CERBERUS" with blink animation
- After `init()` completes, the loader gets `.fade-out` class → opacity 0 → removed from DOM
- Reduced motion: `transition: none` on loader, `animation: none` on blink text; loader fades out instantly
- All colors: `var(--cc-crimson, #c0392b)` and `var(--bg, #060708)` — no hardcoded theme hex

`loader.js` is also available as a standalone canvas-based loader module for other surfaces.

## 2b. Fluid Globe Upgrade

**File:** `static/js/cyberapps/command-center/styles.css`

- Orbit animations `cc-orbit-a/b/c` changed from `linear` to `cubic-bezier(0.4, 0, 0.6, 1)` variants for organic deceleration
- Added `--globe-rotation-duration: 18s` CSS custom property (per-theme overridable)
- Globe wireframe spin uses `var(--globe-rotation-duration, 18s)` + eased timing
- New `@keyframes cc-atmo-breathe` — scales halo between 1.0 and 1.08 over 4s ease-in-out
- Idle halo: both `cc-globe-halo-pulse` (opacity) + `cc-atmo-breathe` (scale) run simultaneously
- Active halo: same dual animation at faster rate (2.2s breathe)
- Halo box-shadows now use `var(--globe-atmo, ...)` token for atmosphere glow
- Reduced motion: halo animations paused via both `@media` block and `:root.reduced-motion`

## 2c. Per-Theme Backgrounds for Missing Themes

**Files:** `static/js/theme.js`, `static/style.css`

Four previously missing theme backgrounds now assigned:
- `lavender` → `aurora` (soft purple/pink light bands drifting)
- `gpt` → `grid-pulse` (dark grid with cell pulse)
- `copper` → `ember-glow` (NEW — warm copper embers, slower/warmer than retrowave embers)
- `claude` → `paper-grain` (NEW — subtle warm film grain/noise texture)

New canvas patterns added:
- `_initEmberGlow()` — warm rising embers, slower rise speed, copper warmth via `--bg-effect-color` token
- `_initPaperGrain()` — regenerating pixel noise at very low alpha, creates tactile paper feel

Effect color defaults added for lavender, copper, claude and all new themes.

## 2d. New Themes (6)

Added to `THEMES` in `static/js/theme.js`:

| Theme | Style | Background |
|-------|-------|-----------|
| `ember` | Warm orange on near-black | embers |
| `abyss` | Steel blue on void black | constellations |
| `sentinel` | Guardian green on dark | synapse |
| `void` | Cool purple-grey on near-void | constellations |
| `neon-noir` | Hot pink on deep purple | aurora |
| `slate` | Steel blue-grey on dark blue-grey | grid-pulse |

All 6 themes added to `THEME_DEFAULT_PATTERN` and `THEME_DEFAULT_EFFECT_COLOR`.

---

## Verified: No Hardcoded Hex

All new canvas functions read color from:
- `getComputedStyle(document.documentElement).getPropertyValue('--bg-effect-color')`
- Falls back to `--fg` or explicit fallback value inside `var(--token, #fallback)` form

---

## Commit

`feat(animations): CC loader + fluid globe + 6 new themes + missing theme backgrounds`
