// dashboard.js — Cerberus post-login landing screen
// All colours via CSS custom properties — theme-reactive by construction.

const PANEL_ID = 'cerberus-dashboard';
let _rafId = null, _vitalsTimer = null, _agentsTimer = null, _usageRaf = null;

function _getRgb() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#c0392b';
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c);
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [192,57,43];
}

export function open() {
  if (document.getElementById(PANEL_ID)) return;
  _buildPanel();
  _startGlobeAnimation();
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
      <header class="dash-header">
        <div class="dash-logo">
          <svg width="22" height="26" viewBox="0 0 100 115" fill="none">
            <path d="M50 5 L8 22 L8 55 C8 78 26 100 50 110 C74 100 92 78 92 55 L92 22 Z"
              stroke="var(--red,#c0392b)" stroke-width="4" fill="none" stroke-linejoin="round"/>
            <path d="M30 70 C30 54 40 46 50 46 C60 46 70 54 70 70"
              stroke="var(--red,#c0392b)" stroke-width="2" fill="none" opacity="0.7"/>
          </svg>
        </div>
        <div class="dash-identity">
          <span class="dash-product">CERBERUS</span>
          <span class="dash-status" id="dash-status-text">ONLINE</span>
        </div>
        <div class="dash-clock" id="dash-clock"></div>
        <button class="dash-close-btn" id="dash-close" title="Settings" aria-label="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>SETTINGS</span>
        </button>
      </header>

      <div class="dash-grid">
        <!-- Hero: Globe + greeting -->
        <div class="dash-card dash-hero">
          <div class="dash-globe-stage">
            <div class="dash-globe-wrap" id="dash-globe-body">
              <div class="dash-globe-halo"></div>
              <div class="dash-globe-sphere">
                <div class="dash-globe-wire">
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
                <div class="dash-globe-particles" aria-hidden="true">
                  <div class="dash-globe-p dash-globe-p1"></div>
                  <div class="dash-globe-p dash-globe-p2"></div>
                  <div class="dash-globe-p dash-globe-p3"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="dash-hero-text">
            <div class="dash-hero-greeting">GUARDIAN ONLINE</div>
            <div class="dash-hero-sub" id="dash-datetime"></div>
            <div class="dash-counters">
              <div class="dash-counter-item">
                <span class="dash-counter-val" id="dash-cnt-sessions">—</span>
                <span class="dash-counter-lbl">SESSIONS</span>
              </div>
              <div class="dash-counter-item">
                <span class="dash-counter-val" id="dash-cnt-agents">—</span>
                <span class="dash-counter-lbl">AGENTS</span>
              </div>
              <div class="dash-counter-item">
                <span class="dash-counter-val" id="dash-cnt-status">—</span>
                <span class="dash-counter-lbl">STATUS</span>
              </div>
            </div>
          </div>
        </div>

        <!-- System vitals -->
        <div class="dash-card dash-vitals">
          <div class="dash-card-title">SYSTEM VITALS</div>
          <div class="dash-vitals-grid" id="dash-vitals-grid">
            ${['CPU','RAM','DISK','LAT'].map(k => `
              <div class="dash-vital-item">
                <div class="dash-vital-bar-wrap">
                  <div class="dash-vital-bar" id="dash-bar-${k.toLowerCase()}" style="width:0%"></div>
                </div>
                <div class="dash-vital-row">
                  <span class="dash-vital-lbl">${k}</span>
                  <span class="dash-vital-val" id="dash-val-${k.toLowerCase()}">—</span>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Recent sessions -->
        <div class="dash-card dash-sessions">
          <div class="dash-card-title">RECENT SESSIONS</div>
          <div id="dash-sessions-list" class="dash-sessions-list">
            <div class="dash-empty">Loading…</div>
          </div>
        </div>

        <!-- Active agents -->
        <div class="dash-card dash-agents">
          <div class="dash-card-title">ACTIVE AGENTS</div>
          <div id="dash-agents-list" class="dash-agents-list">
            <div class="dash-empty">Loading…</div>
          </div>
        </div>

        <!-- Token usage — mock until /api/usage/tokens exists (FLAG 1) -->
        <div class="dash-card dash-usage">
          <div class="dash-card-title">TOKEN USAGE <span class="dash-mock-badge">PREVIEW</span></div>
          <canvas id="dash-usage-canvas" aria-label="Token usage chart" role="img"></canvas>
          <div class="dash-usage-foot">
            <span id="dash-usage-total">—</span>
            <span class="dash-usage-period">THIS MONTH</span>
          </div>
        </div>

        <!-- Quick actions -->
        <div class="dash-card dash-actions">
          <div class="dash-card-title">QUICK ACCESS</div>
          <div class="dash-actions-grid">
            <button class="dash-action-btn dash-action-primary" id="dash-act-chat">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>NEW CHAT</span>
            </button>
            <button class="dash-action-btn dash-action-nexus" id="dash-act-nexus">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              <span>NEXUS</span>
            </button>
            <button class="dash-action-btn dash-action-cerberus" id="dash-act-cerberus">
              <svg width="13" height="15" viewBox="0 0 100 115" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"><path d="M50 5 L8 22 L8 55 C8 78 26 100 50 110 C74 100 92 78 92 55 L92 22 Z"/><path d="M30 70 C30 54 40 46 50 46 C60 46 70 54 70 70" stroke-width="5" opacity="0.8"/></svg>
              <span>CERBERUS</span>
            </button>
            <button class="dash-action-btn" id="dash-act-cc">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              <span>COMMAND CENTER</span>
            </button>
            <button class="dash-action-btn" id="dash-act-notes">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span>NOTES</span>
            </button>
            <button class="dash-action-btn" id="dash-act-tasks">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>TASKS</span>
            </button>
          </div>
        </div>

        <!-- Session activity -->
        <div class="dash-card dash-activity">
          <div class="dash-card-title">SESSION ACTIVITY <span class="dash-mock-badge">7D</span></div>
          <canvas id="dash-act-canvas" role="img" aria-label="Session activity past 7 days"></canvas>
          <div class="dash-act-foot">
            <span id="dash-act-total">0</span>
            <span class="dash-usage-period">THIS WEEK</span>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  document.body.appendChild(panel);

  function _go(action) {
    _cleanup();
    document.getElementById(PANEL_ID)?.remove();
    action?.();
  }

  // Settings opens on top of the dashboard (z-index 9999 > dashboard 4500)
  panel.querySelector('#dash-close')?.addEventListener('click', () => import('./settings.js').then(m => m.default.open()));
  // Notes / tasks: open overlay then raise its z-index above dashboard (4500)
  panel.querySelector('#dash-act-notes')?.addEventListener('click', () => {
    import('./cerberusOverlayTools.js').then(async (m) => {
      await m.default.openOverlayTool('notes');
      const el = document.getElementById('notes-pane-backdrop') || document.getElementById('notes-pane');
      if (el) el.style.zIndex = '5000';
    });
  });
  panel.querySelector('#dash-act-tasks')?.addEventListener('click', () => {
    import('./cerberusOverlayTools.js').then(async (m) => {
      await m.default.openOverlayTool('tasks');
      const el = document.getElementById('tasks-modal');
      if (el) el.style.zIndex = '5000';
    });
  });
  // Navigation buttons close dashboard first
  panel.querySelector('#dash-act-chat')?.addEventListener('click', () => _go(() => { window.history.replaceState({}, '', '/'); document.getElementById('rail-new-session')?.click(); }));
  panel.querySelector('#dash-act-nexus')?.addEventListener('click', () => _go(() => { window.location.href = '/home'; }));
  panel.querySelector('#dash-act-cerberus')?.addEventListener('click', () => _go(() => { window.location.href = '/'; }));
  panel.querySelector('#dash-act-cc')?.addEventListener('click', () => _go(() => { window.history.replaceState({}, '', '/'); document.getElementById('sidebar-command-center-btn')?.click(); }));
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

function _startGlobeAnimation() {
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

  function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#c0392b';
  }
  function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : { r: 192, g: 57, b: 43 };
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }

  function frame() {
    if (!document.getElementById(PANEL_ID)) { window.removeEventListener('resize', resize); return; }
    _rafId = requestAnimationFrame(frame);
    t += 0.008;
    ctx.clearRect(0, 0, W, H);
    const c = getAccent();
    for (let i = 0; i < 3; i++) {
      const phase = (i / 3) * Math.PI * 2;
      const cy = H * 0.35 + Math.sin(t + phase) * H * 0.18;
      const grad = ctx.createRadialGradient(W * 0.5, cy, 0, W * 0.5, cy, W * 0.4);
      grad.addColorStop(0, rgba(c, 0.035));
      grad.addColorStop(0.5, rgba(c, 0.012));
      grad.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }
  frame();
}

async function _loadData() {
  await Promise.all([_loadSessions(), _loadVitals(), _loadAgents()]);
  _vitalsTimer = setInterval(_loadVitals, 8000);
  _agentsTimer = setInterval(_loadAgents, 12000);
  _drawUsageChart();
}

async function _loadSessions() {
  const el = document.getElementById('dash-sessions-list');
  if (!el) return;
  try {
    const res = await fetch('/api/sessions?limit=50', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
    _animCounter('dash-cnt-sessions', sessions.length);
    _drawActivityChart(sessions);
    if (!sessions.length) {
      el.innerHTML = `<div class="dash-empty dash-first-run">
        <div class="dash-empty-icon">◈</div>
        <div class="dash-empty-msg">No conversations yet.</div>
        <button class="dash-cta-btn" onclick="(function(){document.getElementById('cerberus-dashboard')&&window.dashModule&&window.dashModule.close();setTimeout(()=>document.getElementById('rail-new-session')?.click(),100)})()">Start your first chat →</button>
      </div>`;
      return;
    }
    el.innerHTML = sessions.slice(0, 6).map(s => {
      const title = s.title || s.name || 'Untitled Session';
      const time  = s.updated_at || s.created_at || '';
      const rel   = time ? _relTime(time) : '';
      return `<button class="dash-session-row" data-id="${s.id || ''}" title="${_esc(title)}">
        <span class="dash-session-title">${_esc(title)}</span>
        ${rel ? `<span class="dash-session-time">${rel}</span>` : ''}
      </button>`;
    }).join('');
    el.querySelectorAll('.dash-session-row').forEach(btn => {
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
    _drawActivityChart([]);
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
    const cntStatus = document.getElementById('dash-cnt-status');
    if (cntStatus) cntStatus.textContent = cpu > 85 ? 'HIGH' : cpu > 60 ? 'BUSY' : 'IDLE';
  } catch (_) {}
}

function _animCounter(id, to, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = parseFloat(el.textContent) || 0;
  const dur = 900;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased) + (suffix || '');
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Agents card ──────────────────────────────────────────────────────

async function _loadAgents() {
  const el = document.getElementById('dash-agents-list');
  if (!el) return;
  try {
    const res = await fetch('/api/cyberapps/operations/agents', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const agents = data.agents || [];
    const cntEl = document.getElementById('dash-cnt-agents');
    if (cntEl) _animCounter('dash-cnt-agents', agents.length);
    if (!agents.length) {
      el.innerHTML = '<div class="dash-empty">No active agents.</div>';
      return;
    }
    el.innerHTML = agents.slice(0, 6).map(a => {
      const status = a.status || 'idle';
      const name = _esc(a.name || a.id || 'Agent');
      return `<div class="dash-agent-row">
        <span class="dash-agent-dot dash-agent-dot--${status}"></span>
        <span class="dash-agent-name">${name}</span>
        <span class="dash-agent-status">${_esc(status).toUpperCase()}</span>
      </div>`;
    }).join('');
  } catch (_) {
    const el2 = document.getElementById('dash-agents-list');
    if (el2) el2.innerHTML = '<div class="dash-empty">Agents unavailable.</div>';
  }
}

function _drawUsageChart() {
  const canvas = document.getElementById('dash-usage-canvas');
  if (!canvas || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const days = 14;
  const data = Array.from({length: days}, (_, i) => Math.round(4000 + Math.sin(i * 0.9) * 1800 + Math.random() * 1200));
  const total = data.reduce((s, v) => s + v, 0);
  if (document.getElementById('dash-usage-total')) _animCounter('dash-usage-total', Math.round(total / 1000), 'K');
  const max = Math.max(...data);
  const W = canvas.parentElement?.clientWidth || 220, H = 54;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [pl, pr, pt, pb] = [4, 4, 6, 4];
  const iw = W - pl - pr, ih = H - pt - pb;
  let phase = 0;
  function draw() {
    if (!document.getElementById(PANEL_ID)) return;
    phase += 0.018; ctx.clearRect(0, 0, W, H);
    const [r, g, b] = _getRgb();
    const pts = data.map((v, i) => [pl + (i/(days-1))*iw, pt + ih - (v/max)*ih*(1+Math.sin(phase+i*0.7)*0.04)]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], H-pb); ctx.lineTo(pts[0][0], pts[0][1]);
    pts.forEach(([x,y]) => ctx.lineTo(x, y)); ctx.lineTo(pts[pts.length-1][0], H-pb); ctx.closePath();
    const grd = ctx.createLinearGradient(0, pt, 0, H);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.28)`); grd.addColorStop(0.7, `rgba(${r},${g},${b},0.06)`); grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); pts.forEach(([x,y], i) => i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
    ctx.strokeStyle=`rgba(${r},${g},${b},0.75)`; ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.stroke();
    const [lx,ly]=pts[pts.length-1]; ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(${r},${g},${b},0.9)`; ctx.fill();
    _usageRaf = requestAnimationFrame(draw);
  }
  draw();
}

function _drawActivityChart(sessions) {
  const canvas = document.getElementById('dash-act-canvas');
  if (!canvas) return;
  const days = 7, now = Date.now();
  const bins = Array.from({length: days}, () => 0);
  sessions.forEach(s => {
    const d = Math.floor((now - new Date(s.updated_at || s.created_at || 0).getTime()) / 86400000);
    if (d >= 0 && d < days) bins[days - 1 - d]++;
  });
  const tot = document.getElementById('dash-act-total');
  if (tot) tot.textContent = bins.reduce((s, v) => s + v, 0);
  const max = Math.max(...bins, 1);
  const W = canvas.parentElement?.clientWidth || 200, H = 56;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [r, g, b] = _getRgb();
  const bw = Math.max(4, Math.floor((W - 16) / days) - 3);
  const sp = (W - 16 - bw * days) / Math.max(1, days - 1);
  const lbls = ['S','M','T','W','T','F','S'];
  const today = new Date().getDay();
  bins.forEach((v, i) => {
    const bh = Math.max(2, (v / max) * (H - 18));
    const x = 8 + i * (bw + sp);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.2 + (v / max) * 0.65})`;
    ctx.fillRect(x, H - 10 - bh, bw, bh);
    ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
    ctx.font = '7px monospace'; ctx.textAlign = 'center';
    ctx.fillText(lbls[(today - (days - 1 - i) + 7) % 7], x + bw / 2, H - 1);
  });
}

function _setVital(key, val, unit) {
  const bar = document.getElementById(`dash-bar-${key}`);
  const txt = document.getElementById(`dash-val-${key}`);
  if (!txt) return;
  if (val < 0) { txt.textContent = '—'; return; }
  const pct = key === 'lat' ? Math.min(100, val / 3) : Math.min(100, val);
  if (bar) bar.style.width = pct + '%';
  txt.textContent = Math.round(val) + unit;
}

// ── Cleanup ─────────────────────────────────────────────────────────

function _cleanup() {
  if (_rafId)       { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_usageRaf)    { cancelAnimationFrame(_usageRaf); _usageRaf = null; }
  if (_vitalsTimer) { clearInterval(_vitalsTimer); _vitalsTimer = null; }
  if (_agentsTimer) { clearInterval(_agentsTimer); _agentsTimer = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _relTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    if (min < 1)   return 'just now';
    if (min < 60)  return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  } catch (_) { return ''; }
}

// Expose for inline onclick
window.dashModule = { open, close, toggle };
