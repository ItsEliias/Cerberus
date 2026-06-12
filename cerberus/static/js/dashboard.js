/**
 * CERBERUS — dashboard.js
 * Phase D: 4-quadrant system-overview landing view.
 * Replaces the welcome-screen when no chat is selected.
 * Reads from existing endpoints: /api/agents, /api/tasks,
 * /api/notes?limit=5, /api/memory.
 * Real data only — shows "—" on error/no-source.
 * No new backend endpoints. prefers-reduced-motion honoured via JX2.
 */

const API = window.location.origin;
let _dashInterval = null;
let _dashMounted  = false;

// ── Helpers ─────────────────────────────────────────────────────────

function _safeJson(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function _now() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function _svg(w, h, viewBox) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', w);
  s.setAttribute('height', h);
  s.setAttribute('viewBox', viewBox || `0 0 ${w} ${h}`);
  return s;
}

// ── Quadrant builders ────────────────────────────────────────────────

/** Q1 — System Vitals: 3 gauges (CPU / RAM / Latency) */
function _buildVitals() {
  const wrap = _el('div', 'jx2-dash-gauges');

  const metrics = [
    { id: 'dash-g-cpu', label: 'CPU',     state: 'processing' },
    { id: 'dash-g-ram', label: 'RAM',     state: 'idle' },
    { id: 'dash-g-lat', label: 'LATENCY', state: 'active' },
  ];

  metrics.forEach(m => {
    const g = _el('div', 'jx2-gauge');
    g.id = m.id;
    g.dataset.state = m.state;
    const lbl = _el('div', 'jx2-gauge__label', m.label);
    g.appendChild(lbl);
    wrap.appendChild(g);
    // Init at 0 — will be updated by _refreshVitals
    if (typeof JX2 !== 'undefined') JX2.gaugeInit(g, 0);
  });

  return wrap;
}

/** Fetch pseudo-vitals from /api/version (latency probe) and
 *  performance.memory (RAM) — browser API, no backend needed.
 *  CPU is not available from the browser; we use a short-lived
 *  Worker timer deviation as a proxy (shows "—" if unavailable).
 */
async function _refreshVitals() {
  // Real host metrics via psutil — /api/system/vitals
  let cpuPct = null, ramPct = null, latMs = null;
  try {
    const res = await fetch(`${API}/api/system/vitals`, { credentials: 'same-origin' });
    if (res.ok) {
      const v = await res.json();
      cpuPct = v.cpu_percent != null ? Math.round(v.cpu_percent) : null;
      ramPct = v.ram_percent != null ? Math.round(v.ram_percent) : null;
      latMs  = v.latency_ms  != null ? Math.round(v.latency_ms)  : null;
    }
  } catch (_) {}

  const latPct = latMs !== null ? Math.min(100, Math.round((latMs / 50) * 100)) : null;

  const updates = [
    { id: 'dash-g-cpu', pct: cpuPct },
    { id: 'dash-g-ram', pct: ramPct },
    { id: 'dash-g-lat', pct: latPct },
  ];

  updates.forEach(({ id, pct }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.querySelector('.jx2-gauge__value');
    if (pct === null) {
      if (val) val.textContent = '—';
    } else {
      if (typeof JX2 !== 'undefined') JX2.gaugeUpdate(el, pct);
    }
  });
}

/** Q2 — Active Council: top-3 agents from /api/agents */
async function _refreshAgents(body) {
  body.innerHTML = '';
  let agents = [];
  try {
    const data = await fetch(`${API}/api/agents`, { credentials: 'same-origin' }).then(_safeJson);
    agents = (data.agents || []).filter(a => a.status === 'active').slice(0, 3);
    if (!agents.length) {
      agents = (data.agents || []).slice(0, 3);
    }
  } catch (_) {
    body.innerHTML = '<div class="jx2-dash-loading">No source</div>';
    return;
  }

  if (!agents.length) {
    body.innerHTML = '<div class="jx2-dash-loading">No agents</div>';
    return;
  }

  agents.forEach(a => {
    const row = _el('div', 'jx2-dash-agent-row');
    const dot = _el('span', 'jx2-status-dot');
    dot.dataset.status = a.status === 'active' ? 'active'
      : a.status === 'alert' ? 'alert'
      : a.status === 'standby' ? 'processing'
      : 'idle';
    const name   = _el('span', 'jx2-dash-agent-name', a.name || a.id);
    const action = _el('span', 'jx2-dash-agent-action', a.current_action || a.role || '—');
    const score  = _el('span', 'jx2-stat-chip');
    score.dataset.status = 'idle';
    score.textContent    = a.score != null ? `${a.score}` : '—';
    row.append(dot, name, action, score);
    body.appendChild(row);
  });
}

