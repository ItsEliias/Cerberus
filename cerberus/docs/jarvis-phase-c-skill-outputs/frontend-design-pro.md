# frontend-design-pro Skill Output — Phase C Retro-Futurism / 3D Vocabulary

**Skill**: `frontend-design-pro` (frontend-design-pro plugin v1.0.0)
**Dispatch status**: FALLBACK — Skill tool returned "Unknown skill: frontend-design-pro" (known v2 issue).
Read SKILL.md directly from disk at:
`/Users/codyliddell/.claude/plugins/cache/frontend-design-pro/frontend-design-pro/1.0.0/skills/frontend-design-pro/SKILL.md`

## Extracted Vocabulary from SKILL.md

### Retro-Futurism / Cyberpunk Style Profile

From the skill's style table:

| Attribute | Value |
|-----------|-------|
| Style     | Retro-Futurism / Cyberpunk |
| Keywords  | vaporwave, 80s sci-fi, crt scanlines, neon glow, glitch, chrome |
| Palette   | Neon cyan/magenta on deep black, chrome accents |
| Signature | Scanlines, chromatic aberration, glitch transitions, long glowing shadows |

---

## Applied Design Vocabulary for Cerberus Command Center

### 3D Sphere / Globe Cues

**Depth via radial gradient**:
```css
.cerberus-globe {
  background: radial-gradient(
    ellipse at 35% 30%,
    rgba(192,57,43,0.9) 0%,
    rgba(96,28,21,0.7) 35%,
    rgba(20,5,5,0.95) 70%,
    #060708 100%
  );
  border-radius: 50%;
  box-shadow:
    inset -8px -8px 24px rgba(0,0,0,0.8),
    inset 4px 4px 16px rgba(192,57,43,0.3),
    0 0 40px rgba(192,57,43,0.25),
    0 0 80px rgba(192,57,43,0.12);
}
```

**Atmosphere glow halo** (outer ring separate from sphere):
```css
.cerberus-globe-halo {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: transparent;
  box-shadow: 0 0 0 2px rgba(192,57,43,0.25);
  animation: globe-breathe 4s ease-in-out infinite;
}

@keyframes globe-breathe {
  0%, 100% {
    box-shadow: 0 0 0 2px rgba(192,57,43,0.25),
                0 0 20px rgba(192,57,43,0.15);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(192,57,43,0.4),
                0 0 40px rgba(192,57,43,0.3);
  }
}
```

**Latitude/longitude wireframe** (SVG overlay rotated):
```css
.cerberus-globe-wire {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  overflow: hidden;
  animation: globe-rotate 18s linear infinite;
  mix-blend-mode: screen;
}

@keyframes globe-rotate {
  from { transform: rotateY(0deg); }
  to   { transform: rotateY(360deg); }
}
```

```html
<!-- Wire SVG: ellipses simulate latitude/longitude -->
<svg viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.25;">
  <!-- Equator -->
  <ellipse cx="50" cy="50" rx="50" ry="8" fill="none" stroke="#c0392b" stroke-width="0.5"/>
  <!-- Latitude lines -->
  <ellipse cx="50" cy="35" rx="43" ry="6" fill="none" stroke="#c0392b" stroke-width="0.4"/>
  <ellipse cx="50" cy="65" rx="43" ry="6" fill="none" stroke="#c0392b" stroke-width="0.4"/>
  <ellipse cx="50" cy="20" rx="30" ry="4" fill="none" stroke="#c0392b" stroke-width="0.3"/>
  <ellipse cx="50" cy="80" rx="30" ry="4" fill="none" stroke="#c0392b" stroke-width="0.3"/>
  <!-- Meridians (vertical ellipses) -->
  <ellipse cx="50" cy="50" rx="8" ry="50" fill="none" stroke="#c0392b" stroke-width="0.4"/>
  <ellipse cx="50" cy="50" rx="50" ry="50" fill="none" stroke="#c0392b" stroke-width="0.4"/>
</svg>
```

