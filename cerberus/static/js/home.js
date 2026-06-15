// ============================================
// Cerberus OS — Mission Control Shell
// ============================================

import { startCerberusCore, startCerberusBackdrop } from './cerberusCore.js';
import {
  isCerberusHomeRoute,
  isCerberusAgentsRoute,
  isCerberusProjectsRoute,
  isCerberusFinanceRoute,
  cerberusHomeUrl,
} from './cerberusShell.js';
import { initCerberusGraph, refreshCerberusGraph } from './cerberusGraph.js';
import { initCerberusPowerLinks } from './cerberusPowerLinks.js';
import cerberusShellModals from './cerberusShellModals.js';
import agentsOfficeModule from './agentsOffice.js';
import cerberusProjectsModule from './cerberusProjects.js';
import cerberusFinanceModule from './cerberusFinance.js';
import cerberusPipelineModule from './cerberusPipeline.js';
import cerberusProjectContext from './cerberusProjectContext.js';
import cerberusProjectHQ from './cerberusProjectHQ.js';
import cerberusActiveProject from './cerberusActiveProject.js';
import cerberusDesktopApps from './cerberusDesktopApps.js';
import cerberusReasoningAudit from './cerberusReasoningAudit.js';
import cerberusGoals from './cerberusGoals.js';

export {
  isCerberusHomeRoute,
  isCerberusAgentsRoute,
  isCerberusProjectsRoute,
  isCerberusFinanceRoute,
} from './cerberusShell.js';

let _deps = {};
let _projects = [];
let _agents = [];
let _briefing = null;
let _briefingV2 = null;
let _profile = null;
let _active = false;
let _dataReady = false;
let _prefetchPromise = null;

function _el(id) {
  return document.getElementById(id);
}

