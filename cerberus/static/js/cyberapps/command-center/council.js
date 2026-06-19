/**
 * council.js — COUNCIL sub-tab: Two-mode agent graph.
 * Mode A: HIERARCHY     — org-chart from /api/agents, polled every 5 s.
 * Mode B: SESSION REPLAY — radial network from /api/rooms/{id}, polled every 3 s.
 */

import {
  buildHierarchySVG, updateHierarchyNodes,
  buildReplaySVG, updateReplayEdges,
} from './council-graph-svg.js';
import { formatTelemetry } from './command.js';

const AGENTS_API = '/api/agents';
const ROOMS_API  = '/api/rooms';

let _mode       = 'hierarchy';
let _agents     = [];
let _rooms      = [];
let _selRoomId  = null;
let _svgEl      = null;
let _svgBuilt   = false;
let _agentTimer = null;
let _repTimer   = null;
let _root       = null;
let _visCb      = null;

// ── Public API ──────────────────────────────────────────────────────────────

export function buildCouncilTab() {
  return `<div class="ccg-root">
  <div class="ccg-toolbar">
    <div class="ccg-mode-btns">
      <button class="ccg-mode-btn active" data-mode="hierarchy">[ HIERARCHY ]</button>
      <button class="ccg-mode-btn" data-mode="replay">[ SESSION REPLAY ]</button>
    </div>
    <div class="ccg-room-pick" id="ccg-room-pick">
      <span class="ccg-room-lbl">// ROOM</span>
      <select class="ccg-room-sel" id="ccg-room-sel">
        <option value="">— select room —</option>
      </select>
    </div>
  </div>
  <div class="ccg-canvas" id="ccg-canvas">
    <div class="ccg-empty">// LOADING AGENT ROSTER…</div>
  </div>
  <div class="ccg-timeline" id="ccg-timeline"></div>
  <div class="ccg-detail-overlay" id="ccg-detail-overlay"></div>
</div>`;
}

export function initCouncil(root) {
  _destroy();
  _root     = root;
  _mode     = 'hierarchy';
  _svgBuilt = false;
  _svgEl    = null;

  root.querySelectorAll('.ccg-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === _mode) return;
      _mode = btn.dataset.mode;
      root.querySelectorAll('.ccg-mode-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
      _svgBuilt = false;
      _svgEl    = null;
      _clearTimers();
      const ov = root.querySelector('#ccg-detail-overlay');
      if (ov) ov.style.display = 'none';
      _mountMode(root).catch(() => {});
    });
  });

  const sel = root.querySelector('#ccg-room-sel');
  if (sel) {
    sel.addEventListener('change', () => {
      _selRoomId = sel.value || null;
      _svgBuilt  = false;
      _svgEl     = null;
      _startReplayPoll(root).catch(() => {});
    });
  }

  _visCb = () => _applyVisibility(root);
  document.addEventListener('visibilitychange', _visCb);
}

