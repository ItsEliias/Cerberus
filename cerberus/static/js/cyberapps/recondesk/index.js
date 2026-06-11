/**
 * ReconDesk — native Cerberus app entry point.
 * Recon dashboard: target management, ports, credentials, attack board, timeline, export.
 *
 * Self-registers into window.CYBER_APPS_REGISTRY.
 * No external recon binaries required — all scanning results are entered
 * manually or via nmap XML paste. Graceful stubs surface a clear
 * "tool not available" message if an external tool is requested.
 */

import { rdApi }           from './api.js';
import { renderSidebar }   from './sidebar.js';
import { renderOverview }  from './overview.js';
import { renderPorts }     from './ports.js';
import { renderCreds }     from './credentials.js';
import { renderBoard }     from './board.js';
import { renderTimeline }  from './timeline.js';
import { renderExport }    from './export.js';
import { injectStyles }    from './styles.js';
import { buildActions, toast, _esc } from './actions.js';

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} */
let _container = null;

/** @type {{ targets: object[], engagements: object[], activeTargetId: string|null, activeTab: string }} */
const _state = {
  targets: [],
  engagements: [],
  activeTargetId: null,
  activeTab: 'overview',
};

let _actions = null;

// ─── Public lifecycle ──────────────────────────────────────────────────────────

export async function init(container, ctx) {
  _container = container;
  _container.innerHTML = '';
  _container.style.cssText = 'display:flex;height:100%;overflow:hidden;background:var(--bg);color:var(--fg)';

  injectStyles();
  _actions = buildActions(_state, _renderAll, _renderMain);
  _render();
  await _loadData();
}

export function destroy() {
  _container = null;
}

// ─── Data loading ──────────────────────────────────────────────────────────────

async function _loadData() {
  try {
    const data = await rdApi.listTargets();
    _state.targets = data.targets || [];
    _state.engagements = data.engagements || [];
    if (_state.engagements.length === 0) {
      _state.engagements = [{ id: 'default', name: 'Default', color: '#d29922' }];
    }
    _renderAll();
  } catch (e) {
    _showError(`Failed to load ReconDesk data: ${e.message}`);
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  if (!_container) return;
  _container.innerHTML = `
    <div class="rd-sidebar" id="rd-sidebar"></div>
    <div class="rd-main" id="rd-main">
      <div class="rd-tab-bar" id="rd-tab-bar" style="display:none"></div>
      <div class="rd-content" id="rd-content"></div>
    </div>
  `;
}

function _renderAll() {
  if (!_container) return;
  const sidebar = _container.querySelector('#rd-sidebar');
  if (sidebar) {
    renderSidebar(sidebar, _state, {
      onSelectTarget:  _actions.selectTarget,
      onAddTarget:     _actions.showAddTargetModal,
      onDeleteTarget:  _actions.deleteTarget,
      onAddEngagement: _actions.addEngagement,
    });
  }
  _renderMain();
}

function _renderMain() {
  const tabBar  = _container && _container.querySelector('#rd-tab-bar');
  const content = _container && _container.querySelector('#rd-content');
  if (!tabBar || !content) return;

  const target = _state.targets.find(t => t.id === _state.activeTargetId);
  if (!_state.activeTargetId || !target) {
    tabBar.style.display = 'none';
    content.innerHTML = _emptyState();
    return;
  }

  tabBar.style.display = '';
  _renderTabBar(tabBar, target);
  _renderTabContent(content, target);
}

const TABS = [
  { id: 'overview',    label: 'Overview'     },
  { id: 'ports',       label: 'Ports'        },
  { id: 'credentials', label: 'Credentials'  },
  { id: 'board',       label: 'Attack Board' },
  { id: 'timeline',    label: 'Timeline'     },
  { id: 'export',      label: 'Export'       },
];

function _renderTabBar(el, target) {
  el.innerHTML = `
    <div class="rd-tabs">
      ${TABS.map(t => `
        <button class="rd-tab${_state.activeTab === t.id ? ' rd-tab--active' : ''}" data-tab="${t.id}">
          ${t.label}
        </button>
      `).join('')}
      ${target.ip ? `<span class="rd-ip-badge">${_esc(target.ip)}</span>` : ''}
    </div>
  `;
  el.querySelectorAll('.rd-tab').forEach(btn => {
    btn.addEventListener('click', () => { _state.activeTab = btn.dataset.tab; _renderMain(); });
  });
}

function _renderTabContent(el, target) {
  const switchTab = (tab) => { _state.activeTab = tab; _renderMain(); };
  switch (_state.activeTab) {
    case 'overview':
      renderOverview(el, target, _state, { onUpdate: _actions.updateTarget, onSwitchTab: switchTab });
      break;
    case 'ports':
      renderPorts(el, target, {
        onAddPort: _actions.addPort, onUpdatePort: _actions.updatePort,
        onDeletePort: _actions.deletePort, onImportNmap: _actions.importNmap,
      });
      break;
    case 'credentials':
      renderCreds(el, target, {
        onAddCred: _actions.addCredential, onUpdateCred: _actions.updateCredential,
        onDeleteCred: _actions.deleteCredential,
      });
      break;
    case 'board':
      renderBoard(el, target, {
        onAddCard: _actions.addCard, onUpdateCard: _actions.updateCard,
        onDeleteCard: _actions.deleteCard,
      });
      break;
    case 'timeline':
      renderTimeline(el, target, { onAddEntry: _actions.addTimelineEntry });
      break;
    case 'export':
      renderExport(el, target, { onToast: toast });
      break;
    default:
      el.innerHTML = '<div style="padding:24px;color:var(--fg)">Unknown tab.</div>';
  }
}

function _emptyState() {
  return `
    <div class="rd-empty">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" style="color:#d29922;opacity:0.45;margin-bottom:16px">
        <path d="M12 2L20.5 7V17L12 22L3.5 17V7L12 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.5"/>
        <path d="M12 9V7M12 17v-2M7 12H5M19 12h-2" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
      </svg>
      <p style="font-size:13px;font-weight:600;color:#e6edf3;margin:0 0 6px">No target selected</p>
      <p style="font-size:11px;color:#8b949e;margin:0">Select a target from the sidebar or click + to add one.</p>
    </div>
  `;
}

function _showError(msg) {
  if (!_container) return;
  const content = _container.querySelector('#rd-content');
  if (content) content.innerHTML = `<div style="padding:24px;color:#f85149;font-size:13px">${_esc(msg)}</div>`;
}

// ─── Self-register ────────────────────────────────────────────────────────────

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id:   'recondesk',
    name: 'ReconDesk',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L20.5 7V17L12 22L3.5 17V7L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 9V7M12 17v-2M7 12H5M19 12h-2" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
