/**
 * static/js/cyberapps/playbookstudio/index.js
 * PlaybookStudio — Cerberus native app entry point.
 * VAPT playbook builder and execution tracker.
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import { BUILTIN_PLAYBOOKS } from './data.js';
import * as Api from './api.js';
import { render as renderLibrary } from './view-library.js';
import { render as renderEditor } from './view-editor.js';
import { render as renderRun } from './view-run.js';
import { render as renderHistory } from './view-history.js';

// CSS injection
(function injectCSS() {
  if (document.querySelector('[data-ps-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/js/cyberapps/playbookstudio/playbookstudio.css';
  link.dataset.psCss = '1';
  document.head.appendChild(link);
})();

const NAV_ITEMS = [
  { id: 'library',  label: 'Library',  icon: '◈' },
  { id: 'editor',   label: 'Editor',   icon: '✎' },
  { id: 'run',      label: 'Run',      icon: '▶' },
  { id: 'history',  label: 'History',  icon: '◎' },
];

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
let _bootstrapped = false;

async function _bootstrap() {
  try {
    const res = await Api.fetchPlaybooks();
    const custom = (res.playbooks || []).filter(Boolean);
    const builtinIds = new Set(BUILTIN_PLAYBOOKS.map(p => p.id));
    State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !builtinIds.has(p.id))]);
  } catch {
    State.setPlaybooks(BUILTIN_PLAYBOOKS);
  }

  try {
    const res = await Api.fetchRuns();
    State.setRuns(res.runs || []);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------
let _activeComp = null;

function _mountView(viewId, mainEl) {
  if (_activeComp?.destroy) _activeComp.destroy();
  _activeComp = null;
  mainEl.innerHTML = '';

  switch (viewId) {
    case 'library': _activeComp = renderLibrary(mainEl); break;
    case 'editor':  _activeComp = renderEditor(mainEl);  break;
    case 'run':     _activeComp = renderRun(mainEl);     break;
    case 'history': _activeComp = renderHistory(mainEl); break;
    default: mainEl.textContent = 'Unknown view.';
  }
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function _renderShell(container) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0a0a0f;">
      <div class="ps-toolbar" id="ps-nav" style="gap:6px;padding:6px 12px;">
        ${NAV_ITEMS.map(n => `
          <button class="ps-pill" data-view="${n.id}">
            <span>${n.icon}</span> ${n.label}
          </button>`).join('')}
      </div>
      <div id="ps-main" style="flex:1;overflow:hidden;"></div>
    </div>`;

  const mainEl = container.querySelector('#ps-main');
  const navEl  = container.querySelector('#ps-nav');

  function activateView(id) {
    State.setView(id);
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('ps-pill-active', btn.dataset.view === id);
    });
    _mountView(id, mainEl);
  }

  navEl.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => activateView(btn.dataset.view));
  });

  // React to view state changes (triggered by child views navigating programmatically)
  State.subscribe(s => {
    navEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('ps-pill-active', btn.dataset.view === s.view);
    });
    // If view changed externally (e.g. library navigated to editor), remount
    const currentView = container.querySelector('#ps-main')?.__view;
    if (currentView !== s.view) {
      if (container.querySelector('#ps-main')) {
        container.querySelector('#ps-main').__view = s.view;
        _mountView(s.view, mainEl);
      }
    }
  });

  const startView = State.getState().view || 'library';
  mainEl.__view = startView;
  activateView(startView);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function init(container, _ctx) {
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  _renderShell(container);

  if (!_bootstrapped) {
    _bootstrapped = true;
    _bootstrap();
  }
}

function destroy() {
  if (_activeComp?.destroy) _activeComp.destroy();
  _activeComp = null;
  State.setActiveRun(null);
  State.setActivePlaybook(null);
  State.setView('library');
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'playbookstudio',
    name: 'PlaybookStudio',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`,
    init,
    destroy,
    vault: false,
  });
}
