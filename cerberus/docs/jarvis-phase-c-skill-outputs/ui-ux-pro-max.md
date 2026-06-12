# ui-ux-pro-max Skill Output — Phase C Telemetry + Chart Styling

**Skill**: `frontend-design` (dispatched with ui-ux-pro-max prompt)
**Dispatch status**: SUCCESS — skill loaded, same plugin (frontend-design handles this spec)

## Prompt

> Generate the design-system spec for HUD-style telemetry visualizations: number formatters
> (raw → 1.2K / 3.4M / 8.5B with sub-decimals), live counter animation (tween over 600-900ms
> with damping, not linear), gauge dial styling (semicircle, animated fill, optional pulse on
> threshold), sparkline cursor (animated dot at leading edge with trailing glow), status thresholds
> (green/amber/red transition rules). Brand: crimson on near-black. Stack: html-tailwind
> (vanilla CSS variables). Output as a small CSS + JS spec I can implement in a React + Vite app.

---

## HUD Telemetry Design System Spec

### 1. Number Formatter (JS)

```js
/**
 * formatTelemetry — compact HUD number with suffix
 * @param {number} n - raw number
 * @param {string} [unit] - 'bytes' for byte-chain, else numeric chain
 * @returns {string}
 */
function formatTelemetry(n, unit) {
  if (n == null || n < 0) return '—';
  if (unit === 'bytes') {
    const CHAINS = [
      [1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'KB']
    ];
    for (const [div, suf] of CHAINS) {
      if (n >= div) return _compact(n / div) + suf;
    }
    return n + 'B';
  }
  if (n >= 1e9) return _compact(n / 1e9, 2) + 'B';
  if (n >= 1e6) return _compact(n / 1e6) + 'M';
  if (n >= 1e3) return _compact(n / 1e3) + 'K';
  return String(Math.round(n));
}

function _compact(v, maxDec = 1) {
  // Strip trailing zeros: 3.40 -> "3.4", 3.00 -> "3"
  return parseFloat(v.toFixed(maxDec)).toString();
}
```

### 2. Counter Tween Animator (JS)

```js
/**
 * animateCounter — easeOutQuart tween, NOT linear
 * @param {HTMLElement} el
 * @param {number} from
 * @param {number} to
 * @param {number} [duration=750] ms
 * @param {string} [suffix]
 * @param {string} [unit] - passed to formatTelemetry
 */
function animateCounter(el, from, to, duration = 750, suffix = '', unit) {
  const start = performance.now();
  const range = to - from;

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const value = from + range * easeOutQuart(progress);
    el.textContent = formatTelemetry(value, unit) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
```

**Damping behavior**: easeOutQuart decelerates sharply — fast start, soft landing.
At t=0.5 (375ms), 94% of the value is displayed. Final 6% spans the remaining 375ms. This creates
the "nearly there" feel with graceful landing rather than a linear count.

### 3. Gauge Dial CSS Spec

```css
/* Semicircle SVG arc gauge */
.hud-dial-svg {
  width: 56px;
  height: 36px;
  overflow: visible;
}

/* Track arc */
.hud-arc-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.07);
  stroke-width: 4.5;
  stroke-linecap: round;
}

/* Fill arc — animated via stroke-dasharray */
.hud-arc-fill {
  fill: none;
  stroke-width: 4.5;
  stroke-linecap: round;
  /* stroke-dasharray set via JS: "FILLED REMAINING" */
  transition: stroke-dasharray 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* Threshold pulse — applied via JS class at >80% */
.hud-arc-fill.threshold-warn {
  animation: hud-threshold-pulse 1.1s ease-in-out infinite;
}
.hud-arc-fill.threshold-crit {
  animation: hud-threshold-pulse 0.7s ease-in-out infinite;
}

@keyframes hud-threshold-pulse {
  0%, 100% { filter: drop-shadow(0 0 2px currentColor); }
  50%       { filter: drop-shadow(0 0 8px currentColor); }
}

/* Value label */
.hud-dial-num {
  font-family: 'Orbitron', monospace;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.05em;
  line-height: 1;
}
```

