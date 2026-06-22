// dashboard.js — Cerberus post-login landing screen
// Nexus HUD Stage 2 — Variant B "Bold" implementation.
// All colours via CSS custom properties — theme-reactive by construction.
// No hardcoded hex values; all colors derive from --jx2-* and --red tokens.

const PANEL_ID = 'cerberus-dashboard';
let _rafId = null, _vitalsTimer = null, _agentsTimer = null;

// Read the current brand-red rgb triple from the theme token.
function _getRgb() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#c0392b';
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c);
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [192,57,43];
}

export function open() {
  if (document.getElementById(PANEL_ID)) return;
  _buildPanel();
  _startBgAnimation();
  _loadData();
}

export function close() {
  _cleanup();
  const el = document.getElementById(PANEL_ID);
  if (el) { el.classList.add('dash-leaving'); setTimeout(() => el.remove(), 320); }
}

export function toggle() { document.getElementById(PANEL_ID) ? close() : open(); }

function _buildPanel() {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'main');
  panel.setAttribute('aria-label', 'Dashboard');
  panel.innerHTML = `
    <canvas id="dash-bg-canvas" aria-hidden="true"></canvas>
    <div class="dash-inner">

      <!-- ── HUD header ───────────────────────────────────────── -->
      <header class="dash-header">
        <div class="dash-hud-wm" aria-label="Cerberus">
          <span class="dash-bracket">[</span><span class="dash-lead">C</span>ERBERUS<span class="dash-bracket">]</span>
        </div>
        <span class="dash-wm-sub">DASHBOARD</span>
        <div class="dash-hud-chips">
          <div class="dash-hud-chip">
            <span class="dash-chip-dot dash-chip-dot--online"></span>
            <span id="dash-status-text">ONLINE</span>
          </div>
          <div class="dash-hud-chip">
            <span class="dash-chip-dot dash-chip-dot--agents"></span>
            <span id="dash-cnt-agents">—</span>&thinsp;AGENTS
          </div>
          <div class="dash-hud-chip">
            <span class="dash-chip-dot dash-chip-dot--auth"></span>AUTH
          </div>
        </div>
        <div class="dash-hdr-spacer"></div>
        <div class="dash-clock" id="dash-clock"></div>
        <button class="dash-close-btn" id="dash-close" title="Settings" aria-label="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>SETTINGS</span>
        </button>
      </header>

      <div class="dash-body">

        <!-- ── Lifetime stats strip (chips: sessions / messages / tokens) ── -->
        <div class="dash-stats-strip" aria-label="Lifetime stats">
          <span class="dash-stats-title">LIFETIME STATS</span>
          <div class="dash-stat-chips">
            <div class="dash-stat-chip">
              <span class="dash-stat-chip-lbl">// SESSIONS</span>
              <span class="dash-stat-chip-val" id="dash-life-sessions">—</span>
            </div>
            <div class="dash-stat-chip">
              <span class="dash-stat-chip-lbl">// MESSAGES</span>
              <span class="dash-stat-chip-val" id="dash-life-messages">—</span>
            </div>
            <div class="dash-stat-chip">
              <span class="dash-stat-chip-lbl">// TOKENS</span>
              <span class="dash-stat-chip-val" id="dash-life-tokens">—</span>
            </div>
          </div>
        </div>

        <!-- ── Security posture strip (rendered from /api/health) ───────── -->
        <div class="dash-security-strip" aria-label="Security posture">
          <span class="dash-stats-title">SECURITY POSTURE</span>
          <div class="dash-security-items" id="dash-security-items">
            <span class="dash-empty">—</span>
          </div>
        </div>

        <!-- ── Hero counters ─────────────────────────────────── -->
        <div class="dash-hero-row">
          <div class="dash-hero-stat" data-hero="sessions">
            <div class="dash-hero-num" id="dash-cnt-sessions" aria-live="polite">—</div>
            <div class="dash-hero-label">TOTAL SESSIONS</div>
            <div class="dash-hero-sub" id="dash-datetime"></div>
            <div class="dash-hero-delta">
              <span class="dash-delta-val" id="dash-hero-today">—</span>
              <span class="dash-delta-lbl">TODAY</span>
            </div>
          </div>
          <div class="dash-hero-divider" aria-hidden="true"></div>
          <div class="dash-hero-stat" data-hero="tokens">
            <div class="dash-hero-num dash-hero-num--tok" id="dash-usage-total" aria-live="polite">—</div>
            <div class="dash-hero-label">TOTAL TOKENS</div>
            <div class="dash-hero-sub" id="dash-token-cost">—</div>
            <div class="dash-hero-delta">
              <span class="dash-delta-val dash-delta-val--tok" id="dash-hero-tokens-today">—</span>
              <span class="dash-delta-lbl">TODAY</span>
            </div>
          </div>
        </div>

        <!-- ── Token flow graph band ─────────────────────────── -->
        <div class="dash-graph-band">
          <div class="dash-graph-header">
            <span class="dash-section-title">TOKEN FLOW · LAST 24H</span>
            <div class="dash-graph-meta" id="dash-graph-meta" aria-hidden="true">
              <span>PEAK&thinsp;<span id="dash-graph-peak">—</span></span>
              <span>AVG&thinsp;<span id="dash-graph-avg">—</span></span>
            </div>
          </div>
          <div class="dash-graph-wrap">
            <canvas id="dash-usage-canvas" aria-label="Token usage graph" role="img"></canvas>
          </div>
          <div class="dash-graph-axis" aria-hidden="true">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
          </div>
        </div>

        <!-- ── Activity heatmap (5 weeks × 7 days) ─────────────── -->
        <div class="dash-heatmap-band" id="dash-heatmap-band">
          <div class="dash-heatmap-head">
            <span class="dash-section-title">ACTIVITY · LAST 30 DAYS</span>
            <div class="dash-heatmap-chips" id="dash-heatmap-chips" aria-live="polite">
              <span class="dash-heatmap-chip" id="dash-heatmap-streak">🔥&thinsp;—</span>
              <span class="dash-heatmap-chip" id="dash-heatmap-total">⚡&thinsp;—</span>
            </div>
          </div>
          <div class="dash-heatmap-grid" id="dash-heatmap-grid" role="img"
               aria-label="Daily message activity, last 30 days">
            <div class="dash-empty">Loading…</div>
          </div>
        </div>

        <!-- ── Lower: activity + vitals ─────────────────────── -->
        <div class="dash-lower">

          <div class="dash-lower-activity">
            <div class="dash-activity-head">
              <div class="dash-section-title">RECENT ACTIVITY</div>
              <input type="search" id="dash-session-search" class="dash-session-search"
                     placeholder="Filter…" aria-label="Filter sessions by title"
                     autocomplete="off" spellcheck="false" />
            </div>
            <div id="dash-sessions-list" class="dash-activity-list">
              <div class="dash-empty">Loading…</div>
            </div>
          </div>

          <div class="dash-lower-vitals">
            <div class="dash-section-title">SYSTEM VITALS</div>
            <div class="dash-vitals-grid" id="dash-vitals-grid">
              ${['CPU','RAM','DISK','LAT'].map(k => `
                <div class="dash-vital-item">
                  <div class="dash-vital-bar-wrap">
                    <div class="dash-vital-bar" id="dash-bar-${k.toLowerCase()}"
                         data-metric="${k.toLowerCase()}" style="width:0%"></div>
                  </div>
                  <div class="dash-vital-row">
                    <span class="dash-vital-lbl">${k}</span>
                    <span class="dash-vital-val" id="dash-val-${k.toLowerCase()}">—</span>
                  </div>
                </div>`).join('')}
            </div>
          </div>

        </div>

        <!-- ── Quick access ──────────────────────────────────── -->
        <div class="dash-actions-panel">
          <div class="dash-section-title">QUICK ACCESS</div>
          <div class="dash-actions-grid">
            <button class="dash-action-btn dash-action-primary" id="dash-act-chat">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>NEW CHAT</span>
            </button>
            <button class="dash-action-btn dash-action-nexus" id="dash-act-nexus">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span>NEXUS</span>
            </button>
            <button class="dash-action-btn dash-action-cerberus" id="dash-act-cerberus">
              <svg width="13" height="15" viewBox="0 0 100 115" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round" aria-hidden="true"><path d="M50 5 L8 22 L8 55 C8 78 26 100 50 110 C74 100 92 78 92 55 L92 22 Z"/><path d="M30 70 C30 54 40 46 50 46 C60 46 70 54 70 70" stroke-width="5" opacity="0.8"/></svg>
              <span>CERBERUS</span>
            </button>
            <button class="dash-action-btn" id="dash-act-cc">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              <span>COMMAND CENTER</span>
            </button>
            <button class="dash-action-btn" id="dash-act-notes">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span>NOTES</span>
            </button>
            <button class="dash-action-btn" id="dash-act-tasks">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>TASKS</span>
            </button>
            <button class="dash-action-btn" id="dash-act-theme">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none"/>
              </svg>
              <span>THEME</span>
            </button>
          </div>
        </div>

        <!-- Hidden: agents list loaded by _loadAgents (count shown in chip) -->
        <div id="dash-agents-list" style="display:none" aria-hidden="true"></div>
        <!-- Hidden: kept for compat with any external code referencing these IDs -->
        <span id="dash-cnt-status"  style="display:none"></span>
        <span id="dash-act-total"   style="display:none"></span>
        <canvas id="dash-act-canvas" style="display:none" aria-hidden="true"></canvas>

      </div>
    </div>
  `.trim();

  document.body.appendChild(panel);

  function _go(action) {
    _cleanup();
    document.getElementById(PANEL_ID)?.remove();
    action?.();
  }

  panel.querySelector('#dash-close')?.addEventListener('click', () => {
    import('./cerberusShellModals.js').then(m => m.openShellModal('settings'));
  });
  panel.querySelector('#dash-act-notes')?.addEventListener('click', () => {
    import('./cerberusOverlayTools.js').then(async (m) => {
      await m.default.openOverlayTool('notes');
      const el = document.getElementById('notes-pane-backdrop') || document.getElementById('notes-pane');
      if (el) el.style.zIndex = '5000';
    });
  });
  panel.querySelector('#dash-act-tasks')?.addEventListener('click', () => {
    import('./cerberusShellModals.js').then(m => m.openShellModal('tasks'));
  });
  panel.querySelector('#dash-act-theme')?.addEventListener('click', () => {
    const modal = document.getElementById('theme-modal');
    if (!modal) return;
    const portal = document.getElementById('cerberus-modal-portal');
    if (portal && modal.parentElement !== portal) portal.appendChild(modal);
    modal.classList.remove('hidden');
  });
  panel.querySelector('#dash-act-chat')?.addEventListener('click', () => _go(() => {
    document.dispatchEvent(new CustomEvent('cerberus:new-session'));
    document.getElementById('rail-new-session')?.click();
  }));
  panel.querySelector('#dash-act-nexus')?.addEventListener('click', () => _go(() => {
    sessionStorage.setItem('cerberus_skip_modal_restore', '1');
    window.location.href = '/home';
  }));
  panel.querySelector('#dash-act-cerberus')?.addEventListener('click', () => {
    _cleanup();
    document.getElementById(PANEL_ID)?.remove();
  });
  panel.querySelector('#dash-act-cc')?.addEventListener('click', () => _go(() => {
    window.history.replaceState({}, '', '/');
    document.getElementById('sidebar-command-center-btn')?.click();
  }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });
  _tickClock(panel);
  _tickDatetime(panel);
}