function _statusLabel(status) {
  const map = { idle: 'Idle', ready: 'Ready', thinking: 'Thinking', waiting: 'Waiting' };
  return map[status] || status;
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export async function loadProjects() {
  try {
    const data = await _fetchJson('/api/cerberus/projects/recent');
    _projects = Array.isArray(data.projects) ? data.projects : [];
  } catch (_) {
    try {
      const fallback = await _fetchJson('/api/cerberus/projects');
      _projects = Array.isArray(fallback.projects) ? fallback.projects : [];
    } catch (_) {
      _projects = [];
    }
  }
  refreshCerberusGraph(_projects);
  return _projects;
}

function _formatActivity(p) {
  const ts = p.last_activity_at || p.last_indexed_at || p.last_seen_at;
  if (!ts) return 'No activity';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (_) {
    return ts.slice(0, 10);
  }
}

function _changeCount(p) {
  const ch = p.recent_changes || {};
  return (ch.new_count || 0) + (ch.modified_count || 0) + (ch.deleted_count || 0);
}

async function _loadAgents() {
  try {
    const data = await _fetchJson('/api/cerberus/agents');
    _agents = Array.isArray(data.agents) ? data.agents : [];
  } catch (_) {
    _agents = [];
  }
  return _agents;
}

async function _loadProfile() {
  try {
    _profile = await _fetchJson('/api/cerberus/profile');
  } catch (_) {
    _profile = null;
  }
  return _profile;
}

async function _loadBriefing() {
  try {
    _briefingV2 = await _fetchJson('/api/cerberus/briefing/v2');
    _briefing = _briefingV2;
  } catch (_) {
    try {
      _briefing = await _fetchJson('/api/cerberus/briefing');
    } catch (_) {
      _briefing = null;
    }
    _briefingV2 = null;
  }
  return _briefingV2 || _briefing;
}

async function _refreshCerberusData() {
  await loadProjects();
  refreshCerberusGraph(_projects);
  _dataReady = true;
  void Promise.all([_loadAgents(), _loadProfile(), _loadBriefing()]).then(() => {
    if (_active || document.body.classList.contains('cerberus-view-home')) {
      _renderAll();
      refreshCerberusGraph(_projects);
    }
  });
}

function _renderAll() {
  _renderBriefing();
  _renderProjects();
  _renderAgents();
  refreshCerberusGraph(_projects);
}

function _renderBriefing() {
  const el = _el('cerberus-home-briefing-text');
  const v2 = _briefingV2;
  const spoken = v2?.spoken || (_briefing && _briefing.text);
  if (el) {
    el.textContent = spoken
      || 'Cerberus is ready. Scan your workspace and refresh the briefing.';
  }

  const headline = _el('cerberus-briefing-headline');
  const priorities = _el('cerberus-briefing-priorities');
  const rec = _el('cerberus-briefing-recommendation');
  const visual = v2?.visual || {};
  if (headline) headline.textContent = visual.headline || spoken || 'Briefing unavailable';
  if (priorities) {
    const items = visual.priorities || [];
    priorities.innerHTML = items.length
      ? items.slice(0, 4).map(p => `
        <li>
          <button type="button" class="cerberus-briefing-project-btn" data-briefing-project="${_esc(p.project_id || '')}" title="Open Project HQ">
            <strong>${_esc(p.name || 'Project')}</strong>
          </button>
          <span class="cerberus-briefing-score">${p.potential_score ?? p.score ?? '—'}</span>
          ${p.stage ? `<span class="cerberus-briefing-stage">${_esc(p.stage)}</span>` : ''}
        </li>`).join('')
      : '<li class="cerberus-mc-empty">No indexed projects yet.</li>';
  }
  if (rec) rec.textContent = visual.recommendation || '';
}

async function _speakBriefing() {
  const text = _briefingV2?.spoken || (_briefing && _briefing.text);
  if (!text) return;
  if (window.cerberusVoiceMode?.speakText) {
    await window.cerberusVoiceMode.speakText(text, { short: false });
    return;
  }
  if (window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    window.speechSynthesis.speak(u);
  }
}

function _openBriefingDetails() {
  const v2 = _briefingV2;
  if (!v2?.visual) {
    _deps.showToast?.('Refresh briefing first');
    return;
  }
  const v = v2.visual;
  const lines = [
    v.greeting,
    v.headline,
    v.recommendation,
    ...(v.project_changes || []).map(c => `Changes: ${c.name} (+${c.new_count || 0} new, ~${c.modified_count || 0} modified)`),
    ...(v.finance || []).map(f => f.type === 'bill' ? `Bill: ${f.name} in ${f.days_until}d` : `Pay est.: £${f.weekly_net}`),
    ...(v.agent_reports || []).map(r => `Pending: ${r.agent || r.title}`),
  ].filter(Boolean);
  window.alert(lines.join('\n\n'));
}

function _renderProjects() {
  const list = _el('cerberus-home-projects');
  if (!list) return;
  if (!_projects.length) {
    list.innerHTML = '<p class="cerberus-mc-empty">Scan projects in Projects to populate Recent Projects.</p>';
    return;
  }
  list.innerHTML = _projects.map(p => {
    const stack = (p.detected_stack || []).slice(0, 2).join(' · ') || p.detected_type || p.type || '';
    const changes = _changeCount(p);
    return `
    <button type="button" class="cerberus-home-recent-card" data-project-id="${_esc(p.id)}">
      <span class="cerberus-home-recent-pin${p.pinned ? ' cerberus-home-recent-pin--on' : ''}" data-pin-project="${_esc(p.id)}" title="Pin project" aria-label="Pin">★</span>
      <span class="cerberus-home-recent-name">${_esc(p.name)}</span>
      <span class="cerberus-home-recent-stack">${_esc(stack)}</span>
      <span class="cerberus-home-recent-meta">${_formatActivity(p)}${changes ? ` · ${changes} changes` : ''}</span>
    </button>
  `;
  }).join('');
}

function _renderAgents() {
  const list = _el('cerberus-home-agents');
  if (!list) return;
  if (!_agents.length) {
    list.innerHTML = '<p class="cerberus-mc-empty">No agents configured yet.</p>';
    return;
  }
  list.innerHTML = _agents.map(a => `
    <div class="cerberus-home-agent cerberus-home-agent--compact" data-agent-id="${_esc(a.id)}">
      <span class="cerberus-home-agent-name">${_esc(a.name)}</span>
      <span class="cerberus-home-agent-status cerberus-home-agent-status--${_esc(a.status)}">${_statusLabel(a.status)}</span>
    </div>
  `).join('');
}

function _setNavActive(view) {
  const homeBtn = _el('sidebar-home-btn');
  const asstBtn = _el('sidebar-assistant-btn');
  if (homeBtn) homeBtn.classList.toggle('active', view === 'home');
  if (asstBtn) asstBtn.classList.toggle('active', view === 'assistant');
}

function _setCerberusView(view) {
  document.body.classList.remove(
    'cerberus-view-home',
    'cerberus-view-assistant',
    'cerberus-view-agents',
    'cerberus-view-projects',
    'cerberus-view-finance',
    'cerberus-view-tool',
  );
  document.body.classList.add(`cerberus-view-${view}`);
  document.body.classList.toggle('cerberus-home-active', view === 'home');
  document.body.classList.toggle('cerberus-hub-active', view === 'home');
}

function _ensureHomeVisible() {
  const home = _el('cerberus-home');
  if (home) home.classList.remove('hidden');
  _setCerberusView('home');
  _scheduleCoreStart();
}

function _scheduleCoreStart() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => startCerberusCore());
  });
}

