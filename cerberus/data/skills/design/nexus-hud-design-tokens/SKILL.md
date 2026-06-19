---
name: nexus-hud-design-tokens
description: Nexus HUD / jarvis-v2 design system — CSS tokens, typography, and component rules for Cerberus UI
version: 1.1.0
category: design
tags: [design, tokens, hud, nexus, css, jarvis-v2]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

When implementing or reviewing any Cerberus UI component, CSS variable, or style decision in the main HUD or CC iframe.

## Procedure

Apply the Nexus HUD token system from `static/jarvis-v2/tokens.css` and `hud.css`:

**Color tokens**
| Token | Value | Usage |
|-------|-------|-------|
| `--void` | `#0a0a0a` | Page/app background |
| `--void-deep` | `#000` | Deepest surfaces, overlays |
| `--surface` | `#111` | Card and panel backgrounds |
| `--surface-raise` | `#1a1a1a` | Elevated surfaces, dropdowns |
| `--border` | `#2a2a2a` | Dividers and input borders |
| `--red` | `#c0392b` | Primary accent — interactive highlights, CTAs |
| `--red-dim` | `#8b2020` | Disabled / muted red states |
| `--red-glow` | `rgba(192,57,43,0.2)` | Glow rings, hover fills |
| `--cyan` | `#00ffff` | Secondary accent, online/OK indicators |
| `--text-primary` | `#e0e0e0` | Body text |
| `--text-muted` | `#888` | Secondary labels, placeholders |
| `--text-dim` | `#555` | Tertiary / disabled text |

**Typography**
- Display / headings: `Orbitron` (weights 500, 700) — all-caps preferred, `//` prefix convention for section labels
- Body / mono / chrome / data: `JetBrains Mono` (weights 400, 500)
- No system sans-serif fonts in HUD chrome

**Component rules**
1. All form inputs and buttons must have `-webkit-appearance: none; appearance: none` to kill browser defaults (mandatory on WebKit/Safari)
2. Focus rings: `outline: 2px solid var(--red); outline-offset: 2px`
3. Status dots: 8×8 px circles; color from token list (--cyan for online, --red for alert, --text-muted for offline)
4. Card borders: `1px solid var(--border)`; no drop shadows — use border contrast only
5. Animations: prefer `opacity` + `transform` transitions under 200 ms; avoid layout-triggering properties
6. CC iframe isolation: CSS must be linked inside `cc-app/index.html`, NOT the parent shell — styles do not cross iframe boundaries

**Anti-patterns**
- No white or near-white backgrounds in HUD chrome
- No rounded corners > 4 px on HUD cards (6 px max on input elements)
- No hardcoded hex values — all colors from CSS custom properties
- No emoji in labels or status indicators (use `//` prefix text or SVG)
- No competing palettes — do not introduce colors not in the token list without design review
- No external font CDN — fonts must be self-hosted under `static/`
