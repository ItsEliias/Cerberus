// Cerberus OS — ONE shared modal/window system.
//
// Every Atlas modal (shell modals, panels, overlay tools, Project HQ, Notes,
// Settings) registers here and gets identical behaviour:
//   open centred → drag → resize → minimise → pin (dock in place) → close,
//   with geometry persisted per-modal and validated on every load.
//
// Geometry has exactly ONE source of truth: the layout entry written by
// _persist(). makeWindowResizable is used purely for the edge/corner resize
// interaction (storageKey disabled) — double-stored sizes were the cause of
// modals "jumping" to a different size/position after opening.

import { makeWindowResizable, clearWindowResizeLock } from './windowResize.js';

const STORAGE_KEY = 'cerberus_modal_layout_v2';
const LEGACY_KEYS = ['cerberus_modal_layout_v1'];

const MIN_W = 360;
const MIN_H = 240;
const EDGE_MARGIN = 8;      // keep at least this much air to the viewport edge
const MIN_VISIBLE = 48;     // a window may never be dragged fully off-screen

let _store = null; // in-memory cache of the layout map

/* ── storage ─────────────────────────────────────────────────────────── */

function _load() {
  if (_store) return _store;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    _store = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (_) {
    // Corrupt JSON — reset safely rather than fighting it forever.
    _store = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  return _store;
}

function _save(data) {
  _store = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}
}

/** Drop legacy layout stores so old corrupt data can't leak back in. */
function _dropLegacyStores() {
  try {
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    // windowResize.js side-channel sizes from the v1 system.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cerberus_modal_layout_v1::')) localStorage.removeItem(key);
    }
  } catch (_) {}
}

export function resetModalLayouts() {
  _save({});
}

/* ── validation / clamping ───────────────────────────────────────────── */

function _isValidLayout(layout) {
  if (!layout || typeof layout !== 'object') return false;
  if (layout.width != null && !Number.isFinite(Number(layout.width))) return false;
  if (layout.height != null && !Number.isFinite(Number(layout.height))) return false;
  if (layout.centred) {
    return Number(layout.width) > 0 && Number(layout.height) > 0;
  }
  const { top, left } = layout;
  if (!Number.isFinite(Number(top)) || !Number.isFinite(Number(left))) return false;
  // A (0,0)-ish rect is the classic "persisted while hidden" corruption.
  if (Number(top) < 12 && Number(left) < 12) return false;
  return true;
}

/** Clamp a layout into the current viewport so windows always come back visible. */
function _clampLayout(layout) {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const w = Math.min(Math.max(Number(layout.width) || 0, 0), vw - EDGE_MARGIN * 2) || undefined;
  const h = Math.min(Math.max(Number(layout.height) || 0, 0), vh - EDGE_MARGIN * 2) || undefined;
  const effW = w || 480;
  let top = Number(layout.top);
  let left = Number(layout.left);
  left = Math.min(Math.max(left, MIN_VISIBLE - effW), vw - MIN_VISIBLE);
  top = Math.min(Math.max(top, EDGE_MARGIN), vh - MIN_VISIBLE);
  return { ...layout, top: Math.round(top), left: Math.round(left), width: w, height: h };
}

function _sanitizeLayouts() {
  const data = _load();
  let changed = false;
  Object.keys(data).forEach((id) => {
    if (!_isValidLayout(data[id])) {
      delete data[id];
      changed = true;
    }
  });
  if (changed) _save(data);
}

/* ── element helpers ─────────────────────────────────────────────────── */

function _isPinned(el) {
  return el?.dataset?.cerberusModalPinned === '1';
}

function _isMin(el) {
  return el?.classList?.contains('cerberus-modal-min');
}

function _header(el) {
  return el.querySelector(
    '.cerberus-os-panel-header, .cerberus-shell-modal-header, .cerberus-project-hq-header, .cerberus-hq-header, .modal-header, .cerberus-agents-header, .notes-pane-header'
  );
}

