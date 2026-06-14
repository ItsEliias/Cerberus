/**
 * command.js — COMMAND sub-tab: 3D Globe orb + swarm health + system vitals +
 * telemetry sparklines + active tasks/agents table.
 *
 * Phase C upgrades:
 *  - CSS 3D globe with wireframe + atmosphere + particle orbit
 *  - formatTelemetry() for raw number → 1.2K / 3.4M / 8.5B
 *  - animateCounter() with easeOutQuart damping
 *  - Threshold-driven gauge color + pulse
 *  - Sparkline leading cursor + trailing glow
 */

const ARC_LEN = Math.PI * 14; // radius=14 semicircle arc length

// ---- Number formatter ----

export function formatTelemetry(n, unit) {
  if (n == null || n < 0) return '—';
  if (unit === 'bytes') {
    const CHAINS = [[1e12,'TB'],[1e9,'GB'],[1e6,'MB'],[1e3,'KB']];
    for (const [div, suf] of CHAINS) {
      if (n >= div) return _compact(n / div) + ' ' + suf;
    }
    return n + ' B';
  }
  if (n >= 1e9) return _compact(n / 1e9, 2) + 'B';
  if (n >= 1e6) return _compact(n / 1e6)    + 'M';
  if (n >= 1e3) return _compact(n / 1e3)    + 'K';
  return String(Math.round(n));
}

function _compact(v, maxDec = 1) {
  return parseFloat(v.toFixed(maxDec)).toString();
}

// ---- Counter animator (easeOutQuart) ----

