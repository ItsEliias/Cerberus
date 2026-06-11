/**
 * static/js/cyberapps/reportforge/state.js
 * Minimal reactive state store for ReportForge.
 * Mirrors the key slices from the Electron app's Zustand store.
 */

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map();

const _state = {
  /** @type {'library'|'editor'|'wizard'} */
  view: 'library',
  /** @type {Array<object>} */
  reports: [],
  /** @type {object|null} */
  activeReport: null,
  /** @type {string|null} */
  activeSectionId: null,
  /** @type {string|null} */
  activeFindingId: null,
  dirty: false,
  /** @type {Array<object>} */
  builtinTemplates: [],
  /** @type {Array<object>} */
  customTemplates: [],
};

/**
 * @param {string} key
 * @param {any} value
 */
export function set(key, value) {
  _state[key] = value;
  const cbs = _listeners.get(key);
  if (cbs) cbs.forEach(cb => cb(value));
}

/**
 * @param {string} key
 * @returns {any}
 */
export function get(key) {
  return _state[key];
}

/**
 * @param {string} key
 * @param {Function} cb
 * @returns {Function} unsubscribe
 */
export function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(cb);
  return () => _listeners.get(key)?.delete(cb);
}

// --- Convenience setters ---

export function setView(v) { set('view', v); }

export function setReports(r) { set('reports', r); }

export function setActiveReport(r) {
  set('activeReport', r);
  set('activeSectionId', r?.sections?.[0]?.id ?? null);
  set('activeFindingId', null);
  set('dirty', false);
}

export function setActiveSectionId(id) { set('activeSectionId', id); }
export function setActiveFindingId(id) { set('activeFindingId', id); }
export function setDirty(d) { set('dirty', d); }

export function upsertReport(r) {
  const reports = get('reports');
  const idx = reports.findIndex(x => x.id === r.id);
  const next = idx >= 0
    ? reports.map(x => x.id === r.id ? r : x)
    : [r, ...reports];
  set('reports', next);
}

export function removeReport(id) {
  set('reports', get('reports').filter(r => r.id !== id));
  if (get('activeReport')?.id === id) set('activeReport', null);
}

export function updateSection(sectionId, patch) {
  const report = get('activeReport');
  if (!report) return;
  const sections = report.sections.map(s => s.id === sectionId ? { ...s, ...patch } : s);
  set('activeReport', { ...report, sections });
  set('dirty', true);
}

export function patchReportMeta(patch) {
  const report = get('activeReport');
  if (!report) return;
  set('activeReport', { ...report, ...patch });
  set('dirty', true);
}

export function upsertFinding(f) {
  const report = get('activeReport');
  if (!report) return;
  const idx = report.findings.findIndex(x => x.id === f.id);
  const findings = idx >= 0
    ? report.findings.map(x => x.id === f.id ? f : x)
    : [...report.findings, f];
  set('activeReport', { ...report, findings });
  set('dirty', true);
}

export function removeFinding(id) {
  const report = get('activeReport');
  if (!report) return;
  set('activeReport', { ...report, findings: report.findings.filter(f => f.id !== id) });
  set('activeFindingId', null);
  set('dirty', true);
}

export function reorderSections(sections) {
  const report = get('activeReport');
  if (!report) return;
  set('activeReport', { ...report, sections });
  set('dirty', true);
}
