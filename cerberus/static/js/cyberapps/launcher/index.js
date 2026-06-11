/**
 * static/js/cyberapps/launcher/index.js
 * Launcher — Cerberus native app entry point.
 *
 * Unique features (not covered by the existing pill-nav):
 *   - Global fuzzy search across all registered Cyber Apps
 *   - Recent / most-launched apps grid with launch-count tracking
 *   - Pinned apps (user-defined favourites)
 *   - Custom shortcut slots (links to external tools / docs / URLs)
 *   - Activity feed (recent ecosystem events)
 *
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------
(function injectCSS() {
  if (document.querySelector('[data-launcher-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/js/cyberapps/launcher/launcher.css';
  link.dataset.launcherCss = '1';
  document.head.appendChild(link);
})();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API = '/api/cyberapps/launcher';

/** App accent colors for search result dots */
const APP_DOTS = {
  cyberlab:       '#b44fff',
  vaultcore:      '#22d3ee',
  ghostvault:     '#6366f1',
  recondesk:      '#f85149',
  signalboard:    '#4a9eff',
  credvault:      '#d29922',
  playbookstudio: '#a371f7',
  reportforge:    '#ec4899',
  terminallink:   '#f97316',
  networkmap:     '#3fb950',
  netlab:         '#06b6d4',
  launcher:       '#c0392b',
};

