/**
 * static/js/cyberapps/dashboard/view-ecosystem.js
 * Dashboard — Ecosystem view: config inspector, shared context inspector,
 * app status table, event log with search + filter.
 */

import * as State from './state.js';
import { esc, timeAgo, humanizeEvent, appAccentColor, buildAppCards } from './utils.js';

// ---------------------------------------------------------------------------
// App Status Table
// ---------------------------------------------------------------------------

function renderAppStatusTable(cards, events) {
  // Build last-event map
  const lastEventMap = {};
  for (const e of events) {
    const key = (e.app || e.appName || '').toLowerCase().replace(/\s+/g, '');
    if (!lastEventMap[key]) lastEventMap[key] = humanizeEvent(e.event || e.eventType || '');
  }

  const rows = cards.map(card => {
    const nameKey = card.name.toLowerCase().replace(/\s+/g, '');
    const lastEvt = lastEventMap[nameKey] || lastEventMap[card.id] || '—';
    return `
      <tr class="db-table-row">
        <td class="db-table-td">
          <div class="db-table-app-cell">
            <span class="db-dot db-dot--sm" style="background:${card.accentColor};opacity:${card.active?1:0.35};${card.active?`box-shadow:0 0 5px ${card.accentColor}88`:''}"></span>
            <span style="font-weight:500;color:var(--fg)">${esc(card.name)}</span>
          </div>
        </td>
        <td class="db-table-td">
          <span class="db-status-badge" style="${card.active ? 'background:rgba(63,185,80,0.12);color:#3fb950;border-color:rgba(63,185,80,0.25)' : 'background:rgba(72,79,88,0.25);color:rgba(197,201,208,0.4);border-color:rgba(72,79,88,0.3)'}">
            <span class="db-dot db-dot--xs" style="background:${card.active ? '#3fb950' : 'rgba(197,201,208,0.4)'}"></span>
            ${card.active ? 'Online' : 'Offline'}
          </span>
        </td>
        <td class="db-table-td db-mono" style="font-size:11px;color:rgba(197,201,208,0.6)">${timeAgo(card.lastActive)}</td>
        <td class="db-table-td">
          <span class="db-mono" style="font-weight:600;color:${card.accentColor}">${esc(String(card.metrics[0]?.value ?? '—'))}</span>
          ${card.metrics[0]?.label ? `<span style="font-size:10px;color:rgba(197,201,208,0.4);margin-left:4px">${esc(card.metrics[0].label)}</span>` : ''}
        </td>
        <td class="db-table-td" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(197,201,208,0.4);font-size:10px" title="${esc(lastEvt)}">${esc(lastEvt)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="db-glass-panel" style="margin-bottom:20px">
      <div class="db-panel-header">
        <span class="db-section-label">App Status Table</span>
        <span class="db-mono" style="font-size:11px">
          <span style="color:#3fb950">${cards.filter(c=>c.active).length}</span>/${cards.length} online
        </span>
      </div>
      <div style="overflow-x:auto">
        <table class="db-status-table">
          <thead>
            <tr>
              ${['App','Status','Last Active','Key Metric','Last Event'].map(h=>`<th class="db-table-th">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

let _search = '';
let _appFilter = null;
let _expandedId = null;
let _onSearchChange = null;

function renderEventLog(events) {
  const normalized = events.map(e => ({
    id: e.id || String(Math.random()),
    app: e.app || e.appName || 'Unknown',
    event: e.event || e.eventType || 'unknown',
    timestamp: e.timestamp,
    data: e.data || {},
  }));

  const appNames = [...new Set(normalized.map(e => e.app))];
  const filtered = normalized.filter(e => {
    if (_appFilter && e.app.toLowerCase() !== _appFilter.toLowerCase()) return false;
    if (_search) {
      const q = _search.toLowerCase();
      return e.app.toLowerCase().includes(q) || e.event.toLowerCase().includes(q) || JSON.stringify(e.data).toLowerCase().includes(q);
    }
    return true;
  });

  const rows = filtered.map((ev, rowIdx) => {
    const accent = appAccentColor(ev.app);
    const isExpanded = _expandedId === ev.id;
    return `
      <div class="db-event-row" data-id="${esc(ev.id)}">
        <div class="db-event-row-main">
          <span class="db-mono" style="font-size:10px;color:rgba(197,201,208,0.4);width:52px;flex-shrink:0">${timeAgo(ev.timestamp)}</span>
          <span class="db-mono" style="font-size:10px;font-weight:600;width:80px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${accent}">${esc(ev.app)}</span>
          <span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(humanizeEvent(ev.event))}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:rgba(197,201,208,0.4);transform:rotate(${isExpanded?'180deg':'0deg'})"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        ${isExpanded ? `
          <div class="db-event-row-detail">
            <pre class="db-mono" style="font-size:10px;color:rgba(197,201,208,0.6);white-space:pre-wrap">${esc(JSON.stringify(ev.data, null, 2))}</pre>
          </div>` : ''}
      </div>`;
  }).join('');

  const appOpts = appNames.map(a => `<option value="${esc(a)}"${_appFilter===a?' selected':''}>${esc(a)}</option>`).join('');

  return `
    <div class="db-glass-panel">
      <div class="db-panel-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="db-section-label">Event Log</span>
          <span class="db-mono" style="font-size:10px;background:rgba(74,158,255,0.1);color:var(--accent,#4a9eff);padding:1px 6px;border-radius:4px">${filtered.length}</span>
        </div>
      </div>
      <div class="db-event-filters">
        <div class="db-event-search-wrap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:rgba(197,201,208,0.4)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="db-event-search" type="text" placeholder="Search events…" value="${esc(_search)}" class="db-event-search"/>
        </div>
        <select id="db-event-app-filter" class="db-event-filter-select">
          <option value="">All Apps</option>
          ${appOpts}
        </select>
      </div>
      <div class="db-event-log-scroll" id="db-event-log-rows">${rows.length ? rows : `<div style="padding:32px;text-align:center;font-size:12px;color:rgba(197,201,208,0.4)">No events match your filters</div>`}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Shared Context Inspector + Config Inspector (side by side)
// ---------------------------------------------------------------------------

function renderInspectorPair(summary) {
  const ctx = summary?.shared_context;
  const statuses = summary?.app_statuses || {};

  const ctxHtml = ctx
    ? Object.entries(ctx).map(([k, v]) => `
        <div class="db-inspect-row">
          <span class="db-mono db-inspect-key">${esc(k)}</span>
          <span class="db-mono db-inspect-val">${v !== null ? esc(String(v)) : '<span style="color:rgba(197,201,208,0.3)">null</span>'}</span>
        </div>`).join('')
    : '<div style="color:rgba(197,201,208,0.4);font-size:11px;padding:16px">No shared context available.<br>CyberLab writes shared_context.json when a session is active.</div>';

  const healthPct = summary?.health?.percent ?? 0;

  return `
    <div class="db-inspector-grid" style="margin-bottom:20px">
      <div class="db-glass-panel">
        <div class="db-panel-header"><span class="db-section-label">Shared Context</span></div>
        <div class="db-inspect-body">${ctxHtml}</div>
      </div>
      <div class="db-glass-panel">
        <div class="db-panel-header"><span class="db-section-label">Ecosystem Overview</span></div>
        <div class="db-inspect-body">
          <div class="db-inspect-row">
            <span class="db-mono db-inspect-key">health_percent</span>
            <span class="db-mono" style="color:${healthPct>=75?'#3fb950':healthPct>=40?'#d29922':'#f85149'}">${healthPct}%</span>
          </div>
          <div class="db-inspect-row">
            <span class="db-mono db-inspect-key">apps_online</span>
            <span class="db-mono db-inspect-val">${summary?.health?.active ?? 0}</span>
          </div>
          <div class="db-inspect-row">
            <span class="db-mono db-inspect-key">apps_total</span>
            <span class="db-mono db-inspect-val">${summary?.health?.total ?? 0}</span>
          </div>
          ${Object.entries(statuses).map(([k, v]) => `
            <div class="db-inspect-row">
              <span class="db-mono db-inspect-key">${esc(k)}_active</span>
              <span class="db-mono" style="color:${v.active?'#3fb950':'rgba(197,201,208,0.4)'}">${v.active ? 'true' : 'false'}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

let _unsub = null;
let _unsubEvents = null;

function _render(container) {
  const summary = State.get('summary') || {};
  const events = State.get('events') || [];
  const statuses = summary.app_statuses || {};
  const cards = buildAppCards(statuses);
  const loading = State.get('loading');

  if (loading) {
    container.innerHTML = '<div class="db-loading"><span class="db-spinner"></span><span>Loading ecosystem…</span></div>';
    return;
  }

  const totalApps = Object.keys(statuses).length;

  container.innerHTML = `
    <div class="db-ecosystem-view">
      <div class="db-eco-page-header">
        <h2 class="db-eco-title">Ecosystem Status</h2>
        <div style="display:flex;gap:8px">
          <div class="db-eco-stat-chip" style="background:rgba(74,158,255,0.08);border-color:rgba(74,158,255,0.2)">
            <span class="db-mono" style="color:var(--accent,#4a9eff)">${totalApps}</span>
            <span style="color:rgba(197,201,208,0.5)">Apps</span>
          </div>
          <div class="db-eco-stat-chip" style="background:rgba(63,185,80,0.08);border-color:rgba(63,185,80,0.2)">
            <span class="db-mono" style="color:#3fb950">${events.length}</span>
            <span style="color:rgba(197,201,208,0.5)">Events</span>
          </div>
        </div>
      </div>
      ${renderInspectorPair(summary)}
      ${renderAppStatusTable(cards, events)}
      <div id="db-event-log-container">${renderEventLog(events)}</div>
    </div>`;

  // Wire event log interactions
  const searchInput = container.querySelector('#db-event-search');
  const appSelect = container.querySelector('#db-event-app-filter');
  const logContainer = container.querySelector('#db-event-log-container');

  function _reRenderLog() {
    if (logContainer) {
      logContainer.innerHTML = renderEventLog(State.get('events') || []);
      _rewire(container);
    }
  }

  function _rewire(root) {
    const si = root.querySelector('#db-event-search');
    const as = root.querySelector('#db-event-app-filter');
    const rows = root.querySelector('#db-event-log-rows');

    if (si) si.addEventListener('input', (e) => { _search = e.target.value; _reRenderLog(); });
    if (as) as.addEventListener('change', (e) => { _appFilter = e.target.value || null; _reRenderLog(); });
    if (rows) {
      rows.querySelectorAll('.db-event-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          _expandedId = _expandedId === id ? null : id;
          _reRenderLog();
        });
      });
    }
  }

  _rewire(container);
}

export function init(container) {
  container.style.overflow = 'auto';
  container.style.padding = '24px';
  _render(container);
  _unsub = State.subscribe('summary', () => _render(container));
  _unsubEvents = State.subscribe('events', () => _render(container));
}

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_unsubEvents) { _unsubEvents(); _unsubEvents = null; }
  _search = '';
  _appFilter = null;
  _expandedId = null;
}
