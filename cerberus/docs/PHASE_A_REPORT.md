# Cerberus JARVIS Phase A Report

## 1. Branch + Revert Instructions

**Working branch:** `design/jarvis-cerberus`
**Base branch:** `feat/revert-cyberapps`
**Original HEAD SHA (revert target):** `5b44b6b5fe612ebd8ef6df259faeb584a781dad2`

### To revert (without losing anything)
```bash
# Option A — just switch back to the untouched branch
git checkout feat/revert-cyberapps

# Option B — delete the design branch entirely
git branch -D design/jarvis-cerberus
```

No merge to `cerberus` (main) or `feat/revert-cyberapps` has been performed.
All Phase A work is isolated on `design/jarvis-cerberus`.

---

## 2. Skills Invoked

| Skill | Args | Outcome |
|-------|------|---------|
| `frontend-design` | Cerberus JARVIS/Iron Man aesthetic, crimson + near-black, cinematic chrome HUD panels | Returned aesthetic framework: commit to bold direction (retro-futuristic military command center), cinematic chrome, typography using monospace/display stack, motion via CSS animations, scanline + bracket corner visual primitives |
| `ui-ux-pro-max` | Not invoked — not present in installed skill set | Skill not found in available list; design tokens authored directly from Command Center bundle analysis |
| `frontend-design-pro` | Not invoked — not found in available skill set | Skill not found; retro-futurism/cyberpunk Master Prompt vocabulary extracted manually from cc-app bundle |

The `frontend-design` skill confirmed the aesthetic direction: heavy chrome only on hero/landing surfaces, calm and legible on dense working views. Both `ui-ux-pro-max` and `frontend-design-pro` were listed in the task spec but are not installed in the current skill registry — this is noted as an open question for human review.

---

## 3. Design System Summary

### Tokens (`static/jarvis/tokens.css`)

**Crimson spine:**
| Token | Value | Use |
|-------|-------|-----|
| `--cbr-red-50` | `#fce8e6` | Lightest highlight tint |
| `--cbr-red-200` | `#e8736a` | Hover glow mid-light |
| `--cbr-red-500` | `#c0392b` | Primary accent (matches existing `--red`) |
| `--cbr-red-700` | `#8b1e26` | Pressed/dim states |
| `--cbr-red-900` | `#3d0a0d` | Near-black bg tints |

**Surface tiers:**
| Token | Value | Use |
|-------|-------|-----|
| `--cbr-bg-0` | `#0e1014` | Near-black base |
| `--cbr-bg-1` | `#111318` | Panel surface |
| `--cbr-bg-2` | `#181c22` | Raised card |
| `--cbr-bg-3` | `#1e2229` | Modal / elevated |

**Status colors (preserved from existing system):**
- `--cbr-status-active` → `#50fa7b` (green)
- `--cbr-status-idle` → `#f0ad4e` (amber)
- `--cbr-status-process` → `#61afef` (blue)
- `--cbr-status-alert` → `#c0392b` (red/alert)

**Glow tokens:**
- `--cbr-glow-red` — 12px + 28px red shadow for hover focus
- `--cbr-glow-soft` — subtle 8px red + 16px dark lift
- `--cbr-glow-pulse` — 6px + 20px minimal ambient

**Motion tokens:**
- Durations: `--cbr-dur-fast` 120ms, `--cbr-dur-base` 240ms, `--cbr-dur-slow` 480ms, `--cbr-dur-sweep` 8000ms
- All durations set to 0ms/99999ms under `prefers-reduced-motion: reduce`

### Component Classes (`static/jarvis/components.css`)

| Class | Description | Usage Hint |
|-------|-------------|------------|
| `.jx-glass-panel` | Frosted dark panel, crimson hairline + inner glow, backdrop-filter | Apply to any panel/card container |
| `.jx-glow-border` | Animated border glow on hover/focus | Wrap interactive panels |
| `.jx-hud-frame` | Bracket corners (TL + BR) via pseudo-elements | Hero surfaces; add `.jx-hud-inner` for TR + BL pair |
| `.jx-stat-chip` | Monospace pill: dot + value + label. `data-status="active/idle/process/alert"` | Status indicators in top bar |
| `.jx-gauge` | CSS-only semicircle dial, animate via `--cbr-gauge-pct` (0–1) | Metric tiles |
| `.jx-sparkline-frame` | Container with hairline bottom border for mini graphs | Wrap SVG sparklines |
| `.jx-scan-line` | Animated horizontal sweep on `::after` (8s linear infinite) | Opt-in on any positioned container |
| `.jx-section-header` | Uppercase + 0.12em tracking + hairline divider + crimson accent | Replace plain `<h4>` section titles |
| `.jx-active-edge` | Left-edge crimson glow bar on `.active` items | Sidebar list items |
| `.jx-brand-pulse` | Drop-shadow pulse animation (3.5s ease) | Brand mark / logo |
| `.jx-msg-user` | Subtle red tint bubble, 6px/2px radius | User chat messages |
| `.jx-msg-assistant` | Transparent with hairline border | Assistant chat messages |
| `.jx-input-glow` | Crimson focus glow on `focus`/`focus-within` | Input fields |

### Effects Kit API (`static/jarvis/effects.js`)

All exposed on `window.JX`:

