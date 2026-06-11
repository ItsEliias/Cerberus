/**
 * static/js/cyberapps/dashboard/index.js
 * CyberOS Dashboard — Cerberus native app entry point.
 *
 * Views:
 *   - Dashboard   : operator profile card, ecosystem health bar,
 *                   app status grid (12 apps), active session banner,
 *                   activity feed (deduped events, live filter)
 *   - Profile     : stats row, streak calendar, skill radar, operator metrics
 *   - Ecosystem   : config inspector, shared context, app status table,
 *                   event log (search + filter + expand)
 *
 * Backend: /api/cyberapps/dashboard/{summary,events,statuses}
 * Data contract: each Wave-2 app writes status.json + events.json to
 *   data/cyberapps/<id>/<user>/  — Dashboard only reads, never writes.
 *
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import * as Api from './api.js';
import * as DashView from './view-dashboard.js';
import * as ProfileView from './view-profile.js';
import * as EcosystemView from './view-ecosystem.js';

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

(function injectCSS() {
  if (document.querySelector('[data-dashboard-css]')) return;
  [
    '/static/js/cyberapps/dashboard/dashboard.css',
    '/static/js/cyberapps/dashboard/dashboard-views.css',
  ].forEach((href, i) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (i === 0) link.dataset.dashboardCss = '1';
    document.head.appendChild(link);
  });
})();

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'profile',   label: 'Profile' },
  { id: 'ecosystem', label: 'Ecosystem' },
];

// ---------------------------------------------------------------------------
// Data polling
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000; // 10s refresh
let _pollTimer = null;

async function _fetchAll() {
  try {
    const [summaryData, eventsData] = await Promise.all([
      Api.fetchSummary(),
      Api.fetchEvents(100),
    ]);
    State.applySummary(summaryData);
    State.set('events', eventsData.events || []);
  } catch (err) {
    State.setError(err && err.message ? err.message : String(err));
  }
}

function _startPolling() {
  _fetchAll();
  _pollTimer = setInterval(_fetchAll, POLL_INTERVAL_MS);
}

function _stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------

let _activeViewMod = null;

function _mountView(viewId, contentEl) {
  if (_activeViewMod && typeof _activeViewMod.destroy === 'function') {
    _activeViewMod.destroy();
  }
  _activeViewMod = null;
  contentEl.innerHTML = '';

  switch (viewId) {
    case 'dashboard':  _activeViewMod = DashView;      DashView.init(contentEl);      break;
    case 'profile':    _activeViewMod = ProfileView;   ProfileView.init(contentEl);   break;
    case 'ecosystem':  _activeViewMod = EcosystemView; EcosystemView.init(contentEl); break;
    default: contentEl.textContent = 'Unknown view.';
  }
}

// ---------------------------------------------------------------------------
// Shell render
// ---------------------------------------------------------------------------

function _renderShell(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0a0a0f;">
      <div class="db-nav-bar" id="db-nav"></div>
      <div id="db-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
    </div>`;

  const navEl = container.querySelector('#db-nav');
  const contentEl = container.querySelector('#db-content');

  NAV_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'db-nav-btn';
    btn.dataset.view = item.id;
    btn.textContent = item.label;
    btn.addEventListener('click', () => _activateView(item.id, navEl, contentEl));
    navEl.appendChild(btn);
  });

  function _activateView(id, nav, content) {
    State.set('activeView', id);
    nav.querySelectorAll('[data-view]').forEach(b => {
      b.classList.toggle('db-nav-active', b.dataset.view === id);
    });
    _mountView(id, content);
  }

  // Start on dashboard view
  const startView = State.get('activeView') || 'dashboard';
  _activateView(startView, navEl, contentEl);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let _bootstrapped = false;

function init(container, _ctx) {
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  _renderShell(container);

  if (!_bootstrapped) {
    _bootstrapped = true;
    _startPolling();
  }
}

function destroy() {
  _stopPolling();
  if (_activeViewMod && typeof _activeViewMod.destroy === 'function') {
    _activeViewMod.destroy();
  }
  _activeViewMod = null;
  // Reset active view so re-open starts on dashboard
  State.set('activeView', 'dashboard');
  State.set('feedFilter', null);
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'dashboard',
    name: 'Dashboard',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
