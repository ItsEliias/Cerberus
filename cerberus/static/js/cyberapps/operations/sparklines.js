/**
 * sparklines.js — Rolling SVG line graphs (vanilla SVG, no D3).
 *
 * Renders 60-point time series for CPU, RAM, LATENCY.
 * Redrawn on each tick from the /timeseries endpoint.
 */

const SPARK_COLORS = { cpu: '#f1c40f', ram: '#3498db', latency: '#9b59b6' };
const SPARK_LABELS = { cpu: 'CPU', ram: 'RAM', latency: 'LATENCY' };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Build the sparkline section into container. */
export function createSparklines(container) {
  container.className = 'ops-sparklines';
  ['cpu', 'ram', 'latency'].forEach(key => {
    const wrap = document.createElement('div');
    wrap.className = 'ops-spark-wrap';
    wrap.dataset.sparkKey = key;
    wrap.innerHTML = `
      <span class="ops-spark-label">${SPARK_LABELS[key]}</span>
      <svg class="ops-spark-svg" data-spark="${key}" viewBox="0 0 200 40"
           xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <polyline points="" fill="none"
          stroke="${SPARK_COLORS[key]}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"
          class="ops-spark-line-${key}"/>
        <line x1="0" y1="40" x2="200" y2="40"
          stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
      </svg>`.trim();
    container.appendChild(wrap);
  });
}

/**
 * Redraw all three sparklines.
 * @param {HTMLElement} container
 * @param {{ cpu: number[], ram: number[], latency: number[] }} series
 */
export function updateSparklines(container, series) {
  ['cpu', 'ram', 'latency'].forEach(key => {
    const data = series[key] || [];
    if (!data.length) return;

    const polyline = container.querySelector(`.ops-spark-line-${key}`);
    if (!polyline) return;

    const W = 200, H = 40;
    // For latency, cap at 200ms; for cpu/ram it's already 0-100
    const maxVal = key === 'latency' ? 200 : 100;
    const n = data.length;

    const points = data.map((v, i) => {
      const x = ((i / (n - 1 || 1)) * W).toFixed(1);
      const clamped = Math.max(0, Math.min(maxVal, v < 0 ? 0 : v));
      const y = (H - (clamped / maxVal) * (H - 4) - 2).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    if (!REDUCED_MOTION) {
      polyline.setAttribute('points', points);
    } else {
      // Reduced motion: just update without animation class
      polyline.style.transition = 'none';
      polyline.setAttribute('points', points);
    }
  });
}