function _applyRect(el, top, left, { width, height, centered = false } = {}) {
  if (!el) return;
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('right', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
  el.style.setProperty('margin', '0', 'important');
  el.style.setProperty('inset', 'auto', 'important');

  if (centered) {
    el.classList.remove('cerberus-modal-placed');
    el.classList.add('cerberus-modal-centered');
    // Set explicit inline centering — inset:auto !important (set above) would otherwise
    // override the CSS top:50%/left:50% that shell modals rely on, placing them off-screen.
    el.style.setProperty('top', '50%', 'important');
    el.style.setProperty('left', '50%', 'important');
    el.style.setProperty('transform', 'translate(-50%,-50%)', 'important');
  } else {
    el.classList.remove('cerberus-modal-centered');
    el.classList.add('cerberus-modal-placed');
    el.style.setProperty('top', `${top}px`, 'important');
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('transform', 'none', 'important');
  }

  if (width) el.style.setProperty('width', `${width}px`, 'important');
  if (height && !_isMin(el)) el.style.setProperty('height', `${height}px`, 'important');
}

function _setPinnedState(el, pinned) {
  if (!el) return;
  el.dataset.cerberusModalPinned = pinned ? '1' : '0';
  el.classList.toggle('cerberus-modal-pinned', pinned);
}

function _center(el) {
  const layout = _load()[el.dataset.cerberusModalId];
  _setPinnedState(el, false);
  _applyRect(el, 0, 0, {
    centered: true,
    width: layout?.width,
    height: layout?.height,
  });
}

function _placeFree(el, top, left, width, height) {
  _setPinnedState(el, false);
  _applyRect(el, top, left, { width, height });
}

function _placePinned(el, top, left, width, height) {
  _setPinnedState(el, true);
  _applyRect(el, top, left, { width, height });
}

function _applySaved(el, id) {
  const layout = _load()[id];
  if (!_isValidLayout(layout)) {
    _center(el);
    _applyMinState(el, false);
    return;
  }
  if (layout.centred) {
    _center(el);
    _applyMinState(el, !!layout.min);
    return;
  }
  const c = _clampLayout(layout);
  if (c.pinned) {
    _placePinned(el, c.top, c.left, c.width, c.height);
  } else {
    _placeFree(el, c.top, c.left, c.width, c.height);
  }
  _applyMinState(el, !!c.min);
}

/* ── persistence ─────────────────────────────────────────────────────── */

function _persist(el, id) {
  if (!el || !id) return;
  // Persisting the rect of a hidden/teardown element writes (0,0) garbage —
  // that is exactly the "modal opens in the top-left corner" bug.
  if (el.classList.contains('hidden') || !el.isConnected) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 24) return;

  const data = _load();
  const prev = data[id] || {};
  const min = _isMin(el);
  const entry = {
    pinned: _isPinned(el),
    min,
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    // While minimised the live height is just the header strip — keep the
    // last expanded height so restore brings the full window back.
    height: min ? (prev.height || Math.round(Number(el.dataset.cerberusModalFullH) || 0) || undefined)
      : Math.round(rect.height),
  };
  if (el.classList.contains('cerberus-modal-centered')) {
    // Centred windows only persist their size; position stays "centred".
    delete data[id];
    if (entry.width && entry.height) {
      data[id] = { width: entry.width, height: entry.height, min, centred: true };
    }
  } else if (!_isValidLayout(entry)) {
    delete data[id];
  } else {
    data[id] = entry;
  }
  _save(data);
  _updatePinButton(el, id);
  _updateMinButton(el, id);
}

/* ── header buttons (minimise / pin / close) ─────────────────────────── */

function _updatePinButton(el, id) {
  const btn = el.querySelector(`[data-cerberus-modal-pin="${id}"]`);
  if (!btn) return;
  const pinned = _isPinned(el);
  btn.classList.toggle('cerberus-modal-pin-btn--active', pinned);
  btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  btn.title = pinned ? 'Undock window (allow moving)' : 'Dock window (lock position)';
  btn.textContent = pinned ? '📍' : '📌';
}

function _updateMinButton(el, id) {
  const btn = el.querySelector(`[data-cerberus-modal-min="${id}"]`);
  if (!btn) return;
  const min = _isMin(el);
  btn.setAttribute('aria-pressed', min ? 'true' : 'false');
  btn.title = min ? 'Restore window' : 'Minimise window';
  btn.textContent = min ? '▢' : '–';
}

function _applyMinState(el, min) {
  if (!el) return;
  if (min && !_isMin(el)) {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) el.dataset.cerberusModalFullH = String(Math.round(rect.height));
    el.classList.add('cerberus-modal-min');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('min-height', '0', 'important');
  } else if (!min && _isMin(el)) {
    el.classList.remove('cerberus-modal-min');
    el.style.removeProperty('min-height');
    const id = el.dataset.cerberusModalId;
    const saved = id ? _load()[id] : null;
    const h = (saved && saved.height) || Number(el.dataset.cerberusModalFullH) || 0;
    if (h && el.classList.contains('cerberus-modal-placed')) {
      el.style.setProperty('height', `${h}px`, 'important');
    } else {
      el.style.removeProperty('height');
      if (saved?.height && el.classList.contains('cerberus-modal-centered')) {
        el.style.setProperty('height', `${saved.height}px`, 'important');
      }
    }
  }
}