function _tickClock(panel) {
  const el = panel.querySelector('#dash-clock');
  if (!el) return;
  const tick = () => {
    if (!document.getElementById(PANEL_ID)) return;
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    requestAnimationFrame(() => setTimeout(tick, 1000));
  };
  tick();
}

function _tickDatetime(panel) {
  const el = panel.querySelector('#dash-datetime');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
}

// ── Background ambient animation (not the globe — canvas glow only) ────────

function _startBgAnimation() {
  const canvas = document.getElementById('dash-bg-canvas');
  if (!canvas || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H, t = 0;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : { r:192, g:57, b:43 };
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }
  function getAccent() { return getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#c0392b'; }

  function frame() {
    if (!document.getElementById(PANEL_ID)) { window.removeEventListener('resize', resize); return; }
    if (document.hidden) { _rafId = requestAnimationFrame(frame); return; }
    _rafId = requestAnimationFrame(frame);
    t += 0.006;
    ctx.clearRect(0, 0, W, H);
    const c = getAccent();
    for (let i = 0; i < 3; i++) {
      const phase = (i / 3) * Math.PI * 2;
      const cy = H * 0.4 + Math.sin(t + phase) * H * 0.14;
      const grad = ctx.createRadialGradient(W * 0.5, cy, 0, W * 0.5, cy, W * 0.45);
      grad.addColorStop(0, rgba(c, 0.028));
      grad.addColorStop(0.5, rgba(c, 0.008));
      grad.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }
  frame();
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _loadData() {
  _wireSessionSearch();
  await Promise.all([
    _loadSessions(),
    _loadVitals(),
    _loadAgents(),
    _loadTokenUsage(),
    _loadSecurity(),
    _loadActivity(),
  ]);
  _vitalsTimer = setInterval(_loadVitals, 8000);
  _agentsTimer = setInterval(_loadAgents, 12000);
}

// ── Activity heatmap ─────────────────────────────────────────────────────────
//
// 5 weeks × 7 days = 35 cells (the API returns 30 days; the leading 5 cells
// stay blank/inactive so the grid always looks like a tidy week-aligned block).
// Colours are read from CSS tokens via getComputedStyle so the swatch reacts to
// theme switches without a re-render.

async function _loadActivity() {
  const grid    = document.getElementById('dash-heatmap-grid');
  const streakEl = document.getElementById('dash-heatmap-streak');
  const totalEl  = document.getElementById('dash-heatmap-total');
  if (!grid) return;
  let data;
  try {
    const res = await fetch('/api/stats/activity?days=30', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (_) {
    grid.innerHTML = '<span class="dash-empty">// no activity data</span>';
    if (streakEl) streakEl.textContent = '🔥 —';
    if (totalEl)  totalEl.textContent  = '⚡ —';
    return;
  }
  const days = Array.isArray(data?.days) ? data.days : [];
  if (!days.length) {
    grid.innerHTML = '<span class="dash-empty">// no activity data</span>';
    return;
  }
  if (streakEl) streakEl.textContent = `🔥 ${data.current_streak || 0} day streak`;
  if (totalEl)  totalEl.textContent  = `⚡ ${data.total_messages || 0} messages`;
  grid.innerHTML = _heatmapSVG(days);
}

function _heatmapSVG(days) {
  // Layout: 5 columns × 7 rows, 12×12 cell, 2px gap.
  const COLS = 5, ROWS = 7, CELL = 12, GAP = 2;
  const W = COLS * (CELL + GAP) - GAP;
  const H = ROWS * (CELL + GAP) - GAP;

  // Read theme-reactive colours so cells repaint correctly after a theme swap.
  const style = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) =>
    (style.getPropertyValue(name).trim() || fallback);
  const COLD     = cssVar('--surface-raise', 'rgba(255,255,255,0.04)');
  const BORDER   = cssVar('--border',        'rgba(255,255,255,0.08)');
  const RED      = cssVar('--red',           '#c0392b');

  // Right-align so today lands at the bottom-right cell.
  const total = COLS * ROWS;
  const leading = Math.max(0, total - days.length);

  const cells = [];
  for (let i = 0; i < total; i++) {
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    const x = col * (CELL + GAP);
    const y = row * (CELL + GAP);
    const idx = i - leading;
    const entry = idx >= 0 ? days[idx] : null;
    const messages = entry ? entry.messages : 0;
    const fill = entry ? _heatColor(RED, COLD, messages) : COLD;
    const title = entry ? _heatTitle(entry) : '';
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2" `
      + `fill="${_esc(fill)}" stroke="${_esc(BORDER)}" stroke-width="0.5">`
      + (title ? `<title>${_esc(title)}</title>` : '')
      + `</rect>`
    );
  }
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
    + `xmlns="http://www.w3.org/2000/svg" class="dash-heatmap-svg">${cells.join('')}</svg>`;
}

function _heatColor(red, cold, messages) {
  if (!messages) return cold;
  // Token red can be hex or rgb(...); use opacity via color-mix when supported,
  // fall back to per-bucket interpolation against the cold token.
  if (messages >= 10) return red;
  if (messages >= 4)  return `color-mix(in srgb, ${red} 60%, ${cold})`;
  return `color-mix(in srgb, ${red} 30%, ${cold})`;
}

function _heatTitle(entry) {
  // entry.date is ISO `YYYY-MM-DD`. Treat as UTC so the rendered date matches
  // what the backend bucketed it under, then format short for the tooltip.
  let label = entry.date;
  try {
    const d = new Date(entry.date + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime())) {
      label = d.toLocaleDateString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short',
      });
    }
  } catch (_) { /* keep ISO fallback */ }
  const n = entry.messages || 0;
  return `${label} — ${n} message${n === 1 ? '' : 's'}`;
}