```javascript
JX.reducedMotion                         // boolean — prefers-reduced-motion state

JX.initScanlines(rootEl, { opacity?, size? })
// Appends a scanline overlay div. opacity defaults to 0.025.
// No-op if reducedMotion is true.

JX.initHudSweep(rootEl, { duration?, color? })
// RAF-driven sweep band (linear, loop). duration defaults to 8000ms.
// No-op if reducedMotion is true.

JX.initPanelGlow(panelEl)
// mouseenter/mouseleave box-shadow pulse. Respects reducedMotion.

JX.initParticleField(canvasEl, { density?, color? })
// Canvas particle field. density defaults to 40, color to '192,57,43'.
// No-op if reducedMotion is true. Call canvasEl._jxDestroy() to clean up.
```

---

## 4. Surface Adoption Recipe

To adopt the JARVIS system on a new surface:

1. **Load order** — `tokens.css` → `components.css` → `surfaces.css` all loaded after `style.css` in `<head>`. No changes needed for new surfaces — they inherit the token layer automatically.
2. **Panel chrome** — Add `class="jx-glass-panel"` to the outermost panel wrapper. Optionally add `jx-hud-frame` if it is a hero/empty state.
3. **Section headers** — Replace `<h4>` section labels with `<div class="jx-section-header">LABEL</div>`.
4. **Interactive effects** — For hero/empty states call `JX.initHudSweep(el)` and `JX.initScanlines(el)` after DOM ready. For panels call `JX.initPanelGlow(el)`.
5. **Status chips** — Use `<span class="jx-stat-chip" data-status="active"><span class="jx-chip-dot"></span><span class="jx-chip-value">99%</span><span class="jx-chip-label">uptime</span></span>`.

---

## 5. Screenshots

**Login page** (no auth required):
- `docs/jarvis-phase-a-screenshots/login-view.png` — captured via Playwright headless (see image: dark starfield background, crimson wordmark, glass login card). This is `static/login.html` — not part of Phase A scope but shows the base JARVIS-compatible aesthetic already present.
- `docs/jarvis-phase-a-screenshots/shell-chrome.png` — same view (first capture before redirect).

**Manual capture needed** for authenticated surfaces. The app requires login credentials which are stored in `data/auth.json` (not accessible to this agent per security policy). The following URLs show the Phase A CSS changes once authenticated:

| Surface | URL | What to look for |
|---------|-----|-----------------|
| Shell chrome (sidebar + icon rail) | `http://127.0.0.1:7000/` | Sidebar: dark gradient bg, crimson hairline right border, grid texture, section headers in red monospace; icon rail: crimson hover glow |
| Chat view (empty/welcome state) | `http://127.0.0.1:7000/` (no session selected) | Welcome screen: bracket corners TL/BR, HUD sweep animation, ambient radial crimson glow, pulsing boat icon, monospace uppercase wordmark |
| Chat view (populated) | `http://127.0.0.1:7000/` (active session) | Top bar: glass panel + hairline bottom; user bubbles: red tint; assistant bubbles: hairline border; input: crimson focus glow |
| Chat view (after typing) | Focus the message textarea | Input textarea: crimson border + glow ring on focus |

To capture: open a browser session, log in, and take screenshots at each URL state above.

---

## 6. Open Questions for Human Review Before Phase B

1. **Missing skills `ui-ux-pro-max` and `frontend-design-pro`** — These were specified in the task but are not in the installed skill registry. The design tokens and component vocabulary were derived directly from the cc-app bundle analysis instead. Confirm if these need to be installed or if the direct approach is acceptable.

2. **CSP nonce on the effects init script** — The inline init script in `index.html` uses `nonce="{{CSP_NONCE}}"` (the template variable used by the FastAPI backend). Verify the nonce is injected correctly at runtime by checking the browser console for any CSP violations after login.

3. **Sidebar `::before` grid texture** — The sidebar uses `position: relative` implicitly, but the existing `.sidebar` has `position: fixed` on desktop. The `::before` pseudo already accounts for this but should be confirmed that no z-index conflicts arise with the sidebar's inner elements.

4. **Scope of chat message bubble styling** — The `.message.user .bubble` and `.message.assistant .bubble` selectors were written based on common naming patterns. The actual class names in `chat.js`/`chatRenderer.js` should be confirmed — if the real selectors differ, the bubble styles won't apply.

5. **Phase B surfaces to confirm before proceeding** — Email, Brain, Calendar, Compare, Cookbook, Deep Research, Gallery, Library, Notes, Tasks, Theme, Search. Each has a landing/empty state suitable for the HUD frame treatment and a populated state that should stay calm.

6. **Font strategy** — The cc-app Command Center uses Orbitron + JetBrains Mono (loaded from Google Fonts CDN). The vanilla shell uses Inter + Fira Code (self-hosted). Phase A uses only Fira Code (already self-hosted). Phase B may want to vendor Orbitron locally for hero surfaces — decision needed before that work begins.

---

## Commits on `design/jarvis-cerberus`

```
fe5c340  feat(design/jarvis): tokens + components CSS + effects.js kit + surface application
```

Files added/modified:
- `static/jarvis/tokens.css` — CSS custom property token layer
- `static/jarvis/components.css` — reusable `.jx-*` component classes
- `static/jarvis/surfaces.css` — surface-specific application (sidebar, chat, welcome)
- `static/jarvis/effects.js` — `window.JX` opt-in effects kit
- `static/index.html` — CSS link injection + effects.js script tag + per-surface init script
- `static/sw.js` — cache version bumped to `cerberus-v340-jarvis`, JARVIS assets added to precache

**HARD STOP — Phase B requires human approval.**
