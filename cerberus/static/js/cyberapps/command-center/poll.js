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
  // Live psutil-backed vitals. Operations endpoints from the CyberApps spike
  // were stripped during the revert — these are the canonical paths now.
  try {
    const [vr, tr] = await Promise.all([
      fetch(`${BASE}/api/system/vitals`,     { credentials: 'same-origin' }),
      fetch(`${BASE}/api/system/timeseries`, { credentials: 'same-origin' }),
    ]);
    if (vr.ok && cb.onVitals)      cb.onVitals(await vr.json());
    if (tr.ok && cb.onTimeseries)  cb.onTimeseries(await tr.json());
  } catch (e) { cb.onError && cb.onError(e); }
}

async function _fetchAgents(cb) {
  // Operations endpoints were stripped during the CyberApps revert. Use the
  // new /api/agents (Level 2 persistence) as the source of truth — derive
  // swarm counts from agent statuses so the globe still reacts.
  try {
    const ar = await fetch(`${BASE}/api/agents`, { credentials: 'same-origin' });
    if (!ar.ok) return;
    const data = await ar.json();
    const agents = Array.isArray(data) ? data : (data.agents || []);
    if (cb.onAgents) cb.onAgents(agents);
    if (cb.onSwarm) {
      const counts = { active: 0, idle: 0, standby: 0, alert: 0 };
      agents.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
      const status = counts.alert > 0 ? 'DEGRADED'
                   : counts.active > 0 ? 'ACTIVE'
                   : 'IDLE';
      cb.onSwarm({
        active: counts.active,
        total:  agents.length,
        queued: counts.standby + counts.idle,
        status,
      });
    }
  } catch (e) { cb.onError && cb.onError(e); }
}
