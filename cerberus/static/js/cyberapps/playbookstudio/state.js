/**
 * static/js/cyberapps/playbookstudio/state.js
 * Module-level reactive state for PlaybookStudio.
 */

let _playbooks = [];
let _runs = [];
let _view = 'library'; // library | editor | run | history
let _activePlaybook = null;
let _activeRun = null;
let _categoryFilter = 'all';

const _listeners = new Set();

function _notify() {
  _listeners.forEach(fn => fn());
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getState() {
  return {
    playbooks: _playbooks,
    runs: _runs,
    view: _view,
    activePlaybook: _activePlaybook,
    activeRun: _activeRun,
    categoryFilter: _categoryFilter,
  };
}

export function setPlaybooks(pbs) { _playbooks = pbs; _notify(); }
export function setRuns(runs) { _runs = runs; _notify(); }
export function setView(v) { _view = v; _notify(); }
export function setActivePlaybook(pb) { _activePlaybook = pb; _notify(); }
export function setActiveRun(run) { _activeRun = run; _notify(); }
export function setCategoryFilter(cat) { _categoryFilter = cat; _notify(); }

export function updateRun(updated) {
  _runs = _runs.map(r => r.id === updated.id ? updated : r);
  if (_activeRun && _activeRun.id === updated.id) _activeRun = updated;
  _notify();
}