export function toggleMinimise(el, id) {
  if (!el || !id) return;
  _applyMinState(el, !_isMin(el));
  _persist(el, id);
}

function _ensureHeaderButtons(el, id) {
  const header = _header(el);
  if (!header) return;

  const mkBtn = (cls, dataAttr, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.dataset[dataAttr] = id;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    return btn;
  };

  const closeBtn = header.querySelector(
    '.cerberus-shell-modal-close, .cerberus-shell-panel-close, .cerberus-project-hq-close, [data-hq-close], [data-shell-modal-close], .close-btn, .modal-close'
  );
  const insert = (btn) => {
    if (closeBtn?.parentElement === header || closeBtn?.parentElement) {
      closeBtn.parentElement.insertBefore(btn, closeBtn);
    } else {
      header.appendChild(btn);
    }
  };

  if (!header.querySelector('[data-cerberus-modal-min]')) {
    const minBtn = mkBtn('cerberus-modal-pin-btn cerberus-modal-min-btn', 'cerberusModalMin', 'Minimise window');
    minBtn.textContent = '–';
    minBtn.title = 'Minimise window';
    insert(minBtn);
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMinimise(el, id);
    });
  }

  if (!header.querySelector('[data-cerberus-modal-pin]')) {
    const pinBtn = mkBtn('cerberus-modal-pin-btn', 'cerberusModalPin', 'Dock window');
    pinBtn.textContent = '📌';
    pinBtn.title = 'Dock window (lock position)';
    insert(pinBtn);
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(el, id);
    });
  }

  _updatePinButton(el, id);
  _updateMinButton(el, id);
}

/* ── resize wiring ───────────────────────────────────────────────────── */

function _prepareForResize(el) {
  const rect = el.getBoundingClientRect();
  const place = _isPinned(el) ? _placePinned : _placeFree;
  place(
    el,
    Math.round(rect.top),
    Math.round(rect.left),
    Math.round(rect.width),
    Math.round(rect.height),
  );
}

function _ensureResize(el, id) {
  if (el.dataset.atlasResizeBound === id) return;
  el.dataset.atlasResizeBound = id;
  makeWindowResizable(el, {
    storageKey: null, // geometry is owned by _persist — no second store
    minWidth: MIN_W,
    minHeight: MIN_H,
    important: true,
    isLocked: () => _isMin(el),
    onResizeStart: () => _prepareForResize(el),
    onResizeEnd: () => _persist(el, id),
  });
}

/* ── drag wiring ─────────────────────────────────────────────────────── */

function _syncDragCursor(el) {
  const header = _header(el);
  if (!header) return;
  if (document.body.classList.contains('cerberus-cursor-fx-on')) {
    header.style.removeProperty('cursor');
    return;
  }
  header.style.cursor = _isPinned(el) ? 'default' : 'move';
}

function _bindDrag(el, id) {
  const header = _header(el);
  if (!header || header.dataset.atlasDragBound === id) return;
  header.dataset.atlasDragBound = id;
  header.classList.add('cerberus-modal-drag-handle');

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTop = 0;
  let startLeft = 0;
  let raf = 0;
  let nextTop = 0;
  let nextLeft = 0;

  const applyFrame = () => {
    raf = 0;
    if (!dragging) return;
    el.style.setProperty('top', `${nextTop}px`, 'important');
    el.style.setProperty('left', `${nextLeft}px`, 'important');
  };

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || _isPinned(el)) return;
    if (e.target.closest('button, input, select, textarea, a, label')) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startTop = rect.top;
    startLeft = rect.left;
    _placeFree(el, Math.round(startTop), Math.round(startLeft), Math.round(rect.width), _isMin(el) ? undefined : Math.round(rect.height));
    el.classList.add('cerberus-modal-dragging');
    document.body.classList.add('cerberus-modal-dragging');
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || _isPinned(el)) return;
    if (e.buttons === 0) { finish(); return; } // missed mouseup self-heal
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = { w: el.offsetWidth, h: el.offsetHeight };
    let top = startTop + (e.clientY - startY);
    let left = startLeft + (e.clientX - startX);
    // Keep the drag handle reachable: clamp so at least MIN_VISIBLE px stay
    // on-screen and the header can never go above the viewport.
    top = Math.min(Math.max(top, 0), vh - MIN_VISIBLE);
    left = Math.min(Math.max(left, MIN_VISIBLE - rect.w), vw - MIN_VISIBLE);
    nextTop = top;
    nextLeft = left;
    if (!raf) raf = requestAnimationFrame(applyFrame);
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; applyFrame(); }
    el.classList.remove('cerberus-modal-dragging');
    document.body.classList.remove('cerberus-modal-dragging');
    if (!_isPinned(el)) _persist(el, id);
  };

  window.addEventListener('mouseup', finish);
  window.addEventListener('blur', finish);

  // Double-click the header = quick minimise/restore.
  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, select, textarea, a, label')) return;
    toggleMinimise(el, id);
  });
}

