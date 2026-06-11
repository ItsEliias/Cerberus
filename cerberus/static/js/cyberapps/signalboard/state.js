/**
 * static/js/cyberapps/signalboard/state.js
 * SignalBoard — reactive module-level state store.
 * Minimal pub/sub without external deps.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const _state = {
  items:         [],     // FeedItem[]
  sources:       [],     // FeedSource[]
  bookmarks:     [],     // string[] (item ids)
  bookmarkTags:  {},     // Record<string, string[]>
  settings:      {},     // AppSettings
  context:       {},     // RelevanceContext
  alertRules:    [],     // AlertRule[]

  activeView:    'feed', // 'feed' | 'trends' | 'sources' | 'bookmarks' | 'timeline' | 'settings'
  activeFilter:  'all',  // 'all' | 'high' | 'medium' | 'low' | 'starred' | 'unread'
  selectedId:    null,   // string | null
  refreshing:    false,
  lastRefreshed: null,
};

const _listeners = {};

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/** Read a state key */
export function get(key) {
  return _state[key];
}

/** Set a state key and notify listeners */
export function set(key, value) {
  _state[key] = value;
  (_listeners[key] || []).forEach(fn => fn(value));
}

/** Subscribe to state key changes; returns unsubscribe fn */
export function subscribe(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => {
    _listeners[key] = (_listeners[key] || []).filter(f => f !== fn);
  };
}

// ---------------------------------------------------------------------------
// Typed setters
// ---------------------------------------------------------------------------

export const setItems         = v => set('items', v);
export const setSources       = v => set('sources', v);
export const setBookmarks     = v => set('bookmarks', v);
export const setBookmarkTags  = v => set('bookmarkTags', v);
export const setSettings      = v => set('settings', v);
export const setContext       = v => set('context', v);
export const setAlertRules    = v => set('alertRules', v);
export const setActiveView    = v => set('activeView', v);
export const setActiveFilter  = v => set('activeFilter', v);
export const setSelectedId    = v => set('selectedId', v);
export const setRefreshing    = v => set('refreshing', v);
export const setLastRefreshed = v => set('lastRefreshed', v);

export function patchItem(id, patch) {
  const items = _state.items.map(i => i.id === id ? { ...i, ...patch } : i);
  set('items', items);
}
