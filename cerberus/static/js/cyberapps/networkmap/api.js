/**
 * api.js — NetworkMap Cerberus backend API client.
 * Wraps /api/cyberapps/networkmap/* endpoints.
 */

const BASE = '/api/cyberapps/networkmap';

async function _json(res) {
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

/** Fetch all graph summaries for the current user. */
export async function listGraphs() {
  return _json(await fetch(`${BASE}/graphs`));
}

/** Fetch a full graph by id. */
export async function loadGraph(id) {
  return _json(await fetch(`${BASE}/graphs/${encodeURIComponent(id)}`));
}

/** Save (create or overwrite) a graph. Returns updated GraphSummary. */
export async function saveGraph(graph) {
  return _json(await fetch(`${BASE}/graphs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graph),
  }));
}

/** Delete a graph by id. */
export async function deleteGraph(id) {
  return _json(await fetch(`${BASE}/graphs/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
