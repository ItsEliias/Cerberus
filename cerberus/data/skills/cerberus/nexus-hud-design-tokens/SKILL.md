---
name: nexus-hud-design-tokens
description: Nexus HUD design system — color tokens, typography, and component rules for Cerberus UI
version: 1.0.0
category: cerberus
tags: [design, ui, tokens, css, hud, aesthetic]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

When implementing or reviewing any Cerberus UI component, CSS variable, or style decision.

## Procedure

Apply the Nexus HUD token system consistently:

**Color tokens**
| Token | Hex | Usage |
|-------|-----|-------|
| `--void-black` | `#050508` | Page/app background |
| `--surface` | `#0D0D12` | Card and panel backgrounds |
| `--surface-card` | `#12121A` | Elevated card surfaces |
| `--border` | `#1E1E2E` | Dividers and input borders |
| `--cyan` | `#00D4FF` | Primary accent, interactive highlights |
| `--cyan-subtle` | `#00D4FF1A` | Hover backgrounds, selection fills |
| `--magenta` | `#FF2D78` | Alerts, errors, destructive actions |
| `--amber` | `#FFB020` | Warnings, caution indicators |
| `--online-green` | `#00FF8C` | Online/healthy status dots |
| `--text-primary` | `#E8E8F0` | Body text |
| `--text-muted` | `#5A5A7A` | Secondary labels, placeholders |

**Typography**
- Headers / labels: `Orbitron` (weights 500, 700) — all-caps preferred
- Body / code / terminals: `JetBrains Mono` (weights 400, 500)
- No system sans-serif fonts in HUD chrome

**Component rules**
1. All form inputs must have `-webkit-appearance: none; appearance: none` to kill browser defaults
2. Focus rings: `outline: 2px solid var(--cyan); outline-offset: 2px`
3. Status dots: 8×8 px circles; color from token list above
4. Card borders: `1px solid var(--border)`; no drop shadows — use border contrast only
5. Animations: prefer `opacity` + `transform` transitions (< 200 ms); avoid layout-triggering properties

**Anti-patterns**
- No white or near-white backgrounds inside the HUD chrome
- No rounded corners > 6 px on HUD cards
- No emoji in labels or status indicators
- No color outside the token list without explicit design review
