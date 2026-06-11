/**
 * static/js/cyberapps/dashboard/api.js
 * Dashboard — API fetch helpers (aggregation endpoints only).
 */

const BASE = '/api/cyberapps/dashboard';

/** @returns {Promise<Record<string, any>>} */
export async function fetchSummary() {
  const res = await fetch(`${BASE}/summary`);
  if (!res.ok) throw new Error(`Dashboard summary fetch failed: ${res.status}`);
  return res.json();
}

/**
 * @param {number} [limit=100]
 * @param {string|null} [app]
 * @returns {Promise<{events: Array, total: number}>}
 */
export async function fetchEvents(limit = 100, app = null) {
  const url = new URL(`${BASE}/events`, location.href);
  url.searchParams.set('limit', String(limit));
  if (app) url.searchParams.set('app', app);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Dashboard events fetch failed: ${res.status}`);
  return res.json();
}