export async function loadCouncil(root) {
  _root = root;
  await _mountMode(root);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _destroy() {
  _clearTimers();
  if (_visCb) { document.removeEventListener('visibilitychange', _visCb); _visCb = null; }
  _agents   = [];
  _rooms    = [];
  _svgBuilt = false;
  _svgEl    = null;
}

function _clearTimers() {
  if (_agentTimer) { clearInterval(_agentTimer); _agentTimer = null; }
  if (_repTimer)   { clearInterval(_repTimer);   _repTimer   = null; }
}

async function _mountMode(root) {
  const thisMode = _mode;
  const rp = root.querySelector('#ccg-room-pick');
  const tl = root.querySelector('#ccg-timeline');

  if (thisMode === 'hierarchy') {
    if (rp) rp.style.display = 'none';
    if (tl) tl.style.display = 'none';
    await _startHierarchyPoll(root);
  } else {
    if (rp) rp.style.display = 'flex';
    await _fetchRooms(root);
    if (_mode !== thisMode) return;
    if (_selRoomId) await _startReplayPoll(root);
    else _showReplayEmpty(root);
  }
}

// ── Hierarchy mode ────────────────────────────────────────────────────────────

async function _startHierarchyPoll(root) {
  _clearTimers();
  await _pollAgents(root);
  _agentTimer = setInterval(() => { if (!document.hidden) _pollAgents(root); }, 5000);
}

async function _pollAgents(root) {
  if (_root !== root) return;
  try {
    const res = await fetch(AGENTS_API, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _agents = (data.agents || []).map(a => ({
      id:             a.id,
      name:           (a.name || '').toUpperCase(),
      role:           a.role || '—',
      status:         a.status || 'standby',
      current_action: a.current_action || '',
      score:          a.score ?? 0,
      model_alias:    a.model_alias || '',
    }));
    if (_mode === 'hierarchy') _renderHierarchy(root);
  } catch (_) { /* keep stale SVG */ }
}

function _renderHierarchy(root) {
  const canvas = root.querySelector('#ccg-canvas');
  if (!canvas) return;
  if (!_svgBuilt) {
    canvas.innerHTML = buildHierarchySVG(_agents);
    _svgEl    = canvas.querySelector('svg');
    _svgBuilt = true;
    _wireNodeClicks(root, _svgEl);
  } else {
    updateHierarchyNodes(_svgEl, _agents);
  }
}

function _wireNodeClicks(root, svgEl) {
  if (!svgEl) return;
  svgEl.querySelectorAll('.ccg-spec').forEach(g => {
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => {
      const agent = _agents.find(a => a.name === g.dataset.spec);
      if (agent) _showDetail(root, agent);
    });
  });
}

// ── Session Replay mode ───────────────────────────────────────────────────────

async function _fetchRooms(root) {
  try {
    const res = await fetch(ROOMS_API, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _rooms = (data.rooms || []).map(r => ({ id: r.id, name: r.name || r.id }));
    _populateRoomSelect(root);
  } catch (_) { /* silent */ }
}

function _populateRoomSelect(root) {
  const sel = root.querySelector('#ccg-room-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— select room —</option>' +
    _rooms.map(r =>
      `<option value="${_esc(r.id)}"${r.id === _selRoomId ? ' selected' : ''}>${_esc(r.name)}</option>`
    ).join('');
}

async function _startReplayPoll(root) {
  _clearTimers();
  if (!_selRoomId) { _showReplayEmpty(root); return; }
  await _pollReplay(root);
  _repTimer = setInterval(() => { if (!document.hidden) _pollReplay(root); }, 3000);
}

async function _pollReplay(root) {
  if (!_selRoomId || _root !== root) return;
  try {
    const res = await fetch(`${ROOMS_API}/${encodeURIComponent(_selRoomId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const data = await res.json();
    const msgs = data.messages || data.room?.messages || [];
    const turns = msgs
      .filter(m => m.role === 'agent')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(m => (m.sender_name || '').toUpperCase());
    if (_mode === 'replay') _renderReplay(root, turns);
  } catch (_) { /* silent */ }
}

function _renderReplay(root, turns) {
  const canvas = root.querySelector('#ccg-canvas');
  if (!canvas) return;
  if (!_svgBuilt) {
    canvas.innerHTML = buildReplaySVG();
    _svgEl    = canvas.querySelector('svg');
    _svgBuilt = true;
  }
  updateReplayEdges(_svgEl, turns);
  _renderTimeline(root, turns);
}

function _showReplayEmpty(root) {
  const canvas = root.querySelector('#ccg-canvas');
  if (canvas) canvas.innerHTML = '<div class="ccg-empty">// SELECT A ROOM TO REPLAY SESSION</div>';
  const tl = root.querySelector('#ccg-timeline');
  if (tl) { tl.style.display = 'none'; tl.innerHTML = ''; }
}

function _renderTimeline(root, turns) {
  const tl = root.querySelector('#ccg-timeline');
  if (!tl) return;
  if (!turns.length) { tl.style.display = 'none'; tl.innerHTML = ''; return; }
  tl.style.display = 'flex';
  tl.innerHTML = turns.map((name, i) => {
    const cls = i === turns.length - 1 ? 'ccg-tl-chip ccg-tl-active' : 'ccg-tl-chip ccg-tl-done';
    return `<span class="${cls}">${_esc(name)}</span>`;
  }).join('<span class="ccg-tl-arrow">→</span>');
}

// ── Detail overlay ────────────────────────────────────────────────────────────

function _showDetail(root, agent) {
  const ov = root.querySelector('#ccg-detail-overlay');
  if (!ov) return;
  const stCls = 'ccg-ds-' + agent.status.replace(/[^a-z]/g, '');
  ov.innerHTML = `<div class="ccg-detail-panel">
    <div class="ccg-detail-header">
      <span class="ccg-detail-title">// ${_esc(agent.name)}</span>
      <button class="ccg-detail-close" id="ccg-detail-close">[ CLOSE ]</button>
    </div>
    <div class="ccg-detail-body">
      <div class="ccg-detail-row"><span class="ccg-detail-lbl">ROLE</span><span>${_esc(agent.role)}</span></div>
      <div class="ccg-detail-row"><span class="ccg-detail-lbl">STATUS</span><span class="${stCls}">${_esc(agent.status)}</span></div>
      <div class="ccg-detail-row"><span class="ccg-detail-lbl">MODEL</span><span>${_esc(agent.model_alias || '—')}</span></div>
      <div class="ccg-detail-row"><span class="ccg-detail-lbl">SCORE</span><span>${formatTelemetry(agent.score ?? 0)}</span></div>
      ${agent.current_action
        ? `<div class="ccg-detail-row"><span class="ccg-detail-lbl">ACTION</span><span>${_esc(agent.current_action)}</span></div>`
        : ''}
    </div>
  </div>`;
  ov.style.display = 'block';
  ov.querySelector('#ccg-detail-close').addEventListener('click', () => {
    ov.style.display = 'none';
  });
}

// ── Visibility handling ───────────────────────────────────────────────────────

function _applyVisibility(root) {
  const canvas = root.querySelector('#ccg-canvas');
  if (document.hidden) {
    if (canvas) canvas.classList.add('ccg-paused');
    _clearTimers();
  } else {
    if (canvas) canvas.classList.remove('ccg-paused');
    if (_mode === 'hierarchy') _startHierarchyPoll(root).catch(() => {});
    else if (_selRoomId)       _startReplayPoll(root).catch(() => {});
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s || '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
