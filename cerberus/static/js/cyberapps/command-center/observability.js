/**
 * observability.js — OBSERVABILITY sub-tab for Command Center.
 *
 * Renders token usage data from /api/usage/tokens:
 *  - Total tokens (animated counter)
 *  - Estimated cost in USD
 *  - 30-day sparkline bar chart (SVG)
 *  - Input vs output token split
 *
 * Plus, layered on as enhancements:
 *  - SESSIONS counter (from /api/stats/activity?days=30)
 *  - Per-agent token breakdown (derived from /api/agents)
 *  - Per-model token breakdown (derived from /api/agents)
 *  - Daily cost sparkline (derived from by_day.tokens × cloud rate)
 *
 * Each section degrades independently via Promise.allSettled — one
 * failing fetch never blanks the whole tab.
 */

// Cloud rate matches routes/session_routes.py:769 (0.000003 USD/token).
// Per-agent cost can't be split local-vs-cloud client-side (the
// /api/agents response doesn't expose endpoint URLs), so the per-agent
// figures are upper-bound estimates flagged as such in the section label.
const CLOUD_RATE_USD_PER_TOKEN = 0.000003;
const BREAKDOWN_CAP = 8;

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

// ── Breakdown helpers (pure — exposed via __testables for tests) ──────

function _aggregatePerAgent(agents) {
  const list = Array.isArray(agents) ? agents : [];
  return list
    .map(a => {
      const tokens = (a?.total_input_tokens || 0) + (a?.total_output_tokens || 0);
      return {
        name:   String(a?.name || a?.id || '—'),
        model:  String(a?.model_alias || '—'),
        tokens,
        cost:   Math.round(tokens * CLOUD_RATE_USD_PER_TOKEN * 10000) / 10000,
      };
    })
    .filter(r => r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, BREAKDOWN_CAP);
}

function _aggregatePerModel(agents) {
  const list = Array.isArray(agents) ? agents : [];
  const byModel = new Map();
  for (const a of list) {
    const model  = String(a?.model_alias || '—');
    const tokens = (a?.total_input_tokens || 0) + (a?.total_output_tokens || 0);
    if (!tokens) continue;
    byModel.set(model, (byModel.get(model) || 0) + tokens);
  }
  return [...byModel.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, BREAKDOWN_CAP);
}

function _rankOpacity(idx, total) {
  if (total <= 1) return 1;
  return Math.max(0.2, 1 - (idx / (total - 1)) * 0.8);
}

function _renderAgentBreakdown(listEl, rows) {
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = '<div class="cc-obs-empty-row">// NO AGENT DATA</div>';
    return;
  }
  const max = rows[0].tokens;
  listEl.innerHTML = rows.map((r, i) => {
    const pct = max > 0 ? Math.max(2, Math.round((r.tokens / max) * 100)) : 0;
    const op  = _rankOpacity(i, rows.length).toFixed(2);
    const cost = r.cost > 0 ? ` ($${r.cost.toFixed(4)})` : '';
    return `<div class="cc-obs-agent-row" data-rank="${i}">
      <span class="cc-obs-agent-name">${_esc(r.name)}</span>
      <span class="cc-obs-agent-bar-wrap">
        <span class="cc-obs-agent-bar-fill" style="width:${pct}%;opacity:${op}"></span>
      </span>
      <span class="cc-obs-agent-val">${_formatTokens(r.tokens)} tokens${cost}</span>
    </div>`;
  }).join('');
}

function _renderModelBreakdown(listEl, rows) {
  if (!listEl) return;
  if (!rows.length) {
    listEl.innerHTML = '<div class="cc-obs-empty-row">// NO MODEL DATA</div>';
    return;
  }
  const max = rows[0].tokens;
  listEl.innerHTML = rows.map((r, i) => {
    const pct = max > 0 ? Math.max(2, Math.round((r.tokens / max) * 100)) : 0;
    const op  = _rankOpacity(i, rows.length).toFixed(2);
    return `<div class="cc-obs-agent-row" data-rank="${i}">
      <span class="cc-obs-agent-name">${_esc(r.model)}</span>
      <span class="cc-obs-agent-bar-wrap">
        <span class="cc-obs-agent-bar-fill" style="width:${pct}%;opacity:${op}"></span>
      </span>
      <span class="cc-obs-agent-val">${_formatTokens(r.tokens)} tokens</span>
    </div>`;
  }).join('');
}

