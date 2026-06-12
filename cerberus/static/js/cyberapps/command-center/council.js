/**
 * council.js — COUNCIL sub-tab: Agent Roster Panel (Phase E1).
 *
 * Data source: GET /api/agents
 * Status toggle: PATCH /api/agents/{id}
 * Invoke: POST /api/agents/{id}/invoke  (SSE stream)
 * Details: inline overlay panel
 *
 * Phase E1 additions:
 *  - Greek persona SVG portraits (64x64, via council-glyphs.js)
 *  - Rich card layout: portrait | name+role+action | score+sparkline+actions
 *  - MESSAGE and CALL buttons (Coming-soon toast — Phase E2/E3)
 *  - Grid layout: repeat(auto-fill, minmax(420px, 1fr))
 *  - Theme-reactive via var(--cc-accent) (see styles.css)
 *  - prefers-reduced-motion respected for sparkline animation
 */

import { formatTelemetry } from './command.js';
import { getGlyph } from './council-glyphs.js';
import { openNewAgentModal } from './council-new-agent.js';

const AGENTS_API = '/api/agents';

const STATUS_COLOR = {
  active:     '#2ecc71',
  idle:       '#e67e22',
  processing: 'var(--cc-accent)',
  alert:      '#e74c3c',
  standby:    '#888',
};

// Demo stub — graceful degrade on 5xx only
const DEMO_AGENTS = [
  { id: 'arch-1', name: 'Daedalus',   role: 'architect',       current_action: 'Designing swarm topology', status: 'active',  score: 94,   system_prompt: '', model_alias: 'sonnet', _demo: true },
  { id: 'code-1', name: 'Hephaestus', role: 'backend-dev',     current_action: 'Implementing endpoints',   status: 'active',  score: 1210, system_prompt: '', model_alias: 'sonnet', _demo: true },
  { id: 'test-1', name: 'Themis',     role: 'tester',          current_action: 'Running integration suite',status: 'active',  score: 77,   system_prompt: '', model_alias: 'sonnet', _demo: true },
  { id: 'res-1',  name: 'Athena',     role: 'researcher',      current_action: 'Idle — awaiting task',     status: 'idle',    score: 52,   system_prompt: '', model_alias: 'sonnet', _demo: true },
  { id: 'rev-1',  name: 'Argus',      role: 'reviewer',        current_action: 'Idle — awaiting task',     status: 'idle',    score: 88,   system_prompt: '', model_alias: 'sonnet', _demo: true },
  { id: 'sec-1',  name: 'Aegis',      role: 'security-auditor',current_action: 'Standby — on-call',        status: 'standby', score: 100,  system_prompt: '', model_alias: 'sonnet', _demo: true },
];

function _rnd(len, lo, hi) {
  return Array.from({ length: len }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
}

/** Deterministic sparkline based on agent id hash, so each agent has a stable unique line. */
function _stableHistory(id) {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed >>> 16) / 65535; };
  return Array.from({ length: 24 }, () => Math.floor(rng() * 80 + 5));
}

let _filter = 'all';
let _members = [];
let _councilRoot = null;

// ---- Build HTML ----

export function buildCouncilTab() {
  return `<div class="cc-council-tab cc-council-v2">
    <div class="cc-council-header">
      <span class="cc-council-title">COUNCIL <span class="cc-council-sub">— Active Agent Roster</span></span>
      <span class="cc-council-count-chip" id="cc-council-count">0 / 0 ACTIVE</span>
      <button class="cc-new-agent-btn" id="cc-new-agent-btn" title="Create a new agent persona">+ NEW AGENT</button>
    </div>
    <div class="cc-council-filters" id="cc-council-filters">
      ${['all','active','idle','standby'].map(f => `
        <button class="cc-filter-btn${f === 'all' ? ' active' : ''}" data-filter="${f}">${f.toUpperCase()}</button>
      `).join('')}
    </div>
    <div id="cc-new-agent-overlay" class="cc-agent-overlay" style="display:none"></div>
    <div id="cc-council-rows" class="cc-council-rows cc-council-grid"><div class="cc-empty">Loading council...</div></div>
    <div class="cc-council-note" id="cc-council-note"></div>
    <div id="cc-agent-details-overlay" class="cc-agent-overlay" style="display:none"></div>
    <div id="cc-toast" class="cc-council-toast" aria-live="polite" style="display:none"></div>
  </div>`;
}