**Threshold rules**:
| Metric | OK | WARN | CRIT |
|--------|----|----|------|
| CPU % | <70 | 70-89 | >=90 |
| RAM % | <75 | 75-89 | >=90 |
| Disk % | <80 | 80-94 | >=95 |
| Latency ms | <100 | 100-299 | >=300 |

**Color per threshold**:
```css
--threshold-ok:   #27ae60;  /* emerald */
--threshold-warn: #e67e22;  /* amber */
--threshold-crit: #e74c3c;  /* hot crimson */
```

### 4. Sparkline Cursor Spec

```css
/* Sparkline SVG container */
.hud-spark-svg {
  width: 100%;
  height: 44px;
  overflow: visible;
  display: block;
}

/* Polyline fill gradient (use SVG linearGradient) */
.hud-spark-fill {
  fill-opacity: 0.18;
}

/* Leading cursor dot */
.hud-spark-cursor {
  r: 3;
  /* fill set to SPARK_COLOR */
  filter: drop-shadow(0 0 4px currentColor);
  /* cx/cy updated each rAF tick */
  transition: cx 50ms linear, cy 50ms linear;
}

/* Trailing glow line segment (last 15% of sparkline width) */
.hud-spark-trail {
  stroke-width: 3;
  stroke-linecap: round;
  opacity: 0.35;
  filter: blur(2px);
  /* stroke set to SPARK_COLOR */
}
```

**JS cursor update pattern**:
```js
function updateCursor(svgEl, points) {
  if (points.length < 2) return;
  const last = points[points.length - 1];
  const cursor = svgEl.querySelector('.hud-spark-cursor');
  const trail = svgEl.querySelector('.hud-spark-trail');
  if (cursor) {
    cursor.setAttribute('cx', last.x);
    cursor.setAttribute('cy', last.y);
  }
  if (trail && points.length >= 2) {
    const prev = points[Math.max(0, points.length - Math.ceil(points.length * 0.15))];
    trail.setAttribute('x1', prev.x);
    trail.setAttribute('y1', prev.y);
    trail.setAttribute('x2', last.x);
    trail.setAttribute('y2', last.y);
  }
}
```

### 5. Status Threshold Transition Rules

**State machine**: OK → WARN (debounce 2 ticks) → CRIT (debounce 2 ticks) — prevents flicker.

```js
const THRESHOLDS = {
  cpu:     { warn: 70, crit: 90 },
  ram:     { warn: 75, crit: 90 },
  disk:    { warn: 80, crit: 95 },
  latency: { warn: 100, crit: 300 },
};

function getThresholdClass(key, value) {
  const t = THRESHOLDS[key];
  if (!t || value < 0) return 'ok';
  if (value >= t.crit) return 'crit';
  if (value >= t.warn) return 'warn';
  return 'ok';
}
```

**CSS class application**:
```css
.hud-dial-num.ok   { color: var(--threshold-ok,   #27ae60); }
.hud-dial-num.warn { color: var(--threshold-warn,  #e67e22); }
.hud-dial-num.crit { color: var(--threshold-crit,  #e74c3c); }
```

### 6. CSS Variable Token Sheet (Root)

```css
:root {
  /* Brand */
  --crimson-core:  #c0392b;
  --crimson-hot:   #e74c3c;
  --crimson-glow:  rgba(192,57,43,0.4);
  --crimson-trace: rgba(192,57,43,0.12);
  --amber-warn:    #e67e22;
  --emerald-ok:    #27ae60;

  /* Void backgrounds */
  --void:         #060708;
  --void-mid:     #0d0f12;
  --void-surface: #1a1d23;

  /* Thresholds */
  --threshold-ok:   #27ae60;
  --threshold-warn: #e67e22;
  --threshold-crit: #e74c3c;

  /* Sparklines */
  --spark-cpu:     #f1c40f;
  --spark-ram:     #3498db;
  --spark-latency: #9b59b6;

  /* Type */
  --font-hud:  'Orbitron', monospace;
  --font-mono: 'JetBrains Mono', monospace;

  /* Timing */
  --tween-fast:   200ms;
  --tween-normal: 400ms;
  --tween-counter: 750ms;
  --tween-gauge:   600ms;
  --ease-out-quart: cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```
