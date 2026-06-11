/**
 * command.js — COMMAND sub-tab: Shield orb + swarm health + system vitals +
 * telemetry sparklines + active tasks/agents table.
 */

const ARC_LEN = Math.PI * 14; // radius=14 semicircle arc length

// ---- Orb ----

const SHIELD_SVG = `<svg class="cc-orb idle" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M28 4L8 13V26C8 38 18 48 28 52C38 48 48 38 48 26V13Z"
    fill="none" stroke="var(--red,#c0392b)" stroke-width="2" stroke-linejoin="round"/>
  <line x1="20" y1="28" x2="24.5" y2="33" stroke="var(--red,#c0392b)"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="24.5" y1="33" x2="36" y2="22" stroke="var(--red,#c0392b)"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="28" cy="28" r="18" fill="var(--red,#c0392b)" fill-opacity="0.06"/>
</svg>`;

function _updateOrb(wrap, state) {
  const svg = wrap.querySelector('svg');
  const lbl = wrap.querySelector('.cc-orb-status');
  if (svg) svg.className = `cc-orb ${state}`;
  if (lbl) { lbl.className = `cc-orb-status ${state}`; lbl.textContent = state.toUpperCase(); }
}

// ---- Dials ----

function _dialSvg(key, color, label) {
  const total = ARC_LEN.toFixed(2);
  return `<div class="cc-dial-wrap" data-dial="${key}">
    <svg class="cc-dial-svg" viewBox="0 0 48 28">
      <path d="M6 24 A18 18 0 0 1 42 24" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4" stroke-linecap="round"/>
      <path class="cc-arc-${key}" d="M6 24 A18 18 0 0 1 42 24" fill="none" stroke="${color}" stroke-width="4"
        stroke-linecap="round" stroke-dasharray="0 ${total}" style="transition: stroke-dasharray 0.4s ease;"/>
    </svg>
    <div class="cc-dial-num ${key}" data-val-${key}>—</div>
    <div class="cc-dial-lbl">${label}</div>
  </div>`;
}

function _updateDial(container, key, value, text) {
  const arc = container.querySelector(`.cc-arc-${key}`);
  const num = container.querySelector(`[data-val-${key}]`);
  let pct = key === 'latency'
    ? Math.min(100, (value < 0 ? 0 : value) / 200 * 100)
    : Math.max(0, Math.min(100, value < 0 ? 0 : value));
  if (arc) {
    const filled = ((pct / 100) * ARC_LEN).toFixed(2);
    arc.setAttribute('stroke-dasharray', `${filled} ${(ARC_LEN - filled).toFixed(2)}`);
  }
  if (num) num.textContent = value < 0 ? '—' : text;
}

// ---- Sparklines ----

const SPARK_COLORS = { cpu: '#f1c40f', ram: '#3498db', latency: '#9b59b6' };
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function _updateSparklines(container, series) {
  ['cpu', 'ram', 'latency'].forEach(key => {
    const data = series[key] || [];
    if (!data.length) return;
    const poly = container.querySelector(`.cc-spark-line-${key}`);
    if (!poly) return;
    const W = 200, H = 40, maxV = key === 'latency' ? 200 : 100;
    const n = data.length;
    const pts = data.map((v, i) => {
      const x = ((i / (n - 1 || 1)) * W).toFixed(1);
      const y = (H - (Math.max(0, Math.min(maxV, v < 0 ? 0 : v)) / maxV) * (H - 4) - 2).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
    if (!REDUCED) poly.setAttribute('points', pts);
  });
}

// ---- Build HTML ----

export function buildCommandTab() {
  return `
<div class="cc-command-tab">
  <div class="cc-top-row">
    <div class="cc-card">
      <div class="cc-card-title">Cerberus Core</div>
      <div class="cc-orb-wrap" id="cc-orb-mount">
        ${SHIELD_SVG}
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
        ${_dialSvg('cpu', '#f1c40f', 'CPU')}
        ${_dialSvg('ram', '#3498db', 'RAM')}
        ${_dialSvg('disk', '#2ecc71', 'DISK')}
        ${_dialSvg('latency', '#9b59b6', 'LATENCY')}
      </div>
    </div>
  </div>
  <div class="cc-telemetry">
    <div class="cc-telemetry-header">Telemetry Feed</div>
    <div class="cc-sparklines" id="cc-sparklines">
      ${['cpu','ram','latency'].map(k => `
        <div class="cc-spark-wrap">
          <span class="cc-spark-label">${k.toUpperCase()}</span>
          <svg class="cc-spark-svg" viewBox="0 0 200 40" preserveAspectRatio="none">
            <polyline class="cc-spark-line-${k}" points="" fill="none"
              stroke="${SPARK_COLORS[k]}" stroke-width="1.5"
              stroke-linejoin="round" stroke-linecap="round"/>
            <line x1="0" y1="40" x2="200" y2="40" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
          </svg>
        </div>`).join('')}
    </div>
  </div>
  <div class="cc-agents">
    <div class="cc-section-header">Active Tasks / Agents</div>
    <div id="cc-agents-table"><div class="cc-empty">Loading...</div></div>
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
  if (s) _updateSparklines(s, ts);
}

export function applySwarm(root, sw, orbWrap) {
  ['active','total','queued'].forEach(k => {
    const el = root.querySelector(`#sw-${k}`);
    if (el) el.textContent = sw[k] != null ? sw[k] : '—';
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