/** Prefetch Atlas API data — safe to call multiple times. */
export function prefetchAtlasData() {
  if (!_prefetchPromise) {
    _prefetchPromise = _refreshCerberusData()
      .then(() => {
        if (_active || document.body.classList.contains('cerberus-view-home')) {
          _renderAll();
          refreshCerberusGraph(_projects);
          void _maybeAutoSpeakBriefing();
          void _refreshDesktopControl();
        }
        if (document.body.classList.contains('cerberus-view-agents')) {
          agentsOfficeModule.renderAgentsOffice(_agents);
        }
      })
      .catch(() => {
        _prefetchPromise = null;
      });
  }
  return _prefetchPromise;
}

async function _wipeCePersonalDataOnce() {
  // v4: also clears leftover project_summaries from pre-CE builds.
  const flag = 'cerberus_ce_personal_wiped_v4';
  if (localStorage.getItem(flag) === '1') return;
  try {
    await fetch('/api/cerberus/ce/wipe-personal-data', { method: 'POST', credentials: 'same-origin' });
    localStorage.setItem(flag, '1');
  } catch (_) {}
  try {
    localStorage.removeItem('odysseus-calendar-cache');
    localStorage.removeItem('cal-filters-collapsed');
    localStorage.removeItem('cal-wk-hour-px');
    localStorage.removeItem('odysseus.cal.detailH');
    localStorage.removeItem('lastSessionId');
    sessionStorage.removeItem('ody-session-probe');
  } catch (_) {}
}

/** Boot Atlas shell immediately on app init (before loadSessions). */
/** Refresh Atlas data after first-run setup completes. */
export async function onSetupComplete() {
  try {
    localStorage.removeItem('cerberus_offices_v1');
    localStorage.removeItem('cerberus_offices_v2');
  } catch (_) {}
  _prefetchPromise = null;
  await prefetchAtlasData();
  refreshCerberusGraph(_projects);
  import('./officesModal.js').then((om) => om.default?.renderOfficesModal?.());
  window.dispatchEvent(new CustomEvent('cerberus-graph-changed'));
}

export function bootAtlasHome() {
  void _wipeCePersonalDataOnce();
  import('./windowResize.js').then((m) => m.clearWindowResizeLock?.()).catch(() => {});
  startCerberusBackdrop();
  prefetchAtlasData();
  import('./cerberusCursorFx.js').then((m) => m.default.initAtlasCursorFx?.());

  _active = true;
  _ensureHomeVisible();
  _setNavActive('home');
  window.cerberusHomeConversation?.onHomeShown?.();

  try {
    initCerberusGraph({ onNodeClick: (action) => openAtlasModal(action), projects: _projects });
    initCerberusPowerLinks();
    void cerberusShellModals.restoreSessionModals();
  } catch (err) {
    console.error('[cerberus] graph init failed:', err);
  }

  if (isCerberusFinanceRoute()) {
    void openAtlasModal('finance');
  } else if (isCerberusProjectsRoute()) {
    void openAtlasModal('projects');
  } else if (isCerberusAgentsRoute()) {
    void openAtlasModal('offices');
  }
}

export function isHomeActive() {
  return _active;
}

function _syncHomeHistory({ skipHistory = false, replace = false } = {}) {
  if (skipHistory) return;
  const url = cerberusHomeUrl();
  const state = { cerberusView: 'home' };
  if (window.location.pathname === url && !window.location.hash) return;
  if (replace) {
    history.replaceState(state, '', url);
  } else {
    history.pushState(state, '', url);
  }
}

export async function showHome({ skipHistory = false, replace = false } = {}) {
  _active = true;
  window.cerberusVoiceService?.onRouteChange?.('home');
  document.title = 'Cerberus OS';
  _syncHomeHistory({ skipHistory, replace });
  _ensureHomeVisible();
  _setNavActive('home');

  if (_dataReady) _renderAll();
  await prefetchAtlasData();
  _renderAll();
  void _maybeAutoSpeakBriefing();
  void _refreshDesktopControl();
}