const TABS = ['apps', 'activity'];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let _container = null;
let _ctx = null;
let _state = {
  tab: 'apps',
  query: '',
  slots: [],
  pinned: [],
  launchCounts: {},
  activity: [],
  loading: true,
  modalOpen: false,
  modalSlot: null,   // null = create; object = edit
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function _get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function _post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

async function _put(path, body) {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json();
}

async function _delete(path) {
  const res = await fetch(API + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Data bootstrap
// ---------------------------------------------------------------------------

async function _bootstrap() {
  try {
    const [slotsRes, pinnedRes, launchRes, activityRes] = await Promise.all([
      _get('/slots').catch(() => ({ slots: [] })),
      _get('/pinned').catch(() => ({ pinned: [] })),
      _get('/launches').catch(() => ({ counts: {} })),
      _get('/activity').catch(() => ({ entries: [] })),
    ]);
    _state.slots = slotsRes.slots || [];
    _state.pinned = pinnedRes.pinned || [];
    _state.launchCounts = launchRes.counts || {};
    _state.activity = activityRes.entries || [];
    _state.loading = false;
    _render();
  } catch (err) {
    console.error('[Launcher] bootstrap error:', err);
    _state.loading = false;
    _render();
  }
}

// ---------------------------------------------------------------------------
// Launch tracking
// ---------------------------------------------------------------------------

async function _recordLaunch(appId) {
  try {
    const res = await _post('/launches', { app_id: appId });
    _state.launchCounts[appId] = res.count || (_state.launchCounts[appId] || 0) + 1;
  } catch (_) { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Fuzzy search
// ---------------------------------------------------------------------------

function _fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0, matched = 0;
  for (const c of q) {
    const i = t.indexOf(c, ti);
    if (i === -1) return 0;
    matched++;
    ti = i + 1;
  }
  return matched;
}

/** Build the full search command list from the registry. */
function _buildCommands() {
  const registry = window.CYBER_APPS_REGISTRY || [];
  const apps = registry.map(app => ({
    id: `app:${app.id}`,
    label: app.name,
    hint: 'Open app',
    group: 'App',
    accent: APP_DOTS[app.id] || '#8b949e',
    run: () => _activateApp(app.id),
  }));

  const slotCmds = _state.slots.map(s => ({
    id: `slot:${s.id}`,
    label: s.name,
    hint: s.url || 'Custom shortcut',
    group: 'Shortcut',
    accent: '#d29922',
    run: () => s.url && window.open(s.url, '_blank', 'noopener'),
  }));

  return [...apps, ...slotCmds];
}

function _filterCommands(query) {
  const commands = _buildCommands();
  if (!query) return commands;
  return commands
    .map(c => {
      const text = [c.label, c.hint].filter(Boolean).join(' ');
      return { c, score: _fuzzyScore(query, text) };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
}

/** Activate an app through the Cyber Apps panel mechanism. */
function _activateApp(appId) {
  _recordLaunch(appId);
  // Dispatch to cyberapps/index.js which manages the panel lifecycle
  document.dispatchEvent(new CustomEvent('cyberapp:activate', { detail: { id: appId } }));
}

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

function _fmtTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000), m = Math.floor(s / 60),
          h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 60) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d === 1) return 'Yesterday';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (_) { return ''; }
}

function _esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------

function _buildStats() {
  const registry = window.CYBER_APPS_REGISTRY || [];
  const totalApps = registry.length;
  const totalLaunches = Object.values(_state.launchCounts).reduce((a, b) => a + b, 0);
  const pinnedCount = _state.pinned.length;
  const activityCount = _state.activity.length;
  return { totalApps, totalLaunches, pinnedCount, activityCount };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function _renderStatsHtml() {
  const s = _buildStats();
  return `
    <div class="la-stats">
      <div class="la-stat">
        <span class="la-stat-val${s.totalApps > 0 ? ' la-has-val' : ''}">${s.totalApps}</span>
        <span class="la-stat-label">Apps</span>
      </div>
      <div class="la-stat">
        <span class="la-stat-val${s.totalLaunches > 0 ? ' la-has-val' : ''}">${s.totalLaunches}</span>
        <span class="la-stat-label">Launches</span>
      </div>
      <div class="la-stat">
        <span class="la-stat-val${s.pinnedCount > 0 ? ' la-has-val' : ''}">${s.pinnedCount}</span>
        <span class="la-stat-label">Pinned</span>
      </div>
      <div class="la-stat">
        <span class="la-stat-val${s.activityCount > 0 ? ' la-has-val' : ''}">${s.activityCount}</span>
        <span class="la-stat-label">Events</span>
      </div>
    </div>
  `;
}

function _renderSearchHtml() {
  return `
    <div class="la-search-wrap">
      <div class="la-search-row">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          class="la-search-input"
          id="la-search-input"
          placeholder="Search apps and shortcuts…"
          autocomplete="off"
          value="${_esc(_state.query)}"
        />
        <span class="la-search-hint">⌘F</span>
      </div>
    </div>
  `;
}

function _renderTabsHtml() {
  return `
    <div class="la-tabs">
      ${TABS.map(t => `
        <button class="la-tab${_state.tab === t ? ' la-tab-active' : ''}" data-tab="${t}">
          ${t === 'apps' ? 'Apps' : 'Activity'}
        </button>
      `).join('')}
    </div>
  `;
}

function _renderAppsTabHtml() {
  const registry = window.CYBER_APPS_REGISTRY || [];

  // Sort apps by launch count (most launched first), pinned get a star
  const sorted = [...registry].sort((a, b) => {
    const ca = _state.launchCounts[a.id] || 0;
    const cb = _state.launchCounts[b.id] || 0;
    return cb - ca;
  });

  const appTiles = sorted.map(app => {
    const isPinned = _state.pinned.includes(app.id);
    const count = _state.launchCounts[app.id] || 0;
    const initials = (app.name || '?').slice(0, 2).toUpperCase();
    const dot = APP_DOTS[app.id] || '#8b949e';
    return `
      <div class="la-app-tile${isPinned ? ' la-pinned-badge' : ''}"
           data-app-id="${_esc(app.id)}"
           title="${_esc(app.name)} — click to open${count > 0 ? ' · ' + count + ' launches' : ''}">
        <div class="la-app-icon" style="background:${dot}22;color:${dot};">
          ${_esc(initials)}
        </div>
        <span class="la-app-name">${_esc(app.name)}</span>
        ${count > 0 ? `<span class="la-app-count">${count}×</span>` : ''}
      </div>
    `;
  }).join('');

  const slotsHtml = _renderSlotsHtml();

  return `
    <div class="la-content">
      ${registry.length > 0 ? `
        <div class="la-section-header">
          <span class="la-section-title">All Apps</span>
        </div>
        <div class="la-app-grid" id="la-app-grid">
          ${appTiles}
        </div>
      ` : `
        <div class="la-activity-empty">No apps registered yet.</div>
      `}
      <div class="la-section-header">
        <span class="la-section-title">Custom Shortcuts</span>
      </div>
      ${slotsHtml}
    </div>
  `;
}

function _renderSlotsHtml() {
  const cards = _state.slots.map(slot => {
    const initial = (slot.name || '?').charAt(0).toUpperCase();
    return `
      <div class="la-slot-card" data-slot-id="${_esc(slot.id)}">
        <div class="la-slot-card-header">
          <div class="la-slot-avatar">${_esc(initial)}</div>
          <div style="min-width:0;flex:1;">
            <div class="la-slot-name">${_esc(slot.name)}</div>
            ${slot.description ? `<div class="la-slot-desc">${_esc(slot.description)}</div>` : ''}
            ${slot.url ? `<div class="la-slot-url">${_esc(slot.url)}</div>` : ''}
          </div>
        </div>
        <div class="la-slot-actions">
          ${slot.url ? `<button class="la-slot-btn la-slot-btn-open" data-slot-open="${_esc(slot.id)}">Open →</button>` : ''}
          <button class="la-slot-btn" data-slot-edit="${_esc(slot.id)}">Edit</button>
          <button class="la-slot-btn la-slot-btn-del" data-slot-del="${_esc(slot.id)}" title="Delete">✕</button>
        </div>
      </div>
    `;
  }).join('');

  const canAdd = _state.slots.length < 8;
  return `
    <div class="la-slot-grid">${cards}</div>
    ${canAdd ? `
      <button class="la-slot-add-btn" id="la-slot-add-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add shortcut
      </button>
    ` : ''}
  `;
}

function _renderActivityTabHtml() {
  if (_state.activity.length === 0) {
    return `
      <div class="la-content">
        <div class="la-section-header">
          <span class="la-section-title">Recent Activity</span>
        </div>
        <div class="la-activity-empty">
          No activity yet.<br>
          <span style="font-size:10px;opacity:.6;">Events from Cyber Apps appear here.</span>
        </div>
      </div>
    `;
  }

  const items = _state.activity.map(e => {
    const dot = APP_DOTS[e.app?.toLowerCase()] || '#8b949e';
    return `
      <div class="la-activity-item">
        <div class="la-activity-dot" style="background:${dot};"></div>
        <div class="la-activity-body">
          <div class="la-activity-app">${_esc(e.app || 'Unknown')}</div>
          <div class="la-activity-event">${_esc(e.event || '')}</div>
          <div class="la-activity-time">${_esc(_fmtTime(e.timestamp))}</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="la-content">
      <div class="la-section-header">
        <span class="la-section-title">Recent Activity</span>
        <button class="la-section-action" id="la-clear-activity">Clear</button>
      </div>
      <div class="la-activity-list">${items}</div>
    </div>
  `;
}

function _renderSearchResultsHtml() {
  const results = _filterCommands(_state.query);
  if (results.length === 0) {
    return `
      <div class="la-content">
        <div class="la-no-results">No matches for "${_esc(_state.query)}"</div>
      </div>
    `;
  }

  const groups = {};
  for (const r of results) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }

  let html = '<div class="la-content"><div class="la-results">';
  for (const [group, items] of Object.entries(groups)) {
    html += `<div class="la-result-group-label">${_esc(group)}</div>`;
    for (const item of items) {
      html += `
        <div class="la-result-item" data-run-id="${_esc(item.id)}">
          <div class="la-result-dot" style="background:${item.accent};"></div>
          <span class="la-result-label">${_esc(item.label)}</span>
          ${item.hint ? `<span class="la-result-hint">${_esc(item.hint)}</span>` : ''}
        </div>
      `;
    }
  }
  html += '</div></div>';
  return html;
}

function _renderModalHtml() {
  if (!_state.modalOpen) return '';
  const slot = _state.modalSlot;
  const isEdit = !!slot;
  return `
    <div class="la-modal-overlay" id="la-modal-overlay">
      <div class="la-modal">
        <div class="la-modal-title">${isEdit ? 'Edit Shortcut' : 'Add Shortcut'}</div>
        <div class="la-modal-field">
          <div class="la-modal-label">Name *</div>
          <input class="la-modal-input" id="la-modal-name" placeholder="My Tool"
                 value="${_esc(slot?.name || '')}" maxlength="64"/>
        </div>
        <div class="la-modal-field">
          <div class="la-modal-label">URL</div>
          <input class="la-modal-input" id="la-modal-url" placeholder="https://…"
                 value="${_esc(slot?.url || '')}" maxlength="512"/>
        </div>
        <div class="la-modal-field">
          <div class="la-modal-label">Description</div>
          <input class="la-modal-input" id="la-modal-desc" placeholder="Optional note"
                 value="${_esc(slot?.description || '')}" maxlength="256"/>
        </div>
        <div class="la-modal-actions">
          <button class="la-modal-btn la-modal-btn-cancel" id="la-modal-cancel">Cancel</button>
          <button class="la-modal-btn la-modal-btn-save" id="la-modal-save">
            ${isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function _render() {
  if (!_container) return;

  const bodyHtml = _state.query
    ? _renderSearchResultsHtml()
    : (_state.tab === 'apps' ? _renderAppsTabHtml() : _renderActivityTabHtml());

  _container.innerHTML = `
    <div class="la-shell">
      ${_renderStatsHtml()}
      ${_renderSearchHtml()}
      ${!_state.query ? _renderTabsHtml() : ''}
      ${bodyHtml}
      ${_renderModalHtml()}
    </div>
  `;

  _wireEvents();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function _wireEvents() {
  if (!_container) return;

  // Search input
  const searchInput = _container.querySelector('#la-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      _state.query = e.target.value;
      _render();
      // Re-focus the input after re-render
      const newInput = _container.querySelector('#la-search-input');
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(newInput.value.length, newInput.value.length);
      }
    });
    // Focus search on Cmd+F
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        _state.query = '';
        _render();
      }
    });
  }

  // Cmd+F global shortcut
  _container.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      const input = _container.querySelector('#la-search-input');
      if (input) input.focus();
    }
  });

  // Tab buttons
  _container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.tab = btn.dataset.tab;
      _render();
    });
  });

  // App tiles
  _container.querySelectorAll('[data-app-id]').forEach(tile => {
    tile.addEventListener('click', () => _activateApp(tile.dataset.appId));
    tile.addEventListener('contextmenu', e => {
      e.preventDefault();
      _togglePin(tile.dataset.appId);
    });
  });

  // Search results
  _container.querySelectorAll('[data-run-id]').forEach(row => {
    row.addEventListener('click', () => {
      const commands = _buildCommands();
      const cmd = commands.find(c => c.id === row.dataset.runId);
      if (cmd) cmd.run();
    });
  });

  // Slot: open
  _container.querySelectorAll('[data-slot-open]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slot = _state.slots.find(s => s.id === btn.dataset.slotOpen);
      if (slot?.url) window.open(slot.url, '_blank', 'noopener');
    });
  });

  // Slot: edit
  _container.querySelectorAll('[data-slot-edit]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slot = _state.slots.find(s => s.id === btn.dataset.slotEdit);
      if (slot) _openModal(slot);
    });
  });

  // Slot: delete
  _container.querySelectorAll('[data-slot-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _deleteSlot(btn.dataset.slotDel);
    });
  });

  // Add slot button
  const addBtn = _container.querySelector('#la-slot-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => _openModal(null));

  // Clear activity
  const clearBtn = _container.querySelector('#la-clear-activity');
  if (clearBtn) clearBtn.addEventListener('click', _clearActivity);

  // Modal
  const cancelBtn = _container.querySelector('#la-modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', _closeModal);

  const saveBtn = _container.querySelector('#la-modal-save');
  if (saveBtn) saveBtn.addEventListener('click', _saveSlot);

  const overlay = _container.querySelector('#la-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) _closeModal();
    });
  }
}

// ---------------------------------------------------------------------------
// Pin / unpin
// ---------------------------------------------------------------------------

async function _togglePin(appId) {
  const idx = _state.pinned.indexOf(appId);
  if (idx === -1) {
    _state.pinned.push(appId);
  } else {
    _state.pinned.splice(idx, 1);
  }
  try {
    await _put('/pinned', { pinned: _state.pinned });
  } catch (err) {
    console.error('[Launcher] pin save error:', err);
  }
  _render();
}

// ---------------------------------------------------------------------------
// Slot modal
// ---------------------------------------------------------------------------

function _openModal(slot) {
  _state.modalOpen = true;
  _state.modalSlot = slot || null;
  _render();
  setTimeout(() => {
    const input = _container?.querySelector('#la-modal-name');
    if (input) input.focus();
  }, 50);
}

function _closeModal() {
  _state.modalOpen = false;
  _state.modalSlot = null;
  _render();
}

async function _saveSlot() {
  const nameEl = _container?.querySelector('#la-modal-name');
  const urlEl = _container?.querySelector('#la-modal-url');
  const descEl = _container?.querySelector('#la-modal-desc');
  if (!nameEl) return;

  const name = nameEl.value.trim();
  const url = urlEl?.value.trim() || '';
  const description = descEl?.value.trim() || '';

  if (!name) {
    if (nameEl) {
      nameEl.classList.add('la-input-error');
      setTimeout(() => nameEl.classList.remove('la-input-error'), 2000);
    }
    return;
  }

  try {
    const slot = _state.modalSlot;
    if (slot) {
      const res = await fetch(`${API}/slots/${encodeURIComponent(slot.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, description }),
      });
      const data = await res.json();
      const idx = _state.slots.findIndex(s => s.id === slot.id);
      if (idx !== -1) _state.slots[idx] = data.slot;
    } else {
      const data = await _post('/slots', { name, url, description });
      _state.slots.push(data.slot);
    }
    _closeModal();
  } catch (err) {
    console.error('[Launcher] save slot error:', err);
  }
}

async function _deleteSlot(slotId) {
  try {
    await _delete(`/slots/${encodeURIComponent(slotId)}`);
    _state.slots = _state.slots.filter(s => s.id !== slotId);
    _render();
  } catch (err) {
    console.error('[Launcher] delete slot error:', err);
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

async function _clearActivity() {
  try {
    await _delete('/activity');
    _state.activity = [];
    _render();
  } catch (err) {
    console.error('[Launcher] clear activity error:', err);
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  _container.style.height = '100%';
  _container.style.overflow = 'hidden';
  _state = {
    tab: 'apps',
    query: '',
    slots: [],
    pinned: [],
    launchCounts: {},
    activity: [],
    loading: true,
    modalOpen: false,
    modalSlot: null,
  };
  _render();
  _bootstrap();
}

function destroy() {
  _container = null;
  _ctx = null;
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'launcher',
    name: 'Launcher',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
