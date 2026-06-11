/**
 * static/js/cyberapps/reportforge/state.js
 * Minimal reactive state store for ReportForge.
 */

const _listeners = new Map();

const _state = {
  view: 'library',
  reports: [],
  activeReport: null,
  activeSectionId: null,
  activeFindingId: null,
  dirty: false,
  builtinTemplates: [],
  customTemplates: [],
};

export function set(key, value) {
  _state[key] = value;
  const cbs = _listeners.get(key);
  if (cbs) cbs.forEach(cb => cb(value));
}

export function get(key) { return _state[key]; }

export function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(cb);
  return () => _listeners.get(key)?.delete(cb);
}

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
  set('reports', idx >= 0 ? reports.map(x => x.id === r.id ? r : x) : [r, ...reports]);
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