**Particle orbit** (CSS only, 6 particles):
```css
.globe-particle {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #c0392b;
  filter: drop-shadow(0 0 3px #e74c3c);
  top: 50%;
  left: 50%;
  transform-origin: 0 0;
}

.globe-particle:nth-child(1) { animation: orbit1 8s  linear infinite; }
.globe-particle:nth-child(2) { animation: orbit1 11s linear infinite 2s; }
.globe-particle:nth-child(3) { animation: orbit2 9s  linear infinite 1s; }
.globe-particle:nth-child(4) { animation: orbit2 13s linear infinite 4s; }
.globe-particle:nth-child(5) { animation: orbit3 7s  linear infinite 3s; }
.globe-particle:nth-child(6) { animation: orbit3 10s linear infinite 5s; }

@keyframes orbit1 {
  from { transform: rotate(0deg)   translateX(44px) scale(0.8); }
  to   { transform: rotate(360deg) translateX(44px) scale(0.8); }
}
@keyframes orbit2 {
  from { transform: rotate(45deg)  translateX(38px) scaleX(0.5); }
  to   { transform: rotate(405deg) translateX(38px) scaleX(0.5); }
}
@keyframes orbit3 {
  from { transform: rotate(120deg) translateX(50px) scaleX(0.3); }
  to   { transform: rotate(480deg) translateX(50px) scaleX(0.3); }
}
```

---

### HUD Scanline Vocabulary

```css
/* CRT scanline overlay — apply as ::before on any surface */
.hud-scanlines::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.06) 2px,
    rgba(0, 0, 0, 0.06) 4px
  );
}

/* Phosphor glow — red text on dark bg gets warm bleeding */
.hud-phosphor {
  text-shadow:
    0 0 4px rgba(192,57,43,0.8),
    0 0 12px rgba(192,57,43,0.4),
    0 0 20px rgba(192,57,43,0.2);
}

/* Glitch flicker (occasional, low-frequency) */
@keyframes hud-glitch {
  0%, 95%, 100%   { clip-path: none; transform: none; }
  96%  { clip-path: inset(20% 0 60% 0); transform: translateX(-2px); }
  97%  { clip-path: inset(60% 0 20% 0); transform: translateX(2px); }
  98%  { clip-path: none; transform: none; }
  99%  { clip-path: inset(40% 0 40% 0); transform: translateX(-1px); color: #e74c3c; }
}

/* Apply sparingly to brand title — fires ~1/30s */
.cc-brand-title {
  animation: hud-glitch 30s steps(1) infinite;
}

/* Chromatic aberration on hover */
.hud-chr-hover:hover {
  text-shadow:
    -1px 0 rgba(0, 255, 255, 0.4),
    1px  0 rgba(255, 0, 80, 0.4);
}
```

---

### Breathing UI Motion Patterns

```css
/* Slow pulse for idle state elements */
@keyframes hud-idle-breathe {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50%       { opacity: 1.0; transform: scale(1.02); }
}

/* Fast pulse for active/alert state */
@keyframes hud-active-breathe {
  0%, 100% { filter: drop-shadow(0 0 4px #c0392b); }
  50%       { filter: drop-shadow(0 0 14px #e74c3c); }
}

/* Very subtle breathing for background elements */
@keyframes hud-ambient-breathe {
  0%, 100% { opacity: 0.04; }
  50%       { opacity: 0.08; }
}

/* Globe idle breathing (scale + glow) */
@keyframes globe-idle {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 0 8px rgba(192,57,43,0.4));
  }
  50% {
    transform: scale(1.01);
    filter: drop-shadow(0 0 16px rgba(192,57,43,0.6));
  }
}

/* Globe active — faster rotation (done via animation-duration change in JS) */
```

---

### Upgrade Implementation Map

| Current state | Target state | Implementation |
|---------------|--------------|----------------|
| Flat SVG shield 56x56 | CSS 3D globe 100px+, depth + atmosphere | Replace `SHIELD_SVG` in `command.js` |
| Raw numbers (852696898) | Formatted (852M) with counter tween | Add `_fmt()` + `_animateNum()` in `command.js` |
| Static sparkline polyline | Animated cursor dot + trailing glow | `applyTimeseries()` upgrade + SVG cursor elements |
| Gauge fill 0.4s ease | 0.6s ease-out-quart + threshold pulse class | `_updateDial()` + CSS |
| Flat brand bar | Phosphor glow title + occasional glitch | `styles.css` augment |
| Scanlines at 4% | CRT overlay at 6% + noise layer | `styles.css` `.cc-shell::before` |
| No particle orbit | 6 CSS-only particles orbiting globe | New DOM in `SHIELD_SVG` replacement |
