/**
 * static/js/cyberapps/playbookstudio/state.js
 * Module-level reactive state store for PlaybookStudio.
 */

const _state = {
  playbooks:      [],
  runs:           [],
  view:           'library',
  activePlaybook: null,
  activeRun:      null,
  categoryFilter: 'all',
};

const _subs = new Set();

function _notify() {
  _subs.forEach(fn => fn(_state));
}

export function getState() { return _state; }

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export function setPlaybooks(playbooks) {
  _state.playbooks = playbooks;
  _notify();
}

export function setRuns(runs) {
  _state.runs = runs;
  _notify();
}

export function setView(view) {
  _state.view = view;
  _notify();
}

export function setActivePlaybook(pb) {
  _state.activePlaybook = pb;
  _notify();
}

export function setActiveRun(run) {
  _state.activeRun = run;
  _notify();
}

export function setCategoryFilter(cat) {
  _state.categoryFilter = cat;
  _notify();
}

export function updateRun(run) {
  _state.runs = _state.runs.map(r => r.id === run.id ? run : r);
  if (_state.activeRun?.id === run.id) _state.activeRun = run;
  _notify();
}
