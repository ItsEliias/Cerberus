/**
 * orbit-glow.js — shared rAF-driven conic-gradient border animation.
 *
 * A single requestAnimationFrame loop drives --orbit-angle on all registered
 * elements. The loop pauses when the tab is hidden and self-exits when the
 * set is empty.
 *
 * Usage:
 *   import { startOrbitGlow, stopOrbitGlow } from '/static/js/orbit-glow.js';
 *   startOrbitGlow(modalEl);   // call on open
 *   stopOrbitGlow(modalEl);    // call on close
 *
 * The element must carry class .cerberus-orbit-glow. The CSS drives the
 * ::after ring via --orbit-angle (see jarvis-v2/surfaces.css).
 */

const _glowing = new Set();
let _rafId = null;
let _angle = 0;
let _lastTs = 0;

function _tick(ts) {
  if (_glowing.size === 0) {
    _rafId = null;
    _lastTs = 0;
    return;
  }
  if (!document.hidden && _lastTs) {
    const dt = (ts - _lastTs) / 1000;
    _angle = (_angle + 22 * dt) % 360;
    const val = _angle.toFixed(2) + 'deg';
    for (const el of _glowing) {
      el.style.setProperty('--orbit-angle', val);
    }
  }
  if (document.hidden) _lastTs = 0;
  else _lastTs = ts;
  _rafId = requestAnimationFrame(_tick);
}

export function startOrbitGlow(el) {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  _glowing.add(el);
  if (!_rafId) {
    _lastTs = 0;
    _rafId = requestAnimationFrame(_tick);
  }
}

export function stopOrbitGlow(el) {
  if (!el) return;
  _glowing.delete(el);
}

export const __testables = { _glowing, get rafId() { return _rafId; } };
