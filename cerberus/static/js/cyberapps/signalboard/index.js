/**
 * static/js/cyberapps/signalboard/index.js
 * SignalBoard — Native CyberOS app entry point.
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import * as Api from './api.js';
import { refreshFeeds } from './feeds.js';
import { renderFeedView } from './view-feed.js';
import { renderTrendsView } from './view-trends.js';
import { renderSourcesView } from './view-sources.js';
import { renderBookmarksView } from './view-bookmarks.js';
import { renderTimelineView } from './view-timeline.js';
import { renderSettingsView } from './view-settings.js';

const CSS = `
@keyframes sb-spin { to { transform: rotate(360deg); } }
.sb-nav-btn {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px;
  border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 500;
  text-align: left; transition: background 0.15s, color 0.15s;
  background: transparent; color: rgba(139,148,158,0.7);
}
.sb-nav-btn:hover { background: rgba(42,51,71,0.4); color: #c5c9d0; }
.sb-nav-btn.active { background: rgba(255,107,107,0.12); color: #ff6b6b; }
`;

const NAV_ITEMS = [
  { id: 'feed',      label: 'Feed',      icon: '◉' },
  { id: 'trends',    label: 'Trends',    icon: '↗' },
  { id: 'timeline',  label: 'Timeline',  icon: '≡' },
  { id: 'bookmarks', label: 'Bookmarks', icon: '★' },
  { id: 'sources',   label: 'Sources',   icon: '⊞' },
  { id: 'settings',  label: 'Settings',  icon: '⚙' },
];

const VIEW_RENDERERS = {
  feed:      renderFeedView,
  trends:    renderTrendsView,
  timeline:  renderTimelineView,
  bookmarks: renderBookmarksView,
  sources:   renderSourcesView,
  settings:  renderSettingsView,
};

let _styleEl = null;
let _activeViewInstance = null;
let _navUnsub = null;
let _mainEl = null;
let _refreshInterval = null;

function _injectCss() {
  if (_styleEl) return;
  _styleEl = document.createElement('style');
  _styleEl.id = 'signalboard-css';
  _styleEl.textContent = CSS;
  document.head.appendChild(_styleEl);
}

async function _bootstrap() {
  try {
    const [bkData, stData, ruData, ctxData] = await Promise.all([
      Api.getBookmarks().catch(() => ({ bookmarks: [], tags: {} })),
      Api.getSettings().catch(() => ({ settings: {} })),
      Api.getAlertRules().catch(() => ({ rules: [] })),
      Api.getContext().catch(() => ({ context: {} })),
    ]);
    State.setBookmarks(bkData.bookmarks || []);
    State.setBookmarkTags(bkData.tags || {});
    State.setSettings(stData.settings || {});
    State.setAlertRules(ruData.rules || []);
    State.setContext(ctxData.context || {});
  } catch { /* non-fatal */ }
  await refreshFeeds();
}

function _switchView(viewId, navEl) {
  if (_activeViewInstance?.destroy) _activeViewInstance.destroy();
  _activeViewInstance = null;
  if (!_mainEl) return;
  _mainEl.innerHTML = '';
  navEl?.querySelectorAll('.sb-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  const renderer = VIEW_RENDERERS[viewId] || VIEW_RENDERERS.feed;
  _activeViewInstance = renderer(_mainEl);
}

function _renderShell(container) {
  container.innerHTML = '';
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#0d1117;color:#c5c9d0;overflow:hidden;';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(42,51,71,0.5);flex-shrink:0;';
  header.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" style="flex-shrink:0;">
      <path d="M5 12a7 7 0 0 1 7-7"/><path d="M5 12a9 9 0 0 1 9-9"/><circle cx="5" cy="12" r="1" fill="#ff6b6b"/>
    </svg>
    <span style="font-size:13px;font-weight:600;color:#c5c9d0;flex:1;">SignalBoard</span>
    <span id="sb-last" style="font-size:9px;color:#3a424f;font-family:monospace;"></span>
    <button id="sb-refresh" style="display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:rgba(42,51,71,0.3);border:1px solid rgba(42,51,71,0.5);color:#8b949e;font-size:11px;cursor:pointer;">
      <svg id="sb-spin-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
      Refresh
    </button>`;
  container.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex:1;overflow:hidden;';

  // Nav
  const nav = document.createElement('div');
  nav.id = 'sb-nav';
  nav.style.cssText = 'width:140px;flex-shrink:0;padding:10px 8px;border-right:1px solid rgba(42,51,71,0.4);display:flex;flex-direction:column;gap:2px;overflow-y:auto;';
  nav.innerHTML = NAV_ITEMS.map(n =>
    `<button class="sb-nav-btn${n.id==='feed'?' active':''}" data-view="${n.id}"><span style="font-size:13px;">${n.icon}</span>${n.label}</button>`
  ).join('');
  body.appendChild(nav);

  // Main
  _mainEl = document.createElement('div');
  _mainEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
  body.appendChild(_mainEl);
  container.appendChild(body);

  // Nav click
  nav.querySelectorAll('.sb-nav-btn').forEach(btn => btn.addEventListener('click', () => {
    State.setActiveView(btn.dataset.view);
  }));

  // Refresh button
  header.querySelector('#sb-refresh')?.addEventListener('click', () => refreshFeeds());

  // Refresh spinner & last-refreshed
  State.subscribe('refreshing', refreshing => {
    const icon = header.querySelector('#sb-spin-icon');
    if (icon) icon.style.animation = refreshing ? 'sb-spin 1s linear infinite' : '';
  });
  State.subscribe('lastRefreshed', ts => {
    const el = header.querySelector('#sb-last');
    if (el && ts) el.textContent = `Updated ${new Date(ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
  });

  // Active view subscriber
  _navUnsub = State.subscribe('activeView', viewId => _switchView(viewId, nav));
  _switchView('feed', nav);
}

function _startAutoRefresh() {
  const cfg = State.get('settings') || {};
  const ms = ((cfg.refreshInterval) || 30) * 60 * 1000;
  if (_refreshInterval) clearInterval(_refreshInterval);
  _refreshInterval = setInterval(() => refreshFeeds(), ms);
}

const app = {
  init(container, _ctx) {
    _injectCss();
    _renderShell(container);
    _bootstrap().then(() => _startAutoRefresh());
    State.subscribe('settings', () => _startAutoRefresh());
  },
  destroy() {
    if (_navUnsub) { _navUnsub(); _navUnsub = null; }
    if (_activeViewInstance?.destroy) { _activeViewInstance.destroy(); _activeViewInstance = null; }
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
    if (_styleEl) { _styleEl.remove(); _styleEl = null; }
    _mainEl = null;
  },
};

if (typeof window !== 'undefined') {
  window.CYBER_APPS_REGISTRY = window.CYBER_APPS_REGISTRY || [];
  window.CYBER_APPS_REGISTRY.push({
    id: 'signalboard',
    name: 'SignalBoard',
    icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12a7 7 0 0 1 7-7"/><path d="M5 12a9 9 0 0 1 9-9"/><circle cx="5" cy="12" r="1" fill="currentColor"/></svg>`,
    vault: false,
    init: (container, ctx) => app.init(container, ctx),
    destroy: () => app.destroy(),
  });
}

export default app;
