// Cerberus OS — shared open-modal stack + z-index (no UI imports)
//
// Layering contract (bottom → top):
//   globe/home (z ≤ 20) → status bar (999990) is chrome, modals live in
//   999901–999944 inside the portal, notifications (999999), cursor glow (max).
// raiseModal keeps every modal inside that band and renormalises when the
// band is exhausted, so a modal can never climb above notifications or the
// status bar no matter how often windows are focused.

const Z_BASE = 999900;
const Z_MAX = 999944;
const OPEN_MODALS_KEY = 'cerberus_open_modals_v1';

let _openModalIds = new Set();
let _openStack = [];
let _zCounter = Z_BASE;
let _domVisible = null;
const _raisedEls = new Map(); // id -> element last raised for that modal

/** Optional callback: (modalId) => boolean */
export function setModalDomVisibleCheck(fn) {
  _domVisible = typeof fn === 'function' ? fn : null;
}

function _syncBodyClass() {
  document.body.classList.toggle('cerberus-modal-open', _openModalIds.size > 0);
}

function _persistOpenModals() {
  try {
    localStorage.setItem(OPEN_MODALS_KEY, JSON.stringify([..._openModalIds]));
  } catch (_) {}
}

export function getPersistedModalIds() {
  try {
    const raw = localStorage.getItem(OPEN_MODALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((id) => String(id).toLowerCase()) : [];
  } catch (_) {
    return [];
  }
}

export function clearPersistedModals() {
  try {
    localStorage.removeItem(OPEN_MODALS_KEY);
  } catch (_) {}
}

export function trackModalOpen(id) {
  const key = String(id || '').toLowerCase();
  if (!key) return;
  _openModalIds.add(key);
  _openStack = _openStack.filter((x) => x !== key);
  _openStack.push(key);
  _syncBodyClass();
  _persistOpenModals();
}

export function trackModalClose(id) {
  const key = String(id || '').toLowerCase();
  if (!key) return;
  _openModalIds.delete(key);
  _openStack = _openStack.filter((x) => x !== key);
  _raisedEls.delete(key);
  _syncBodyClass();
  _persistOpenModals();
}

/**
 * The element whose z-index actually decides stacking is the direct child of
 * the modal portal (or body). Overlay/settings wrappers carry fixed z-indexes
 * in CSS, so raising an inner .modal-content never re-orders them against
 * shell modals — walk up to the portal child and raise that instead.
 */
function _stackingRoot(el) {
  const portal = document.getElementById('cerberus-modal-portal');
  let node = el;
  while (node && node.parentElement) {
    const parent = node.parentElement;
    if (parent === portal || parent === document.body) return node;
    node = parent;
  }
  return el;
}

function _setZ(el, z) {
  el.style.setProperty('z-index', String(z), 'important');
}

/** Re-pack every raised modal into the band, preserving current order. */
function _renormalise() {
  const entries = [..._raisedEls.entries()]
    .filter(([, el]) => el?.isConnected)
    .sort((a, b) => (parseInt(a[1].style.zIndex, 10) || 0) - (parseInt(b[1].style.zIndex, 10) || 0));
  _zCounter = Z_BASE;
  for (const [, el] of entries) {
    _zCounter += 1;
    _setZ(el, _zCounter);
  }
}

export function raiseModal(el, id) {
  if (!el || !id) return;
  const key = String(id).toLowerCase();
  const root = _stackingRoot(el);
  if (_zCounter >= Z_MAX) _renormalise();
  _zCounter += 1;
  _setZ(root, _zCounter);
  if (root !== el) _setZ(el, _zCounter); // inner content keeps pace for local stacking
  _raisedEls.set(key, root);
  trackModalOpen(key);
}

export function bindRaiseOnFocus(el, id) {
  if (!el || el.dataset.atlasRaiseBound === id) return;
  el.dataset.atlasRaiseBound = id;
  el.addEventListener('mousedown', () => raiseModal(el, id));
}

export function getOpenModal() {
  return _openStack[_openStack.length - 1] || null;
}

export function getOpenModals() {
  return [..._openModalIds];
}

export function isModalTrackedOpen(id) {
  const key = String(id || '').toLowerCase();
  if (!_openModalIds.has(key)) return false;
  if (_domVisible && !_domVisible(key)) {
    trackModalClose(key);
    return false;
  }
  return true;
}

export function hasOpenModals() {
  return _openModalIds.size > 0;
}
