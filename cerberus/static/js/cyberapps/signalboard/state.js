/**
 * static/js/cyberapps/signalboard/state.js
 * SignalBoard — reactive module-level state store with pub/sub.
 */

const _state = {
  items: [], sources: [], bookmarks: [], bookmarkTags: {},
  settings: {}, context: {}, alertRules: [],
  activeView: 'feed', activeFilter: 'all',
  selectedId: null, refreshing: false, lastRefreshed: null,
};

const _listeners = {};

export function get(key) { return _state[key]; }

export function set(key, value) {
  _state[key] = value;
  (_listeners[key] || []).forEach(fn => fn(value));
}

export function subscribe(key, fn) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(fn);
  return () => { _listeners[key] = (_listeners[key] || []).filter(f => f !== fn); };
}

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
  set('items', _state.items.map(i => i.id === id ? { ...i, ...patch } : i));
}
