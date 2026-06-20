/**
 * static/js/cyberapps/command-center/index.js
 *
 * Command Center — real-time JARVIS-aesthetic overview of Cerberus + CyberOS.
 * Five sub-tabs: COMMAND | COUNCIL | WORKSPACE | FINANCE | ASSISTANT
 *
 * Self-registers with window.CYBER_APPS_REGISTRY using unshift() (priority: first).
 */

import { buildCommandTab, applyVitals, applyTimeseries, applySwarm, applyAgents, applyGateway, applyTasks, applyModelStatus, loadCommandTab, destroyCommandTab } from './command.js';
import { buildCouncilTab, initCouncil, loadCouncil } from './council.js';
import { buildWorkspaceTab, loadWorkspace } from './workspace.js';
import { buildFinanceTab, loadFinance }     from './finance.js';
import { buildAssistantTab, initAssistant, destroyAssistant } from './assistant.js';
import { buildGatewayTab, loadGateway } from './gateway.js';
import { buildAgentsTab, loadAgents } from './agents.js';
import { buildRoomsTab, loadRooms } from './rooms.js';
import { buildObservabilityTab, loadObservability } from './observability.js';
import { initShortcuts, destroyShortcuts } from './shortcuts.js';
import * as Poll from './poll.js';

// Inject CC stylesheet once — version param busts browser/SW cache on updates
(function injectCSS() {
  if (document.getElementById('cc-styles-link')) return;
  const link = document.createElement('link');
  link.id   = 'cc-styles-link';
  link.rel  = 'stylesheet';
  link.href = '/static/js/cyberapps/command-center/styles.css?v=359';
  document.head.appendChild(link);
})();

// ---- Tab config ----

const TABS = [
  { id: 'command',       label: 'COMMAND'   },
  { id: 'council',       label: 'COUNCIL'   },
  { id: 'workspace',     label: 'WORKSPACE' },
  { id: 'finance',       label: 'FINANCE'   },
  { id: 'assistant',     label: 'ASSISTANT' },
  { id: 'gateway',       label: 'GATEWAY'   },
  { id: 'agents',        label: 'AGENTS'    },
  { id: 'rooms',         label: 'ROOMS'     },
  { id: 'observability', label: 'OBSERVE'   },
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
  destroyShortcuts();
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
      <span class="cc-wordmark">
        <span class="hud-bracket">[</span><span class="hud-lead">C</span><span class="hud-bracket">]</span>ERBERUS
      </span>
      <span class="cc-wordmark-sub">COMMAND CENTER</span>
      <div class="cc-brand-chips">
        <div class="hud-chip"><span class="hud-chip-dot hud-chip-dot--online"></span>ONLINE</div>
        <div class="hud-chip" id="cc-agents-chip"><span class="hud-chip-dot hud-chip-dot--agents"></span><span id="cc-agents-chip-count">— AGENTS</span></div>
        <div class="hud-chip"><span class="hud-chip-dot hud-chip-dot--auth"></span>AUTH</div>
      </div>
      <span class="cc-brand-spacer"></span>
      <span class="cc-clock" id="cc-clock">--:--:--</span>
      <button class="cc-refresh-btn" id="cc-refresh">REFRESH</button>
    </div>
    <nav class="cc-tab-nav" id="cc-tab-nav">
      ${TABS.map(t => `
        <button class="cc-tab-btn${t.id === _activeTab ? ' active' : ''}"
          data-tab="${t.id}">${t.label}
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
  _startGatewayBadgePoll(shell);
  initShortcuts(shell, TABS);
}

// ---- GATEWAY tab pending-approval badge ----
// Polls /api/gateway/status from the CC shell so the GATEWAY tab pill shows
// the pending-approval count even when the user is on another tab. Visible
// only when count > 0; styled crimson via tokens (see styles.css).
const _GW_BADGE_POLL_MS = 60_000;
const _GW_BADGE_TIMER_KEY = '__gwBadgeTimer';

function _startGatewayBadgePoll(shell) {
  if (!shell) return;
  const prev = shell[_GW_BADGE_TIMER_KEY];
  if (prev) clearInterval(prev);
  _refreshGatewayBadge(shell);
  shell[_GW_BADGE_TIMER_KEY] = setInterval(() => _refreshGatewayBadge(shell), _GW_BADGE_POLL_MS);
}

async function _refreshGatewayBadge(shell) {
  if (!shell || !shell.querySelector) return;
  try {
    const r = await fetch('/api/gateway/status', { credentials: 'same-origin' });
    if (!r.ok) return _setGatewayBadge(shell, 0);
    const data = await r.json();
    _setGatewayBadge(shell, Number(data.pending_approvals || 0));
  } catch (_) {
    _setGatewayBadge(shell, 0);
  }
}

function _setGatewayBadge(shell, count) {
  const btn = shell.querySelector('.cc-tab-btn[data-tab="gateway"]');
  if (!btn) return;
  let badge = btn.querySelector('.cc-tab-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'cc-tab-badge';
    btn.appendChild(badge);
  }
  badge.textContent = String(count);
  if (count > 0) badge.removeAttribute('hidden');
  else badge.setAttribute('hidden', '');
}

// ---- Tab switching ----

function _switchTab(id, shell) {
  if (id === _activeTab) return;

  // Tear down ASSISTANT streaming on tab switch
  if (_activeTab === 'assistant') destroyAssistant();
  // Tear down COMMAND's task-feed poller — Poll.js handles its own lifecycle
  // separately, but the 10s active-tasks loop needs an explicit stop.
  if (_activeTab === 'command') destroyCommandTab();

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
    // First paint for the task feed + model panel — Poll.js handles the
    // periodic refresh, but we want both panels populated before the next tick.
    loadCommandTab(content).catch(() => { /* loader paints its own error state */ });
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
  } else if (id === 'agents') {
    content.innerHTML = buildAgentsTab();
    loadAgents(content);
  } else if (id === 'rooms') {
    content.innerHTML = buildRoomsTab();
    loadRooms(content);
  } else if (id === 'observability') {
    content.innerHTML = buildObservabilityTab();
    loadObservability(content);
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
      const chipCount = shell.querySelector('#cc-agents-chip-count');
      if (chipCount && sw.active != null) chipCount.textContent = sw.active + ' AGENTS';
    },
    onAgents(agents) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyAgents(c, agents);
    },
    onGateway(gw) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyGateway(c, gw);
    },
    onTasks(tasks) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyTasks(c, tasks);
    },
    onModelStatus(status) {
      const c = shell.querySelector('#cc-tab-content');
      if (_activeTab === 'command' && c) applyModelStatus(c, status);
    },
    onError(e) { console.warn('[Command Center] poll error:', e); },
  };
}

// ---- Clock ----

function _startClock(shell) {
  const el = shell.querySelector('#cc-clock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
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