// ---- Init ----

export function initCouncil(root) {
  _councilRoot = root;
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
  const newBtn = root.querySelector('#cc-new-agent-btn');
  if (newBtn) newBtn.addEventListener('click', () => openNewAgentModal(root, () => loadCouncil(root)));
}

// ---- Toast helper ----

function _toast(root, message, duration = 2800) {
  const el = root.querySelector('#cc-toast');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.classList.add('cc-toast-visible');
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => {
    el.classList.remove('cc-toast-visible');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, duration);
}

// ---- Load ----

export async function loadCouncil(root) {
  _councilRoot = root;
  const container = root.querySelector('#cc-council-rows');
  const note = root.querySelector('#cc-council-note');
  if (!container) return;
  try {
    const res = await fetch(AGENTS_API, { credentials: 'same-origin' });
    if (!res.ok) {
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (note) note.textContent = `Auth error ${res.status} — please log in.`;
      container.innerHTML = `<div class="cc-empty">Not authenticated.</div>`;
      return;
    }
    const data = await res.json();
    const raw = data.agents || [];
    _members = raw.map(a => ({
      id:            a.id,
      name:          a.name || '',
      role:          a.role || '—',
      action:        a.current_action || 'Idle — awaiting task',
      status:        a.status || 'idle',
      score:         a.score ?? 0,
      system_prompt: a.system_prompt || '',
      model_alias:   a.model_alias || 'sonnet',
      history:       _stableHistory(a.id || a.name || 'x'),
    }));
    if (note) note.textContent = '';
    _renderCouncil(root);
    if (window.JX && typeof window.JX.staggerIn === 'function') {
      window.JX.staggerIn(container, '.cc-council-card', 0);
    }
    _wireButtons(root);
  } catch (e) {
    _members = DEMO_AGENTS.map(a => ({ ...a, history: _stableHistory(a.id), action: a.current_action || 'Idle' }));
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

  filtered.forEach(m => {
    const svg = container.querySelector(`[data-spark-id="${m.id}"]`);
    if (svg && m.history) _drawSparkline(svg, m.history);
  });
}

// ---- Rich card HTML ----

function _cardHtml(m) {
  const st       = m.status || 'idle';
  const scoreStr = m.score != null ? formatTelemetry(m.score) : '—';
  const dotAnim  = st === 'processing' ? ' cc-dot-processing' : (st === 'active' ? ' cc-dot-active-ring' : '');
  const dotColor = STATUS_COLOR[st] || STATUS_COLOR.standby;
  const isDemo   = m._demo ? ' cc-card-demo' : '';
  const portrait = getGlyph(m.name);
  const nameDisp = _esc(m.name).toUpperCase();
  const actionLbl = _esc(m.action || 'Idle — awaiting task');

  return `<div class="cc-council-card jx2-hud-frame${isDemo}" data-agent-id="${_esc(m.id)}" data-status="${st}">
    <span class="jx2-bracket-tl" aria-hidden="true"></span>
    <span class="jx2-bracket-br" aria-hidden="true"></span>

    <div class="cc-e1-card-body">
      <div class="cc-e1-portrait" aria-label="${nameDisp} portrait">${portrait}</div>

      <div class="cc-e1-main">
        <div class="cc-e1-header-row">
          <span class="cc-council-name cc-e1-name">${nameDisp}</span>
          <span class="cc-e1-role-chip">${_esc(m.role)}</span>
          <span class="cc-e1-status-dot cc-council-dot${dotAnim}"
            style="background:${dotColor}" title="${st}"></span>
        </div>

        <span class="cc-e1-action-line">Currently: <em>${actionLbl}</em></span>

        <div class="cc-e1-metrics-row">
          <span class="cc-council-score-chip jx2-stat-chip cc-e1-score"
            title="Score">${scoreStr}</span>
          <div class="cc-council-spark-wrap">
            <svg class="cc-council-spark" data-spark-id="${_esc(m.id)}"
              viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true"></svg>
          </div>
          <span class="cc-e1-tasks-badge" style="display:none">0 PENDING</span>
        </div>

        <div class="cc-council-actions cc-e1-actions">
          <button class="cc-council-action-btn cc-action-message"
            data-id="${_esc(m.id)}" data-action="message">[ MESSAGE ]</button>
          <button class="cc-council-action-btn cc-action-call"
            data-id="${_esc(m.id)}" data-action="call">[ CALL ]</button>
          <button class="cc-council-action-btn cc-action-invoke"
            data-id="${_esc(m.id)}" data-action="invoke">[ INVOKE ]</button>
          <button class="cc-council-action-btn cc-action-details"
            data-id="${_esc(m.id)}" data-action="details">[ DETAILS ]</button>
        </div>
      </div>
    </div>

    <div class="cc-invoke-pane" id="cc-invoke-${_esc(m.id)}" style="display:none">
      <div class="cc-invoke-input-row">
        <input class="cc-invoke-input" type="text" placeholder="Enter prompt for ${nameDisp}..."
          id="cc-invoke-input-${_esc(m.id)}" />
        <button class="cc-council-action-btn cc-action-send"
          data-id="${_esc(m.id)}" data-action="send">[ SEND ]</button>
      </div>
      <div class="cc-invoke-result" id="cc-invoke-result-${_esc(m.id)}"></div>
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
  const W = 120, H = 32, pad = 2;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', pts.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'var(--cc-accent)');
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('opacity', '0.7');
  const lastPt = pts[pts.length - 1].split(',');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', lastPt[0]);
  dot.setAttribute('cy', lastPt[1]);
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', 'var(--cc-accent)');
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

    if (action === 'message' || action === 'call') {
      _toast(root, `Coming soon — Phase E${action === 'message' ? '2' : '3'}`);
      return;
    }
    if (action === 'details') {
      const member = _members.find(m => m.id === id);
      if (member) _showDetails(root, member);
      return;
    }
    if (action === 'invoke') {
      _toggleInvokePane(root, id);
      return;
    }
    if (action === 'send') {
      await _sendInvoke(root, id);
      return;
    }
  });

  container.querySelectorAll('.cc-invoke-input').forEach(inp => {
    inp.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        const agentId = inp.id.replace('cc-invoke-input-', '');
        await _sendInvoke(root, agentId);
      }
    });
  });
}

// ---- Invoke pane ----

function _toggleInvokePane(root, id) {
  const pane = root.querySelector(`#cc-invoke-${id}`);
  if (!pane) return;
  const visible = pane.style.display !== 'none';
  pane.style.display = visible ? 'none' : 'block';
  if (!visible) {
    const inp = root.querySelector(`#cc-invoke-input-${id}`);
    if (inp) inp.focus();
  }
}

async function _sendInvoke(root, id) {
  const member = _members.find(m => m.id === id);
  if (!member) return;
  const inp = root.querySelector(`#cc-invoke-input-${id}`);
  const resultEl = root.querySelector(`#cc-invoke-result-${id}`);
  if (!inp || !resultEl) return;
  const prompt = inp.value.trim();
  if (!prompt) return;
  if (member._demo) {
    resultEl.textContent = '[DEMO] Cannot invoke demo agents. Reload to connect to the API.';
    return;
  }
  resultEl.textContent = 'Invoking...';
  inp.disabled = true;
  member.status = 'active';
  member.action = `Invoking: ${prompt.slice(0, 60)}`;
  _renderCouncil(root);
  _wireButtons(root);
  try {
    const res = await fetch(`${AGENTS_API}/${encodeURIComponent(id)}/invoke`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const txt = await res.text();
      resultEl.textContent = `Error ${res.status}: ${txt}`;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    resultEl.textContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const obj = JSON.parse(payload);
          if (obj.delta) { accumulated += obj.delta; resultEl.textContent = accumulated; }
          else if (obj.error) { resultEl.textContent = `Error: ${obj.error}`; }
        } catch (_) { /* non-JSON lines ignored */ }
      }
    }
    await _refreshAgent(root, id);
  } catch (err) {
    resultEl.textContent = `Stream error: ${err.message}`;
    if (member) { member.status = 'alert'; _renderCouncil(root); _wireButtons(root); }
  } finally {
    if (inp) inp.disabled = false;
  }
}

