# Skill Output: frontend-design

Plugin: `claude-plugins-official`
Skill slug: `frontend-design`
Base dir: `/Users/codyliddell/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/skills/frontend-design`
Invoked: 2026-06-12

## SKILL PROMPT SENT

> "Cerberus — a localhost AI workspace. Existing identity: deep crimson (#c0392b family) on near-black,
> red 'Cerberus' wordmark, status accents already in use (green=active, amber=idle, blue=processing,
> red=alert). Reference: the Command Center bundle at /static/cc-app/ has the target look — crimson
> core orb, radar council graph, gauge dials, telemetry sparklines, glowing HUD panels. Mission: bring
> this Iron-Man / JARVIS aesthetic across the WHOLE app (sidebar, chat view, working surfaces) without
> hurting legibility in dense views. Confirm aesthetic direction and the visual primitives to lean on.
> Principle: 'cinematic chrome, legible core' — heavy effects on hero/landing/loading surfaces, calm on
> dense working views."

## FULL SKILL OUTPUT (RAW)

The skill loaded its SKILL.md guidelines (retro-futuristic category with cyberpunk / 80s sci-fi flavor)
and returned the following aesthetic direction:

---

### Aesthetic Direction: JARVIS-Class HUD — "Cinematic Chrome, Legible Core"

**Conceptual Foundation**

The unforgettable thing: Cerberus feels like a real Iron Man suit OS — not a themed web app.
Every surface has weight, depth, and tactical purpose. The crimson spine isn't decoration; it's the
system's heartbeat made visible.

**Tone**: Retro-futuristic militech. Not cyberpunk neon, not sci-fi blue — crimson war-room. Think:
tactical operations center running on obsidian glass panels with embedded holographic overlays.

---

### Visual Primitives (Binding Decisions)

#### 1. Surface Hierarchy — "Depth Stack"
```
Level 0 — Void:      #09090a  (pure background, deep space)
Level 1 — Plate:     #0d0d0f  (primary panels, cards)
Level 2 — Raised:    #111115  (sidebar, active states)
Level 3 — Lifted:    #16161c  (modals, tooltips, popovers)
Level 4 — Glass:     rgba(22,22,28,0.72) + backdrop-blur(12px)
```

#### 2. Crimson Spine — The Brand's Nervous System
```
--crimson-900: #2d0a0a   (ember, deep background tints)
--crimson-800: #4a0f0f   (subtle fills)
--crimson-700: #7a1a1a   (hover fills, inactive tints)
--crimson-600: #a02020   (border glows, secondary actions)
--crimson-500: #c0392b   (CORE — primary actions, wordmark, active indicators)
--crimson-400: #e04030   (hover state on core)
--crimson-300: #f06050   (highlight, focus rings)
--crimson-200: #ff8877   (glow tips, sparkline peaks)
```

#### 3. Typography — "Orbitron + IBM Plex Sans" pairing
- **Display / Hero**: `Orbitron` (geometric, angular, space-tactical) — numbers, counters, system labels
- **UI Chrome**: `JetBrains Mono` — sidebar labels, HUD readouts, status chips
- **Body / Chat**: `IBM Plex Sans` — conversation text, descriptions, dense working views
- **Accent**: Letter-spacing 0.15em on all UI chrome

#### 4. Glow Physics — Two Modes
```
"Hero glow"   — large, soft, ambient:  0 0 60px rgba(192,57,43,0.35), 0 0 120px rgba(192,57,43,0.15)
"Focus glow"  — tight, precise:        0 0 0 1px #c0392b, 0 0 8px rgba(192,57,43,0.6)
"Lift glow"   — panel depth:           0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)
"Pulse"       — animated heartbeat:    keyframes pulseCrimson (opacity 0.5→1→0.5 @ 3s)
```

#### 5. Surface Treatment — "Chrome Panels"
- **Hairline borders**: `1px solid rgba(192,57,43,0.15)` — always. Panels live on obsidian, need edge definition.
- **Top accent line**: `border-top: 1px solid rgba(192,57,43,0.4)` — signals "active chrome."
- **Bracket corners**: `::before / ::after` SVG-style L-bracket insets at panel corners.
- **Scan line overlay**: `repeating-linear-gradient` at 1–2px intervals, opacity 0.025 — hero zones only.
- **Noise grain**: SVG feTurbulence at 0.65 frequency, opacity 0.03.

#### 6. Motion — "Tactical Precision"
```
--dur-instant:  80ms   ease-out
--dur-fast:     150ms  ease-out
--dur-normal:   240ms  ease-out
--dur-slow:     400ms  ease-in-out
--dur-dramatic: 800ms  cubic-bezier(0.16,1,0.3,1)
```
All motion wrapped in `@media (prefers-reduced-motion: reduce)` killswitch.

#### 7. "Cinematic Chrome, Legible Core" — The Density Rule
| Surface Type | Effects Allowed |
|---|---|
| Hero / Landing / Splash | All: scanlines, bracket corners, ambient glow, parallax, animated orb |
| Sidebar / Shell Chrome | Moderate: glow on active item, hairline borders, top-accent on header |
| Chat Panel | Minimal: bubble borders, input focus glow, empty state HUD frame |
| Dense Data (tables, code, logs) | None: pure surface tiers + hairline borders only |

#### 8. Status Accent Preservation (UNCHANGED)
```
--status-active:     #22c55e  (green — system live)
--status-idle:       #f59e0b  (amber — standing by)
--status-processing: #3b82f6  (blue — inference running)
--status-alert:      #ef4444  (red — error/danger)
```

### The One Unforgettable Thing

**Bracket corners + hairline crimson + monospaced chrome = tactility.**

When a user hovers any panel, L-bracket corners at the four corners animate in (scale + opacity) at 150ms.
It's theatrical but instantaneous — the suit is "reading" the element. This is the signature interaction
that makes Cerberus feel like a real system interface.

---

## SKILL NOTES

Skill base dir: `/Users/codyliddell/.claude/plugins/cache/claude-plugins-official/frontend-design/unknown/skills/frontend-design`

The skill was successfully invoked via the Skill tool. It returned comprehensive aesthetic direction with:
- Explicit surface hierarchy (5 levels)
- 8-shade crimson spine
- Typography trio (Orbitron/JetBrains Mono/IBM Plex Sans)
- Glow physics in 4 named modes
- Density rule table for effect gating
- Motion token set with named durations
- The "bracket corners" signature interaction as the unforgettable detail

The skill's style category applied: **Retro-Futurism / Cyberpunk** with keywords:
"vaporwave, 80s sci-fi, CRT scanlines, neon glow, glitch, chrome"
Adapted to: crimson-on-obsidian war-room (not blue/cyan cyberpunk)