function _animateCounter(el, from, to, duration, suffix, unit) {
  if (!el) return;
  const start = performance.now();
  const range = to - from;
  function ease(t) { return 1 - Math.pow(1 - t, 4); }
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const v = from + range * ease(t);
    el.textContent = formatTelemetry(v, unit) + (suffix || '');
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- Threshold helpers ----

const THRESHOLDS = {
  cpu:     { warn: 70, crit: 90 },
  ram:     { warn: 75, crit: 90 },
  disk:    { warn: 80, crit: 95 },
  latency: { warn: 100, crit: 300 },
};

function _thresholdClass(key, v) {
  const t = THRESHOLDS[key];
  if (!t || v < 0) return 'ok';
  if (v >= t.crit) return 'crit';
  if (v >= t.warn) return 'warn';
  return 'ok';
}

// ---- 3D CSS Globe orb ----

const GLOBE_HTML = `
<div class="cc-globe-wrap" id="cc-globe-body">
  <div class="cc-globe-halo"></div>
  <div class="cc-globe-sphere">
    <div class="cc-globe-wire">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <ellipse cx="50" cy="50" rx="49" ry="10" fill="none" stroke="currentColor" stroke-width="0.6"/>
        <ellipse cx="50" cy="36" rx="42" ry="7"  fill="none" stroke="currentColor" stroke-width="0.45"/>
        <ellipse cx="50" cy="64" rx="42" ry="7"  fill="none" stroke="currentColor" stroke-width="0.45"/>
        <ellipse cx="50" cy="22" rx="28" ry="5"  fill="none" stroke="currentColor" stroke-width="0.35"/>
        <ellipse cx="50" cy="78" rx="28" ry="5"  fill="none" stroke="currentColor" stroke-width="0.35"/>
        <ellipse cx="50" cy="50" rx="9"  ry="49" fill="none" stroke="currentColor" stroke-width="0.5"/>
        <ellipse cx="50" cy="50" rx="49" ry="49" fill="none" stroke="currentColor" stroke-width="0.5"/>
        <ellipse cx="50" cy="50" rx="30" ry="49" fill="none" stroke="currentColor" stroke-width="0.4"/>
      </svg>
    </div>
    <div class="cc-globe-particles" aria-hidden="true">
      <div class="cc-globe-p cc-globe-p1"></div>
      <div class="cc-globe-p cc-globe-p2"></div>
      <div class="cc-globe-p cc-globe-p3"></div>
      <div class="cc-globe-p cc-globe-p4"></div>
      <div class="cc-globe-p cc-globe-p5"></div>
    </div>
  </div>
</div>`;

function _updateOrb(wrap, state) {
  const globe = wrap.querySelector('#cc-globe-body');
  const lbl   = wrap.querySelector('.cc-orb-status');
  if (globe) { globe.className = 'cc-globe-wrap ' + state; globe.id = 'cc-globe-body'; }
  if (lbl)   { lbl.className = 'cc-orb-status ' + state; lbl.textContent = state.toUpperCase(); }
}

// ---- Dials ----

function _dialSvg(key, label) {
  const total = ARC_LEN.toFixed(2);
  return `<div class="cc-dial-wrap" data-dial="${key}">
    <svg class="cc-dial-svg" viewBox="0 0 56 34">
      <path d="M7 28 A21 21 0 0 1 49 28" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="4.5" stroke-linecap="round"/>
      <path class="cc-arc-fill cc-arc-${key}" d="M7 28 A21 21 0 0 1 49 28" fill="none" stroke-width="4.5"
        stroke-linecap="round" stroke-dasharray="0 ${total}"/>
    </svg>
    <div class="cc-dial-num ${key}" data-num-${key}>—</div>
    <div class="cc-dial-lbl">${label}</div>
  </div>`;
}

const DIAL_COLORS = {
  cpu:     '#f1c40f',
  ram:     '#3498db',
  disk:    '#2ecc71',
  latency: '#9b59b6',
};

function _updateDial(container, key, value, text) {
  const arc = container.querySelector(`.cc-arc-${key}`);
  const num = container.querySelector(`[data-num-${key}]`);
  let pct = key === 'latency'
    ? Math.min(100, (value < 0 ? 0 : value) / 200 * 100)
    : Math.max(0, Math.min(100, value < 0 ? 0 : value));

  const arcLen = Math.PI * 21; // radius=21
  if (arc) {
    const filled = ((pct / 100) * arcLen).toFixed(2);
    const color = DIAL_COLORS[key] || getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#c0392b';
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-dasharray', `${filled} ${(arcLen - filled).toFixed(2)}`);
    const cls = _thresholdClass(key, value);
    arc.classList.remove('ok','warn','crit');
    arc.classList.add(cls);
  }
  if (num) {
    num.textContent = value < 0 ? '—' : text;
    num.classList.remove('ok','warn','crit');
    if (value >= 0) num.classList.add(_thresholdClass(key, value));
  }
}

// ---- Sparklines ----

const SPARK_COLORS = { cpu: '#f1c40f', ram: '#3498db', latency: '#9b59b6' };
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function _sparkPoints(data, W, H, maxV) {
  const n = data.length;
  return data.map((v, i) => ({
    x: parseFloat(((i / (n - 1 || 1)) * W).toFixed(1)),
    y: parseFloat((H - (Math.max(0, Math.min(maxV, v < 0 ? 0 : v)) / maxV) * (H - 6) - 3).toFixed(1)),
  }));
}

function _updateSparklines(container, series) {
  ['cpu', 'ram', 'latency'].forEach(key => {
    const data = series[key] || [];
    if (!data.length) return;
    const poly    = container.querySelector(`.cc-spark-line-${key}`);
    const cursor  = container.querySelector(`.cc-spark-cursor-${key}`);
    const trail   = container.querySelector(`.cc-spark-trail-${key}`);
    const W = 200, H = 44, maxV = key === 'latency' ? 200 : 100;
    const pts = _sparkPoints(data, W, H, maxV);
    const joined = pts.map(p => `${p.x},${p.y}`).join(' ');

    if (!REDUCED && poly) poly.setAttribute('points', joined);

    if (!REDUCED && cursor && pts.length > 0) {
      const last = pts[pts.length - 1];
      cursor.setAttribute('cx', last.x);
      cursor.setAttribute('cy', last.y);
    }
    if (!REDUCED && trail && pts.length >= 2) {
      const prev = pts[Math.max(0, Math.floor(pts.length * 0.8))];
      const last = pts[pts.length - 1];
      trail.setAttribute('x1', prev.x); trail.setAttribute('y1', prev.y);
      trail.setAttribute('x2', last.x); trail.setAttribute('y2', last.y);
    }
  });
}

function _sparkSvg(key) {
  const color = SPARK_COLORS[key];
  const gradId = `spark-grad-${key}`;
  return `
<div class="cc-spark-wrap">
  <span class="cc-spark-label">${key.toUpperCase()}</span>
  <svg class="cc-spark-svg" viewBox="0 0 200 44" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon class="cc-spark-fill-${key}" points="" fill="url(#${gradId})"/>
    <polyline class="cc-spark-line-${key}" points="" fill="none"
      stroke="${color}" stroke-width="1.5"
      stroke-linejoin="round" stroke-linecap="round"/>
    <line class="cc-spark-trail-${key}" x1="0" y1="0" x2="0" y2="0"
      stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity="0.4"
      style="filter:blur(1.5px)"/>
    <circle class="cc-spark-cursor-${key}" cx="-10" cy="-10" r="3"
      fill="${color}" style="filter:drop-shadow(0 0 4px ${color})"/>
    <line x1="0" y1="44" x2="200" y2="44" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
  </svg>
</div>`;
}

// ---- JARVIS helpers ----

function _jxAnimateNum(el, toVal, suffix, key) {
  if (!el) return;
  const fromVal = parseFloat(el.dataset.rawVal || '0') || 0;
  el.dataset.rawVal = String(toVal);
  if (toVal < 0) { el.textContent = '—'; return; }
  if (window.JX && typeof window.JX.animateNumber === 'function') {
    window.JX.animateNumber(el, fromVal, toVal, 750, suffix || '');
  } else {
    _animateCounter(el, fromVal, toVal, 750, suffix || '');
  }
}

// ---- Build HTML ----

export function buildCommandTab() {
  return `
<div class="cc-command-tab">
  <div class="cc-top-row">
    <div class="cc-card cc-card-orb-slim">
      <div class="cc-card-title">Cerberus Core</div>
      <div class="cc-core-status" id="cc-orb-mount">
        <div class="cc-core-ring"></div>
        <div class="cc-core-state-text">CORE</div>
        <div class="cc-orb-status idle">OFFLINE</div>
      </div>
    </div>
    <div class="cc-card">
      <div class="cc-card-title">Swarm Health</div>
      <div class="cc-swarm-grid">
        <div><div class="cc-swarm-num" id="sw-active">—</div><div class="cc-swarm-lbl">Active</div></div>
        <div><div class="cc-swarm-num" id="sw-total">—</div><div class="cc-swarm-lbl">Total</div></div>
        <div><div class="cc-swarm-num" id="sw-queued">—</div><div class="cc-swarm-lbl">Running</div></div>
      </div>
    </div>
    <div class="cc-card">
      <div class="cc-card-title">System Vitals</div>
      <div class="cc-vitals-row" id="cc-dials">
        ${_dialSvg('cpu', 'CPU')}
        ${_dialSvg('ram', 'RAM')}
        ${_dialSvg('disk', 'DISK')}
        ${_dialSvg('latency', 'PING')}
      </div>
    </div>
  </div>
  <div class="cc-telemetry">
    <div class="cc-telemetry-header">Telemetry Feed</div>
    <div class="cc-sparklines" id="cc-sparklines">
      ${['cpu','ram','latency'].map(k => _sparkSvg(k)).join('')}
    </div>
  </div>
  <div class="cc-hero-globe">
    <div class="cc-hero-globe-stage" id="cc-hero-globe-mount">
      ${GLOBE_HTML}
    </div>
    <div class="cc-hero-globe-state idle" id="cc-hero-globe-state">CERBERUS CORE — IDLE</div>
  </div>
</div>`.trim();
}

export function applyVitals(root, v) {
  const d = root.querySelector('#cc-dials');
  if (!d) return;
  _updateDial(d, 'cpu',     v.cpu_percent,  `${v.cpu_percent < 0 ? '—' : v.cpu_percent + '%'}`);
  _updateDial(d, 'ram',     v.ram_percent,  `${v.ram_percent < 0 ? '—' : v.ram_percent + '%'}`);
  _updateDial(d, 'disk',    v.disk_percent, `${v.disk_percent < 0 ? '—' : v.disk_percent + '%'}`);
  _updateDial(d, 'latency', v.latency_ms,   `${v.latency_ms < 0 ? '—' : v.latency_ms + 'ms'}`);
}

export function applyTimeseries(root, ts) {
  const s = root.querySelector('#cc-sparklines');
  if (!s) return;
  _updateSparklines(s, ts);
}

export function applySwarm(root, sw, orbWrap) {
  ['active','total','queued'].forEach(k => {
    const el = root.querySelector(`#sw-${k}`);
    if (!el) return;
    if (sw[k] != null) _jxAnimateNum(el, sw[k]);
    else el.textContent = '—';
  });
  if (orbWrap) {
    const state = sw.status === 'DEGRADED' ? 'degraded'
                : (sw.queued > 0 || sw.status === 'ACTIVE') ? 'active'
                : sw.active > 0 ? 'idle' : 'offline';
    _updateOrb(orbWrap, state);
  }
}

export function applyAgents(root, agents) {
  const t = root.querySelector('#cc-agents-table');
  if (!t) return;
  if (!agents || agents.length === 0) {
    t.innerHTML = '<div class="cc-empty">No active tasks</div>';
    return;
  }
  t.innerHTML = agents.map(a => {
    const dot = a.status === 'running' ? 'running' : a.status === 'active' ? 'active' : 'standby';
    return `<div class="cc-agent-row">
      <span class="cc-dot ${dot}"></span>
      <span class="cc-agent-name">${_esc(a.name || a.id)}</span>
      <span class="cc-agent-action">${_esc(a.current_action || '—')}</span>
      <span class="cc-agent-score">${a.score != null ? a.score : '—'}</span>
    </div>`;
  }).join('');
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
