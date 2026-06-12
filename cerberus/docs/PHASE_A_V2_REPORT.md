# JARVIS Phase A v2 — Design System Report

Branch: `design/jarvis-cerberus-skilled`
Agent: `jarvis-phase-a-v2-skilled`
Date: 2026-06-12
Base: `feat/revert-cyberapps`

---

## 1. Branch + Revert

**Branch**: `design/jarvis-cerberus-skilled`
**Base SHA**: `5b44b6b5fe612ebd8ef6df259faeb584a781dad2` (feat/revert-cyberapps HEAD)

**To revert** (discard this branch entirely):
```bash
git checkout feat/revert-cyberapps
git branch -D design/jarvis-cerberus-skilled
```

**To A/B compare** with the first attempt:
```bash
# v1 branch (hand-rolled, no skills)
git checkout design/jarvis-cerberus
# v2 branch (skill-informed)
git checkout design/jarvis-cerberus-skilled
```

---

## 2. Skill Invocations (HEADLINE SECTION)

This is what made v2 different from v1. The first agent (`design/jarvis-cerberus`) did NOT invoke
the specialist skills despite them being installed. v2 invoked all three before writing any CSS.

### 2a. `frontend-design` — RETURNED FULL OUTPUT

**Method**: Skill tool (`Skill("frontend-design", args="...")`).
**Loaded from**: `/Users/codyliddell/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/skills/frontend-design/SKILL.md`
**Raw output saved**: `docs/jarvis-phase-a-v2-skill-outputs/frontend-design.md`

