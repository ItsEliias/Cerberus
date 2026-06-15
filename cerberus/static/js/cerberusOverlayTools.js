// Cerberus OS — global overlay tools (Notes, Library, Cookbook, Calendar, Brain, Tasks)

import AtlasVoiceContext from './cerberusVoiceContext.js';

const TOOL_IDS = ['notes', 'library', 'cookbook', 'calendar', 'brain', 'tasks'];

function _isAtlasOs() {
  return document.body.classList.contains('cerberus-os');
}

function _applyOverlayClass(el) {
  if (el && _isAtlasOs()) el.classList.add('cerberus-overlay-modal');
}

function _visible(id) {
  if (id === 'notes') {
    const pane = document.getElementById('notes-pane');
    return !!(pane && !pane.classList.contains('hidden'));
  }
  if (id === 'library') {
    const m = document.getElementById('doclib-modal');
    return !!(m && !m.classList.contains('hidden'));
  }
  if (id === 'cookbook') {
    const m = document.getElementById('cookbook-modal');
    return !!(m && !m.classList.contains('hidden'));
  }
  if (id === 'calendar') {
    const m = document.getElementById('calendar-modal');
    return !!(m && m.style.display !== 'none' && !m.classList.contains('hidden'));
  }
  if (id === 'brain') {
    const m = document.getElementById('memory-modal');
    return !!(m && !m.classList.contains('hidden'));
  }
  if (id === 'tasks') {
    const m = document.getElementById('tasks-modal');
    return !!m;
  }
  return false;
}

function _syncContext(toolId, open) {
  if (open) {
    AtlasVoiceContext.set({
      currentModal: toolId,
      currentSelectionType: 'overlay',
      currentSelectionLabel: toolId.charAt(0).toUpperCase() + toolId.slice(1),
    });
  } else if (AtlasVoiceContext.get().currentModal === toolId) {
    AtlasVoiceContext.clear('modal');
    AtlasVoiceContext.clear('selection');
  }
}

export function isOverlayToolOpen(id) {
  if (id) return _visible(id);
  return TOOL_IDS.some((t) => _visible(t));
}

export function anyOverlayOpen() {
  return TOOL_IDS.some((t) => _visible(t));
}

export async function openOverlayTool(id) {
  const tool = String(id || '').toLowerCase().replace(/^memory$/, 'brain');
  if (!TOOL_IDS.includes(tool)) return false;

  if (tool === 'notes') {
    const mod = await import('./notes.js');
    mod.openPanel?.();
    const backdrop = document.getElementById('notes-pane-backdrop');
    if (_isAtlasOs() && backdrop) backdrop.classList.add('cerberus-overlay-host');
    _syncContext('notes', true);
    return true;
  }
  if (tool === 'library') {
    if (window.sessionModule?.openLibrary) window.sessionModule.openLibrary();
    else (await import('./documentLibrary.js')).openLibrary?.();
    _applyOverlayClass(document.getElementById('doclib-modal'));
    _syncContext('library', true);
    return true;
  }
  if (tool === 'cookbook') {
    const mod = await import('./cookbook.js');
    await mod.open?.();
    _applyOverlayClass(document.getElementById('cookbook-modal'));
    _syncContext('cookbook', true);
    return true;
  }
  if (tool === 'calendar') {
    const mod = await import('./calendar.js');
    mod.openCalendar?.();
    _applyOverlayClass(document.getElementById('calendar-modal'));
    _syncContext('calendar', true);
    return true;
  }
  if (tool === 'brain') {
    const modal = document.getElementById('memory-modal');
    if (modal) {
      modal.classList.remove('hidden');
      _applyOverlayClass(modal);
      window.memoryModule?.renderMemoryList?.();
      window.memoryModule?.updateMemoryCount?.();
    }
    _syncContext('brain', true);
    return true;
  }
  if (tool === 'tasks') {
    const mod = await import('./tasks.js');
    mod.openTasks?.();
    _applyOverlayClass(document.getElementById('tasks-modal'));
    _syncContext('tasks', true);
    return true;
  }
  return false;
}

export async function closeOverlayTool(id) {
  const tool = String(id || '').toLowerCase().replace(/^memory$/, 'brain');
  if (!TOOL_IDS.includes(tool)) return false;
  if (!_visible(tool)) return false;

  if (tool === 'notes') {
    (await import('./notes.js')).closePanel?.();
    _syncContext('notes', false);
    return true;
  }
  if (tool === 'library') {
    if (window.sessionModule?.closeLibrary) window.sessionModule.closeLibrary();
    else (await import('./documentLibrary.js')).closeLibrary?.();
    _syncContext('library', false);
    return true;
  }
  if (tool === 'cookbook') {
    (await import('./cookbook.js')).close?.();
    _syncContext('cookbook', false);
    return true;
  }
  if (tool === 'calendar') {
    (await import('./calendar.js')).closeCalendar?.();
    _syncContext('calendar', false);
    return true;
  }
  if (tool === 'brain') {
    const modal = document.getElementById('memory-modal');
    if (modal) modal.classList.add('hidden');
    _syncContext('brain', false);
    return true;
  }
  if (tool === 'tasks') {
    (await import('./tasks.js')).closeTasks?.();
    _syncContext('tasks', false);
    return true;
  }
  return false;
}

export async function closeTopOverlay() {
  for (const id of ['calendar', 'tasks', 'notes', 'brain', 'library', 'cookbook']) {
    if (_visible(id)) return closeOverlayTool(id);
  }
  return false;
}

const cerberusOverlayTools = {
  openOverlayTool,
  closeOverlayTool,
  closeTopOverlay,
  isOverlayToolOpen,
  anyOverlayOpen,
  TOOL_IDS,
};

window.AtlasOverlayTools = cerberusOverlayTools;
export default cerberusOverlayTools;
