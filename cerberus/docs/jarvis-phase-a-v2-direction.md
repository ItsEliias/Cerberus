# Cerberus JARVIS Phase A v2 — Aesthetic Direction Synthesis

Generated: 2026-06-12
Branch: `design/jarvis-cerberus-skilled`

## Skill Invocations

| Skill | Status | Method |
|---|---|---|
| `frontend-design` (claude-plugins-official) | RETURNED FULL OUTPUT | Skill tool (loaded SKILL.md guidelines, returned aesthetic direction) |
| `ui-ux-pro-max` (v2.5.0) | RETURNED FULL OUTPUT | Skill tool loaded SKILL.md; Python search script run separately for design-system output |
| `frontend-design-pro` (v1.0.0) | SKILL TOOL FAILED — not in dispatcher registry | Read SKILL.md directly from disk; vocabulary extracted manually |

See `/docs/jarvis-phase-a-v2-skill-outputs/` for full raw outputs.

---

## Convergence Points (all 3 skills agreed)

### 1. Style Category: Retro-Futurism / Cyberpunk
- **frontend-design**: Committed to "retro-futuristic militech / crimson war-room"
- **ui-ux-pro-max script**: Returned "Retro-Futurism" as matched style; confirmed "Dark Mode OLED" as mode
- **frontend-design-pro SKILL.md**: Lists "Retro-Futurism / Cyberpunk" with scanlines, neon glow, chrome as signature effects

All three point at the same style family. The only difference: frontend-design-pro defaults to cyan/magenta palette which we override to crimson.

### 2. Typography: Orbitron + JetBrains Mono
- **frontend-design**: Orbitron (display), JetBrains Mono (UI chrome), IBM Plex Sans (body)
- **ui-ux-pro-max script**: "Orbitron / JetBrains Mono" with mood "cyberpunk, neon, glitch, hud, sci-fi, tactical"
- **frontend-design-pro**: "NEVER use Inter, Roboto, Arial" — Orbitron/JetBrains Mono fits its characterful-font rule

Exact match on the display + mono pair. IBM Plex Sans added for body (chat/dense views).

### 3. Dark OLED / Near-Black Surfaces
- **frontend-design**: Surface void #09090a, base #0d0d0f (obsidian)
- **ui-ux-pro-max**: "Dark Mode OLED — deep black, OLED-optimized"
- **frontend-design-pro**: "dark OLED luxury" row as secondary style

All agree: maximum darkness, true near-black (not the existing #1a1d23 which is dark but not OLED-grade).

### 4. Accessibility Non-Negotiables
- **frontend-design**: WCAG AA verified on all color pairs; prefers-reduced-motion killswitch
- **ui-ux-pro-max**: Priority 1 rule — "contrast 4.5:1, focus rings, keyboard nav"
- **frontend-design-pro**: "Full WCAG AA/AAA, focus styles, prefers-reduced-motion"

Full agreement. All component states include focus-visible rings.

### 5. HUD Vocabulary
- **frontend-design**: Bracket corners as signature interaction; scanline overlays on hero surfaces
- **frontend-design-pro**: "Scanlines, chromatic aberration, glitch transitions, long glowing shadows"
- **ui-ux-pro-max**: "Minimal glow (text-shadow: 0 0 10px)" for HUD labels

Converged on: bracket corners + scanlines on hero, glow on HUD labels, calm on dense views.

---

## Conflicts / Divergences

### Surface Base Color
- **frontend-design**: #09090a void (much darker than current #1a1d23)
- **ui-ux-pro-max script**: #0F172A (midnight blue-black, slightly lighter)
- **Resolution**: Use #09090a–#16161c range from frontend-design. Darker is more OLED-authentic and the crimson reads better against pure black than mid-grey.

### Effect Intensity on Dense Views
- **frontend-design**: Explicit "cinematic chrome, legible core" — no effects on data/code surfaces
- **frontend-design-pro**: No explicit density rule (implies all-surfaces treatment)
- **ui-ux-pro-max**: "Slow performance" listed as avoid (implies restraint)
- **Resolution**: frontend-design's density rule wins. Effects gate by surface type as specified.

### Font Body Choice
- **frontend-design**: IBM Plex Sans for body/chat
- **ui-ux-pro-max / frontend-design-pro**: Don't specify a third body font, but both say "avoid Inter/Roboto"
- **Resolution**: IBM Plex Sans for body (legible, neutral authority, not on the banned list).

---

## Token Decisions (skill-informed)

### Crimson Spine (7 shades — from frontend-design)
```
--jx2-crimson-900: #1a0505
--jx2-crimson-800: #2d0a0a
--jx2-crimson-700: #4a0f0f
--jx2-crimson-600: #7a1a1a
--jx2-crimson-500: #c0392b  ← CORE (existing brand anchor preserved)
--jx2-crimson-400: #e04535
--jx2-crimson-300: #f06b5a
--jx2-crimson-200: #ff9080
```

### Surface Tiers (OLED-grade — from ui-ux-pro-max + frontend-design)
```
--jx2-surface-void:   #09090a
--jx2-surface-base:   #0d0d0f
--jx2-surface-raised: #111115
--jx2-surface-modal:  #16161c
--jx2-surface-glass:  rgba(22,22,28,0.72)
```

### Status Colors (PROTECTED — unchanged)
```
--jx2-status-active:     #22c55e  (green)
--jx2-status-idle:       #f59e0b  (amber)
--jx2-status-processing: #3b82f6  (blue)
--jx2-status-alert:      #ef4444  (red)
```

### HUD Vocabulary (from frontend-design-pro)
- Scanlines: `repeating-linear-gradient` at 2px/3px with rgba(192,57,43,0.025) — hero only
- Bracket corners: `::before` / `::after` with L-shaped border, animated on hover
- Glow shadows on labels: `text-shadow: 0 0 8px rgba(192,57,43,0.6), 0 0 24px rgba(192,57,43,0.3)`
- Panel sheen: diagonal linear-gradient at 3% opacity for chrome texture

---

## Implementation Files

| File | Source Skills |
|---|---|
| `static/jarvis-v2/tokens.css` | ui-ux-pro-max (token structure), frontend-design (values) |
| `static/jarvis-v2/components.css` | frontend-design (surface rules), frontend-design-pro (HUD vocabulary) |
| `static/jarvis-v2/surfaces.css` | frontend-design (density rule), all 3 (surface tiers) |
| `static/jarvis-v2/effects.js` | frontend-design (bracket corner animation), frontend-design-pro (motion) |
