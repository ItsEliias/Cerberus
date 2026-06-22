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
    return `<div class="cc-obs-no-data">// NO DATA</div>`;
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
  if (!days.length) return '<div class="cc-obs-no-data">// NO DATA</div>';
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
    <span class="cc-section-label">TOKEN OBSERVABILITY</span>
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
    <div class="cc-section-label">DAILY USAGE — LAST 30 DAYS</div>
    <div id="cc-obs-spark-wrap" class="cc-obs-spark-wrap">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-section-label">DAILY COST — LAST 30 DAYS (EST.)</div>
    <div id="cc-obs-cost-spark-wrap" class="cc-obs-spark-wrap">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-section-label">PER-AGENT BREAKDOWN — TOP ${BREAKDOWN_CAP} (COST ESTIMATED)</div>
    <div id="cc-obs-per-agent" class="cc-obs-breakdown">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section">
    <div class="cc-section-label">PER-MODEL BREAKDOWN — TOP ${BREAKDOWN_CAP}</div>
    <div id="cc-obs-per-model" class="cc-obs-breakdown">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section cc-diag-section">
    <div class="cc-section-label">SYSTEM DIAGNOSTICS</div>
    <div id="cc-diag-services" class="cc-diag-services">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section cc-diag-section">
    <div class="cc-section-label">DATABASE</div>
    <div id="cc-diag-db" class="cc-diag-chips">
      <div class="cc-empty">Loading…</div>
    </div>
  </div>

  <div class="cc-obs-spark-section cc-diag-section">
    <div class="cc-section-label">RAG INDEX</div>
    <div id="cc-diag-rag" class="cc-diag-chips">
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

// ─── Diagnostics: services / database / RAG index ──────────────────────────
//
// Three independent panels under the OBSERVE tab. Each fetch settles on its
// own — one failure paints `// UNAVAILABLE` in its row instead of taking the
// other two down with it. The non-admin 403 from the underlying routes lands
// here as a regular fetch failure.

const _DIAG_OK_STATUSES = new Set(['ok', 'online', 'healthy']);

function _diagDotClass(status) {
  const s = String(status || '').toLowerCase();
  if (_DIAG_OK_STATUSES.has(s)) return 'cc-diag-dot--ok';
  if (s === 'degraded')        return 'cc-diag-dot--warn';
  if (s === 'down' || s === 'error') return 'cc-diag-dot--err';
  if (s === 'disabled')        return 'cc-diag-dot--off';
  return 'cc-diag-dot--unknown';
}

function _diagLabel(status) {
  const s = String(status || '').toLowerCase();
  if (_DIAG_OK_STATUSES.has(s)) return 'ONLINE';
  if (!s) return 'UNKNOWN';
  return s.toUpperCase();
}

function _applyServices(container, data) {
  const el = container.querySelector('#cc-diag-services');
  if (!el) return;
  const services = Array.isArray(data?.services) ? data.services
                 : Array.isArray(data) ? data
                 : [];
  if (!services.length) {
    el.innerHTML = '<div class="cc-empty">// NO SERVICE PROBES</div>';
    return;
  }
  el.innerHTML = services.map(s => {
    const name    = String(s.name || '').toUpperCase();
    const dotCls  = _diagDotClass(s.status);
    const label   = _diagLabel(s.status);
    const latency = (s.meta && (s.meta.latency_ms ?? s.meta.latency))
                  || s.latency_ms || s.latency;
    const latStr  = latency != null ? `${Math.round(latency)}ms` : '';
    return `<div class="cc-diag-row">
      <span class="cc-diag-service-name">${_esc(name)}</span>
      <span class="cc-diag-dot ${dotCls}"></span>
      <span class="cc-diag-status">${_esc(label)}</span>
      <span class="cc-diag-latency">${_esc(latStr)}</span>
    </div>`;
  }).join('');
}

function _applyServicesFailure(container) {
  const el = container.querySelector('#cc-diag-services');
  if (el) el.innerHTML = '<div class="cc-empty">// UNAVAILABLE</div>';
}

function _applyDbStats(container, data) {
  const el = container.querySelector('#cc-diag-db');
  if (!el) return;
  const sessions = Number(data?.total_sessions ?? 0);
  const messages = Number(data?.total_messages ?? 0);
  const memories = Number(data?.total_memories ?? 0);
  const sizeMb   = Number(data?.database_size_mb ?? 0);
  const chips = [
    { lbl: 'SESSIONS', val: sessions.toLocaleString() },
    { lbl: 'MESSAGES', val: messages.toLocaleString() },
    { lbl: 'MEMORIES', val: memories.toLocaleString() },
  ];
  if (sizeMb > 0) chips.push({ lbl: 'SIZE', val: `${sizeMb} MB` });
  el.innerHTML = chips.map(c => `
    <div class="cc-diag-chip">
      <span class="cc-diag-chip-lbl">${_esc(c.lbl)}</span>
      <span class="cc-diag-chip-val">${_esc(c.val)}</span>
    </div>
  `).join('');
}

function _applyDbStatsFailure(container) {
  const el = container.querySelector('#cc-diag-db');
  if (el) el.innerHTML = '<div class="cc-empty">// UNAVAILABLE</div>';
}

