/**
 * static/js/cyberapps/dashboard/state.js
 * Dashboard — lightweight reactive state store (no framework).
 */

/** @type {Record<string, any>} */
const _state = {
  summary: null,       // full /summary response
  events: [],          // recent events array
  activeView: 'dashboard', // 'dashboard' | 'profile' | 'ecosystem'
  loading: true,
  error: null,
  feedFilter: null,    // app name filter for activity feed
};

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map();

/**
 * Subscribe to state key changes.
 * @param {string} key
 * @param {Function} cb
 * @returns {Function} unsubscribe
 */
export function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(cb);
  return () => _listeners.get(key)?.delete(cb);
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
 * @param {any} value
 */
export function set(key, value) {
  _state[key] = value;
  _listeners.get(key)?.forEach(cb => { try { cb(value); } catch (_) {} });
}

/**
 * Patch summary and notify individual sub-keys.
 * @param {Record<string, any>} summaryData
 */
export function applySummary(summaryData) {
  set('summary', summaryData);
  set('loading', false);
  set('error', null);
}

export function setError(msg) {
  set('error', msg);
  set('loading', false);
}
