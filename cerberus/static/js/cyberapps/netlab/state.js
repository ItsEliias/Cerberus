/**
 * static/js/cyberapps/netlab/state.js
 * Shared reactive state for NetLab.
 * Observers pattern: subscribe(key, callback) fires when state[key] changes.
 */

const _state = {
  labs: [],
  progress: {},        // Record<labId, ProgressObj>
  snippets: [],
  topologies: [],
  activeLab: null,
  activeStepIndex: 0,
  activeView: 'labs',  // 'labs'|'reference'|'topology'|'snippets'|'progress'|'settings'
  labStartTime: null,
};

const _listeners = {};  // Record<key, Set<fn>>

function _notify(key) {
  (_listeners[key] || []).forEach(fn => { try { fn(_state[key]); } catch (e) { /* ignore */ } });
}

export function get(key) {
  return _state[key];
}

export function set(key, value) {
  _state[key] = value;
  _notify(key);
}

export function subscribe(key, fn) {
  if (!_listeners[key]) _listeners[key] = new Set();
  _listeners[key].add(fn);
  return () => _listeners[key].delete(fn);
}

// ---------------------------------------------------------------------------
// Named state setters (mirrors Zustand store actions)
// ---------------------------------------------------------------------------

export function setLabs(labs) { set('labs', labs); }
export function setProgress(prog) { set('progress', prog); }
export function setSnippets(s) { set('snippets', s); }
export function setTopologies(t) { set('topologies', t); }
export function setActiveView(v) { set('activeView', v); }

export function setActiveLab(lab) {
  set('activeLab', lab);
  set('activeStepIndex', 0);
  if (lab) set('activeView', 'labs');
}

export function setActiveStepIndex(i) { set('activeStepIndex', i); }

export function startLabTimer() { set('labStartTime', Date.now()); }
export function clearLabTimer() { set('labStartTime', null); }

export function updateStepResult(labId, stepId, passed, actualOutput) {
  const prog = { ..._state.progress };
  const existing = prog[labId] || {
    labId,
    startedAt: new Date().toISOString(),
    stepResults: {},
    notes: '',
  };
  const updated = {
    ...existing,
    stepResults: {
      ...existing.stepResults,
      [stepId]: { passed, actualOutput, attemptedAt: new Date().toISOString() },
    },
  };
  prog[labId] = updated;
  setProgress(prog);
  _persistProgress(updated);
}

export function updateLabNotes(labId, notes) {
  const prog = { ..._state.progress };
  const existing = prog[labId] || {
    labId,
    startedAt: new Date().toISOString(),
    stepResults: {},
    notes: '',
  };
  const updated = { ...existing, notes };
  prog[labId] = updated;
  setProgress(prog);
  _scheduleNotesPersist(labId, updated);
}

export function markLabComplete(labId, elapsedMs) {
  const prog = { ..._state.progress };
  const existing = prog[labId];
  if (!existing) return;
  const updated = {
    ...existing,
    completedAt: new Date().toISOString(),
    bestTimeMs: elapsedMs && (!existing.bestTimeMs || elapsedMs < existing.bestTimeMs)
      ? elapsedMs
      : existing.bestTimeMs,
  };
  prog[labId] = updated;
  setProgress(prog);
  _persistProgress(updated);
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
const _notesTimers = {};
const _notesPayloads = {};

function _scheduleNotesPersist(labId, payload) {
  _notesPayloads[labId] = payload;
  clearTimeout(_notesTimers[labId]);
  _notesTimers[labId] = setTimeout(() => {
    const p = _notesPayloads[labId];
    delete _notesTimers[labId];
    delete _notesPayloads[labId];
    if (p) _persistProgress(p);
  }, 500);
}

async function _persistProgress(prog) {
  try {
    await fetch(`/api/cyberapps/netlab/progress/${prog.labId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prog),
    });
  } catch (e) {
    // Best-effort; state already updated in memory
  }
}