/** Q3 — Today's Work: task stats donut + recent completions */
async function _refreshTodayWork(body) {
  body.innerHTML = '';
  let tasks = [];
  try {
    const data = await fetch(`${API}/api/tasks`, { credentials: 'same-origin' }).then(_safeJson);
    tasks = data.tasks || [];
  } catch (_) {
    body.innerHTML = '<div class="jx2-dash-loading">No source</div>';
    return;
  }

  const today = new Date().toDateString();
  const active  = tasks.filter(t => t.status === 'active').length;
  const paused  = tasks.filter(t => t.status === 'paused').length;
  const doneToday = tasks.filter(t => {
    if (!t.last_run) return false;
    return new Date(t.last_run).toDateString() === today && t.last_run_status === 'success';
  }).length;
  const total   = tasks.length;

  // Mini donut (60px)
  const donutWrap = _buildMiniDonut(60, [
    { value: active,   color: 'var(--jx2-status-active)',     label: 'Active' },
    { value: paused,   color: 'var(--jx2-status-idle)',       label: 'Paused' },
    { value: Math.max(0, total - active - paused),
      color: 'var(--jx2-fg-muted)', label: 'Other' },
  ], total);

  const statsRow = _el('div', '');
  statsRow.style.cssText = 'display:flex;align-items:center;gap:12px;';

  const chips = _el('div', '');
  chips.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  [
    { val: active,    status: 'active',  lbl: 'Active'   },
    { val: paused,    status: 'idle',    lbl: 'Paused'   },
    { val: doneToday, status: 'active',  lbl: 'Done today'},
  ].forEach(c => {
    const chip = _el('span', 'jx2-stat-chip');
    chip.dataset.status = c.status;
    chip.textContent    = `${c.val} ${c.lbl}`;
    chips.appendChild(chip);
  });

  statsRow.append(donutWrap, chips);
  body.appendChild(statsRow);

  // Recent completions (last 3 with last_run)
  const completed = tasks
    .filter(t => t.last_run && t.last_run_status === 'success')
    .sort((a, b) => new Date(b.last_run) - new Date(a.last_run))
    .slice(0, 3);

  if (completed.length) {
    const divider = _el('hr', 'jx2-divider');
    body.appendChild(divider);
    completed.forEach(t => {
      const row = _el('div', 'jx2-dash-completion-row');
      const d = new Date(t.last_run);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      row.textContent = `${hh}:${mm} — ${t.name || '—'}`;
      body.appendChild(row);
    });
  }
}

/** Q4 — Knowledge Feed: 5 most recent notes */
async function _refreshFeed(body) {
  body.innerHTML = '';
  let notes = [];
  try {
    const data = await fetch(`${API}/api/notes?limit=5`, { credentials: 'same-origin' }).then(_safeJson);
    notes = data.notes || data || [];
  } catch (_) {
    body.innerHTML = '<div class="jx2-dash-loading">No source</div>';
    return;
  }

  if (!notes.length) {
    body.innerHTML = '<div class="jx2-dash-loading">No notes yet</div>';
    return;
  }

  notes.slice(0, 5).forEach(n => {
    const row = _el('div', 'jx2-dash-feed-row');
    const lbl  = _el('span', 'jx2-dash-feed-label', n.title || n.content?.slice(0, 40) || '—');
    const type = _el('span', 'jx2-dash-feed-type', 'note');
    row.append(lbl, type);
    // Clicking opens notes panel (if present)
    row.addEventListener('click', () => {
      const btn = document.querySelector('[data-panel="notes"], [data-section="notes"]');
      if (btn) btn.click();
    });
    body.appendChild(row);
  });
}

