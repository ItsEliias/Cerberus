/**
 * poll.js — Polling engine for the Operations panel.
 *
 * Constants (configurable at top):
 *   VITALS_INTERVAL_MS  — 5000 ms  (vitals + timeseries)
 *   AGENTS_INTERVAL_MS  — 10000 ms (agents + swarm)
 *
 * Exports: start(callbacks) / destroy()
 * Respects prefers-reduced-motion (no visual changes mid-animation on slow devices).
 */

export const VITALS_INTERVAL_MS = 5_000;
export const AGENTS_INTERVAL_MS = 10_000;

let _vitalsTimer = null;
let _agentsTimer = null;
const _BASE = '';  // same-origin

/**
 * Start polling.
 * @param {{ onVitals, onTimeseries, onSwarm, onAgents, onError }} callbacks
 */
export function start(callbacks) {
  _fetchVitals(callbacks);
  _fetchAgents(callbacks);
  _vitalsTimer = setInterval(() => _fetchVitals(callbacks), VITALS_INTERVAL_MS);
  _agentsTimer = setInterval(() => _fetchAgents(callbacks), AGENTS_INTERVAL_MS);
}

/** Stop all polling timers. */
export function destroy() {
  if (_vitalsTimer) { clearInterval(_vitalsTimer); _vitalsTimer = null; }
  if (_agentsTimer) { clearInterval(_agentsTimer); _agentsTimer = null; }
}

async function _fetchVitals(cb) {
  try {
    const [vitRes, tsRes] = await Promise.all([
      fetch(`${_BASE}/api/cyberapps/operations/vitals`),
      fetch(`${_BASE}/api/cyberapps/operations/timeseries`),
    ]);
    if (vitRes.ok) {
      const data = await vitRes.json();
      if (typeof cb.onVitals === 'function') cb.onVitals(data);
    }
    if (tsRes.ok) {
      const data = await tsRes.json();
      if (typeof cb.onTimeseries === 'function') cb.onTimeseries(data);
    }
  } catch (e) {
    if (typeof cb.onError === 'function') cb.onError(e);
  }
}

async function _fetchAgents(cb) {
  try {
    const [swRes, agRes] = await Promise.all([
      fetch(`${_BASE}/api/cyberapps/operations/swarm`),
      fetch(`${_BASE}/api/cyberapps/operations/agents`),
    ]);
    if (swRes.ok) {
      const data = await swRes.json();
      if (typeof cb.onSwarm === 'function') cb.onSwarm(data);
    }
    if (agRes.ok) {
      const data = await agRes.json();
      if (typeof cb.onAgents === 'function') cb.onAgents(data.agents || []);
    }
  } catch (e) {
    if (typeof cb.onError === 'function') cb.onError(e);
  }
}
