/**
 * static/js/cyberapps/command-center/index.js
 *
 * Command Center — real-time JARVIS-aesthetic overview of Cerberus + CyberOS.
 * Five sub-tabs: COMMAND | COUNCIL | WORKSPACE | FINANCE | ASSISTANT
 *
 * Self-registers with window.CYBER_APPS_REGISTRY using unshift() (priority: first).
 */

import { buildCommandTab, applyVitals, applyTimeseries, applySwarm, applyAgents, applyGateway } from './command.js';
import { buildCouncilTab, initCouncil, loadCouncil } from './council.js';
import { buildWorkspaceTab, loadWorkspace } from './workspace.js';
import { buildFinanceTab, loadFinance }     from './finance.js';
import { buildAssistantTab, initAssistant, destroyAssistant } from './assistant.js';
import { buildGatewayTab, loadGateway } from './gateway.js';
import * as Poll from './poll.js';

// Inject CC stylesheet once — version param busts browser/SW cache on updates
(function injectCSS() {
  if (document.getElementById('cc-styles-link')) return;
  const link = document.createElement('link');
  link.id   = 'cc-styles-link';
  link.rel  = 'stylesheet';
  link.href = '/static/js/cyberapps/command-center/styles.css?v=358';
  document.head.appendChild(link);
})();

// ---- Tab config ----

const TABS = [
  {
    id: 'command',
    label: '>_ COMMAND',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>`,
  },
  {
    id: 'council',
    label: 'COUNCIL',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
      <circle cx="19" cy="7" r="2"/><path d="M21 21v-1.5a3 3 0 0 0-3-3h-1"/>
    </svg>`,
  },
  {
    id: 'workspace',
    label: 'WORKSPACE',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`,
  },
  {
    id: 'finance',
    label: 'FINANCE',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>`,
  },
  {
    id: 'assistant',
    label: 'ASSISTANT',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>`,
  },
  {
    id: 'gateway',
    label: 'GATEWAY',
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 2H3v16h5v4l4-4h9V2z"/>
      <line x1="7" y1="8" x2="17" y2="8"/>
      <line x1="7" y1="12" x2="13" y2="12"/>
    </svg>`,
  },
];

// ---- Module state ----

let _container  = null;
let _activeTab  = 'command';
let _clockTimer = null;
let _orbWrap    = null;

// ---- init / destroy ----

export function init(container, _ctx) {
  _container = container;
  _activeTab = 'command';
  _render();
}

export function destroy() {
  Poll.destroy();
  destroyAssistant();
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
  _container = _orbWrap = null;
}

// ---- Shell render ----

function _render() {
  if (!_container) return;
  _container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'cc-shell';

  shell.innerHTML = `
    <div class="cc-brand-bar">
      <span class="cc-brand-title">Cerberus — Command Center</span>
      <span class="cc-clock" id="cc-clock">--:--:-- --</span>
      <button class="cc-refresh-btn" id="cc-refresh">REFRESH</button>
    </div>
    <nav class="cc-tab-nav" id="cc-tab-nav">
      ${TABS.map(t => `
        <button class="cc-tab-btn${t.id === _activeTab ? ' active' : ''}"
          data-tab="${t.id}" title="${t.label}">
          ${t.icon}<span>${t.label}</span>
        </button>`).join('')}
    </nav>
    <div class="cc-tab-content" id="cc-tab-content"></div>
  `.trim();

  _container.appendChild(shell);

  // Wire tab buttons
  shell.querySelectorAll('.cc-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab, shell));
  });

  // Wire refresh
  const refreshBtn = shell.querySelector('#cc-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      Poll.destroy();
      Poll.start(_pollCallbacks(shell));
    });
  }

  _startClock(shell);
  _mountTab('command', shell);
  Poll.start(_pollCallbacks(shell));
}

// ---- Tab switching ----

function _switchTab(id, shell) {
  if (id === _activeTab) return;

  // Tear down ASSISTANT streaming on tab switch
  if (_activeTab === 'assistant') destroyAssistant();

  _activeTab = id;

  // Update pills
  shell.querySelectorAll('.cc-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
  });

  _mountTab(id, shell);
}

function _mountTab(id, shell) {
  const content = shell.querySelector('#cc-tab-content');
  if (!content) return;

  if (id === 'command') {
    content.innerHTML = buildCommandTab();
    _orbWrap = content.querySelector('#cc-orb-mount');
    // Immediately populate if we have cached data
    Poll.destroy();
    Poll.start(_pollCallbacks(shell));
  } else if (id === 'council') {
    content.innerHTML = buildCouncilTab();
    initCouncil(content);
    loadCouncil(content);
  } else if (id === 'workspace') {
    content.innerHTML = buildWorkspaceTab();
    loadWorkspace(content);
  } else if (id === 'finance') {
    content.innerHTML = buildFinanceTab();
    loadFinance(content);
  } else if (id === 'assistant') {
    content.innerHTML = buildAssistantTab();
    initAssistant(content);
  } else if (id === 'gateway') {
    content.innerHTML = buildGatewayTab();
    loadGateway(content);
  }
}

// ---- Poll callbacks ----

function _pollCallbacks(shell) {
  return {
    onVitals(v) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyVitals(c, v);
    },
    onTimeseries(ts) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyTimeseries(c, ts);
    },
    onSwarm(sw) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applySwarm(c, sw, _orbWrap);
    },
    onAgents(agents) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyAgents(c, agents);
    },
    onGateway(gw) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyGateway(c, gw);
    },
    onError(e) { console.warn('[Command Center] poll error:', e); },
  };
}

// ---- Clock ----

function _startClock(shell) {
  const el = shell.querySelector('#cc-clock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  };
  tick();
  _clockTimer = setInterval(tick, 1000);
}

// ---- Self-register (priority: first via unshift) ----

const SHIELD_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2L3 6V12C3 17.5 7 22 12 24C17 22 21 17.5 21 12V6Z"/>
  <line x1="9" y1="12" x2="11.5" y2="15" stroke="currentColor" stroke-width="1.6"/>
  <line x1="11.5" y1="15" x2="16" y2="10" stroke="currentColor" stroke-width="1.6"/>
</svg>`.trim();

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.unshift({
    id:       'command-center',
    name:     'Command Center',
    icon:     SHIELD_ICON,
    init,
    destroy,
    vault:    false,
    priority: 'first',
  });
}