// ── SVG donut helper ─────────────────────────────────────────────────

function _buildMiniDonut(size, segments, total) {
  const wrap = _el('div', 'jx2-donut');
  wrap.style.width  = `${size}px`;
  wrap.style.height = `${size}px`;

  const R  = size / 2 - 8;
  const CX = size / 2;
  const CY = size / 2;
  const CIRC = 2 * Math.PI * R;

  const svg = _svg(size, size);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Task distribution: ${total} total`);

  // Track circle
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', CX);
  track.setAttribute('cy', CY);
  track.setAttribute('r', R);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(192,57,43,0.10)');
  track.setAttribute('stroke-width', '5');
  svg.appendChild(track);

  let offset = 0;
  const safeTot = total || 1;

  segments.forEach(seg => {
    if (!seg.value) return;
    const pct   = seg.value / safeTot;
    const dash  = pct * CIRC;
    const gap   = CIRC - dash;
    const arc   = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', CX);
    arc.setAttribute('cy', CY);
    arc.setAttribute('r', R);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', seg.color);
    arc.setAttribute('stroke-width', '5');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', `${dash} ${gap}`);
    arc.setAttribute('stroke-dashoffset', -offset);
    arc.style.transformOrigin = `${CX}px ${CY}px`;
    arc.style.transform = 'rotate(-90deg)';
    arc.style.transition = 'stroke-dasharray 0.4s ease-out';
    arc.setAttribute('aria-label', seg.label);
    // Tooltip on hover
    arc.addEventListener('mouseenter', e => {
      _showMiniTooltip(e.currentTarget, `${seg.label}: ${seg.value} (${Math.round(pct * 100)}%)`);
    });
    arc.addEventListener('mouseleave', _hideMiniTooltip);
    svg.appendChild(arc);
    offset += dash;
  });

  wrap.appendChild(svg);

  const center = _el('div', 'jx2-donut__center');
  const tot    = _el('span', 'jx2-donut__total', String(total));
  const sub    = _el('span', 'jx2-donut__sub', 'tasks');
  center.append(tot, sub);
  wrap.appendChild(center);

  return wrap;
}

// ── Tooltip helpers ──────────────────────────────────────────────────

function _showMiniTooltip(anchor, text) {
  _hideMiniTooltip();
  const tt = _el('div', 'jx2-tooltip');
  tt.id = 'jx2-mini-tooltip';
  tt.textContent = text;
  document.body.appendChild(tt);
  const r = anchor.closest('svg')?.getBoundingClientRect();
  if (r) {
    tt.style.top  = `${r.top - 28}px`;
    tt.style.left = `${r.left + r.width / 2 - tt.offsetWidth / 2}px`;
  }
}

function _hideMiniTooltip() {
  document.getElementById('jx2-mini-tooltip')?.remove();
}

// ── System status chip ───────────────────────────────────────────────

async function _refreshStatus(chipEl) {
  try {
    await fetch(`${API}/api/version`, { credentials: 'same-origin' });
    chipEl.dataset.status = 'active';
    chipEl.textContent    = 'NOMINAL';
  } catch (_) {
    chipEl.dataset.status = 'alert';
    chipEl.textContent    = 'DEGRADED';
  }
}

// ── Clock tick ───────────────────────────────────────────────────────

function _startClock(el) {
  el.textContent = _now();
  const id = setInterval(() => { el.textContent = _now(); }, 1000);
  return id;
}

// ── Main mount / unmount ─────────────────────────────────────────────

/**
 * Mount the dashboard into #welcome-screen.
 * Called when welcome-screen becomes visible (no chat selected).
 */
async function mountDashboard() {
  const screen = document.getElementById('welcome-screen');
  if (!screen) return;
  if (document.getElementById('jx2-dashboard')) return; // already mounted

  screen.classList.add('jx2-dash-active');
  _dashMounted = true;

  const dash = _el('div', 'jx2-scan-line', '');
  dash.id = 'jx2-dashboard';

  // ── Top strip ────────────────────────────────────────────────────
  const topstrip = _el('div', 'jx2-dash-topstrip');

  const brand = _el('span', 'jx2-brand-pulse');
  brand.textContent = 'CBR // SYSTEM OVERVIEW';

  const clock = _el('span', 'jx2-dash-clock');
  const clockId = _startClock(clock);
  dash._clockId = clockId;

  const statusChip = _el('span', 'jx2-stat-chip');
  statusChip.dataset.status = 'processing';
  statusChip.textContent = 'CHECKING…';
  _refreshStatus(statusChip);

  topstrip.append(brand, clock, statusChip);
  dash.appendChild(topstrip);

  // ── 2×2 Grid ─────────────────────────────────────────────────────
  const grid = _el('div', 'jx2-dash-grid');

  const quadrants = [
    {
      id: 'dash-q-vitals',
      title: 'SYSTEM VITALS',
      icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
      build: async (body) => {
        const gauges = _buildVitals();
        body.appendChild(gauges);
        await _refreshVitals();
      },
    },
    {
      id: 'dash-q-council',
      title: 'ACTIVE COUNCIL',
      icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      build: _refreshAgents,
    },
    {
      id: 'dash-q-work',
      title: "TODAY'S WORK",
      icon: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
      build: _refreshTodayWork,
    },
    {
      id: 'dash-q-feed',
      title: 'KNOWLEDGE FEED',
      icon: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16"/><path d="M8 22V4"/>',
      build: _refreshFeed,
    },
  ];

  for (const q of quadrants) {
    const panel = _el('div', 'jx2-glass-panel jx2-hud-frame jx2-dash-quadrant');
    panel.id = q.id;

    const header = _el('div', 'jx2-dash-quadrant__header');
    const icon   = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = q.icon;
    icon.style.color = 'var(--jx2-crimson-500)';
    icon.style.flexShrink = '0';

    const title = _el('span', 'jx2-dash-quadrant__title', q.title);
    header.append(icon, title);

    const body = _el('div', 'jx2-dash-quadrant__body');
    body.innerHTML = '<div class="jx2-dash-loading">Loading…</div>';

    panel.append(header, body);
    grid.appendChild(panel);

    // Add bracket corners
    if (typeof JX2 !== 'undefined') JX2.bracketCorners(panel);

    // Fill data
    q.build(body).catch(() => {
      body.innerHTML = '<div class="jx2-dash-loading">— (no source)</div>';
    });
  }

  dash.appendChild(grid);
  screen.appendChild(dash);

  // Stagger-reveal quadrants
  if (typeof JX2 !== 'undefined') {
    JX2.staggerReveal(grid.querySelectorAll('.jx2-dash-quadrant'), 60);
  }

  // Periodic refresh (vitals every 30s, others every 60s)
  _dashInterval = setInterval(() => {
    _refreshVitals().catch(() => {});
    _refreshStatus(statusChip).catch(() => {});
    const councilBody = document.querySelector('#dash-q-council .jx2-dash-quadrant__body');
    if (councilBody) _refreshAgents(councilBody).catch(() => {});
    const workBody = document.querySelector('#dash-q-work .jx2-dash-quadrant__body');
    if (workBody) _refreshTodayWork(workBody).catch(() => {});
  }, 30_000);
}

/** Unmount the dashboard — called when a chat is selected. */
function unmountDashboard() {
  const dash = document.getElementById('jx2-dashboard');
  if (dash) {
    if (dash._clockId) clearInterval(dash._clockId);
    dash.remove();
  }
  if (_dashInterval) { clearInterval(_dashInterval); _dashInterval = null; }
  const screen = document.getElementById('welcome-screen');
  if (screen) screen.classList.remove('jx2-dash-active');
  _dashMounted = false;
}

export { mountDashboard, unmountDashboard };