async function _refreshAgent(root, id) {
  try {
    const res = await fetch(AGENTS_API, { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    const fresh = (data.agents || []).find(a => a.id === id);
    if (!fresh) return;
    const idx = _members.findIndex(m => m.id === id);
    if (idx !== -1) {
      _members[idx] = {
        ..._members[idx],
        status:        fresh.status,
        score:         fresh.score,
        action:        fresh.current_action || 'Idle — awaiting task',
        system_prompt: fresh.system_prompt,
        model_alias:   fresh.model_alias,
      };
    }
    _renderCouncil(root);
    _wireButtons(root);
  } catch (_) { /* silent */ }
}

// ---- Details overlay ----

function _showDetails(root, m) {
  const overlay = root.querySelector('#cc-agent-details-overlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="cc-overlay-panel jx2-hud-frame">
      <span class="jx2-bracket-tl" aria-hidden="true"></span>
      <span class="jx2-bracket-br" aria-hidden="true"></span>
      <div class="cc-overlay-header">
        <span class="cc-overlay-title">AGENT / ${_esc(m.name).toUpperCase()}</span>
        <button class="cc-overlay-close" id="cc-overlay-close">[ CLOSE ]</button>
      </div>
      <div class="cc-overlay-body">
        <div class="cc-overlay-row"><span class="cc-overlay-lbl">ROLE</span><span>${_esc(m.role)}</span></div>
        <div class="cc-overlay-row"><span class="cc-overlay-lbl">STATUS</span><span>${_esc(m.status)}</span></div>
        <div class="cc-overlay-row"><span class="cc-overlay-lbl">MODEL</span><span>${_esc(m.model_alias || 'sonnet')}</span></div>
        <div class="cc-overlay-row"><span class="cc-overlay-lbl">SCORE</span><span>${formatTelemetry(m.score ?? 0)}</span></div>
        <div class="cc-overlay-row cc-overlay-prompt-row">
          <span class="cc-overlay-lbl">SYSTEM PROMPT</span>
          <textarea class="cc-overlay-prompt" id="cc-overlay-prompt-${_esc(m.id)}" rows="6" ${m._demo ? 'disabled' : ''}>${_esc(m.system_prompt || '')}</textarea>
        </div>
        ${!m._demo ? `<button class="cc-council-action-btn cc-action-save" data-id="${_esc(m.id)}" data-action="save-prompt">[ SAVE PROMPT ]</button>` : ''}
      </div>
    </div>`;
  overlay.style.display = 'block';
  overlay.querySelector('#cc-overlay-close').addEventListener('click', () => {
    overlay.style.display = 'none';
  });
  const saveBtn = overlay.querySelector('[data-action="save-prompt"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const ta = overlay.querySelector(`#cc-overlay-prompt-${m.id}`);
      if (!ta) return;
      saveBtn.disabled = true;
      try {
        const res = await fetch(`${AGENTS_API}/${encodeURIComponent(m.id)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system_prompt: ta.value }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = await res.json();
        const idx = _members.findIndex(x => x.id === m.id);
        if (idx !== -1) _members[idx].system_prompt = updated.system_prompt || '';
        saveBtn.textContent = '[ SAVED ]';
      } catch (err) {
        saveBtn.textContent = '[ ERROR ]';
        console.warn('[Council] save prompt failed', err);
      } finally {
        setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = '[ SAVE PROMPT ]'; }, 2000);
      }
    });
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
