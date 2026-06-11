/**
 * poll.js — Polling engine for the Command Center COMMAND tab.
 *
 * VITALS_INTERVAL_MS  — 5000 ms  (vitals + timeseries)
 * AGENTS_INTERVAL_MS  — 10000 ms (agents + swarm)
 */

export const VITALS_INTERVAL_MS = 5_000;
export const AGENTS_INTERVAL_MS = 10_000;

const BASE = '';
let _vt = null;
let _at = null;

export function start(callbacks) {
  _fetchVitals(callbacks);
  _fetchAgents(callbacks);
  _vt = setInterval(() => _fetchVitals(callbacks), VITALS_INTERVAL_MS);
  _at = setInterval(() => _fetchAgents(callbacks), AGENTS_INTERVAL_MS);
}

export function destroy() {
  if (_vt) { clearInterval(_vt); _vt = null; }
  if (_at) { clearInterval(_at); _at = null; }
}

async function _fetchVitals(cb) {
  try {
    const [vr, tr] = await Promise.all([
      fetch(`${BASE}/api/cyberapps/operations/vitals`),
      fetch(`${BASE}/api/cyberapps/operations/timeseries`),
    ]);
    if (vr.ok && cb.onVitals)      cb.onVitals(await vr.json());
    if (tr.ok && cb.onTimeseries)  cb.onTimeseries(await tr.json());
  } catch (e) { cb.onError && cb.onError(e); }
}

async function _fetchAgents(cb) {
  try {
    const [sr, ar] = await Promise.all([
      fetch(`${BASE}/api/cyberapps/operations/swarm`),
      fetch(`${BASE}/api/cyberapps/operations/agents`),
    ]);
    if (sr.ok && cb.onSwarm)   cb.onSwarm(await sr.json());
    if (ar.ok && cb.onAgents)  { const d = await ar.json(); cb.onAgents(d.agents || []); }
  } catch (e) { cb.onError && cb.onError(e); }
}
