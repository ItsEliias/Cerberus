/**
 * orb.js — Animated shield orb for the Operations panel.
 *
 * States:
 *   idle     — slow pulse, dim crimson
 *   active   — bright glow, full crimson
 *   degraded — amber tint
 *   offline  — grey, no animation
 *
 * Respects prefers-reduced-motion via CSS (animations are defined in styles.css).
 */

const SHIELD_SVG = `
<svg class="ops-orb idle" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M28 4L8 13V26C8 38 18 48 28 52C38 48 48 38 48 26V13Z"
    fill="none" stroke="var(--red,#c0392b)" stroke-width="2"
    stroke-linejoin="round"/>
  <line x1="20" y1="28" x2="24.5" y2="33" stroke="var(--red,#c0392b)"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="24.5" y1="33" x2="36" y2="22" stroke="var(--red,#c0392b)"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="28" cy="28" r="18"
    fill="var(--red,#c0392b)" fill-opacity="0.06"/>
</svg>`.trim();

/** @param {HTMLElement} container */
export function createOrb(container) {
  const wrap = document.createElement('div');
  wrap.className = 'ops-orb-wrap';
  wrap.innerHTML = SHIELD_SVG + '<div class="ops-orb-status idle">OFFLINE</div>';
  container.appendChild(wrap);
  return wrap;
}

/**
 * Update the orb visual state.
 * @param {HTMLElement} wrap
 * @param {'idle'|'active'|'degraded'|'offline'} state
 */
export function updateOrb(wrap, state) {
  const svg = wrap.querySelector('svg');
  const label = wrap.querySelector('.ops-orb-status');
  if (!svg || !label) return;

  svg.className = `ops-orb ${state}`;
  label.className = `ops-orb-status ${state}`;
  label.textContent = state.toUpperCase();
}