function _applyRagStats(container, data) {
  const el = container.querySelector('#cc-diag-rag');
  if (!el) return;
  if (data?.error) {
    el.innerHTML = `<div class="cc-empty">// ${_esc(String(data.error).toUpperCase())}</div>`;
    return;
  }
  const docs   = Number(data?.document_count ?? 0);
  const model  = data?.embedding_model || '';
  const healthy = data?.healthy !== false;
  const chips = [
    { lbl: 'DOCUMENTS', val: docs.toLocaleString() },
    { lbl: 'STATUS',    val: healthy ? 'HEALTHY' : 'DEGRADED' },
  ];
  if (model) chips.push({ lbl: 'EMBEDDER', val: String(model).split(' @ ')[0] });
  el.innerHTML = chips.map(c => `
    <div class="cc-diag-chip">
      <span class="cc-diag-chip-lbl">${_esc(c.lbl)}</span>
      <span class="cc-diag-chip-val">${_esc(c.val)}</span>
    </div>
  `).join('');
}

function _applyRagStatsFailure(container) {
  const el = container.querySelector('#cc-diag-rag');
  if (el) el.innerHTML = '<div class="cc-empty">// UNAVAILABLE</div>';
}

async function _loadDiagnostics(container) {
  const [svc, db, rag] = await Promise.allSettled([
    _fetchJSON('/api/diagnostics/services'),
    _fetchJSON('/api/db/stats'),
    _fetchJSON('/api/rag/stats'),
  ]);
  if (svc.status === 'fulfilled') _applyServices(container, svc.value);
  else                            _applyServicesFailure(container);
  if (db.status === 'fulfilled')  _applyDbStats(container, db.value);
  else                            _applyDbStatsFailure(container);
  if (rag.status === 'fulfilled') _applyRagStats(container, rag.value);
  else                            _applyRagStatsFailure(container);
}

// Inject diagnostics-only CSS at module-load time. styles.css is locked by
// a concurrent session so we ship the styles inline here; token-only — no
// hardcoded hex except as final fallbacks for the var() chain.
const _DIAG_STYLE_ID = 'cc-diag-styles';
function _ensureDiagStyles() {
  if (typeof document === 'undefined') return;
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function'
      && document.getElementById(_DIAG_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = _DIAG_STYLE_ID;
  style.textContent = `
.cc-diag-section { padding-top: 8px; }
.cc-diag-services {
  display: flex; flex-direction: column;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-diag-row {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--cc-border, var(--border, #3a2a2a));
}
.cc-diag-row:last-child { border-bottom: none; }
.cc-diag-service-name {
  font-size: 11px;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  min-width: 100px;
  letter-spacing: 0.06em;
}
.cc-diag-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--cc-border, var(--border, #3a2a2a));
  flex-shrink: 0;
}
.cc-diag-dot--ok   { background: var(--green, var(--cc-ok, #50fa7b)); }
.cc-diag-dot--warn { background: var(--warn, var(--cc-warn, #f0ad4e)); }
.cc-diag-dot--err  { background: var(--cc-crimson, var(--red, #c0392b)); }
.cc-diag-dot--off  { background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 25%, transparent); }
.cc-diag-dot--unknown { background: var(--cc-border, var(--border, #3a2a2a)); }
.cc-diag-status {
  font-size: 10px; letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 60%, transparent);
  flex: 1; min-width: 0;
}
.cc-diag-latency {
  font-size: 10px; letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 40%, transparent);
  white-space: nowrap;
}
.cc-diag-chips {
  display: flex; flex-wrap: wrap; gap: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-diag-chip {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 4%, transparent);
}
.cc-diag-chip-lbl {
  font-size: 8.5px; letter-spacing: 0.14em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 45%, transparent);
}
.cc-diag-chip-val {
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 11px; letter-spacing: 0.04em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  font-variant-numeric: tabular-nums;
}
  `.trim();
  document.head.appendChild(style);
}

// Slow auto-refresh for diagnostics — they don't change as often as token
// totals. The interval self-clears when the OBSERVE tab is unmounted (the
// container leaves the DOM), so no separate destroyObservability hook is
// required from index.js.
function _scheduleDiagRefresh(container) {
  if (typeof setInterval !== 'function') return;
  const id = setInterval(() => {
    if (!container || !container.isConnected) {
      clearInterval(id);
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) return;
    _loadDiagnostics(container);
  }, 60_000);
}

export async function loadObservability(container) {
  _ensureDiagStyles();
  // Fire all three usage fetches AND the diagnostics fetch concurrently;
  // settle independently so one backend wobble doesn't blank the whole tab.
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

  // Diagnostics fan-out runs alongside the token data and self-refreshes
  // every 60s while the tab stays mounted.
  await _loadDiagnostics(container);
  _scheduleDiagRefresh(container);
}

// Exposed for tests/test_observability.test.mjs + test_cc_diagnostics.test.mjs.
export const __testables = {
  CLOUD_RATE_USD_PER_TOKEN, BREAKDOWN_CAP,
  _aggregatePerAgent, _aggregatePerModel,
  _renderAgentBreakdown, _renderModelBreakdown,
  _buildCostSparkline, _rankOpacity,
  _applyUsage, _applyUsageFailure,
  _applyAgents, _applyAgentsFailure,
  _applyActivity, _applyActivityFailure,
  _applyServices, _applyServicesFailure,
  _applyDbStats, _applyDbStatsFailure,
  _applyRagStats, _applyRagStatsFailure,
  _loadDiagnostics, _diagDotClass,
};
