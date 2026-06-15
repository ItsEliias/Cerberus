// Cerberus OS — lightweight cursor glow (desktop only, no trail lag)



const STORAGE_KEY = 'cerberus_cursor_fx';

const LEGACY_KEY = 'cerberus_cursor_effects';



let _enabled = true;

let _glow = null;

let _mx = 0;

let _my = 0;



function _isTouch() {

  try {

    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  } catch (_) {

    return false;

  }

}



function _loadEnabled() {

  try {

    const v = localStorage.getItem(STORAGE_KEY);

    if (v === 'off' || v === 'false') return false;

    if (v === 'on' || v === 'true') return true;

    const legacy = localStorage.getItem(LEGACY_KEY);

    if (legacy === 'false') return false;

    if (legacy === 'true') return true;

  } catch (_) {}

  return true;

}



function _saveEnabled(on) {

  try {

    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');

  } catch (_) {}

}



function _applyPos() {

  if (!_glow) return;

  _glow.style.transform = `translate3d(${_mx}px, ${_my}px, 0)`;

}



function _onMove(e) {

  _mx = e.clientX;

  _my = e.clientY;

  _applyPos();

}



function _teardown() {

  document.body.classList.remove('cerberus-cursor-fx-on');

  document.removeEventListener('mousemove', _onMove);

  const wrap = document.getElementById('cerberus-cursor-fx');

  if (wrap) wrap.classList.remove('cerberus-cursor-fx--active');

  _glow = null;

}



function _setup() {

  if (_isTouch() || !_enabled) {

    _teardown();

    return;

  }

  const wrap = document.getElementById('cerberus-cursor-fx');

  if (!wrap) return;

  document.body.appendChild(wrap);

  _glow = wrap.querySelector('.atlas-cursor-fx-glow');

  document.body.classList.add('cerberus-cursor-fx-on');

  wrap.classList.add('cerberus-cursor-fx--active');

  document.addEventListener('mousemove', _onMove, { passive: true });

  _applyPos();

}



export function isCursorFxEnabled() {

  return _enabled && !_isTouch();

}



export function setCursorFxEnabled(on) {

  _enabled = !!on;

  _saveEnabled(_enabled);

  const cb = document.getElementById('cerberus-home-cursor-fx');

  if (cb) cb.checked = _enabled;

  if (_enabled) _setup();

  else _teardown();

}



export function initAtlasCursorFx() {

  _enabled = _loadEnabled();

  try {

    if (_enabled) _setup();

  } catch (_) {

    _teardown();

  }

}



const cerberusCursorFx = {

  initAtlasCursorFx,

  setCursorFxEnabled,

  isCursorFxEnabled,

};



export default cerberusCursorFx;