function _buildCostSparkline(byDay) {
  const days = Array.isArray(byDay) ? byDay.slice(-30) : [];
  if (!days.length) return '<div class="cc-obs-no-data">No daily data</div>';
  const costs = days.map(d => (d?.tokens || 0) * CLOUD_RATE_USD_PER_TOKEN);
  const max   = Math.max(...costs, 0.000001);
  const W = 300, H = 48, barW = Math.max(4, Math.floor((W - 8) / days.length) - 2);
  const gap   = days.length > 1 ? (W - 8 - barW * days.length) / (days.length - 1) : 0;
  const bars  = costs.map((c, i) => {
    const bh = Math.max(2, Math.round((c / max) * (H - 12)));
    const x  = 4 + i * (barW + gap);
    const y  = H - 8 - bh;
    const op = 0.25 + (c / max) * 0.65;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh}"
      rx="1" fill="var(--cc-crimson)" opacity="${op.toFixed(2)}"/>`;
  }).join('');
  return `<svg class="cc-obs-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    aria-label="30-day cost sparkline (estimated)">${bars}</svg>`;
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
    <div class="cc-obs-counter-card">
      <div class="cc-obs-counter-val" id="cc-obs-sessions">—</div>
      <div class="cc-obs-counter-lbl">SESSIONS</div>
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

  <div class="cc-obs-spark-section">
    <div class="cc-obs-spark-label">DAILY COST — LAST 30 DAYS (EST.)</div>
    <div id="cc-obs-cost-spark-wrap" class="cc-obs-spark-wrap">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-obs-spark-label">PER-AGENT BREAKDOWN — TOP ${BREAKDOWN_CAP} (COST ESTIMATED)</div>
    <div id="cc-obs-per-agent" class="cc-obs-breakdown">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-obs-spark-label">PER-MODEL BREAKDOWN — TOP ${BREAKDOWN_CAP}</div>
    <div id="cc-obs-per-model" class="cc-obs-breakdown">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div id="cc-obs-empty" class="cc-obs-empty-note" style="display:none">
    No sessions yet — token data will appear here after your first conversation.
  </div>
</div>`.trim();
}

async function _fetchJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function _applyUsage(container, data) {
  _renderData(container, data);
  const costSparkEl = container.querySelector('#cc-obs-cost-spark-wrap');
  if (costSparkEl) costSparkEl.innerHTML = _buildCostSparkline(data?.by_day || []);
}

function _applyUsageFailure(container, err) {
  const sparkEl = container.querySelector('#cc-obs-spark-wrap');
  if (sparkEl) sparkEl.innerHTML = `<div class="cc-empty">Data unavailable — ${_esc(err.message)}</div>`;
  const costSparkEl = container.querySelector('#cc-obs-cost-spark-wrap');
  if (costSparkEl) costSparkEl.innerHTML = '<div class="cc-empty">Cost data unavailable.</div>';
  const emptyEl = container.querySelector('#cc-obs-empty');
  if (emptyEl) { emptyEl.textContent = 'Could not load usage data.'; emptyEl.style.display = 'block'; }
}

function _applyAgents(container, data) {
  const agents = Array.isArray(data?.agents) ? data.agents : (Array.isArray(data) ? data : []);
  const perAgent = _aggregatePerAgent(agents);
  const perModel = _aggregatePerModel(agents);
  _renderAgentBreakdown(container.querySelector('#cc-obs-per-agent'), perAgent);
  _renderModelBreakdown(container.querySelector('#cc-obs-per-model'), perModel);
}

function _applyAgentsFailure(container, err) {
  const agentEl = container.querySelector('#cc-obs-per-agent');
  const modelEl = container.querySelector('#cc-obs-per-model');
  if (agentEl) agentEl.innerHTML = `<div class="cc-empty">Agent data unavailable — ${_esc(err.message)}</div>`;
  if (modelEl) modelEl.innerHTML = `<div class="cc-empty">Model data unavailable — ${_esc(err.message)}</div>`;
}

function _applyActivity(container, data) {
  const sessionsEl = container.querySelector('#cc-obs-sessions');
  if (!sessionsEl) return;
  const n = Number(data?.total_sessions || 0);
  sessionsEl.textContent = _formatTokens(n).replace(/^[—]$/, '0');
  if (n > 0) _animCounter(sessionsEl, 0, n, 600);
}

function _applyActivityFailure(container) {
  const sessionsEl = container.querySelector('#cc-obs-sessions');
  if (sessionsEl) sessionsEl.textContent = '—';
}

export async function loadObservability(container) {
  // Fire all three fetches concurrently; settle independently so one
  // backend wobble doesn't blank the whole tab.
  const [usage, agents, activity] = await Promise.allSettled([
    _fetchJSON('/api/usage/tokens'),
    _fetchJSON('/api/agents'),
    _fetchJSON('/api/stats/activity?days=30'),
  ]);

  if (usage.status === 'fulfilled') _applyUsage(container, usage.value);
  else                              _applyUsageFailure(container, usage.reason);

  if (agents.status === 'fulfilled') _applyAgents(container, agents.value);
  else                               _applyAgentsFailure(container, agents.reason);

  if (activity.status === 'fulfilled') _applyActivity(container, activity.value);
  else                                 _applyActivityFailure(container);
}

// Exposed for tests/test_observability.test.mjs.
export const __testables = {
  CLOUD_RATE_USD_PER_TOKEN, BREAKDOWN_CAP,
  _aggregatePerAgent, _aggregatePerModel,
  _renderAgentBreakdown, _renderModelBreakdown,
  _buildCostSparkline, _rankOpacity,
  _applyUsage, _applyUsageFailure,
  _applyAgents, _applyAgentsFailure,
  _applyActivity, _applyActivityFailure,
};
