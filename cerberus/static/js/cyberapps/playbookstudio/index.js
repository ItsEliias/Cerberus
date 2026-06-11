/**
 * static/js/cyberapps/playbookstudio/index.js
 * PlaybookStudio — Cerberus native app entry point.
 *
 * Pentesting / engagement playbook builder + runner.
 * Views: Library, Editor, Run, History.
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import * as Api from './api.js';
import { BUILTIN_PLAYBOOKS } from './data.js';
import { render as renderLibrary } from './view-library.js';
import { render as renderEditor } from './view-editor.js';
import { render as renderRun } from './view-run.js';
import { render as renderHistory } from './view-history.js';

// ── CSS injection ──────────────────────────────────────────────────────────────
(function injectCSS() {
  if (document.querySelector('[data-playbookstudio-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/js/cyberapps/playbookstudio/playbookstudio.css';
  link.dataset.playbookstudioCss = '1';
  document.head.appendChild(link);
})();

// ── Module-level state ─────────────────────────────────────────────────────────
let _container = null;
let _currentView = null;
let _navEl = null;
let _viewUnsub = null;
let _stateUnsub = null;
const _initialised = { playbooks: false, runs: false };

const NAV_ITEMS = [
  { id: 'library', label: 'Library', icon: '◈' },
  { id: 'editor',  label: 'Editor',  icon: '✏' },
  { id: 'run',     label: 'Run',     icon: '▶' },
  { id: 'history', label: 'History', icon: '◎' },
];

// ── Bootstrap (load data from API) ────────────────────────────────────────────
async function _bootstrap() {
  // Custom playbooks
  try {
    const custom = await Api.fetchPlaybooks();
    const builtinIds = new Set(BUILTIN_PLAYBOOKS.map(p => p.id));
    State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !builtinIds.has(p.id))]);
  } catch {
    State.setPlaybooks(BUILTIN_PLAYBOOKS);
  }
  _initialised.playbooks = true;

  // Runs
  try {
    const runs = await Api.fetchRuns();
    State.setRuns(runs);
  } catch { /* ignore */ }
  _initialised.runs = true;
}

// ── Nav bar ────────────────────────────────────────────────────────────────────
function _renderNav() {
  if (!_navEl) return;
  const { view } = State.getState();
  _navEl.innerHTML = NAV_ITEMS.map(item => `
<button class="ps-nav-btn${view === item.id ? ' active' : ''}" data-view="${item.id}"
  style="font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;
    background:${view === item.id ? 'rgba(74,158,255,.15)' : 'transparent'};
    color:${view === item.id ? '#4a9eff' : 'var(--fg,#c5c9d0)'};
    border:1px solid ${view === item.id ? 'rgba(74,158,255,.3)' : 'transparent'};
    opacity:${view === item.id ? 1 : .7}">
  ${item.icon} ${item.label}
</button>`).join('');
  _navEl.querySelectorAll('.ps-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => State.setView(btn.dataset.view));
  });
}

// ── View router ────────────────────────────────────────────────────────────────
function _mountView(view) {
  if (_viewUnsub) { _viewUnsub(); _viewUnsub = null; }
  if (!_container) return;

  const viewEl = _container.querySelector('#ps-view-mount');
  if (!viewEl) return;

  viewEl.innerHTML = '';

  let renderer;
  if (view === 'library') renderer = renderLibrary;
  else if (view === 'editor') renderer = renderEditor;
  else if (view === 'run') renderer = renderRun;
  else if (view === 'history') renderer = renderHistory;
  else renderer = renderLibrary;

  const handle = renderer(viewEl);
  if (handle && handle.destroy) {
    _viewUnsub = handle.destroy.bind(handle);
  }
}

// ── App shell ──────────────────────────────────────────────────────────────────
function _renderShell() {
  if (!_container) return;
  _container.innerHTML = `
<div style="display:flex;flex-direction:column;height:100%;background:var(--bg,#1a1d23)">
  <div id="ps-top-nav" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border,#3a2a2a);background:rgba(13,14,24,.7);flex-shrink:0">
    <div style="display:flex;align-items:center;gap:5px;margin-right:6px">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="2" width="14" height="12" rx="2" stroke="#4a9eff" stroke-width="1.4"/>
        <path d="M4 6h8M4 9h5M4 12h6" stroke="#4a9eff" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="13" cy="5" r="2.5" fill="#3fb950"/>
      </svg>
      <span style="font-size:12px;font-weight:600;color:var(--fg);letter-spacing:.03em">PlaybookStudio</span>
    </div>
    <div id="ps-nav-bar" style="display:flex;gap:4px"></div>
    <div style="flex:1"></div>
    <span id="ps-loading-badge" style="font-size:10px;color:#8b949e;display:none">Loading…</span>
  </div>
  <div id="ps-view-mount" style="flex:1;overflow:hidden;min-height:0"></div>
</div>`;

  _navEl = _container.querySelector('#ps-nav-bar');
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function init(container, ctx) {
  _container = container;
  _renderShell();

  let lastView = null;

  _stateUnsub = State.subscribe(() => {
    const { view } = State.getState();
    _renderNav();
    if (view !== lastView) {
      lastView = view;
      _mountView(view);
    }
  });

  // Initial render
  _renderNav();
  _mountView(State.getState().view);

  // Bootstrap data
  const badge = container.querySelector('#ps-loading-badge');
  if (badge) badge.style.display = '';
  _bootstrap().then(() => {
    if (badge && badge.isConnected) badge.style.display = 'none';
  }).catch(() => {
    if (badge && badge.isConnected) badge.style.display = 'none';
  });
}

export function destroy() {
  if (_viewUnsub) { _viewUnsub(); _viewUnsub = null; }
  if (_stateUnsub) { _stateUnsub(); _stateUnsub = null; }
  _container = null;
  _navEl = null;
  _currentView = null;
  // Reset view to library for next mount
  State.setView('library');
}

// ── Self-register ──────────────────────────────────────────────────────────────
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'playbookstudio',
    name: 'PlaybookStudio',
    icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/>
      <path d="M4 6h8M4 9h5M4 12h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="13" cy="5" r="2.5" fill="#3fb950"/>
    </svg>`,
    init,
    destroy,
    vault: false,
  });
}
