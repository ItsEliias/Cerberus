// Cerberus OS — global voice/action context store

const STATE = {
  currentRoute: 'home',
  currentProjectId: null,
  currentProjectName: null,
  currentAgentId: null,
  currentAgentName: null,
  currentReportId: null,
  currentReportTitle: null,
  currentModal: null,
  currentSelectionType: null,
  currentSelectionLabel: null,
};

const LISTENERS = new Set();

function _notify() {
  LISTENERS.forEach((fn) => {
    try { fn(get()); } catch (_) {}
  });
  window.AtlasVoiceActionsPanel?.refresh?.();
}

function get() {
  return { ...STATE };
}

function set(partial = {}) {
  if (!partial || typeof partial !== 'object') return get();
  Object.assign(STATE, partial);
  _notify();
  return get();
}

function clear(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'project' || t === 'all') {
    STATE.currentProjectId = null;
    STATE.currentProjectName = null;
  }
  if (t === 'agent' || t === 'all') {
    STATE.currentAgentId = null;
    STATE.currentAgentName = null;
  }
  if (t === 'report' || t === 'all') {
    STATE.currentReportId = null;
    STATE.currentReportTitle = null;
  }
  if (t === 'modal' || t === 'all') {
    STATE.currentModal = null;
  }
  if (t === 'selection' || t === 'all') {
    STATE.currentSelectionType = null;
    STATE.currentSelectionLabel = null;
  }
  _notify();
  return get();
}

function reset() {
  STATE.currentRoute = 'home';
  STATE.currentProjectId = null;
  STATE.currentProjectName = null;
  STATE.currentAgentId = null;
  STATE.currentAgentName = null;
  STATE.currentReportId = null;
  STATE.currentReportTitle = null;
  STATE.currentModal = null;
  STATE.currentSelectionType = null;
  STATE.currentSelectionLabel = null;
  _notify();
  return get();
}

function describe() {
  const parts = [];
  if (STATE.currentRoute) parts.push(`route:${STATE.currentRoute}`);
  if (STATE.currentModal) parts.push(`modal:${STATE.currentModal}`);
  if (STATE.currentProjectName) parts.push(`project:${STATE.currentProjectName}`);
  if (STATE.currentAgentName) parts.push(`agent:${STATE.currentAgentName}`);
  if (STATE.currentReportTitle) parts.push(`report:${STATE.currentReportTitle}`);
  if (STATE.currentSelectionLabel) parts.push(`selection:${STATE.currentSelectionLabel}`);
  return parts.join(' · ') || 'general';
}

function onChange(fn) {
  if (typeof fn === 'function') LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

const AtlasVoiceContext = { get, set, clear, reset, describe, onChange };

window.AtlasVoiceContext = AtlasVoiceContext;
export default AtlasVoiceContext;