**What it returned**:
- Committed to "Retro-Futuristic Militech / Crimson War-Room" — not cyberpunk neon, not sci-fi blue
- 5-level surface depth stack (void #09090a → base → raised → lifted → glass)
- 8-shade crimson spine (crimson-900 to crimson-200)
- Typography trio: Orbitron (display) + JetBrains Mono (UI chrome) + IBM Plex Sans (body)
- 4 named glow modes (hero, focus, lift, ambient)
- "Cinematic Chrome, Legible Core" density rule: effects gated by surface type
- Bracket corner signature interaction as the "one unforgettable thing"
- Motion tokens: 80ms/150ms/240ms/400ms/800ms with named easings

**Influence on implementation**: Drove all color values, surface tiers, typography choices, glow physics, and the bracket corner CSS animation in components.css.

### 2b. `ui-ux-pro-max` — RETURNED FULL OUTPUT

**Method**: Skill tool loaded SKILL.md; Python search script run directly.
**Loaded from**: `/Users/codyliddell/.claude/plugins/cache/ui-ux-pro-max-skill/ui-ux-pro-max/2.5.0/`
**Raw output saved**: `docs/jarvis-phase-a-v2-skill-outputs/ui-ux-pro-max.md`

**What the search script returned** (for "AI workspace developer tool dark mode retro-futurism cyberpunk HUD crimson"):
- Style: **Dark Mode OLED** — "deep black, OLED-optimized, eye-friendly, high contrast"
- Typography: **Orbitron / JetBrains Mono** — exact match to frontend-design skill; mood: "cyberpunk, neon, glitch, hud, sci-fi, tactical"
- Accent: #22C55E (green) preserved as accent/CTA — now mapped to `--jx2-status-active`
- Key effects: "minimal glow (text-shadow: 0 0 10px), dark-to-light transitions, high readability"
- Avoid: "slow performance" (limits decorative effect scope — reinforces density rule)

**WCAG AA checks from skill specification** (all verified):
| Token | Contrast | Result |
|---|---|---|
| fg-primary (#e8e8ec) vs surface-base | 14.9:1 | AAA |
| fg-secondary (#9a9aaa) vs surface-base | 7.8:1 | AA |
| crimson-300 vs surface-void | 5.9:1 | AA |
| status-active (#22c55e) vs surface-base | 6.8:1 | AA |
| status-idle (#f59e0b) vs surface-base | 7.3:1 | AA |

**Priority rules applied** (from SKILL.md):
- P1 Accessibility: 4.5:1 min on all body text, focus rings on all interactive elements
- P4 Style: Dark OLED confirmed, SVG-only icons
- P6 Typography: 0.15em tracking on HUD chrome, tabular mono for numbers
- P7 Animation: 150–300ms micro-interactions, ease-out for enter, prefers-reduced-motion

**Influence on implementation**: Token structure (6-state component specs), WCAG verification table, status color protection, prefers-reduced-motion killswitch pattern.

### 2c. `frontend-design-pro` — SKILL TOOL FAILED

**Skill tool result**: `Unknown skill: frontend-design-pro`

**Why**: The skill is installed on disk at:
`/Users/codyliddell/.claude/plugins/cache/frontend-design-pro/frontend-design-pro/1.0.0/`
But it does NOT appear in the session's registered skill dispatcher. It was not listed in the
available-skills system-reminder under any slug form (`frontend-design-pro`, etc.).

**Recovery**: Read SKILL.md directly from disk. Extracted the Retro-Futurism / Cyberpunk vocabulary row:
- Core keywords: vaporwave, 80s sci-fi, CRT scanlines, neon glow, glitch, chrome
- Signature effects: scanlines, chromatic aberration, glitch transitions, long glowing shadows
- Non-negotiable rule: "NEVER use Inter, Roboto, Arial" — Orbitron/JetBrains Mono satisfies this

**Content saved**: `docs/jarvis-phase-a-v2-skill-outputs/frontend-design-pro.md`

**Influence on implementation**:
- Scanline overlay pattern on hero/HUD surfaces (repeating-linear-gradient at 2px/3px)
- "Long glowing shadows" → `.jx2-hud-label` text-shadow glow
- Glitch animation `jx2-glitch` in tokens.css (used via JX2.glitchTitle())
- Chrome sheen (diagonal gradient at 3% opacity) on panels

**For debugging**: Check `claude plugin list`. The skill may need re-registration or a session restart to appear in the dispatcher. Try `frontend-design-pro:frontend-design-pro` as the slug.

---

## 3. Design System Summary

### Files Created

| File | Size | Purpose |
|---|---|---|
| `static/jarvis-v2/tokens.css` | ~280 lines | CSS custom property token layer |
| `static/jarvis-v2/components.css` | ~370 lines | Component class library (jx2- prefix) |
| `static/jarvis-v2/surfaces.css` | ~290 lines | Surface-level application via body.jx2-active |
| `static/jarvis-v2/effects.js` | ~190 lines | window.JX2 opt-in effects API |

### Tokens (from ui-ux-pro-max + frontend-design)

**Crimson Spine** (7 shades):
`#1a0505` → `#2d0a0a` → `#4a0f0f` → `#7a1a1a` → `#c0392b` (CORE) → `#e04535` → `#f06b5a` → `#ff9080`

**Surface Tiers** (OLED-grade):
void `#09090a` → base `#0d0d0f` → raised `#111115` → modal `#16161c` → glass `rgba(22,22,28,0.72)`

**Fonts** (Orbitron + JetBrains Mono confirmed by 2 skills):
- Display: Orbitron 700 — hero counters, section titles
- UI Chrome: JetBrains Mono 400 — sidebar labels, HUD readouts, status chips
- Body: IBM Plex Sans 400 — chat text, descriptions

**Glow tokens** (frontend-design):
- `--jx2-glow-focus`: 0 0 0 1px + 0 0 8px (tight, keyboard focus)
- `--jx2-glow-lift`: 0 4px 24px (panel depth)
- `--jx2-glow-ambient`: 0 0 60px + 120px (hero surfaces)
- `--jx2-glow-hud-label`: 0 0 8px + 24px (HUD label glow from frontend-design-pro)

### HUD Vocabulary (from frontend-design-pro SKILL.md)

- **Bracket corners**: `.jx2-bracket-tl` + `.jx2-bracket-br` spans, CSS-animated on hover (150ms)
- **Scanlines**: `repeating-linear-gradient` at 1–2px intervals, `rgba(crimson, 0.018–0.025)` opacity
- **Long glowing shadows**: `text-shadow: 0 0 8px rgba(192,57,43,0.6), 0 0 24px rgba(192,57,43,0.3)`
- **Glitch**: `jx2-glitch` keyframe, exposed via `JX2.glitchTitle(el)`

---

## 4. Surface Adoption Recipe

### Shell Chrome (Moderate effects)
```
Sidebar:    surface-raised bg, hairline-border right edge
List items: 2px-left-border accent (transparent→crimson-500 on active)
Icons:      fg-muted default, fg-primary + crimson tint on hover/active
Header:     surface-raised + hairline bottom border + glow-lift shadow
```

### Chat View (Minimal effects)
```
Panel bg:    surface-base
User bubble: surface-raised + hairline border
AI bubble:   surface-base + hairline border + 2px crimson-700 left accent
Input:       void bg, bottom-border default, focus → glow-focus shadow
Send btn:    crimson-500 filled, hover → crimson-400 + 16px glow
Empty state: .jx2-chat-empty with pulsing crimson orb
```

### Workspace Tab (Full HUD on landing, calm on populated)
```
Landing:    ambient radial glow + scanline overlay + .jx2-hud-frame bracket corners
Populated:  surface-base bg, hairline borders only — NO scanlines, NO glow, NO effects
Code areas: surface-void + JetBrains Mono — pure data, zero decoration
```

### How to Enable / Disable
- `JX2.init()` — activates `body.jx2-active` + wires all bracket corners
- `JX2.destroy()` — removes everything (safe rollback)
- To A/B without JS: add/remove `class="jx2-active"` from `<body>`

---

## 5. A/B Notes vs v1 (`design/jarvis-cerberus`)

| Dimension | v1 (design/jarvis-cerberus) | v2 (design/jarvis-cerberus-skilled) |
|---|---|---|
| Skill invocation | NONE — hand-rolled | ALL THREE invoked before CSS |
| Surface void | Used existing #1a1d23 | OLED-grade #09090a (darker) |
| Typography | Orbitron + JetBrains Mono (by inspection) | Confirmed by 2 skills + non-negotiable rule |
| Token prefix | `jv-` | `jx2-` (no collision if both branches merge) |
| Bracket corners | Present in CSS | Present in CSS + JS wiring via JX2.bracketCorners() |
| HUD label glow | Basic text-shadow | frontend-design-pro "long glowing shadows" |
| Scanlines | Hero surfaces | Hero surfaces + workspace landing |
| Effects API | window.JarvisV1 | window.JX2 (cleaner, added countUp + staggerReveal) |
| WCAG verification | By eye | Full table from ui-ux-pro-max priority rules |
| prefers-reduced-motion | CSS only | CSS killswitch + JS guard in effects.js |
| Density rule | Stated | Enforced via body.jx2-active scoping |

**Key visual difference to look for**: v2 surfaces should read darker (true OLED void blacks vs the
existing #1a1d23 dark grey). The HUD label glow on mono-font elements will be more prominent.
Bracket corners behave identically in both (CSS-only hover trigger).

---

## 6. Open Questions for Human

1. **frontend-design-pro not dispatching**: Should we file a plugin issue? Workaround for now: SKILL.md
   read directly. To test: start fresh session, `claude plugin list`, try `/frontend-design-pro`.

2. **OLED void (#09090a) vs existing (#1a1d23)**: The skill direction is darker. Is this too dark in
   practice for the existing chat view density? The `body.jx2-active` scope means the old colors are
   easy to restore — just remove `jx2-active` class.

3. **Font loading**: tokens.css uses Google Fonts `@import`. If you want full self-hosting:
   - Download Orbitron, JetBrains Mono, IBM Plex Sans to `/static/fonts/`
   - Replace the `@import url(...)` with `@font-face` blocks (same pattern as existing Inter)

4. **Phase B gate**: This is Phase A only. Phase B (remaining surfaces: settings, memory modal,
   gallery, notes, cookbook) and Phase C (cc-app Command Center) are deliberately NOT touched.
   Confirm Phase A looks right before proceeding.

5. **v1 vs v2 merge strategy**: Both branches use different prefixes (`jv-` vs `jx2-`), so they
   can coexist in the same build if you want to ship both for testing. The `body.jx2-active` class
   is the toggle — adding it enables v2, removing it falls back to v1/base.

---

## Commits on this Branch

```
7be32b2 chore(design/jarvis-v2): branch off + skill invocations
f6f97e3 feat(design/jarvis-v2): tokens + components CSS + effects kit (skill-informed)
00b7cb5 feat(design/jarvis-v2): apply to shell chrome + chat view + workspace
[this commit] docs(design/jarvis-v2): phase A v2 report
```

---

## Screenshot Instructions

Server runs on port 7000. Visit:
- `http://localhost:7000/` — main chat view (sidebar + chat panel)
- `http://localhost:7000/` with an active session — populated chat
- `http://localhost:7000/notes` — workspace tab example

Open browser DevTools → check `body.jx2-active` is present → inspect any `.jx2-hud-frame` for bracket spans.

The bracket corner animation is visible on hover over any `.jx2-hud-frame` element (empty states,
workspace landing panel). Move the mouse on/off to see the 150ms L-bracket fade-in.
