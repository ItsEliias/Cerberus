/**
 * dashboard.js — Cerberus post-login landing screen
 * Full-page overlay composited of read-only panels from existing data.
 * All colours via CSS custom properties — theme-reactive by construction.
 */

const PANEL_ID = 'cerberus-dashboard';
let _canvas = null;
let _rafId  = null;
let _vitalsTimer = null;

// ── Public API ──────────────────────────────────────────────────────

export function open() {
  if (document.getElementById(PANEL_ID)) return;
  _buildPanel();
  _startGlobeAnimation();
  _loadData();
}

export function close() {
  _cleanup();
  const el = document.getElementById(PANEL_ID);
  if (el) {
    el.classList.add('dash-leaving');
    setTimeout(() => el.remove(), 320);
  }
}

export function toggle() {
  document.getElementById(PANEL_ID) ? close() : open();
}

// ── Build DOM ───────────────────────────────────────────────────────

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
        <button class="dash-close-btn" id="dash-close" title="Go to Chat" aria-label="Go to Chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>CHAT</span>
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
      </div>
    </div>
  `.trim();

  document.body.appendChild(panel);

  // Wire close / actions
  panel.querySelector('#dash-close')?.addEventListener('click', close);
  panel.querySelector('#dash-act-chat')?.addEventListener('click', () => {
    close();
    setTimeout(() => document.getElementById('rail-new-session')?.click(), 100);
  });
  panel.querySelector('#dash-act-cc')?.addEventListener('click', () => {
    close();
    setTimeout(() => document.getElementById('command-center-btn')?.click() || document.querySelector('[data-section="command-center"] .section-header-flex')?.click(), 100);
  });
  panel.querySelector('#dash-act-notes')?.addEventListener('click', () => { close(); setTimeout(() => window.location.href = '/notes', 80); });
  panel.querySelector('#dash-act-tasks')?.addEventListener('click', () => { close(); setTimeout(() => document.getElementById('tool-tasks-btn')?.click(), 80); });

  // Close on Escape
  const _onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', _onKey, { once: true });

  _tickClock(panel);
  _tickDatetime(panel);
}

// ── Clock & datetime ────────────────────────────────────────────────

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
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
}

// ── Globe animation ─────────────────────────────────────────────────

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

// ── Data loading ────────────────────────────────────────────────────

async function _loadData() {
  await Promise.all([_loadSessions(), _loadVitals()]);
  _vitalsTimer = setInterval(_loadVitals, 8000);
}

async function _loadSessions() {
  const el = document.getElementById('dash-sessions-list');
  if (!el) return;
  try {
    const res = await fetch('/api/sessions?limit=6', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
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
    if (status) {
      const cpu = v.cpu_percent ?? 0;
      status.textContent = cpu > 85 ? 'HIGH LOAD' : cpu > 60 ? 'ACTIVE' : 'ONLINE';
      status.dataset.level = cpu > 85 ? 'warn' : 'ok';
    }
  } catch (_) {}
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
  if (_vitalsTimer) { clearInterval(_vitalsTimer); _vitalsTimer = null; }
  _canvas = null;
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
