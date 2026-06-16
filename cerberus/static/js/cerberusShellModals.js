// Cerberus OS — multi-window modal workspace (stay on Home, globe always visible)

import cerberusOverlayTools from './cerberusOverlayTools.js';
import officesModal from './officesModal.js';
import cerberusModalWindow from './cerberusModalWindow.js';
import * as modalRegistry from './cerberusModalRegistry.js';

const PANEL_MODALS = {
  projects: { panelId: 'cerberus-projects-panel', title: 'Projects' },
  finance: { panelId: 'cerberus-finance-panel', title: 'Finance' },
};

const SHELL_MODALS = {
  assistant: 'cerberus-shell-modal-assistant',
  offices: 'cerberus-shell-modal-offices',
  tools: 'cerberus-shell-modal-tools',
  brain: 'cerberus-shell-modal-brain',
  voice: 'cerberus-shell-modal-voice',
  monitor: 'cerberus-shell-modal-monitor',
};

/** Spoken/typed aliases → canonical modal ids. */
const MODAL_ALIASES = {
  agents: 'offices',
  memory: 'brain',
  'voice-commands': 'voice',
  'voice commands': 'voice',
  voicecommands: 'voice',
  'voice command cheat sheet': 'voice',
  'voice cheat sheet': 'voice',
  'cheat sheet': 'voice',
  cheatsheet: 'voice',
  'system-monitor': 'monitor',
  'system monitor': 'monitor',
  systemmonitor: 'monitor',
  sysmon: 'monitor',
};

const OVERLAY_MODALS = new Set(['calendar', 'notes', 'library', 'cookbook', 'settings', 'tasks', 'brain']);

