/**
 * dials.js — Semicircle SVG dials for CPU, RAM, DISK, LATENCY.
 *
 * Each dial is an SVG arc (stroke-dasharray trick) that fills 0→100%.
 * Colors: CPU=yellow, RAM=blue, DISK=green, LATENCY=purple (JARVIS palette).
 */

const COLORS = { cpu: '#f1c40f', ram: '#3498db', disk: '#2ecc71', latency: '#9b59b6' };
const RADIUS = 14;
const CX = 24, CY = 24;
// Arc from 180° to 0° (left to right, top semicircle)
const ARC_LEN = Math.PI * RADIUS; // half circumference

function _arcSvg(key, label) {
  const color = COLORS[key] || '#888';
  const total = ARC_LEN.toFixed(2);
  return `
<div class="ops-dial-wrap" data-dial="${key}">
  <svg class="ops-dial-svg" viewBox="0 0 48 28" xmlns="http://www.w3.org/2000/svg">
    <!-- Track -->
    <path d="M6 24 A18 18 0 0 1 42 24"
      fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4"
      stroke-linecap="round"/>
    <!-- Fill arc -->
    <path class="ops-dial-fill-${key}" d="M6 24 A18 18 0 0 1 42 24"
      fill="none" stroke="${color}" stroke-width="4"
      stroke-linecap="round"
      stroke-dasharray="0 ${total}"
      style="transition: stroke-dasharray 0.4s ease; transform-origin: 24px 24px;"/>
  </svg>
  <div class="ops-dial-num ${key}" data-val-${key}>—</div>
  <div class="ops-dial-lbl">${label.toUpperCase()}</div>
</div>`.trim();
}

/** Build the vitals dials into container. */
export function createDials(container) {
  container.innerHTML = [
    _arcSvg('cpu', 'CPU'),
    _arcSvg('ram', 'RAM'),
    _arcSvg('disk', 'DISK'),
    _arcSvg('latency', 'LATENCY'),
  ].join('');
}

/**
 * Update one dial.
 * @param {HTMLElement} container
 * @param {'cpu'|'ram'|'disk'|'latency'} key
 * @param {number} value — 0-100 for %; ms for latency (capped at 200ms=100%)
 * @param {string} displayText — e.g. "42%" or "5ms"
 */
export function updateDial(container, key, value, displayText) {
  const arc = container.querySelector(`.ops-dial-fill-${key}`);
  const num = container.querySelector(`[data-val-${key}]`);

  let pct = key === 'latency'
    ? Math.min(100, (value < 0 ? 0 : value) / 200 * 100)
    : Math.max(0, Math.min(100, value < 0 ? 0 : value));

  if (arc) {
    const filled = ((pct / 100) * ARC_LEN).toFixed(2);
    const gap = (ARC_LEN - filled).toFixed(2);
    arc.setAttribute('stroke-dasharray', `${filled} ${gap}`);
  }
  if (num) num.textContent = value < 0 ? '—' : displayText;
}
