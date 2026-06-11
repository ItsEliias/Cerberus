/**
 * static/js/cyberapps/dashboard/view-dashboard.js
 * Dashboard main view — OperatorProfileCard, EcosystemHealthBar,
 * AppStatusGrid, ActiveSessionBanner, ActivityFeed.
 */

import * as State from './state.js';
import { timeAgo, humanizeEvent, appAccentColor, buildAppCards, formatElapsed, esc, truncate } from './utils.js';

// ---------------------------------------------------------------------------
// Active Session Banner
// ---------------------------------------------------------------------------

let _elapsedTimerId = null;
let _elapsedStart = null;
let _elapsedEl = null;

function _stopElapsedTimer() {
  if (_elapsedTimerId) { clearInterval(_elapsedTimerId); _elapsedTimerId = null; }
}

function _startElapsedTimer() {
  _stopElapsedTimer();
  _elapsedStart = Date.now();
  _elapsedTimerId = setInterval(() => {
    if (_elapsedEl) {
      const sec = Math.floor((Date.now() - _elapsedStart) / 1000);
      _elapsedEl.textContent = formatElapsed(sec);
    }
  }, 1000);
}

/** @param {Record<string, any>|null} ctx */
function renderSessionBanner(ctx) {
  if (!ctx?.activeLab) return '';
  return `
    <div class="db-session-banner" id="db-session-banner">
      <div class="db-session-live">
        <span class="db-dot db-dot--danger db-dot--pulse"></span>
        <span class="db-live-label">LIVE</span>
      </div>
      <div class="db-session-divider"></div>
      <div class="db-session-fields">
        <div class="db-session-field">
          <div class="db-field-label">Lab</div>
          <div class="db-field-value db-mono">${esc(ctx.activeLab)}</div>
        </div>
        ${ctx.activeIP ? `<div class="db-session-field"><div class="db-field-label">IP</div><div class="db-field-value db-mono db-accent">${esc(ctx.activeIP)}</div></div>` : ''}
        ${ctx.activeTarget && ctx.activeTarget !== ctx.activeLab
          ? `<div class="db-session-field"><div class="db-field-label">Host</div><div class="db-field-value">${esc(ctx.activeTarget)}</div></div>` : ''}
        ${ctx.activePlaybook ? `<div class="db-session-field"><div class="db-field-label">Playbook</div><div class="db-field-value">${esc(ctx.activePlaybook)}</div></div>` : ''}
      </div>
      <div class="db-session-elapsed shrink-0">
        <div class="db-field-label">Elapsed</div>
        <div class="db-field-value db-mono db-danger" id="db-elapsed-timer">00:00</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Operator Profile Card + SkillRadar
// ---------------------------------------------------------------------------

function renderSkillRadar(skills, size) {
  const KEYS = ['web', 'network', 'activeDirectory', 'linux', 'windows', 'crypto', 'forensics'];
  const LABELS = ['Web', 'Network', 'AD', 'Linux', 'Windows', 'Crypto', 'Forensics'];
  const MAX = 100;
  const center = size / 2;
  const radius = size / 2 - 38;
  const step = (2 * Math.PI) / KEYS.length;

  function pt(i, val) {
    const a = step * i - Math.PI / 2;
    const r = (val / MAX) * radius;
    return [center + r * Math.cos(a), center + r * Math.sin(a)];
  }

  const rings = [0.25, 0.5, 0.75, 1].map(scale =>
    `<polygon points="${KEYS.map((_, i) => { const [x,y] = pt(i, MAX*scale); return `${x},${y}`; }).join(' ')}" fill="none" stroke="rgba(42,51,71,0.4)" stroke-width="0.5"/>`
  ).join('');

  const axes = KEYS.map((_, i) => {
    const [x, y] = pt(i, MAX);
    return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="rgba(42,51,71,0.3)" stroke-width="0.5"/>`;
  }).join('');

  const polyPts = KEYS.map((k, i) => { const [x,y] = pt(i, skills[k] ?? 0); return `${x},${y}`; }).join(' ');

  const dots = KEYS.map((k, i) => {
    const [x, y] = pt(i, skills[k] ?? 0);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="#4a9eff" stroke="#0a0a0f" stroke-width="1.5"/>`;
  }).join('');

  const labelRadius = MAX + 22;
  const labels = KEYS.map((k, i) => {
    const [x, y] = pt(i, labelRadius);
    const val = skills[k] ?? 0;
    const a = ((step * i - Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    let anchor = 'middle';
    if (a > Math.PI * 0.15 && a < Math.PI * 0.85) anchor = 'start';
    else if (a > Math.PI * 1.15 && a < Math.PI * 1.85) anchor = 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" style="font-size:10px;font-family:JetBrains Mono,monospace;fill:#8b949e;">${LABELS[i]} <tspan style="font-size:9px;fill:#6e7681">${val}</tspan></text>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><filter id="db-radar-glow"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${rings}${axes}
    <polygon points="${polyPts}" fill="rgba(74,158,255,0.12)" stroke="#4a9eff" stroke-width="2" filter="url(#db-radar-glow)"/>
    ${dots}${labels}
  </svg>`;
}

function renderOperatorCard(profile) {
  const name = profile?.operatorName ?? 'Operator';
  const streak = profile?.currentStreak ?? 0;
  const flags = profile?.totalFlags ?? 0;
  const labs = profile?.totalLabsCompleted ?? 0;
  const creds = profile?.totalCredentials ?? 0;
  const skills = profile?.skillProgress ?? {};

  return `
    <div class="db-operator-card">
      <div class="db-radar-area">${renderSkillRadar(skills, 220)}</div>
      <div class="db-operator-identity">
        <div class="db-operator-name">${esc(name)}</div>
        <div class="db-operator-status"><span class="db-dot db-dot--online db-dot--pulse"></span><span>Active Operator</span></div>
      </div>
      <div class="db-hero-metrics">
        <div class="db-hero-metric"><div class="db-hero-val">${labs}</div><div class="db-hero-label">Labs</div></div>
        <div class="db-hero-metric"><div class="db-hero-val">${flags}</div><div class="db-hero-label">Flags</div></div>
        <div class="db-hero-metric"><div class="db-hero-val">${creds}</div><div class="db-hero-label">Creds</div></div>
        <div class="db-hero-metric"><div class="db-hero-val">${streak}<span style="font-size:14px">d</span></div><div class="db-hero-label">Streak</div></div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Ecosystem Health Bar
// ---------------------------------------------------------------------------

function renderHealthBar(cards) {
  const active = cards.filter(c => c.active).length;
  const total = cards.length || 1;
  const pct = Math.round((active / total) * 100);
  const SEGS = 20;
  const filled = Math.round((pct / 100) * SEGS);
  const healthColor = pct >= 75 ? '#3fb950' : pct >= 40 ? '#d29922' : '#f85149';

  const segs = Array.from({ length: SEGS }, (_, i) => {
    const isFilled = i < filled;
    return `<div class="db-seg ${isFilled ? 'db-seg--filled' : ''}" style="${isFilled ? `--seg-color:${healthColor}` : ''}"></div>`;
  }).join('');

  const dots = cards.map(c =>
    `<div class="db-app-dot" title="${esc(c.name)}">
      <span class="db-dot ${c.active ? 'db-dot--pulse' : ''}" style="background:${c.accentColor};opacity:${c.active ? 1 : 0.22};${c.active ? `box-shadow:0 0 6px ${c.accentColor}99` : ''}"></span>
      <span class="db-dot-label" style="color:${c.active ? 'var(--fg)' : 'rgba(197,201,208,0.4)'}">${c.name.slice(0, 6)}</span>
    </div>`
  ).join('');

  return `
    <div class="db-health-bar">
      <div class="db-health-header">
        <span class="db-section-label">Ecosystem Health</span>
        <div class="db-health-meta">
          <span class="db-health-pct db-mono" style="color:${healthColor}">${pct}%</span>
          <span class="db-mono" style="color:rgba(197,201,208,0.5)">${active}/${total}</span>
        </div>
      </div>
      <div class="db-seg-row">${segs}</div>
      <div class="db-app-dots">${dots}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// App Status Grid
// ---------------------------------------------------------------------------

function renderSparkline(seed, active, accentColor) {
  const pts = Array.from({ length: 14 }, (_, i) => {
    const s = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return 30 + Math.sin(s + i * 0.8) * 20 + Math.cos(s * 0.3 + i) * 10;
  });
  const W = 120, H = 28;
  const step = W / (pts.length - 1);
  const max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const coords = pts.map((v, i) => [i * step, H - ((v - min) / range) * (H - 2) - 1]);
  const linePath = 'M' + coords.map(([x, y]) => `${x},${y}`).join(' L');
  const areaPath = linePath + ` L${W},${H} L0,${H} Z`;
  const gid = `dbg-${seed.replace(/[^a-z0-9]/gi, '')}`;
  const opacity = active ? '0.58' : '0.15';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:34px;display:block">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${accentColor}" stop-opacity="${opacity}"/>
        <stop offset="100%" stop-color="#0a0d17" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${gid})"/>
    <path d="${linePath}" fill="none" stroke="${accentColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="${active ? 1 : 0.35}" ${active ? `style="filter:drop-shadow(0 0 3px ${accentColor}88)"` : ''}/>
  </svg>`;
}

function renderAppStatusGrid(cards) {
  const cardHtml = cards.map(card => {
    const primary = card.metrics[0] || {};
    const secondaries = card.metrics.slice(1, 3);
    return `
      <div class="db-app-card" style="border-top-color:${card.active ? card.accentColor : card.accentColor + '40'}">
        <div class="db-card-header">
          <div class="db-card-title-row">
            <span class="db-dot db-dot--sm ${card.active ? 'db-dot--pulse' : ''}" style="background:${card.accentColor};opacity:${card.active ? 1 : 0.3};${card.active ? `box-shadow:0 0 5px ${card.accentColor}` : ''}"></span>
            <span class="db-card-name">${esc(card.name)}</span>
          </div>
          <span class="db-card-status db-mono" style="color:${card.active ? card.accentColor : 'rgba(197,201,208,0.4)'}">${card.active ? 'ON' : 'OFF'}</span>
        </div>
        ${primary.value !== undefined ? `
          <div class="db-primary-metric" style="color:${card.accentColor}">
            ${esc(String(primary.value))}
            <span class="db-metric-label">${esc(primary.label || '')}</span>
          </div>` : ''}
        <div class="db-sparkline">${renderSparkline(card.id, card.active, card.accentColor)}</div>
        ${secondaries.length ? `<div class="db-secondaries">${secondaries.map(m =>
          `<div class="db-secondary-row"><span class="db-secondary-label">${esc(m.label)}</span><span class="db-secondary-val db-mono">${esc(String(m.value))}</span></div>`
        ).join('')}</div>` : ''}
        <div class="db-card-footer">
          <span class="db-mono" style="font-size:9px;color:rgba(197,201,208,0.4)">${timeAgo(card.lastActive)}</span>
        </div>
      </div>`;
  }).join('');

  return `<div class="db-app-grid">${cardHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

function renderActivityFeed(events, feedFilter) {
  const normalized = events.map(e => ({
    id: e.id || String(Math.random()),
    app: e.app || e.appName || 'Unknown',
    event: e.event || e.eventType || 'unknown',
    timestamp: e.timestamp,
    data: e.data || {},
  }));

  const filtered = feedFilter
    ? normalized.filter(e => e.app.toLowerCase() === feedFilter.toLowerCase())
    : normalized;

  // Deduplicate by app::event
  const deduped = [];
  for (const ev of filtered.slice(0, 50)) {
    const key = `${ev.app}::${ev.event}`;
    const existing = deduped.find(r => `${r.app}::${r.event}` === key);
    if (existing) { existing.count = (existing.count || 1) + 1; }
    else { deduped.push({ ...ev, count: 1 }); }
  }

  const appNames = [...new Set(normalized.map(e => e.app))];
  const filterOpts = appNames.map(a => `<button class="db-feed-filter-opt" data-app="${esc(a)}" style="color:${appAccentColor(a)}">${esc(a)}</button>`).join('');

  const rows = deduped.slice(0, 20).map(ev => {
    const accent = appAccentColor(ev.app);
    const dataKeys = Object.keys(ev.data).slice(0, 2);
    const dataSummary = dataKeys.length
      ? dataKeys.map(k => `${k}: ${ev.data[k]}`).join(' · ')
      : '';
    return `
      <div class="db-feed-row" style="border-left-color:${accent}55">
        <div class="db-feed-row-header">
          <span class="db-feed-app" style="color:${accent}">${esc(ev.app)}</span>
          ${ev.count > 1 ? `<span class="db-feed-count db-mono">×${ev.count}</span>` : ''}
          <span class="db-feed-time db-mono">${timeAgo(ev.timestamp)}</span>
        </div>
        <div class="db-feed-event">${esc(humanizeEvent(ev.event))}</div>
        ${dataSummary ? `<div class="db-feed-data db-mono">${esc(dataSummary)}</div>` : ''}
      </div>`;
  }).join('');

  const emptyState = `
    <div class="db-feed-empty">
      <div class="db-feed-empty-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <p class="db-feed-empty-title">No activity yet</p>
      <p class="db-feed-empty-sub">Events will appear as apps send updates.</p>
    </div>`;

  return `
    <div class="db-activity-feed" id="db-activity-feed">
      <div class="db-feed-header">
        <div class="db-feed-header-left">
          <span class="db-section-label">Activity</span>
          ${deduped.length ? `<span class="db-feed-badge db-mono">${deduped.length}</span>` : ''}
        </div>
        <div class="db-feed-filter-wrap" id="db-feed-filter-wrap">
          <button class="db-feed-filter-btn db-mono" id="db-feed-filter-btn">${feedFilter || 'ALL'} ▾</button>
          <div class="db-feed-filter-dropdown" id="db-feed-filter-dropdown" style="display:none">
            <button class="db-feed-filter-opt" data-app="">All Apps</button>
            ${filterOpts}
          </div>
        </div>
      </div>
      <div class="db-feed-scroll" id="db-feed-scroll">
        ${deduped.length ? rows : emptyState}
      </div>
      <div class="db-feed-footer"><span class="db-mono">${deduped.length} unique · ${normalized.length} total</span></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main view render
// ---------------------------------------------------------------------------

let _refreshInterval = null;
let _unsubSummary = null;
let _unsubEvents = null;
let _container = null;

function _render(container) {
  const summary = State.get('summary') || {};
  const events = State.get('events') || [];
  const feedFilter = State.get('feedFilter');

  const statuses = summary.app_statuses || {};
  const profile = summary.operator_profile;
  const ctx = summary.shared_context;
  const cards = buildAppCards(statuses);

  const loading = State.get('loading');
  const error = State.get('error');

  if (loading) {
    container.innerHTML = '<div class="db-loading"><span class="db-spinner"></span><span>Loading dashboard…</span></div>';
    return;
  }
  if (error) {
    container.innerHTML = `<div class="db-error"><p>Error loading dashboard</p><p class="db-mono" style="font-size:11px">${esc(error)}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="db-main-layout">
      <div class="db-center-pane">
        ${ctx?.activeLab ? renderSessionBanner(ctx) : ''}
        <div class="db-dashboard-grid">
          ${renderOperatorCard(profile)}
          <div class="db-right-col">
            ${renderHealthBar(cards)}
            <p class="db-section-label" style="margin-top:12px;margin-bottom:6px">Applications</p>
            ${renderAppStatusGrid(cards)}
          </div>
        </div>
      </div>
      ${renderActivityFeed(events, feedFilter)}
    </div>`;

  // Wire elapsed timer
  _elapsedEl = container.querySelector('#db-elapsed-timer');
  if (_elapsedEl) _startElapsedTimer();

  // Wire feed filter dropdown
  const filterBtn = container.querySelector('#db-feed-filter-btn');
  const filterDrop = container.querySelector('#db-feed-filter-dropdown');
  if (filterBtn && filterDrop) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      filterDrop.style.display = filterDrop.style.display === 'none' ? 'block' : 'none';
    });
    filterDrop.querySelectorAll('.db-feed-filter-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        State.set('feedFilter', btn.dataset.app || null);
        filterDrop.style.display = 'none';
      });
    });
    document.addEventListener('click', function closeDropdown() {
      filterDrop.style.display = 'none';
      document.removeEventListener('click', closeDropdown);
    });
  }
}

export function init(container) {
  _container = container;
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  _render(container);

  _unsubSummary = State.subscribe('summary', () => _render(container));
  _unsubEvents = State.subscribe('events', () => _render(container));
  State.subscribe('feedFilter', () => _render(container));
}

export function destroy() {
  _stopElapsedTimer();
  if (_unsubSummary) { _unsubSummary(); _unsubSummary = null; }
  if (_unsubEvents) { _unsubEvents(); _unsubEvents = null; }
  _container = null;
  _elapsedEl = null;
}