const TOOL_TILES = [
  { id: 'calendar', label: 'Calendar', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
  { id: 'notes', label: 'Notes', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5"/><path d="M8 17.5 15.5 10l2.5 2.5L10.5 20H8z"/></svg>' },
  { id: 'library', label: 'Library', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
  { id: 'cookbook', label: 'Cookbook', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>' },
  { id: 'settings', label: 'Settings', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' },
  { id: 'voice', label: 'Voice Commands', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' },
  { id: 'monitor', label: 'System Monitor', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="6 11 9 11 11 8 13 13 15 10 18 10"/></svg>' },
];

const BRAIN_SECTIONS = [
  { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge Graph' },
  { id: 'indexed', label: 'Indexed Files' },
  { id: 'context', label: 'Project Context' },
  { id: 'system', label: 'System Knowledge' },
  { id: 'reports', label: 'Agent Reports' },
  { id: 'learning', label: 'Learning / Status' },
];

let _deps = {};

function _el(id) {
  return document.getElementById(id);
}

function _backdrop() {
  return _el('cerberus-shell-modal-backdrop');
}

function _updateBodyClass() {
  document.body.classList.toggle('cerberus-modal-open', modalRegistry.hasOpenModals());
  document.body.classList.add('cerberus-hub-active');
}

function _trackOpen(id) {
  modalRegistry.trackModalOpen(id);
  _updateBodyClass();
}

function _trackClose(id) {
  modalRegistry.trackModalClose(id);
  _updateBodyClass();
}

export function notifyModalOpened(id, el) {
  modalRegistry.raiseModal(el, id);
  modalRegistry.bindRaiseOnFocus(el, id);
  _updateBodyClass();
}

export function notifyModalClosed(id) {
  _trackClose(id);
}

function _showBackdrop() {
  const bd = _backdrop();
  if (!bd) return;
  bd.classList.toggle('cerberus-shell-modal-backdrop--visible', false);
  bd.classList.add('hidden');
}

function _hidePortaledEl(el) {
  if (!el) return;
  cerberusModalWindow.deactivateAtlasModal(el);
  el.classList.add('hidden');
  el.classList.remove('cerberus-shell-panel-active', 'cerberus-shell-modal--open');
  el.setAttribute('aria-hidden', 'true');
  el.querySelectorAll('.cerberus-modal-window').forEach((child) => {
    cerberusModalWindow.deactivateAtlasModal(child);
    child.classList.add('hidden');
  });
}

function _shellModalKeyFromEl(modalEl) {
  if (!modalEl?.id) return null;
  return Object.entries(SHELL_MODALS).find(([, domId]) => domId === modalEl.id)?.[0] || null;
}

async function _closeOverlayModal(id) {
  if (id === 'settings') {
    try {
      const settingsMod = await import('./settings.js');
      settingsMod.default?.close?.();
    } catch (_) {
      _hidePortaledEl(_el('settings-modal'));
    }
    return;
  }
  await cerberusOverlayTools.closeOverlayTool(id);
}

async function _closeOneModal(id) {
  const key = String(id || '').toLowerCase();
  if (!key) return false;

  if (key === 'project_hq') {
    const mod = await import('./cerberusProjectHQ.js');
    mod.default?.closeProjectHQ?.();
    return true;
  }

  if (PANEL_MODALS[key]) {
    _hidePortaledEl(_el(PANEL_MODALS[key].panelId));
    _trackClose(key);
    return true;
  }

  if (SHELL_MODALS[key]) {
    if (key === 'monitor') {
      import('./cerberusSystemMonitor.js').then((m) => m.default.stopSystemMonitor()).catch(() => {});
    }
    _hidePortaledEl(_el(SHELL_MODALS[key]));
    _trackClose(key);
    return true;
  }

  if (OVERLAY_MODALS.has(key)) {
    await _closeOverlayModal(key);
    _trackClose(key);
    return true;
  }

  return false;
}

function _sweepGhostPortalModals() {
  const portal = _el('cerberus-modal-portal');
  if (!portal) return;

  portal.querySelectorAll('.hidden.cerberus-modal-placed, .cerberus-modal-window.hidden').forEach((el) => {
    cerberusModalWindow.deactivateAtlasModal(el);
  });
}

export async function closeShellModal(id) {
  if (!id) {
    const ids = modalRegistry.getOpenModals();
    for (const mid of ids) {
      await _closeOneModal(mid);
    }
    _sweepGhostPortalModals();
    _showBackdrop();
    import('./windowResize.js').then((m) => m.clearWindowResizeLock?.()).catch(() => {});
    return true;
  }

  const closed = await _closeOneModal(id);
  if (closed) {
    import('./windowResize.js').then((m) => m.clearWindowResizeLock?.()).catch(() => {});
  }
  return closed;
}

export function closeAllModals() {
  return closeShellModal();
}

/** Re-open modals from the last Atlas session (localStorage). */
export async function restoreSessionModals() {
  const ids = modalRegistry.getPersistedModalIds();
  if (!ids.length) return;
  for (const id of ids) {
    if (isModalOpen(id)) continue;
    try {
      await openShellModal(id);
    } catch (err) {
      console.warn('[atlas] restore modal failed:', id, err);
    }
  }
}

export function getOpenModal() {
  return modalRegistry.getOpenModal();
}

export function getOpenModals() {
  return modalRegistry.getOpenModals();
}

function _modalDomVisible(id) {
  if (PANEL_MODALS[id]) {
    const el = _el(PANEL_MODALS[id].panelId);
    return !!(el && !el.classList.contains('hidden'));
  }
  if (SHELL_MODALS[id]) {
    const el = _el(SHELL_MODALS[id]);
    return !!(el && el.classList.contains('cerberus-shell-modal--open') && !el.classList.contains('hidden'));
  }
  if (id === 'project_hq') {
    const el = _el('cerberus-project-hq');
    return !!(el && !el.classList.contains('hidden'));
  }
  if (id === 'settings') {
    const el = _el('settings-modal');
    return !!(el && !el.classList.contains('hidden'));
  }
  const overlayIds = {
    calendar: 'calendar-modal',
    library: 'doclib-modal',
    cookbook: 'cookbook-modal',
    notes: 'notes-pane',
    tasks: 'tasks-modal',
    brain: 'memory-modal',
  };
  const domId = overlayIds[id];
  if (domId) {
    const el = _el(domId);
    return !!(el && !el.classList.contains('hidden') && el.style.display !== 'none');
  }
  return false;
}

export function isModalOpen(id) {
  return modalRegistry.isModalTrackedOpen(id);
}

async function _renderPanelContent(id) {
  if (id === 'projects') {
    const mod = await import('./cerberusProjects.js');
    await mod.default?.renderProjectsPanel?.();
  } else if (id === 'finance') {
    const mod = await import('./cerberusFinance.js');
    await mod.default?.renderFinancePanel?.();
  } else if (id === 'offices') {
    officesModal.renderOfficesModal();
  }
}

function _portalEl(el) {
  const portal = _el('cerberus-modal-portal');
  if (portal && el && el.parentElement !== portal) {
    portal.appendChild(el);
  }
}

function _ensurePanelCloseBtn(panel, modalKey) {
  if (!panel || panel.querySelector('.cerberus-shell-panel-close')) return;
  const header = panel.querySelector('.cerberus-os-panel-header, .cerberus-hq-header, .cerberus-agents-header');
  if (!header) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cerberus-shell-modal-close cerberus-shell-panel-close';
  btn.setAttribute('aria-label', 'Close');
  btn.textContent = '×';
  btn.style.marginLeft = 'auto';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeShellModal(modalKey);
  });
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.appendChild(btn);
}

function _openPanelModal(id) {
  const cfg = PANEL_MODALS[id];
  if (!cfg) return false;
  const panel = _el(cfg.panelId);
  if (!panel) return false;

  if (isModalOpen(id)) {
    modalRegistry.raiseModal(panel, id);
    _updateBodyClass();
    void _renderPanelContent(id);
    return true;
  }

  _portalEl(panel);
  panel.classList.remove('hidden');
  panel.classList.add('cerberus-shell-panel-active', 'cerberus-shell-modal--open');
  panel.setAttribute('aria-hidden', 'false');
  _ensurePanelCloseBtn(panel, id);
  cerberusModalWindow.openAtlasModalWindow(panel, cfg.panelId);
  notifyModalOpened(id, panel);
  _showBackdrop();
  void _renderPanelContent(id);
  return true;
}

function _openShellModal(id) {
  const modalId = SHELL_MODALS[id];
  const modal = _el(modalId);
  if (!modal) return false;

  if (isModalOpen(id)) {
    modalRegistry.raiseModal(modal, id);
    _updateBodyClass();
    return true;
  }

  _portalEl(modal);
  modal.classList.remove('hidden');
  modal.classList.add('cerberus-shell-modal--open');
  modal.setAttribute('aria-hidden', 'false');
  cerberusModalWindow.openAtlasModalWindow(modal, modalId);
  notifyModalOpened(id, modal);
  _showBackdrop();

  if (id === 'brain') _activateBrainSection('memory');
  return true;
}

function _activateBrainSection(sectionId) {
  document.querySelectorAll('.cerberus-brain-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.brainSection === sectionId);
  });
  document.querySelectorAll('.cerberus-brain-section').forEach((sec) => {
    sec.classList.toggle('active', sec.dataset.brainSection === sectionId);
  });
  if (sectionId === 'memory') {
    void _loadMemoryPreview();
  }
  if (sectionId === 'reports') {
    _renderBrainReports();
  }
}

async function _renderBrainReports() {
  const el = _el('cerberus-brain-reports-content');
  if (!el) return;
  try {
    const res = await fetch('/api/cerberus/reports', { credentials: 'same-origin' });
    const data = await res.json();
    const reports = data.queue?.pending || data.reports?.filter?.((r) => r.status === 'pending') || [];
    el.innerHTML = reports.length
      ? reports.map((r) => `<div class="cerberus-brain-report-item" style="padding:8px;border-bottom:1px solid rgba(80,200,255,0.1)"><strong>${r.agent || r.title || 'Report'}</strong><br><span style="opacity:0.6;font-size:0.75rem">${r.summary || r.message || ''}</span></div>`).join('')
      : '<p class="cerberus-brain-placeholder">No pending agent reports.</p>';
  } catch (_) {
    el.innerHTML = '<p class="cerberus-brain-placeholder">Agent reports will appear here when agents submit results.</p>';
  }
}

export async function openShellModal(id) {
  let modalId = String(id || '').toLowerCase().trim();
  if (MODAL_ALIASES[modalId]) modalId = MODAL_ALIASES[modalId];

  if (modalId === 'tasks') {
    if (isModalOpen('tasks')) {
      const tasksModal = _el('tasks-modal');
      if (tasksModal) {
        modalRegistry.raiseModal(tasksModal, 'tasks');
        _updateBodyClass();
      }
      return true;
    }
    await cerberusOverlayTools.openOverlayTool('tasks');
    const tasksModal = document.getElementById('tasks-modal');
    if (tasksModal) {
      _portalEl(tasksModal);
      tasksModal.classList.add('cerberus-overlay-modal');
      tasksModal.classList.remove('hidden');
      const tasksContent = tasksModal.querySelector('.tasks-modal-content, .modal-content');
      if (tasksContent) cerberusModalWindow.openAtlasModalWindow(tasksContent, 'tasks-modal');
      notifyModalOpened('tasks', tasksModal);
    }
    _showBackdrop();
    return true;
  }

  if (modalId.startsWith('finance:')) {
    return _openPanelModal('finance');
  }

  if (modalId.startsWith('project:')) {
    const pid = modalId.slice(8);
    if (pid) {
      try {
        const mod = await import('./cerberusProjectHQ.js');
        await mod.default.openProjectHQ?.(pid);
      } catch (_) {}
      return true;
    }
    return _openPanelModal('projects');
  }

  if (modalId.startsWith('office:') || modalId.startsWith('dept:') || modalId.startsWith('agent:') || modalId.startsWith('subagent:')) {
    const opened = await _openShellModal('offices');
    if (opened) officesModal.renderOfficesModal();
    return opened;
  }

  if (modalId.startsWith('task:')) {
    return openShellModal('tasks');
  }

  if (PANEL_MODALS[modalId]) {
    return _openPanelModal(modalId);
  }

  if (SHELL_MODALS[modalId]) {
    if (modalId === 'assistant') {
      window.cerberusHomeConversation?.onHomeShown?.();
    }
    if (modalId === 'offices') {
      officesModal.renderOfficesModal();
    }
    const opened = _openShellModal(modalId);
    if (opened && modalId === 'voice') {
      import('./cerberusVoiceCheatSheet.js')
        .then((m) => m.default.renderVoiceCheatSheet())
        .catch((err) => console.error('[atlas] cheat sheet failed:', err));
    }
    if (opened && modalId === 'monitor') {
      import('./cerberusSystemMonitor.js')
        .then((m) => m.default.startSystemMonitor())
        .catch((err) => console.error('[atlas] system monitor failed:', err));
    }
    return opened;
  }

  if (['calendar', 'notes', 'library', 'cookbook', 'settings'].includes(modalId)) {
    if (isModalOpen(modalId)) {
      if (modalId === 'settings') {
        const content = _el('settings-modal')?.querySelector('.settings-modal-content');
        if (content) {
          modalRegistry.raiseModal(content, 'settings');
          _updateBodyClass();
        }
      } else {
        const overlayIds = {
          calendar: 'calendar-modal',
          library: 'doclib-modal',
          cookbook: 'cookbook-modal',
          notes: 'notes-pane',
        };
        const overlayEl = _el(overlayIds[modalId]);
        if (overlayEl) {
          modalRegistry.raiseModal(overlayEl, modalId);
          _updateBodyClass();
        }
      }
      return true;
    }

    if (modalId === 'settings') {
      const settingsMod = await import('./settings.js');
      settingsMod.default.open();
      const settingsModal = _el('settings-modal');
      const content = settingsModal?.querySelector('.settings-modal-content');
      if (settingsModal && content) {
        _portalEl(settingsModal);
        settingsModal.classList.remove('hidden');
        settingsModal.classList.add('cerberus-overlay-modal');
        settingsModal.setAttribute('aria-hidden', 'false');
        cerberusModalWindow.openAtlasModalWindow(content, 'settings-modal');
        notifyModalOpened('settings', content);
        modalRegistry.bindRaiseOnFocus(settingsModal, 'settings');
      }
      _showBackdrop();
      return true;
    }

    await cerberusOverlayTools.openOverlayTool(modalId);
    const overlayIds = {
      calendar: 'calendar-modal',
      library: 'doclib-modal',
      cookbook: 'cookbook-modal',
      notes: 'notes-pane',
    };
    const overlayEl = document.getElementById(overlayIds[modalId]);
    if (overlayEl) {
      _portalEl(overlayEl);
      overlayEl.classList.add('cerberus-overlay-modal');
      overlayEl.classList.remove('hidden');
      overlayEl.setAttribute('aria-hidden', 'false');
      if (modalId === 'notes') {
        overlayEl.classList.add('cerberus-notes-centered');
        const backdrop = document.getElementById('notes-pane-backdrop');
        if (backdrop) backdrop.classList.add('cerberus-notes-backdrop-hidden');
        cerberusModalWindow.openAtlasModalWindow(overlayEl, 'notes-pane');
        notifyModalOpened('notes', overlayEl);
      } else {
        const content = overlayEl.querySelector('.modal-content, .tasks-modal-content');
        if (content) {
          cerberusModalWindow.openAtlasModalWindow(content, overlayIds[modalId] || `${modalId}-modal`);
          notifyModalOpened(modalId, content);
          modalRegistry.bindRaiseOnFocus(overlayEl, modalId);
        }
      }
    }
    _showBackdrop();
    return true;
  }

  return false;
}

function _renderToolsGrid() {
  const grid = _el('cerberus-tools-grid');
  if (!grid || grid.dataset.rendered) return;
  grid.dataset.rendered = '1';
  grid.innerHTML = TOOL_TILES.map((t) => `
    <button type="button" class="cerberus-tools-tile" data-tool-id="${t.id}">
      ${t.icon}
      <span class="cerberus-tools-tile-label">${t.label}</span>
    </button>
  `).join('');
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-tool-id]');
    if (!tile) return;
    void openShellModal(tile.dataset.toolId);
  });
}

function _renderBrainTabs() {
  const tabs = _el('cerberus-brain-tabs');
  const body = _el('cerberus-brain-sections');
  if (!tabs || tabs.dataset.rendered) return;
  tabs.dataset.rendered = '1';
  body.dataset.rendered = '1';

  tabs.innerHTML = BRAIN_SECTIONS.map((s, i) =>
    `<button type="button" class="cerberus-brain-tab${i === 0 ? ' active' : ''}" data-brain-section="${s.id}">${s.label}</button>`
  ).join('');

  body.innerHTML = BRAIN_SECTIONS.map((s, i) => {
    if (s.id === 'memory') {
      return `<div class="cerberus-brain-section${i === 0 ? ' active' : ''}" data-brain-section="memory">
        <p class="cerberus-brain-placeholder">Persistent memories, skills, and learned context.</p>
        <button type="button" id="cerberus-brain-open-memory" class="cerberus-briefing-btn" style="margin-bottom:12px">Open Memory Editor</button>
        <div id="cerberus-brain-memory-preview"></div>
      </div>`;
    }
    if (s.id === 'reports') {
      return `<div class="cerberus-brain-section" data-brain-section="reports"><div id="cerberus-brain-reports-content"></div></div>`;
    }
    return `<div class="cerberus-brain-section" data-brain-section="${s.id}"><p class="cerberus-brain-placeholder">${s.label} — connect backend data here. Cerberus stores ${s.label.toLowerCase()} as the source of truth for agent context isolation.</p></div>`;
  }).join('');

  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-brain-section]');
    if (!tab) return;
    _activateBrainSection(tab.dataset.brainSection);
  });

  _el('cerberus-brain-open-memory')?.addEventListener('click', () => {
    void cerberusOverlayTools.openOverlayTool('brain');
  });
}