let _briefingAutoSpoken = false;

async function _maybeAutoSpeakBriefing() {
  if (_briefingAutoSpoken) return;
  try {
    const data = await _fetchJson('/api/cerberus/briefing/settings');
    const settings = data.settings || {};
    if (!settings.speak_on_home_start) return;
    _briefingAutoSpoken = true;
    await _speakBriefing();
  } catch (_) {}
}

async function _refreshDesktopControl() {
  try {
    const data = await _fetchJson('/api/cerberus/desktop/status');
    const statusEl = _el('cerberus-desktop-control-status');
    const metaEl = _el('cerberus-desktop-control-meta');
    const cursorBtn = _el('cerberus-desktop-open-cursor');
    const folderBtn = _el('cerberus-desktop-open-folder');
    const testCursorBtn = _el('cerberus-desktop-test-cursor');
    const testBrowserBtn = _el('cerberus-desktop-test-browser');
    const ready = data.state === 'ready' || (data.enabled && data.bridge_ready);
    if (statusEl) statusEl.textContent = data.label || 'Desktop Control: Disabled';
    if (metaEl) {
      const avail = (data.available_apps || []).length;
      const total = data.app_count;
      metaEl.textContent = ready && total != null
        ? `${avail}/${total} apps available on bridge`
        : (data.message || '');
    }
    if (cursorBtn) cursorBtn.disabled = !ready;
    if (folderBtn) folderBtn.disabled = !ready;
    if (testCursorBtn) testCursorBtn.disabled = !ready;
    if (testBrowserBtn) testBrowserBtn.disabled = !ready;
    window._cerberusDesktopHint = data.setup_hint || '';
  } catch (_) {}
}

async function _desktopCommand(command, args = {}) {
  const res = await fetch('/api/cerberus/desktop/command', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  const data = await res.json();
  _deps.showToast?.(data.message || (data.ok ? 'Command sent' : 'Desktop command failed'));
  return data;
}

function _openDesktopSetup() {
  const hint = window._cerberusDesktopHint || (
    'Cerberus runs inside Docker and cannot open Windows apps directly.\n\n'
    + 'Configure launchable apps in Settings → Desktop Bridge, then enable desktop_commands_enabled '
    + 'and set bridge_url / bridge_token in desktop_permissions.json.'
  );
  window.alert(hint);
}

export async function showAgentsOffice({ skipHistory = false } = {}) {
  await showHome({ skipHistory: true });
  return openAtlasModal('offices');
}

export async function showProjects({ skipHistory = false } = {}) {
  await showHome({ skipHistory: true });
  return openAtlasModal('projects');
}

export async function showFinance({ skipHistory = false } = {}) {
  await showHome({ skipHistory: true });
  return openAtlasModal('finance');
}

export async function showAssistantView({ dockId = 'assistant' } = {}) {
  await showHome({ skipHistory: true });
  if (dockId === 'assistant') {
    return openAtlasModal('assistant');
  }
  return openAtlasModal(dockId);
}

export async function openAtlasModal(id) {
  _active = true;
  _ensureHomeVisible();
  window.cerberusVoiceService?.onRouteChange?.('home');
  document.title = 'Cerberus OS';
  return cerberusShellModals.openShellModal(id);
}

export function getAtlasAgents() {
  return _agents;
}

export function hideHome() {
  showAssistantView();
}

function _openAssistant(prompt, opts) {
  if (_deps.openAssistant) _deps.openAssistant(prompt, opts);
}

function _openTool(id) {
  if (id === 'home') {
    void showHome();
    return;
  }
  if (id === 'brain') {
    void openAtlasModal('brain');
    return;
  }
  if (_deps.openTool) _deps.openTool(id);
}

function _bindEvents() {
  const cmdInput = _el('cerberus-home-command-input');
  const cmdForm = _el('cerberus-home-command-form');

  if (cmdForm) {
    cmdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (cmdInput?.value || '').trim();
      if (!text) return;
      if (cmdInput) cmdInput.value = '';
      if (window.cerberusHomeConversation?.submitHomeMessage) {
        await window.cerberusHomeConversation.submitHomeMessage(text);
      } else {
        _openAssistant(text, { submit: true, stayOnHome: true });
      }
    });
  }

  const briefingPriorities = _el('cerberus-briefing-priorities');
  if (briefingPriorities) {
    briefingPriorities.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-briefing-project]');
      if (!btn?.dataset.briefingProject) return;
      cerberusProjectHQ.openProjectHQ(btn.dataset.briefingProject);
    });
  }

  const projects = _el('cerberus-home-projects');
  if (projects) {
    projects.addEventListener('click', async (e) => {
      const pin = e.target.closest('[data-pin-project]');
      if (pin) {
        e.stopPropagation();
        const id = pin.dataset.pinProject;
        const res = await fetch(`/api/cerberus/projects/${id}/pin`, { method: 'POST', credentials: 'same-origin' });
        const data = await res.json();
        if (data.ok) {
          await loadProjects();
          _renderProjects();
        }
        return;
      }
      const card = e.target.closest('[data-project-id]');
      if (!card) return;
      cerberusProjectHQ.openProjectHQ(card.dataset.projectId);
    });
  }

  _el('cerberus-briefing-speak')?.addEventListener('click', () => { void _speakBriefing(); });
  _el('cerberus-briefing-refresh')?.addEventListener('click', async () => {
    await _loadBriefing();
    _renderBriefing();
    _deps.showToast?.('Briefing refreshed');
  });
  _el('cerberus-briefing-details')?.addEventListener('click', () => _openBriefingDetails());
  _el('cerberus-desktop-open-cursor')?.addEventListener('click', () => {
    document.getElementById('settings-btn')?.click();
    import('./settings.js').then(() => {
      const tab = document.querySelector('[data-settings-tab="desktop"]');
      tab?.click();
    });
    _deps.showToast?.('Configure desktop apps in Settings → Desktop Bridge.');
  });
  _el('cerberus-desktop-open-folder')?.addEventListener('click', () => {
    const active = cerberusActiveProject.getActiveProjectId?.();
    void _desktopCommand('open_project_in_cursor', { project_id: active || '' });
  });
  _el('cerberus-desktop-setup')?.addEventListener('click', () => _openDesktopSetup());
  _el('cerberus-hq-desktop-open-settings')?.addEventListener('click', () => {
    document.getElementById('settings-btn')?.click();
    document.querySelector('[data-settings-tab="desktop"]')?.click();
  });

}

