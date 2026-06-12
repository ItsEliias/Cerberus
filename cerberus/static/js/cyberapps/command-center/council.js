/**
 * council.js — COUNCIL sub-tab: Agent Roster Panel.
 *
 * Data source: /api/cyberapps/operations/council
 * Agent activate/idle: PATCH /api/cyberapps/operations/council/{id}
 *
 * Features:
 *  - Header with live active-count chip
 *  - Filter tabs: ALL / ACTIVE / IDLE / STANDBY
 *  - Agent rows with status dot, name, role, current action, score chip
 *  - ACTIVATE / IDLE + DETAILS action buttons
 *  - jx2-hud-frame bracket-corner hover effect
 *  - Per-agent sparkline (last 60s task throughput)
 *  - Falls back to 6-agent demo stub when API returns empty
 */

import { formatTelemetry } from './command.js';

const COUNCIL_API = '/api/cyberapps/operations/council';

// Status colours that align with jx2 vars (applied as inline style fallback)
const STATUS_COLOR = { active: '#2ecc71', idle: '#e67e22', processing: '#c0392b', alert: '#e74c3c', standby: '#888' };

// Demo stub — 6 curated agents used when API returns empty
const DEMO_AGENTS = [
  { id: 'arch-1', name: 'ARCHITECT', role: 'system-architect', action: 'Designing swarm topology', status: 'active',  score: 94,  history: _rnd(60,60,85) },
  { id: 'code-1', name: 'CODER',     role: 'backend-dev',      action: 'Implementing endpoints', status: 'active',  score: 1210, history: _rnd(60,40,95) },
  { id: 'test-1', name: 'TESTER',    role: 'tester',           action: 'Running integration suite',status:'processing',score:77,  history: _rnd(60,20,60) },
  { id: 'res-1',  name: 'RESEARCHER',role: 'researcher',       action: 'Idle — awaiting task',   status: 'idle',    score: 52,  history: _rnd(60,0,20) },
  { id: 'rev-1',  name: 'REVIEWER',  role: 'reviewer',         action: 'Idle — awaiting task',   status: 'idle',    score: 88,  history: _rnd(60,0,15) },
  { id: 'sec-1',  name: 'SECURITY',  role: 'security-auditor', action: 'Standby — on-call',      status: 'standby', score: 100, history: _rnd(60,5,30) },
];

function _rnd(len, lo, hi) {
  return Array.from({ length: len }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
}

// Current filter state
let _filter = 'all';
// Live members list (populated after fetch)
let _members = [];
let _toggleSupported = false;

// ---- Build HTML ----

export function buildCouncilTab() {
  return `<div class="cc-council-tab cc-council-v2">
    <div class="cc-council-header">
      <span class="cc-council-title">COUNCIL <span class="cc-council-sub">— Active Agent Roster</span></span>
      <span class="cc-council-count-chip" id="cc-council-count">0 / 0 ACTIVE</span>
    </div>
    <div class="cc-council-filters" id="cc-council-filters">
      ${['all','active','idle','standby'].map(f => `
        <button class="cc-filter-btn${f === 'all' ? ' active' : ''}" data-filter="${f}">${f.toUpperCase()}</button>
      `).join('')}
    </div>
    <div id="cc-council-rows" class="cc-council-rows"><div class="cc-empty">Loading council...</div></div>
    <div class="cc-council-note" id="cc-council-note"></div>
  </div>`;
}

// ---- Init ----

export function initCouncil(root) {
  const filterBar = root.querySelector('#cc-council-filters');
  if (filterBar) {
    filterBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      _filter = btn.dataset.filter;
      filterBar.querySelectorAll('.cc-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      _renderCouncil(root);
    });
  }
}

// ---- Load ----