async function _loadSessions() {
  const el = document.getElementById('dash-sessions-list');
  if (!el) return;
  try {
    const res = await fetch('/api/sessions?limit=1000', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const sessions = Array.isArray(data) ? data : (data.sessions || []);

    // Hero counter — total count with dramatic tick-up
    _heroCountUp('dash-cnt-sessions', sessions.length);

    // Lifetime stats strip — sessions + messages (sum from per-session message_count)
    const lifeSessionsEl = document.getElementById('dash-life-sessions');
    if (lifeSessionsEl) lifeSessionsEl.textContent = _fmtSI(sessions.length);
    const lifeMessagesEl = document.getElementById('dash-life-messages');
    if (lifeMessagesEl) {
      // TODO: switch to a dedicated /api/stats endpoint when one exists.
      const totalMessages = sessions.reduce((sum, s) => sum + (s.message_count || 0), 0);
      lifeMessagesEl.textContent = totalMessages > 0 ? _fmtSI(totalMessages) : '—';
    }

    // Today delta — sessions created or updated today
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayCount = sessions.filter(s => {
      const d = new Date(s.created_at || s.updated_at || 0);
      return d >= todayStart;
    }).length;
    const todayEl = document.getElementById('dash-hero-today');
    if (todayEl) todayEl.textContent = todayCount > 0 ? `+${todayCount}` : '—';

    if (!sessions.length) {
      el.innerHTML = `<div class="dash-empty dash-first-run">
        <div class="dash-empty-icon">◈</div>
        <div class="dash-empty-msg">No conversations yet.</div>
        <button class="dash-cta-btn" id="dash-cta-first-chat">Start your first chat →</button>
      </div>`;
      el.querySelector('#dash-cta-first-chat')?.addEventListener('click', () => {
        close();
        document.dispatchEvent(new CustomEvent('cerberus:new-session'));
        setTimeout(() => document.getElementById('rail-new-session')?.click(), 100);
      });
      return;
    }

    // Render as activity feed (most recent first)
    const recent = sessions.slice(0, 8);
    el.innerHTML = recent.map((s, i) => {
      const title = s.title || s.name || 'Untitled Session';
      const time  = s.updated_at || s.created_at || '';
      const rel   = time ? _relTime(time) : '';
      return `<button class="dash-activity-item" data-id="${s.id || ''}" data-title="${_esc(title).toLowerCase()}" title="${_esc(title)}"
                      style="animation-delay:${i * 55}ms">
        <span class="dash-activity-dot"></span>
        <span class="dash-activity-title">${_esc(title)}</span>
        ${rel ? `<span class="dash-activity-time">${rel}</span>` : ''}
      </button>`;
    }).join('');
    // Reapply active filter (if user typed before sessions finished loading)
    _applySessionSearch();

    el.querySelectorAll('.dash-activity-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        close();
        if (id && window.sessionModule?.loadSession) {
          setTimeout(() => window.sessionModule.loadSession(id), 120);
        }
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="dash-empty">Could not load sessions.</div>';
  }
}

async function _loadVitals() {
  try {
    const res = await fetch('/api/cyberapps/operations/vitals', { credentials: 'same-origin' });
    if (!res.ok) return;
    const v = await res.json();
    _setVital('cpu',  v.cpu_percent  ?? -1, '%');
    _setVital('ram',  v.ram_percent  ?? -1, '%');
    _setVital('disk', v.disk_percent ?? -1, '%');
    _setVital('lat',  v.latency_ms   ?? -1, 'ms');
    const status = document.getElementById('dash-status-text');
    const cpu = v.cpu_percent ?? 0;
    if (status) {
      status.textContent = cpu > 85 ? 'HIGH LOAD' : cpu > 60 ? 'ACTIVE' : 'ONLINE';
      status.dataset.level = cpu > 85 ? 'warn' : 'ok';
    }
    // Compat — update hidden status counter
    const cntStatus = document.getElementById('dash-cnt-status');
    if (cntStatus) cntStatus.textContent = cpu > 85 ? 'HIGH' : cpu > 60 ? 'BUSY' : 'IDLE';
  } catch (_) {}
}

async function _loadAgents() {
  const listEl = document.getElementById('dash-agents-list');
  try {
    const [opsRes, rosterRes] = await Promise.all([
      fetch('/api/cyberapps/operations/agents', { credentials: 'same-origin' }),
      fetch('/api/agents', { credentials: 'same-origin' }).catch(() => null),
    ]);
    if (!opsRes.ok) throw new Error(opsRes.status);
    const data = await opsRes.json();
    const agents = data.agents || [];
    if (rosterRes?.ok) {
      const rd = await rosterRes.json();
      const cnt = (rd.agents || (Array.isArray(rd) ? rd : [])).length;
      _animCounter('dash-cnt-agents', cnt);
    } else {
      _animCounter('dash-cnt-agents', agents.length);
    }
    // Populate hidden list for compat (not visible in Variant B layout)
    if (listEl) {
      listEl.innerHTML = agents.length
        ? agents.slice(0, 6).map(a => {
            const s = a.status || 'idle';
            return `<div class="dash-agent-row">
              <span class="dash-agent-dot dash-agent-dot--${s}"></span>
              <span class="dash-agent-name">${_esc(a.name || a.id || 'Agent')}</span>
              <span class="dash-agent-status">${_esc(s).toUpperCase()}</span>
            </div>`;
          }).join('')
        : '<div class="dash-empty">No active agents.</div>';
    }
  } catch (_) {
    if (listEl) listEl.innerHTML = '<div class="dash-empty">Agents unavailable.</div>';
  }
}

async function _loadTokenUsage() {
  const totalEl  = document.getElementById('dash-usage-total');
  const canvas   = document.getElementById('dash-usage-canvas');
  try {
    const res = await fetch('/api/usage/tokens', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data  = await res.json();
    const total = data.total_tokens ?? 0;
    const cost  = data.cost_usd  ?? 0;

    // Hero token counter — full number with comma formatting
    if (totalEl) _heroCountUp('dash-usage-total', total);

    // Lifetime stats strip — compact total
    const lifeTokensEl = document.getElementById('dash-life-tokens');
    if (lifeTokensEl) lifeTokensEl.textContent = total > 0 ? _fmtSI(total) : '—';

    // Cost sub-line
    const costEl = document.getElementById('dash-token-cost');
    if (costEl) costEl.textContent = cost > 0 ? `$${cost.toFixed(4)} COST` : 'LOCAL ENDPOINTS';

    // Today's tokens from daily breakdown
    const todayStr = new Date().toISOString().slice(0, 10);
    const byDay    = data.by_day ?? [];
    const todayRec = byDay.find(d => d.date === todayStr);
    const tokToday = todayRec?.tokens ?? 0;
    const tokTodayEl = document.getElementById('dash-hero-tokens-today');
    if (tokTodayEl) tokTodayEl.textContent = tokToday > 0 ? _fmtSI(tokToday) : '—';

    // Graph meta
    if (byDay.length) {
      const vals   = byDay.map(d => d.tokens || 0);
      const peak   = Math.max(...vals);
      const avg    = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      const peakEl = document.getElementById('dash-graph-peak');
      const avgEl  = document.getElementById('dash-graph-avg');
      if (peakEl) peakEl.textContent = _fmtSI(peak);
      if (avgEl)  avgEl.textContent  = _fmtSI(avg);
    }

    if (canvas) _drawTokenFlowGraph(canvas, byDay);
  } catch (_) {
    if (totalEl) totalEl.textContent = '—';
    const lifeTokensEl = document.getElementById('dash-life-tokens');
    if (lifeTokensEl) lifeTokensEl.textContent = '—';
    const canvas2 = document.getElementById('dash-usage-canvas');
    if (canvas2) _drawTokenFlowGraph(canvas2, []); // graceful: fallback sine wave
  }
}

// ── Security posture strip ───────────────────────────────────────────────────
// Renders ONLY fields actually present in the /api/health response so the strip
// stays honest if the backend payload is later extended. Currently /api/health
// returns { status, timestamp } — additional keys (auth, sandbox, gateway) are
// picked up automatically once exposed.

const SECURITY_FIELD_LABELS = {
  status:    'STATUS',
  auth:      'AUTH',
  sandbox:   'SANDBOX',
  gateway:   'GATEWAY',
};

function _securityTone(val) {
  const s = String(val ?? '').toLowerCase();
  if (['healthy', 'ok', 'on', 'ready', 'connected', 'active', 'true'].includes(s)) return 'ok';
  if (['off', 'down', 'offline', 'unavailable', 'disconnected', 'error', 'false'].includes(s)) return 'bad';
  return 'unk';
}

function _renderSecurityItems(host, fields) {
  const entries = Object.entries(fields).filter(([k]) => k !== 'timestamp');
  if (!entries.length) { host.innerHTML = '<span class="dash-empty">—</span>'; return; }
  host.innerHTML = entries.map(([k, v]) => {
    const label = SECURITY_FIELD_LABELS[k] || k.toUpperCase();
    const tone  = _securityTone(v);
    const txt   = String(v ?? '—').toUpperCase();
    return `<span class="dash-security-item" data-tone="${tone}">
      <span class="dash-security-lbl">${_esc(label)}</span>
      <span class="dash-security-val">${_esc(txt)}</span>
    </span>`;
  }).join('');
}

async function _loadSecurity() {
  const host = document.getElementById('dash-security-items');
  if (!host) return;
  try {
    const res = await fetch('/api/health', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!data || typeof data !== 'object') {
      _renderSecurityItems(host, { status: 'unknown' });
      return;
    }
    _renderSecurityItems(host, data);
  } catch (_) {
    _renderSecurityItems(host, { status: 'offline' });
  }
}

// ── Session search ──────────────────────────────────────────────────────────
// Client-side filter over the already-loaded session list. Empty input restores
// every row; no new API calls.

function _wireSessionSearch() {
  const input = document.getElementById('dash-session-search');
  if (!input || input.dataset.wired === '1') return;
  input.dataset.wired = '1';
  input.addEventListener('input', _applySessionSearch);
}

function _applySessionSearch() {
  const input = document.getElementById('dash-session-search');
  const list  = document.getElementById('dash-sessions-list');
  if (!input || !list) return;
  const q = (input.value || '').trim().toLowerCase();
  let hidden = 0, shown = 0;
  list.querySelectorAll('.dash-activity-item').forEach(btn => {
    const t = btn.dataset.title || btn.textContent.toLowerCase();
    const match = !q || t.includes(q);
    btn.classList.toggle('dash-activity-item--hidden', !match);
    if (match) shown++; else hidden++;
  });
  let emptyHint = list.querySelector('.dash-search-empty');
  if (q && shown === 0 && hidden > 0) {
    if (!emptyHint) {
      emptyHint = document.createElement('div');
      emptyHint.className = 'dash-empty dash-search-empty';
      emptyHint.textContent = 'No sessions match.';
      list.appendChild(emptyHint);
    }
  } else if (emptyHint) {
    emptyHint.remove();
  }
}

// ── Animations ────────────────────────────────────────────────────────────────

// Hero counter — large numbers, dramatic ease-out, full comma formatting.
function _heroCountUp(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toLocaleString();
    return;
  }
  const dur = 2000;
  const t0  = performance.now();
  function step(now) {
    if (document.hidden) { requestAnimationFrame(step); return; }
    const p = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 4); // strong ease-out
    el.textContent = Math.round(target * e).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Compact counter — smaller numbers (agent count chip), fast.
function _animCounter(id, to, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  const from  = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
  const dur   = 600;
  const start = performance.now();
  const tick  = (now) => {
    const t     = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased) + (suffix || '');
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Token flow graph — draws in from left on load, respects tab visibility.
function _drawTokenFlowGraph(canvas, byDay) {
  if (!canvas) return;
  // Defer one rAF to guarantee flex layout has been measured
  requestAnimationFrame(() => _drawTokenFlowGraphImmediate(canvas, byDay));
}

function _drawTokenFlowGraphImmediate(canvas, byDay) {
  if (!canvas || !document.getElementById(PANEL_ID)) return;
  // Graceful fallback when no data: a flat low-activity reference baseline
  const raw = (byDay.length >= 2)
    ? byDay.slice(-30).map(d => d.tokens || 0)
    : Array.from({length: 24}, (_, i) => Math.round(800 + Math.sin(i * 0.55) * 400 + i * 12));

  const parent = canvas.parentElement;
  // getBoundingClientRect is reliable inside overflow/flex; clientWidth can be 0 before first paint
  const rect = parent?.getBoundingClientRect();
  const W    = (rect && rect.width > 10 ? rect.width : parent?.clientWidth || 900);
  const H    = 130;
  const dpr  = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx  = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const [r, g, b] = _getRgb();
  const max  = Math.max(...raw, 1);
  const days = raw.length;
  const pad  = { t: 12, b: 6, l: 2, r: 2 };
  const iW   = W - pad.l - pad.r;
  const iH   = H - pad.t - pad.b;

  const pts = raw.map((v, i) => [
    pad.l + (i / Math.max(days - 1, 1)) * iW,
    pad.t + (1 - v / max) * iH,
  ]);

  function drawGrid() {
    ctx.strokeStyle = `rgba(${r},${g},${b},0.04)`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = pad.t + (iH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }
    for (let i = Math.ceil(days / 6); i < days; i += Math.ceil(days / 6)) {
      const x = pad.l + (i / Math.max(days - 1, 1)) * iW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    }
  }

  function renderFrame(progress) {
    ctx.clearRect(0, 0, W, H);
    drawGrid();

    const tX  = pts[0][0] + (pts[pts.length - 1][0] - pts[0][0]) * progress;
    const vis = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i][0] <= tX) { vis.push(pts[i]); }
      else {
        if (i > 0) {
          const pr = pts[i - 1], t2 = (tX - pr[0]) / (pts[i][0] - pr[0]);
          vis.push([tX, pr[1] + (pts[i][1] - pr[1]) * t2]);
        }
        break;
      }
    }
    if (vis.length < 2) return;
    const last = vis[vis.length - 1];

    // Area gradient
    ctx.beginPath();
    ctx.moveTo(vis[0][0], H - pad.b);
    vis.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(last[0], H - pad.b);
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, pad.t, 0, H);
    grd.addColorStop(0,   `rgba(${r},${g},${b},0.22)`);
    grd.addColorStop(0.65,`rgba(${r},${g},${b},0.05)`);
    grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd;
    ctx.fill();

    // Line — two passes: outer glow + crisp stroke
    for (const [lw, alpha] of [[6, 0.07], [1.5, 1]]) {
      ctx.beginPath();
      vis.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.lineWidth   = lw;
      ctx.lineJoin    = 'round';
      ctx.stroke();
    }

    // Head dot
    if (progress > 0.02) {
      ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(last[0], last[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    renderFrame(1);
    return;
  }

  const dur = 1600, t0 = performance.now();
  function animate(now) {
    if (!document.getElementById(PANEL_ID)) return;
    if (document.hidden) { requestAnimationFrame(animate); return; }
    const p = Math.min((now - t0) / dur, 1);
    renderFrame(1 - Math.pow(1 - p, 2.5));
    if (p < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ── Vitals ────────────────────────────────────────────────────────────────────

function _setVital(key, val, unit) {
  const bar = document.getElementById(`dash-bar-${key}`);
  const txt = document.getElementById(`dash-val-${key}`);
  if (!txt) return;
  if (val < 0) { txt.textContent = '—'; return; }
  const pct = key === 'lat' ? Math.min(100, val / 3) : Math.min(100, val);
  if (bar) bar.style.width = pct + '%';
  txt.textContent = Math.round(val) + unit;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function _cleanup() {
  if (_rafId)       { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_vitalsTimer) { clearInterval(_vitalsTimer); _vitalsTimer = null; }
  if (_agentsTimer) { clearInterval(_agentsTimer); _agentsTimer = null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtSI(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _relTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)  return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  } catch (_) { return ''; }
}

// Expose for inline onclick and external callers
window.dashModule = { open, close, toggle };