export function initHome(deps = {}) {
  _deps = deps;
  cerberusShellModals.initAtlasShellModals(deps);
  agentsOfficeModule.initAgentsOffice({
    showToast: deps.showToast,
    openAssistant: deps.openAssistant,
    showProjects: () => showProjects({ skipHistory: false }),
  });
  cerberusProjectsModule.initAtlasProjects({ showToast: deps.showToast });
  cerberusFinanceModule.initAtlasFinance({ showToast: deps.showToast });
  cerberusPipelineModule.initAtlasPipeline({
    showToast: deps.showToast,
    onPipelineUpdate: () => agentsOfficeModule.refreshAgentsOffice(),
  });
  cerberusProjectContext.initAtlasProjectContext({
    showToast: deps.showToast,
    openSummary: (id) => cerberusProjectsModule.openProjectSummary?.(id),
    onPinChange: async () => { await loadProjects(); _renderProjects(); refreshCerberusGraph(_projects); },
  });
  cerberusProjectHQ.initAtlasProjectHQ({ showToast: deps.showToast });
  cerberusDesktopApps.initAtlasDesktopApps({ showToast: deps.showToast });
  import('./cerberusLauncherSettings.js').then((m) => m.default.initAtlasLauncherSettings({ showToast: deps.showToast }));
  cerberusReasoningAudit.initAtlasReasoningAudit({ showToast: deps.showToast });
  cerberusActiveProject.initAtlasActiveProject({
    navigateAssistant: () => deps.openAssistant?.('', { submit: false }),
  });
  window.cerberusPipelineRefresh = () => cerberusPipelineModule.renderPipeline();
  _bindEvents();
  // Home shell boots from app.js _bootAtlasAfterSetup() after the setup wizard gate.
  if (deps.defaultHome && !deps.skipDefaultHome
    && !isCerberusAgentsRoute() && !isCerberusProjectsRoute() && !isCerberusFinanceRoute()) {
    showHome();
  }
}

const homeModule = {
  initHome,
  bootAtlasHome,
  onSetupComplete,
  prefetchAtlasData,
  showHome,
  showAgentsOffice,
  showProjects,
  showFinance,
  showAssistantView,
  openAtlasModal,
  hideHome,
  isHomeActive,
  loadProjects,
  getAtlasAgents,
};

export default homeModule;
