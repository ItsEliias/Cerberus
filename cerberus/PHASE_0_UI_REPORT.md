# Phase 0 — UI Recon Report

**Mission 1.5 — Look & Feel (Animation, Theming & Dashboard)**
**Date:** 2026-06-15

---

## 1. Working Environment

- Branch: `cerberus` (up to date with origin)
- Working tree: clean except `.claude-flow/` (untracked, never commit) and `vendor/odysseus` submodule untracked content
- Tag `cerberus-1.5-baseline` is the safe rollback point

---

## 2. Token Contract (theme.js)

### Core tokens set on `document.documentElement` by `applyColors()`:
| Token | Source |
|-------|--------|
| `--bg` | colors.bg |
| `--fg` | colors.fg |
| `--panel` | colors.panel |
| `--border` | colors.border |
| `--red` | colors.red |
| `--cc-crimson` | colors.red (direct hex) |
| `--cc-crimson-glow` | color-mix(in srgb, red 40%, transparent) |
| `--cc-crimson-hot` | color-mix(in srgb, red 85%, white) |
| `--hl-*` | Derived via deriveSyntaxColors() |
| Advanced: `--user-bubble-bg`, `--ai-bubble-bg`, `--bubble-border`, etc. | computeAdvancedDefaults() |

### CC iframe tokens set by `_applyTheme()` in cc-app/index.html:
- `--bg`, `--fg`, `--panel`, `--border`, `--red`, `--cc-crimson`, `--cc-crimson-glow`, `--cc-crimson-hot`
- Seeded from localStorage on load, updated via postMessage

### Tokens MISSING from applyColors() that Phase 1 must add:
- `--glow` — based on --red, very transparent (for general glow use)
- `--grid-line` — --border at low opacity
- `--particle` — --fg at reduced opacity
- `--globe-wire` — --red low opacity (wireframe)
- `--globe-atmo` — --red for atmosphere

---

## 3. Background Animation System

All canvas patterns live as private functions in `static/js/theme.js` (NOT in effects.js — no effects.js exists; theme.js IS the effects system).

### Pattern registry:
```js
const _CANVAS_PATTERNS = {
  synapse: _initSynapse,
  rain: _initRain,
  constellations: _initConstellations,
  'perlin-flow': _initPerlinFlow,
  petals: _initPetals,
  sparkles: _initSparkles,
  embers: _initEmbers
};
```

### How each pattern works:
1. Creates a `<canvas>` with fixed position, prepended to body
2. Uses `getComputedStyle(document.documentElement).getPropertyValue('--bg-effect-color')` to get color (falls back to `--fg`)
3. Checks `document.body.classList.contains('bg-pattern-<name>')` in draw loop — removes itself if gone
4. Responds to `--bg-effect-intensity` and `--bg-effect-size` CSS vars
5. CSS classes registered in `_BG_CLASSES` array

### Canvas color pattern (canonical):
```js
function getColor() {
  const s = getComputedStyle(document.documentElement);
  return s.getPropertyValue('--bg-effect-color').trim() || s.getPropertyValue('--fg').trim() || '#c5c9d0';
}
```

### To add a new pattern:
1. Add `canvas.id = '<name>-canvas'` cleanup selector to `applyBgPattern()`
2. Add `'<name>-canvas'` to the querySelectorAll cleanup in `applyBgPattern()`
3. Add `'bg-pattern-<name>'` to `_BG_CLASSES`
4. Add `'<name>': _init<Name>` to `_CANVAS_PATTERNS`
5. Write `_init<Name>()` function following the pattern above

### CSS-only patterns (body class):
- `dots` — radial-gradient dots in `style.css`
- `synapse` — grid lines in `style.css` + canvas pulses
- `perlin-flow`, `petals`, `sparkles` — canvas only, no CSS body rule needed

---

## 4. CC Stylesheet Analysis

**File:** `static/js/cyberapps/command-center/styles.css` (743 lines)

### Token usage — all correct:
- Borders: `var(--cc-border)` throughout
- Accent: `var(--cc-crimson)` throughout
- Glow: `var(--cc-crimson-glow)`, `var(--cc-crimson-hot)`
- Background: `var(--cc-surface)` = `var(--bg)`
- Text: `var(--cc-fg)` = `var(--fg)`

### Hardcoded colors found (intentional status colors, NOT theme tokens):
- `#2ecc71` — success/active green (cc-ok)
- `#e67e22` — warning orange (cc-warn)
- `#e74c3c` — critical red (cc-crit)
- `#3498db`, `#9b59b6`, `#f1c40f` — badge colors in workspace/finance
- `rgba(0,0,0,0.22)` — card background tint (decorative, appropriate)

### Focus states:
- `.cc-chat-input:focus` — border-color: var(--cc-crimson) [GOOD]
- `.cc-overlay-prompt:focus` — border-color: var(--cc-crimson) [GOOD]
- `.cc-invoke-input:focus` — border-color: #9b59b6 [BAD — hardcoded]
- All buttons: NO `:focus-visible` outline [GAP — Phase 3 must fix]

### Globe animation:
- Orbit animations: `cc-orbit-a/b/c` use `linear` timing [Phase 2b will add easing]
- Wireframe spin: `cc-globe-spin 18s linear` [Phase 2b will add --globe-rotation-duration token]
- Particles: use `var(--red)` directly [GOOD]
- Halo: uses `color-mix(in srgb, var(--red) ...)` [GOOD]
- Reduced motion: `@media (prefers-reduced-motion: reduce)` block exists BUT also uses `.jx-reduced-motion` class

### CC Loader:
- No existing loader — must build from scratch per mission spec

---

## 5. Main Button Analysis (style.css)

Button classes found: `.btn-spinner`, `.btn-primary` (inside #group-model-picker)

The CC uses a distinct HUD aesthetic (Orbitron font, monospace, small sizing). This is intentional. The gap between CC and main buttons is by design. Phase 3 scope: fix focus rings and ensure token usage on hover/active states.

---

## 6. Missing Theme Backgrounds

Confirmed missing from `THEME_DEFAULT_PATTERN`:
- `lavender` — no entry
- `gpt` — no entry
- `copper` — no entry
- `claude` — no entry

These fall back to 'none' (no background animation).

---

## 7. App Structure (routing)

`static/app.js` is the main orchestrator. It imports all modules at the top level. There is no explicit route array — routing appears to be URL-hash or CSS show/hide based. The sidebar nav items (sessions, notes, tasks, calendar, etc.) switch views. Phase 4 dashboard will need to add a view following this pattern.

---

## 8. Decisions Made

1. **No effects.js** — all background patterns live in `theme.js`. New patterns go there.
2. **CC loader** — build as pure CSS/canvas in `loader.js`, inject into `cc-app/index.html`
3. **Phase 3 focus** — `.cc-invoke-input:focus` fix + `:focus-visible` on all CC buttons
4. **Dashboard route** — will examine app.js more deeply in Phase 4 to determine exact routing mechanism
5. **Reduced motion** — will add both CSS `@media` AND `.reduced-motion` class approach, matching existing `.jx-reduced-motion` class already used in CC

---

*Report complete. Proceeding to Phase 1 — Animation Token Contract.*
