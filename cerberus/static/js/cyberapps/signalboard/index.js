/**
 * static/js/cyberapps/signalboard/index.js
 * SignalBoard — Cerberus native app entry point.
 * Security intelligence RSS/Atom feed aggregator with relevance scoring,
 * alert rules, bookmarks, trends analytics, and timeline view.
 *
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import * as Api from './api.js';
import * as Feeds from './feeds.js';
import { renderFeedView } from './view-feed.js';
import { renderTrendsView } from './view-trends.js';
import { renderSourcesView } from './view-sources.js';
import { renderBookmarksView } from './view-bookmarks.js';
import { renderTimelineView } from './view-timeline.js';
import { renderSettingsView } from './view-settings.js';

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

(function injectCSS() {
  if (document.querySelector('[data-signalboard-css]')) return;
  const style = document.createElement('style');
  style.dataset.signalboardCss = '1';
  style.textContent = `
    @keyframes sb-spin { to { transform: rotate(360deg); } }
    .sb-nav-btn {
      display: flex; align-items: center; gap: 8px;
      width: 100%; padding: 8px 12px;
      background: none; border: none; cursor: pointer;
      font-size: 12px; color: #8b949e; text-align: left;
      border-left: 2px solid transparent;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .sb-nav-btn:hover { background: rgba(42,51,71,0.3); color: #c5c9d0; }
    .sb-nav-btn.sb-nav-active {
      color: #ff6b6b; border-left-color: #ff6b6b;
      background: rgba(255,107,107,0.07);
    }
    .sb-nav-icon { font-size: 13px; width: 16px; text-align: center; flex-shrink: 0; }
  `;
  document.head.appendChild(style);
})();

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { id: 'feed',      label: 'Feed',      icon: '◈' },
  { id: 'trends',    label: 'Trends',    icon: '⊟' },
  { id: 'sources',   label: 'Sources',   icon: '⊕' },
  { id: 'bookmarks', label: 'Bookmarks', icon: '★' },
  { id: 'timeline',  label: 'Timeline',  icon: '⊞' },
  { id: 'settings',  label: 'Settings',  icon: '⚙' },
];

// ---------------------------------------------------------------------------
// Bootstrap — load persisted state from backend
// ---------------------------------------------------------------------------

let _bootstrapped = false;

async function _bootstrap() {
  try {
    const [itemsData, sourcesData, bmData, settingsData, alertsData, ctxData] = await Promise.all([
      Api.getItems().catch(() => ({ items: [] })),
      Api.getSources().catch(() => ({ sources: [] })),
      Api.getBookmarks().catch(() => ({ ids: [], tags: {} })),
      Api.getSettings().catch(() => ({ settings: {} })),
      Api.getAlertRules().catch(() => ({ rules: [] })),
      Api.getContext().catch(() => ({ context: {} })),
    ]);

    State.setItems(itemsData.items || []);
    State.setSources(sourcesData.sources || []);
    State.setBookmarks(bmData.ids || []);
    State.setBookmarkTags(bmData.tags || {});
    State.setSettings(settingsData.settings || {});
    State.setAlertRules(alertsData.rules || []);
    State.setContext(ctxData.context || {});
  } catch (err) {
    console.warn('SignalBoard: bootstrap failed', err);
  }
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------

let _activeViewComp = null;

function _mountView(viewId, mainEl) {
  if (_activeViewComp?.destroy) _activeViewComp.destroy();
  _activeViewComp = null;
  mainEl.innerHTML = '';

  switch (viewId) {
    case 'feed':      _activeViewComp = renderFeedView(mainEl);      break;
    case 'trends':    _activeViewComp = renderTrendsView(mainEl);    break;
    case 'sources':   _activeViewComp = renderSourcesView(mainEl);   break;
    case 'bookmarks': _activeViewComp = renderBookmarksView(mainEl); break;
    case 'timeline':  _activeViewComp = renderTimelineView(mainEl);  break;
    case 'settings':  _activeViewComp = renderSettingsView(mainEl);  break;
    default: mainEl.textContent = 'Unknown view.';
  }
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

function _renderShell(container) {
  container.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden;background:var(--bg,#0d1117);">
      <div id="sb-nav" style="
        width:140px;flex-shrink:0;border-right:1px solid rgba(42,51,71,0.4);
        display:flex;flex-direction:column;padding-top:8px;background:rgba(13,17,23,0.6);">
        <div style="padding:10px 12px 6px;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z"/>
            </svg>
            <span style="font-size:11px;font-weight:700;color:#ff6b6b;letter-spacing:0.03em;">SignalBoard</span>
          </div>
        </div>
        ${NAV_ITEMS.map(n => `
          <button class="sb-nav-btn" data-view="${n.id}">
            <span class="sb-nav-icon">${n.icon}</span>
            ${n.label}
          </button>
        `).join('')}
        <div style="margin-top:auto;padding:10px 12px;border-top:1px solid rgba(42,51,71,0.3);">
          <div id="sb-refresh-status" style="font-size:9px;color:#4a5568;"></div>
        </div>
      </div>
      <div id="sb-main" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-width:0;"></div>
    </div>`;

  const mainEl  = container.querySelector('#sb-main');
  const navEl   = container.querySelector('#sb-nav');
  const statusEl = container.querySelector('#sb-refresh-status');

  function activateView(id) {
    State.setActiveView(id);
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('sb-nav-active', btn.dataset.view === id);
    });
    _mountView(id, mainEl);
  }

  navEl.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => activateView(btn.dataset.view));
  });

  // activeView from bookmarks/timeline navigating to feed
  State.subscribe('activeView', id => {
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('sb-nav-active', btn.dataset.view === id);
    });
    if (id !== State.get('activeView')) _mountView(id, mainEl);
  });

  State.subscribe('refreshing', refreshing => {
    if (statusEl) statusEl.textContent = refreshing ? 'Refreshing…' : '';
  });

  State.subscribe('lastRefreshed', ts => {
    if (statusEl && ts) {
      const t = new Date(ts).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
      statusEl.textContent = `Updated ${t}`;
    }
  });

  const startView = State.get('activeView') || 'feed';
  activateView(startView);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function init(container, _ctx) {
  container.style.height   = '100%';
  container.style.overflow = 'hidden';

  _renderShell(container);

  if (!_bootstrapped) {
    _bootstrapped = true;
    _bootstrap();
  }
}

function destroy() {
  if (_activeViewComp?.destroy) _activeViewComp.destroy();
  _activeViewComp = null;
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id:   'signalboard',
    name: 'SignalBoard',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5c7.18 0 13 5.82 13 13"/><path d="M6 11a7 7 0 017 7"/><path d="M6 17a1 1 0 110-2 1 1 0 010 2z"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
