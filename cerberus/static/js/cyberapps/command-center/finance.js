/**
 * finance.js — FINANCE tab: LLM Cost & Usage dashboard.
 *
 * Data source: GET /api/finance/summary
 * The "finance" of a self-hosted AI workspace is token spend.
 * Degrades gracefully on empty data; sections are independent.
 */

const _BREAKDOWN_CAP = 8;

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _fmt(n) {
  if (n == null || n < 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function _fmtCost(v) {
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

function _animCounter(el, to, ms) {
  if (!el) return;
  const start = performance.now();
  (function tick(now) {
    const t = Math.min((now - start) / ms, 1);
    const ease = 1 - Math.pow(1 - t, 4);
    el.textContent = Math.round(to * ease).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  })(performance.now());
}

function _buildSparkline(byDay, valueKey) {
  if (!byDay || byDay.length === 0) return '<div class="cc-fin-no-data">// NO DATA</div>';
  const days = byDay.slice(-30);
  const max = Math.max(...days.map(d => d[valueKey] || 0), 1);
  const W = 300, H = 48;
  const barW = Math.max(4, Math.floor((W - 8) / days.length) - 2);
  const gap = days.length > 1 ? (W - 8 - barW * days.length) / (days.length - 1) : 0;
  const bars = days.map((d, i) => {
    const v = d[valueKey] || 0;
    const bh = Math.max(2, Math.round((v / max) * (H - 12)));
    const x = 4 + i * (barW + gap);
    const y = H - 8 - bh;
    const op = (0.25 + (v / max) * 0.65).toFixed(2);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh}"
      rx="1" fill="var(--cc-crimson)" opacity="${op}"/>`;
  }).join('');
  return `<svg class="cc-fin-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    aria-label="30-day sparkline">${bars}</svg>`;
}

function _buildBars(rows, nameKey, valueKey) {
  if (!rows || rows.length === 0) return '<div class="cc-fin-no-data">// NO DATA</div>';
  const max = Math.max(...rows.map(r => r[valueKey] || 0), 1);
  return rows.map((r, i) => {
    const v = r[valueKey] || 0;
    const pct = Math.max(2, Math.round((v / max) * 100));
    const op = Math.max(0.2, 1 - (i / Math.max(rows.length - 1, 1)) * 0.8).toFixed(2);
    const cost = r.cost > 0 ? ` · ${_fmtCost(r.cost)}` : '';
    return `<div class="cc-fin-bar-row">
      <span class="cc-fin-bar-name">${_esc(r[nameKey])}</span>
      <span class="cc-fin-bar-wrap">
        <span class="cc-fin-bar-fill" style="width:${pct}%;opacity:${op}"></span>
      </span>
      <span class="cc-fin-bar-val">${_fmt(v)}${cost}</span>
    </div>`;
  }).join('');
}

export function buildFinanceTab() {
  return `<div class="cc-finance-tab" id="cc-fin-root">
    <div id="cc-fin-hero" class="cc-fin-hero">
      <div class="cc-fin-hero-left">
        <div class="cc-fin-big-label">TOKENS THIS MONTH</div>
        <div class="cc-fin-big-val" id="cc-fin-total">—</div>
        <div class="cc-fin-sub-val" id="cc-fin-cost">—</div>
      </div>
      <div class="cc-fin-hero-right">
        <div id="cc-fin-free-badge" class="cc-fin-free-badge" style="display:none">FREE TIER</div>
        <div id="cc-fin-proj-chip" class="cc-fin-proj-chip" style="display:none"></div>
      </div>
    </div>

    <div class="cc-fin-section-header">// DAILY TOKEN USAGE — LAST 30 DAYS</div>
    <div id="cc-fin-spark-tokens" class="cc-fin-spark-wrap"><div class="cc-fin-no-data">Loading…</div></div>

    <div class="cc-fin-section-header">// DAILY COST — LAST 30 DAYS (EST.)</div>
    <div id="cc-fin-spark-cost" class="cc-fin-spark-wrap"><div class="cc-fin-no-data">Loading…</div></div>

    <div class="cc-fin-section-header">// COST BY AGENT — TOP ${_BREAKDOWN_CAP}</div>
    <div id="cc-fin-by-agent" class="cc-fin-bar-list"><div class="cc-fin-no-data">Loading…</div></div>

    <div class="cc-fin-section-header">// COST BY MODEL — TOP ${_BREAKDOWN_CAP}</div>
    <div id="cc-fin-by-model" class="cc-fin-bar-list"><div class="cc-fin-no-data">Loading…</div></div>
  </div>`;
}

function _ensureStyles() {
  if (document.getElementById('cc-fin-styles')) return;
  const s = document.createElement('style');
  s.id = 'cc-fin-styles';
  s.textContent = `
.cc-finance-tab { padding: 16px; color: var(--cc-fg); font-family: var(--cc-font-mono, monospace); }
.cc-fin-hero { display:flex; justify-content:space-between; align-items:flex-start;
  background:var(--cc-surface-raise, var(--surface-raise));
  border:1px solid var(--cc-border); border-radius:4px; padding:16px 20px; margin-bottom:16px; }
.cc-fin-hero-left { flex:1; }
.cc-fin-hero-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
.cc-fin-big-label { font-size:10px; letter-spacing:.12em; opacity:.6; margin-bottom:6px; }
.cc-fin-big-val { font-size:36px; font-weight:700; color:var(--cc-crimson); line-height:1; }
.cc-fin-sub-val { font-size:14px; opacity:.75; margin-top:6px; }
.cc-fin-free-badge { background:var(--cc-crimson); color:var(--cc-bg, #000);
  font-size:10px; font-weight:700; letter-spacing:.1em; padding:3px 8px; border-radius:2px; }
.cc-fin-proj-chip { font-size:11px; opacity:.75; background:var(--cc-surface-mid, var(--surface-mid));
  border:1px solid var(--cc-border); border-radius:3px; padding:4px 8px; }
.cc-fin-section-header { font-size:10px; letter-spacing:.12em; color:var(--cc-crimson);
  opacity:.8; margin:20px 0 8px; }
.cc-fin-spark-wrap { margin-bottom:4px; }
.cc-fin-spark { display:block; width:100%; max-width:300px; height:48px; }
.cc-fin-no-data { font-size:11px; opacity:.4; padding:8px 0; }
.cc-fin-bar-list { margin-bottom:4px; }
.cc-fin-bar-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; }
.cc-fin-bar-name { width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.9; }
.cc-fin-bar-wrap { flex:1; background:color-mix(in srgb,var(--cc-crimson) 10%,transparent);
  border-radius:2px; height:6px; overflow:hidden; }
.cc-fin-bar-fill { display:block; height:100%; background:var(--cc-crimson); border-radius:2px;
  transition:width .4s ease; }
.cc-fin-bar-val { font-size:10px; opacity:.65; white-space:nowrap; min-width:80px; text-align:right; }
`;
  document.head.appendChild(s);
}

export async function loadFinance(root) {
  _ensureStyles();
  const q = s => root.querySelector(s);

  let data;
  try {
    const res = await fetch('/api/finance/summary');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    const hero = q('#cc-fin-hero');
    if (hero) hero.innerHTML =
      `<div class="cc-fin-no-data">// FINANCE DATA UNAVAILABLE — ${_esc(err.message)}</div>`;
    ['cc-fin-spark-tokens','cc-fin-spark-cost','cc-fin-by-agent','cc-fin-by-model'].forEach(id => {
      const el = q(`#${id}`);
      if (el) el.innerHTML = '<div class="cc-fin-no-data">—</div>';
    });
    return;
  }

  // Hero
  const totalEl = q('#cc-fin-total');
  const costEl = q('#cc-fin-cost');
  if (totalEl) _animCounter(totalEl, data.total_tokens || 0, 900);
  if (costEl) costEl.textContent = data.estimated_cost > 0
    ? `Est. cost: ${_fmtCost(data.estimated_cost)}`
    : data.is_free_tier ? 'Groq free tier — $0.00' : '$0.00';

  const freeBadge = q('#cc-fin-free-badge');
  if (freeBadge) freeBadge.style.display = data.is_free_tier ? '' : 'none';

  const projChip = q('#cc-fin-proj-chip');
  if (projChip && data.projected_monthly_tokens > 0) {
    projChip.style.display = '';
    projChip.textContent = `Proj. ${_fmt(data.projected_monthly_tokens)} tok · ${_fmtCost(data.projected_monthly_cost)}/mo`;
  }

  // Sparklines
  const sparkTok = q('#cc-fin-spark-tokens');
  if (sparkTok) sparkTok.innerHTML = _buildSparkline(data.by_day, 'tokens');

  const sparkCost = q('#cc-fin-spark-cost');
  if (sparkCost) sparkCost.innerHTML = _buildSparkline(data.by_day, 'cost');

  // Bar charts
  const agentEl = q('#cc-fin-by-agent');
  if (agentEl) agentEl.innerHTML = _buildBars(data.by_agent || [], 'name', 'tokens');

  const modelEl = q('#cc-fin-by-model');
  if (modelEl) modelEl.innerHTML = _buildBars(data.by_model || [], 'model', 'tokens');
}