export async function loadCouncil(root) {
  const container = root.querySelector('#cc-council-rows');
  const note = root.querySelector('#cc-council-note');
  if (!container) return;
  try {
    const res = await fetch(COUNCIL_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.members || [];
    _toggleSupported = !!data.toggle_supported;

    if (raw.length === 0) {
      _members = DEMO_AGENTS.map(a => ({ ...a, _demo: true }));
      if (note) note.textContent = '(demo) — No agents in DB; showing curated stub.';
    } else {
      _members = raw.map(m => ({
        id:      m.id,
        name:    (m.name || '').toUpperCase(),
        role:    m.model || m.role || '—',
        action:  m.action || m.current_action || 'Idle',
        status:  m.is_active ? 'active' : 'idle',
        score:   m.score ?? null,
        history: m.history || _rnd(60, 0, 100),
      }));
      if (note) note.textContent = _toggleSupported ? '' : '(read-only) — No agent-toggle endpoint.';
    }

    _renderCouncil(root);

    if (window.JX && typeof window.JX.staggerIn === 'function') {
      window.JX.staggerIn(container, '.cc-council-card', 0);
    }

    _wireButtons(root);
  } catch (e) {
    // API error — fall back to demo
    _members = DEMO_AGENTS.map(a => ({ ...a, _demo: true }));
    if (note) note.textContent = `(demo) — API error: ${_esc(String(e))}`;
    _renderCouncil(root);
    _wireButtons(root);
  }
}

// ---- Render ----

function _renderCouncil(root) {
  const container = root.querySelector('#cc-council-rows');
  const countChip = root.querySelector('#cc-council-count');
  if (!container) return;

  const filtered = _filter === 'all'
    ? _members
    : _members.filter(m => m.status === _filter);

  const activeCount = _members.filter(m => m.status === 'active' || m.status === 'processing').length;
  if (countChip) countChip.textContent = `${activeCount} / ${_members.length} ACTIVE`;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="cc-empty">No agents in <strong>${_filter}</strong> state.</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => _cardHtml(m)).join('');

  // Draw sparklines after DOM update
  filtered.forEach(m => {
    const svg = container.querySelector(`[data-spark-id="${m.id}"]`);
    if (svg && m.history) _drawSparkline(svg, m.history);
  });
}

function _cardHtml(m) {
  const st = m.status || 'idle';
  const scoreStr = m.score != null ? formatTelemetry(m.score) : '—';
  const activeLbl = (st === 'active' || st === 'processing') ? 'IDLE' : 'ACTIVATE';
  const activeCls = (st === 'active' || st === 'processing') ? 'cc-action-idle' : 'cc-action-activate';
  const dotAnim   = (st === 'processing') ? ' cc-dot-processing' : (st === 'active' ? ' cc-dot-active-ring' : '');
  const dotColor  = STATUS_COLOR[st] || STATUS_COLOR.standby;

  return `<div class="cc-council-card jx2-hud-frame" data-agent-id="${_esc(m.id)}" data-status="${st}">
    <span class="jx2-bracket-tl" aria-hidden="true"></span>
    <span class="jx2-bracket-br" aria-hidden="true"></span>
    <div class="cc-council-card-main">
      <div class="cc-council-card-status">
        <span class="cc-council-dot${dotAnim}" style="background:${dotColor}" title="${st}"></span>
      </div>
      <div class="cc-council-card-info">
        <span class="cc-council-name">${_esc(m.name)}</span>
        <span class="cc-council-role-lbl">${_esc(m.role)}</span>
        <span class="cc-council-action-lbl">${_esc(m.action)}</span>
      </div>
      <div class="cc-council-card-right">
        <span class="cc-council-score-chip jx2-stat-chip" data-status="${st}">${scoreStr}</span>
        <div class="cc-council-spark-wrap">
          <svg class="cc-council-spark" data-spark-id="${_esc(m.id)}"
            viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <div class="cc-council-actions">
          <button class="cc-council-action-btn ${activeCls}"
            data-id="${_esc(m.id)}" data-action="${activeLbl === 'IDLE' ? 'idle' : 'activate'}">
            [ ${activeLbl} ]
          </button>
          <button class="cc-council-action-btn cc-action-details"
            data-id="${_esc(m.id)}" data-action="details">
            [ DETAILS ]
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

// ---- Sparkline ----

function _drawSparkline(svg, data) {
  if (!svg || !data.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    svg.innerHTML = '';
    return;
  }
  const W = 120, H = 28, pad = 2;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', pts.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'var(--cc-crimson)');
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('opacity', '0.7');

  // Leading cursor dot
  const lastPt = pts[pts.length - 1].split(',');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', lastPt[0]);
  dot.setAttribute('cy', lastPt[1]);
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', 'var(--cc-crimson)');

  svg.innerHTML = '';
  svg.appendChild(polyline);
  svg.appendChild(dot);
}

// ---- Wire action buttons ----

function _wireButtons(root) {
  const container = root.querySelector('#cc-council-rows');
  if (!container) return;

  container.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { id, action } = btn.dataset;

    if (action === 'details') {
      const member = _members.find(m => m.id === id);
      if (member) _showDetails(member);
      return;
    }

    if (!_toggleSupported) return;

    try {
      btn.disabled = true;
      await fetch(`${COUNCIL_API}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: action === 'activate' }),
      });
      // Optimistic local update
      const m = _members.find(x => x.id === id);
      if (m) m.status = action === 'activate' ? 'active' : 'idle';
      _renderCouncil(root);
      _wireButtons(root);
    } catch (err) {
      console.warn('[Council] toggle failed', err);
      btn.disabled = false;
    }
  });
}

function _showDetails(m) {
  const scoreStr = m.score != null ? formatTelemetry(m.score) : '—';
  alert(`AGENT: ${m.name}\nROLE: ${m.role}\nSTATUS: ${m.status}\nSCORE: ${scoreStr}\nACTION: ${m.action}`);
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