async function _loadMemoryPreview() {
  const el = _el('cerberus-brain-memory-preview');
  if (!el) return;
  try {
    const res = await fetch('/api/memory', { credentials: 'same-origin' });
    const data = await res.json();
    const items = data.memory || data.memories || (Array.isArray(data) ? data : []);
    const list = Array.isArray(items) ? items.slice(0, 8) : [];
    el.innerHTML = list.length
      ? `<p style="font-size:0.72rem;opacity:0.55;margin:0 0 8px">${items.length} memories stored</p>` +
        list.map((m) => `<div style="padding:6px 0;border-bottom:1px solid rgba(80,200,255,0.08);font-size:0.78rem">${m.title || m.content?.slice(0, 80) || 'Memory'}</div>`).join('')
      : '<p class="cerberus-brain-placeholder">No memories yet. Use the Memory Editor to add context.</p>';
  } catch (_) {
    el.innerHTML = '<p class="cerberus-brain-placeholder">Memory preview loads when backend is connected.</p>';
  }
}

function _bindCloseButtons() {
  document.querySelectorAll('[data-shell-modal-close]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shell = btn.closest('.cerberus-shell-modal');
      const key = _shellModalKeyFromEl(shell);
      if (key) {
        closeShellModal(key);
        return;
      }
      const top = getOpenModal();
      if (top) closeShellModal(top);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = getOpenModal();
    if (top) closeShellModal(top);
  });
}

export function initAtlasShellModals(deps = {}) {
  _deps = deps;
  modalRegistry.setModalDomVisibleCheck(_modalDomVisible);
  officesModal.initOfficesModal(deps);
  _renderToolsGrid();
  _renderBrainTabs();
  _bindCloseButtons();
  _sweepGhostPortalModals();
  _updateBodyClass();
  import('./windowResize.js').then((m) => m.clearWindowResizeLock?.()).catch(() => {});
}

const cerberusShellModals = {
  initAtlasShellModals,
  openShellModal,
  closeShellModal,
  closeAllModals,
  restoreSessionModals,
  getOpenModal,
  getOpenModals,
  isModalOpen,
  notifyModalOpened,
  notifyModalClosed,
};

export default cerberusShellModals;
