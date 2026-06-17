/**
 * observability.js — OBSERVABILITY sub-tab for Command Center.
 *
 * Renders token usage data from /api/usage/tokens:
 *  - Total tokens (animated counter)
 *  - Estimated cost in USD
 *  - 30-day sparkline bar chart (SVG)
 *  - Input vs output token split
 */

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _animCounter(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  const range = to - from;
  function ease(t) { return 1 - Math.pow(1 - t, 4); }
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + range * ease(t)).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function _formatTokens(n) {
  if (n == null || n < 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function _buildSparkline(byDay) {
  if (!byDay || byDay.length === 0) {
    return `<div class="cc-obs-no-data">No daily data</div>`;
  }
  const days  = byDay.slice(-30);
  const max   = Math.max(...days.map(d => d.tokens || 0), 1);
  const W = 300, H = 48, barW = Math.max(4, Math.floor((W - 8) / days.length) - 2);
  const gap   = days.length > 1 ? (W - 8 - barW * days.length) / (days.length - 1) : 0;

  const bars = days.map((d, i) => {
    const v   = d.tokens || 0;
    const bh  = Math.max(2, Math.round((v / max) * (H - 12)));
    const x   = 4 + i * (barW + gap);
    const y   = H - 8 - bh;
    const op  = 0.25 + (v / max) * 0.65;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh}"
      rx="1" fill="var(--cc-crimson)" opacity="${op.toFixed(2)}"/>`;
  }).join('');

  return `<svg class="cc-obs-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    aria-label="30-day token usage sparkline">${bars}</svg>`;
}

function _pct(a, b) {
  if (!b) return '—';
  return Math.round((a / b) * 100) + '%';
}

function _renderData(container, data) {
  const total    = data.total_tokens   ?? 0;
  const input    = data.input_tokens   ?? 0;
  const output   = data.output_tokens  ?? 0;
  const cost     = data.cost_usd       ?? 0;
  const byDay    = data.by_day         ?? [];
  const isEmpty  = total === 0 && byDay.length === 0;

  const totalEl  = container.querySelector('#cc-obs-total');
  const costEl   = container.querySelector('#cc-obs-cost');
  const inputEl  = container.querySelector('#cc-obs-input');
  const outputEl = container.querySelector('#cc-obs-output');
  const inPctEl  = container.querySelector('#cc-obs-in-pct');
  const outPctEl = container.querySelector('#cc-obs-out-pct');
  const sparkEl  = container.querySelector('#cc-obs-spark-wrap');
  const emptyEl  = container.querySelector('#cc-obs-empty');

  if (emptyEl) emptyEl.style.display = isEmpty ? 'block' : 'none';

  if (totalEl)  _animCounter(totalEl, 0, total, 900);
  if (costEl)   costEl.textContent = '$' + cost.toFixed(4);
  if (inputEl)  inputEl.textContent = _formatTokens(input);
  if (outputEl) outputEl.textContent = _formatTokens(output);
  if (inPctEl)  inPctEl.textContent = _pct(input, total);
  if (outPctEl) outPctEl.textContent = _pct(output, total);
  if (sparkEl)  sparkEl.innerHTML = _buildSparkline(byDay);
}

// ---- Public API ----

export function buildObservabilityTab() {
  return `
<div class="cc-obs-tab">
  <div class="cc-obs-header">
    <span class="cc-obs-title">TOKEN OBSERVABILITY</span>
  </div>

  <div class="cc-obs-counters">
    <div class="cc-obs-counter-card">
      <div class="cc-obs-counter-val" id="cc-obs-total">—</div>
      <div class="cc-obs-counter-lbl">TOTAL TOKENS</div>
    </div>
    <div class="cc-obs-counter-card">
      <div class="cc-obs-counter-val" id="cc-obs-cost">—</div>
      <div class="cc-obs-counter-lbl">EST. COST (USD)</div>
    </div>
  </div>

  <div class="cc-obs-split">
    <div class="cc-obs-split-item">
      <span class="cc-obs-split-val" id="cc-obs-input">—</span>
      <span class="cc-obs-split-lbl">INPUT</span>
      <span class="cc-obs-split-pct" id="cc-obs-in-pct">—</span>
    </div>
    <div class="cc-obs-split-divider"></div>
    <div class="cc-obs-split-item">
      <span class="cc-obs-split-val" id="cc-obs-output">—</span>
      <span class="cc-obs-split-lbl">OUTPUT</span>
      <span class="cc-obs-split-pct" id="cc-obs-out-pct">—</span>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-obs-spark-label">DAILY USAGE — LAST 30 DAYS</div>
    <div id="cc-obs-spark-wrap" class="cc-obs-spark-wrap">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div id="cc-obs-empty" class="cc-obs-empty-note" style="display:none">
    No sessions yet — token data will appear here after your first conversation.
  </div>
</div>`.trim();
}

export async function loadObservability(container) {
  try {
    const res = await fetch('/api/usage/tokens');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _renderData(container, data);
  } catch (e) {
    const sparkEl = container.querySelector('#cc-obs-spark-wrap');
    if (sparkEl) sparkEl.innerHTML = `<div class="cc-empty">Data unavailable — ${_esc(e.message)}</div>`;
    const emptyEl = container.querySelector('#cc-obs-empty');
    if (emptyEl) { emptyEl.textContent = 'Could not load usage data.'; emptyEl.style.display = 'block'; }
  }
}
