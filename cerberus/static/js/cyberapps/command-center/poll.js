/**
 * poll.js — Polling engine for the Command Center COMMAND tab.
 *
 * VITALS_INTERVAL_MS  — 5000 ms  (vitals + timeseries)
 * AGENTS_INTERVAL_MS  — 10000 ms (agents + swarm)
 * STATUS_INTERVAL_MS  — 8000 ms  (tasks/active + model/status)
 */

export const VITALS_INTERVAL_MS = 5_000;
export const AGENTS_INTERVAL_MS = 10_000;
export const STATUS_INTERVAL_MS = 8_000;

const BASE = '';
let _vt = null;
let _at = null;
let _st = null;

export function start(callbacks) {
  _fetchVitals(callbacks);
  _fetchAgents(callbacks);
  _fetchStatus(callbacks);
  _vt = setInterval(() => _fetchVitals(callbacks), VITALS_INTERVAL_MS);
  _at = setInterval(() => _fetchAgents(callbacks), AGENTS_INTERVAL_MS);
  _st = setInterval(() => _fetchStatus(callbacks), STATUS_INTERVAL_MS);
}

export function destroy() {
  if (_vt) { clearInterval(_vt); _vt = null; }
  if (_at) { clearInterval(_at); _at = null; }
  if (_st) { clearInterval(_st); _st = null; }
}

async function _fetchVitals(cb) {
  try {
    const [vr, tr] = await Promise.all([
      fetch(`${BASE}/api/cyberapps/operations/vitals`),
      fetch(`${BASE}/api/cyberapps/operations/timeseries`),
    ]);
    if (vr.ok) {
      const v = await vr.json();
      if (cb.onVitals) cb.onVitals(v);
      _emitBadge(v);
    }
    if (tr.ok && cb.onTimeseries)  cb.onTimeseries(await tr.json());
  } catch (e) { cb.onError && cb.onError(e); }
}

function _emitBadge(v) {
  const warn = (v.cpu_percent > 80 || v.ram_percent > 80 || v.disk_percent > 90);
  try {
    window.parent.postMessage({ type: 'cc-badge', level: warn ? 'warn' : 'ok' }, window.location.origin || '*');
  } catch (_) {}
}

async function _fetchAgents(cb) {
  try {
    const [sr, ar, gr] = await Promise.all([
      fetch(`${BASE}/api/cyberapps/operations/swarm`),
      fetch(`${BASE}/api/cyberapps/operations/agents`),
      fetch(`${BASE}/api/cyberapps/operations/gateway`),
    ]);
    if (sr.ok && cb.onSwarm)   cb.onSwarm(await sr.json());
    if (ar.ok && cb.onAgents)  { const d = await ar.json(); cb.onAgents(d.agents || []); }
    if (gr.ok && cb.onGateway) cb.onGateway(await gr.json());
  } catch (e) { cb.onError && cb.onError(e); }
}

async function _fetchStatus(cb) {
  try {
    const [tr, mr] = await Promise.all([
      fetch(`${BASE}/api/tasks/active`),
      fetch(`${BASE}/api/model/status`),
    ]);
    if (tr.ok && cb.onTasks) {
      const d = await tr.json();
      cb.onTasks(d.tasks || (Array.isArray(d) ? d : []));
    }
    if (mr.ok && cb.onModelStatus) cb.onModelStatus(await mr.json());
  } catch (e) { cb.onError && cb.onError(e); }
}
