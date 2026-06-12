# frontend-design Skill Output — Phase C Command Center

**Skill**: `frontend-design` (claude-plugins-official)
**Dispatch status**: SUCCESS — skill loaded and executed

## Prompt

> I have an existing React + Vite JARVIS Command Center dashboard with a crimson orb 'Cerberus Core'
> visualization, swarm health counts, system vitals gauges (CPU/Memory/Latency), telemetry sparklines,
> active agents list, and 5 sub-tabs (COMMAND/COUNCIL/WORKSPACE/FINANCE/ASSISTANT). Mission: make it
> MORE dramatic, more Iron Man / JARVIS. Bigger, more cinematic. The current orb is static-ish; I want
> a real spinning 3D globe with depth, ambient glow, particle/data points orbiting. Telemetry numbers
> currently show raw values like 852696898 — needs proper formatting (852M, 0.85B, etc) and live-ish
> ticking animation. Brand identity: crimson #c0392b family on near-black, monospace/Orbitron typography
> (already used). Want the direction, the visual upgrades to prioritize, and the motion vocabulary.

## Skill Framework Output (from SKILL.md guidelines)

### Aesthetic Direction: MAXIMALIST RETRO-FUTURISM / CINEMATIC HUD

**Tone committed**: Maximalist chaos restrained by precision grids. Think Iron Man Mark III HUD overlaid
on a deep-space operations interface — every pixel earns its glow.

**Unforgettable element**: The Cerberus Core orb becomes a living entity — a crimson atmospheric globe
with latitude/longitude wireframe lines rotating at two different speeds, particle data-points orbiting
in elliptical paths, and an atmosphere halo that pulses with system health state.

---

### Priority Upgrade Stack (ordered by visual impact)

#### 1. CERBERUS CORE — 3D Spinning Globe (Highest Impact)

Replace the flat SVG shield with a Three.js globe or advanced CSS 3D transform sphere.

**Implementation choice**: CSS 3D perspective + SVG layer compositing (no CDN dep, fits vendor constraint)
- Outer: `perspective(400px)` container with `transform-style: preserve-3d`
- Globe body: `border-radius: 50%` sphere with radial-gradient for depth shading
- Wireframe: SVG overlay of latitude/longitude arcs animated with `rotateY` at 8s/12s
- Atmosphere: layered `box-shadow` + radial-gradient halo pulsing on `keyframes`
- Particles: 6-8 `::before`/`::after` + sibling divs with `transform-origin` orbit paths
- Active state: increases rotation speed, intensifies glow (`filter: brightness(1.3)`)
- Idle state: slow 20s rotation, dim glow, slight "breathing" scale 1.0-1.02

**OR Three.js (if source rebuild is available)**:
```
- Icosahedron geometry + wireframe MeshBasicMaterial in crimson
- Ambient + point light for depth
- OrbitControls disabled (auto-rotate only)
- 8-12 sprite particles on circular orbit paths
- canvas placed in div with CSS z-layering
```

#### 2. NUMBER FORMATTING (Critical UX — currently broken at 852696898 raw)

Formatter spec:
```
< 1,000        → as-is (e.g. "847")
1,000-999,999  → "1.2K" (one decimal, trim .0)
1M-999M        → "3.4M" (one decimal)
1B+            → "0.85B" (two decimals below 10B, one above)
Bytes special  → auto-detect suffix chain: B → KB → MB → GB → TB
```

Tween animation: easeOutQuart over 700ms, integer steps for large numbers.

#### 3. SPARKLINES — Animated Leading Cursor

- SVG `polyline` updated frame-by-frame (requestAnimationFrame ticker)
- Leading dot: `circle` element that follows the last point
- Trailing glow: `filter: drop-shadow(0 0 3px COLOR)` on the leading dot
- Gradient fill: `linearGradient` from COLOR at 40% opacity to transparent

#### 4. GAUGE DIALS — Cinematic Fill + Threshold Pulse

- Semicircle SVG arc (already exists)
- Animated fill: CSS transition on `stroke-dasharray` (already in place — enhance timing)
- Threshold pulse: at >80%, add `animation: threshold-pulse` — red/amber glow on arc
- Numbers: use the formatter + animated counter (point 2 above)

#### 5. MOTION VOCABULARY

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Globe rotation (idle) | rotateY continuous | 18s | linear |
| Globe rotation (active) | rotateY continuous | 6s | linear |
| Globe atmosphere pulse | opacity 0.4→0.8 | 3s | ease-in-out infinite |
| Particle orbit | translateX/Y circular | 8-14s per particle | linear |
| Number tween | count up/down | 700ms | easeOutQuart |
| Gauge fill on mount | stroke-dasharray 0→value | 800ms | ease-out |
| Threshold pulse | box-shadow scale | 1.2s | ease-in-out infinite |
| Sparkline cursor | follows polyline | rAF | n/a |
| Tab reveal stagger | opacity + translateY | 400ms + 50ms/item | ease-out |
| Brand bar glow | text-shadow flicker | 4s | steps(1) occasional |

#### 6. BRAND BAR — CINEMATIC CHROME

- Title: Orbitron 700 weight, 0.3em letter-spacing, crimson text-shadow glow
- Scanline overlay: `::before` with repeating-linear-gradient (already exists, increase opacity)
- Corner bracket SVG decorations (referencing existing JX effects.js bracket pattern)
- Subtle noise texture: `url("data:image/svg+xml,...")` SVG noise at 3% opacity

#### 7. SUB-TAB POLISH (lower priority, don't bloat)

- COUNCIL: add pulsing ripple to active crew-member dots (already exists in styles.css)
- WORKSPACE: stagger reveal on mount (wire to JX.staggerIn)
- FINANCE: "waiting for data source" aesthetic — empty state with animated placeholder bars
- ASSISTANT: chat bubble entrance animation (slide-in from bottom, 200ms)

---

### Typography Reinforcement

- Display (brand bar, tab labels): Orbitron 700 — already in use, good
- Numbers (all telemetry): Orbitron 500 tabular-nums — switch from Fira Code for numbers
- Body/labels: JetBrains Mono — cleaner than Fira Code for small labels
- Section headers: letter-spacing: 0.25em, 8px, uppercase — increase from 0.14em

---

### Color System Expansion

```css
--crimson-core:   #c0392b;   /* primary brand */
--crimson-hot:    #e74c3c;   /* active/hover state */
--crimson-ember:  #96281b;   /* dark variant */
--crimson-glow:   rgba(192,57,43,0.4);  /* glow shadows */
--crimson-trace:  rgba(192,57,43,0.12); /* subtle tints */
--amber-warn:     #e67e22;   /* degraded state */
--emerald-ok:     #27ae60;   /* healthy/active agent */
--void:           #060708;   /* deepest background */
--void-mid:       #0d0f12;   /* card backgrounds */
--void-surface:   #1a1d23;   /* shell surface */
```

---

### Implementation Notes

**For vanilla JS source** (what's available in `static/js/cyberapps/command-center/`):
- The orb can be upgraded from flat SVG shield to CSS 3D sphere in `command.js` — just replace `SHIELD_SVG` constant
- Number formatting: add a `_fmt(n)` utility function in `command.js`
- Sparkline cursor: wire to existing `window.JX.addSparkCursor` calls (already in `applyTimeseries`)
- CSS enhancements: `styles.css` under 293 lines — room for orb 3D + animation additions
- The `window.JX.animateNumber` function in `effects.js` handles counter tweening

**For React bundle source** (deleted — needs rebuild or options decision):
- Three.js via npm, vendored post-build
- framer-motion for stagger reveals (already in CyberOS Dashboard electron app deps)