/* ── public API ──────────────────────────────────────────────────────── */

export function centerModal(el) {
  _center(el);
  _syncDragCursor(el);
}

export function togglePin(el, id) {
  if (!el || !id) return;
  const rect = el.getBoundingClientRect();
  const place = _isPinned(el) ? _placeFree : _placePinned;
  place(
    el,
    Math.round(rect.top),
    Math.round(rect.left),
    Math.round(rect.width),
    _isMin(el) ? undefined : Math.round(rect.height),
  );
  _persist(el, id);
  _syncDragCursor(el);
}

export function registerAtlasModal(el, id) {
  if (!el || !id) return;

  clearWindowResizeLock();

  if (el.dataset.cerberusModalRegistered !== id) {
    el.dataset.cerberusModalRegistered = id;
    el.dataset.cerberusModalId = id;
    el.classList.add('cerberus-modal-window');
    _applySaved(el, id);
    _ensureHeaderButtons(el, id);
    _ensureResize(el, id);
    _syncDragCursor(el);
  }

  _bindDrag(el, id);
}

/** Replay the open animation (CSS keyframe; removed on end so resize can kill it). */
function _playOpenAnim(el) {
  if (!el) return;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  } catch (_) {}
  el.classList.remove('cerberus-modal-anim-in');
  void el.offsetWidth;
  el.classList.add('cerberus-modal-anim-in');
  el.addEventListener('animationend', () => el.classList.remove('cerberus-modal-anim-in'), { once: true });
}

export function openAtlasModalWindow(el, id) {
  if (!el) return;
  clearWindowResizeLock();
  registerAtlasModal(el, id);
  _applySaved(el, id); // valid saved layout → restore (clamped); else centred
  _syncDragCursor(el);
  _playOpenAnim(el);
}

/** Tear down fixed placement so a closed modal cannot block the workspace. */
export function deactivateAtlasModal(el) {
  if (!el) return;
  clearWindowResizeLock();
  el.classList.remove('cerberus-modal-placed', 'cerberus-modal-centered', 'cerberus-modal-dragging', 'cerberus-modal-anim-in');
  el.style.removeProperty('position');
  el.style.removeProperty('top');
  el.style.removeProperty('left');
  el.style.removeProperty('right');
  el.style.removeProperty('bottom');
  el.style.removeProperty('width');
  el.style.removeProperty('height');
  el.style.removeProperty('min-height');
  el.style.removeProperty('transform');
  el.style.removeProperty('margin');
  el.style.removeProperty('inset');
  const header = _header(el);
  if (header) header.style.removeProperty('cursor');
}

/* ── global hygiene ──────────────────────────────────────────────────── */

_dropLegacyStores();
_sanitizeLayouts();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') clearWindowResizeLock();
});

// Keep placed windows reachable when the viewport shrinks.
let _reclampTimer = 0;
window.addEventListener('resize', () => {
  if (_reclampTimer) return;
  _reclampTimer = window.setTimeout(() => {
    _reclampTimer = 0;
    document.querySelectorAll('.cerberus-modal-window.cerberus-modal-placed:not(.hidden)').forEach((el) => {
      const id = el.dataset.cerberusModalId;
      if (!id) return;
      const rect = el.getBoundingClientRect();
      const c = _clampLayout({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      if (Math.abs(c.top - rect.top) > 1 || Math.abs(c.left - rect.left) > 1) {
        _applyRect(el, c.top, c.left, { width: c.width, height: _isMin(el) ? undefined : c.height });
        _persist(el, id);
      }
    });
  }, 150);
});

const cerberusModalWindow = {
  registerAtlasModal,
  openAtlasModalWindow,
  deactivateAtlasModal,
  centerModal,
  togglePin,
  toggleMinimise,
  resetModalLayouts,
};

export default cerberusModalWindow;
