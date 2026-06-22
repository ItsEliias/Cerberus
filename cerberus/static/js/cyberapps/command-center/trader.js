/**
 * trader.js — TRADER tab: Phase 2 — brief → paper-sim integration.
 *
 * Phase 1 panels (T1 — market data + briefs):
 *   MARKET DATA     — live Kalshi ≥50¢ contracts from /api/trader/markets/threshold
 *   RESEARCH BRIEFS — Council briefs; click to expand candidates + paper-order form
 *
 * Phase 2 panels (T2 — paper-sim):
 *   KILL SWITCH     — live file state + circuit breaker from /api/trader/status
 *   WALLET          — paper balance, exposure, fills from /api/trader/status
 *   POSITIONS & P&L — open paper trades from /api/trader/status
 *   AUDIT LEDGER    — hash-chained events from /api/trader/ledger
 *
 * Phase 2 new (T1 — integration):
 *   PAPER PERFORMANCE — win rate, P&L, CLV, drawdown from /api/trader/paper/stats
 *
 * Untrusted-content invariant (Phase 2):
 *   A brief, a news headline, a fetched page, or any market data CANNOT auto-trigger
 *   a paper order. Every paper order is human-initiated (owner reads candidate,
 *   sets size, clicks PLACE). Ref: docs/TRADER_AGENT_RISK_AND_PHASING.md §5.
 *
 * Admin-only: loadTrader() shows access-denied for non-admins.
 */

// Module-level kill-switch state so order buttons can check it synchronously.
let _killArmed = false;

function _ensureStyles() {
  if (document.getElementById('cc-trader-styles')) return;
  const s = document.createElement('style');
  s.id = 'cc-trader-styles';
  s.textContent = `
.cc-trader-tab {
  padding: 16px;
  color: var(--cc-fg);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Phase banner */
.cc-trader-notice {
  background: color-mix(in srgb, var(--cc-crimson) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-crimson) 40%, transparent);
  border-radius: 4px;
  padding: 12px 16px;
  font-size: 10px;
  letter-spacing: 0.14em;
  line-height: 1.7;
}
.cc-trader-notice--active {
  background: color-mix(in srgb, var(--cc-fg) 4%, transparent);
  border-color: color-mix(in srgb, var(--cc-fg) 18%, transparent);
}
.cc-trader-notice-title {
  color: var(--cc-crimson);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.18em;
  margin-bottom: 4px;
}
.cc-trader-notice--active .cc-trader-notice-title { color: var(--cc-fg); opacity: 0.8; }
.cc-trader-notice-body { opacity: 0.65; }

/* Card */
.cc-trader-card {
  background: var(--cc-void-mid);
  border: 1px solid var(--cc-border);
  border-radius: 6px;
  padding: 14px 16px;
}

/* Empty-state */
.cc-trader-empty {
  font-size: 11px;
  opacity: 0.38;
  padding: 6px 0 2px;
  letter-spacing: 0.08em;
}

/* MODE flags */
.cc-trader-mode-flags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.cc-trader-flag {
  font-size: 9px; font-weight: 700; letter-spacing: 0.18em;
  padding: 4px 10px; border-radius: 3px;
  border: 1px solid var(--cc-border); color: var(--cc-fg);
  opacity: 0.3; -webkit-appearance: none; appearance: none;
}
.cc-trader-flag--current {
  opacity: 0.8;
  border-color: color-mix(in srgb, var(--cc-fg) 40%, transparent);
}

/* Kill switch */
.cc-trader-kill-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 11px; }
.cc-trader-kill-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: color-mix(in srgb, var(--cc-fg) 25%, transparent);
}
.cc-trader-kill-dot--armed { background: color-mix(in srgb, var(--cc-crimson) 70%, transparent); }
.cc-trader-kill-label { opacity: 0.55; letter-spacing: 0.06em; }

/* Circuit breaker bar */
.cc-trader-circuit-bar-wrap {
  margin-top: 8px; height: 4px;
  background: color-mix(in srgb, var(--cc-border) 40%, transparent);
  border-radius: 2px; overflow: hidden;
}
.cc-trader-circuit-bar {
  height: 100%; border-radius: 2px;
  background: color-mix(in srgb, var(--cc-fg) 30%, transparent);
  transition: width 0.4s ease;
}
.cc-trader-circuit-bar--warn { background: color-mix(in srgb, var(--cc-crimson) 60%, transparent); }

/* Approval gate */
.cc-trader-gate-notice { margin-top: 10px; font-size: 10px; letter-spacing: 0.08em; line-height: 1.65; opacity: 0.55; }

/* Admin access denied */
.cc-trader-access-denied { padding: 24px 16px; font-size: 10px; letter-spacing: 0.14em; opacity: 0.45; text-align: center; }

/* Market data cards */
.cc-trader-market-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.cc-trader-market-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10px; padding: 6px 10px; border-radius: 4px;
  background: color-mix(in srgb, var(--cc-fg) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 60%, transparent);
  gap: 8px; flex-wrap: wrap;
}
.cc-trader-market-ticker { font-weight: 700; letter-spacing: 0.1em; opacity: 0.9; min-width: 90px; }
.cc-trader-market-title { opacity: 0.6; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
.cc-trader-market-mid { font-weight: 700; letter-spacing: 0.06em; min-width: 40px; text-align: right; color: color-mix(in srgb, var(--cc-fg) 85%, transparent); }
.cc-trader-market-vol { opacity: 0.4; font-size: 9px; min-width: 50px; text-align: right; }

/* Brief cards */
.cc-trader-brief-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.cc-trader-brief-row {
  padding: 8px 10px; border-radius: 4px;
  background: color-mix(in srgb, var(--cc-fg) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 60%, transparent);
  font-size: 10px; cursor: pointer;
}
.cc-trader-brief-row:hover { border-color: color-mix(in srgb, var(--cc-fg) 25%, transparent); }
.cc-trader-brief-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cc-trader-brief-ticker { font-weight: 700; letter-spacing: 0.1em; }
.cc-trader-brief-dir {
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  padding: 2px 6px; border-radius: 2px;
  background: color-mix(in srgb, var(--cc-fg) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 50%, transparent);
}
.cc-trader-brief-dir--YES { color: color-mix(in srgb, var(--cc-fg) 90%, transparent); }
.cc-trader-brief-dir--NO  { opacity: 0.6; }
.cc-trader-brief-dir--PASS { opacity: 0.4; }
.cc-trader-brief-conf { opacity: 0.5; font-size: 9px; }
.cc-trader-brief-rationale { opacity: 0.55; font-size: 9px; line-height: 1.5; margin-top: 2px; }
.cc-trader-brief-ts { opacity: 0.3; font-size: 8px; margin-top: 4px; letter-spacing: 0.06em; }

/* Candidate + order form (Phase 2) */
.cc-trader-candidate {
  margin-top: 8px; padding: 8px 10px; border-radius: 4px;
  background: color-mix(in srgb, var(--cc-fg) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 80%, transparent);
}
.cc-trader-candidate-price {
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
  margin-bottom: 6px;
}
.cc-trader-order-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.cc-trader-size-input {
  font-family: inherit; font-size: 10px; letter-spacing: 0.06em;
  background: color-mix(in srgb, var(--cc-fg) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 70%, transparent);
  color: var(--cc-fg); border-radius: 3px;
  padding: 4px 8px; width: 60px; text-align: center;
  -webkit-appearance: none; appearance: none;
}
.cc-trader-size-input:focus { outline: none; border-color: color-mix(in srgb, var(--cc-fg) 40%, transparent); }

/* Loading / error states */
.cc-trader-loading { font-size: 10px; opacity: 0.4; padding: 6px 0; letter-spacing: 0.1em; }
.cc-trader-error { font-size: 10px; padding: 6px 0; letter-spacing: 0.08em; color: color-mix(in srgb, var(--cc-crimson) 70%, transparent); }

/* Buttons */
.cc-trader-btn {
  margin-top: 10px;
  font-family: inherit; font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  padding: 5px 14px; border-radius: 3px; cursor: pointer;
  background: transparent; color: var(--cc-fg);
  border: 1px solid color-mix(in srgb, var(--cc-border) 80%, transparent);
  opacity: 0.65; -webkit-appearance: none; appearance: none;
  transition: opacity 0.15s;
}
.cc-trader-btn:hover { opacity: 1; }
.cc-trader-btn:disabled { opacity: 0.25; cursor: not-allowed; }
.cc-trader-order-btn {
  font-family: inherit; font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  padding: 4px 12px; border-radius: 3px; cursor: pointer;
  background: transparent; color: var(--cc-fg);
  border: 1px solid color-mix(in srgb, var(--cc-border) 80%, transparent);
  opacity: 0.7; -webkit-appearance: none; appearance: none;
  transition: opacity 0.15s; margin-top: 0;
}
.cc-trader-order-btn:hover:not(:disabled) { opacity: 1; }
.cc-trader-order-btn:disabled {
  opacity: 0.2; cursor: not-allowed;
  border-color: color-mix(in srgb, var(--cc-crimson) 30%, transparent);
}
.cc-trader-order-btn--kill-msg {
  font-size: 9px; opacity: 0.4; letter-spacing: 0.08em; margin-left: 4px;
}

/* Paper-sim stat rows */
.cc-trader-stat-row {
  display: flex; justify-content: space-between;
  font-size: 11px; padding: 3px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--cc-border) 40%, transparent);
}
.cc-trader-stat-row:last-child { border-bottom: none; }
.cc-trader-stat-label { opacity: 0.5; letter-spacing: 0.06em; }
.cc-trader-stat-value { font-weight: 700; }
.cc-trader-stat-value--loss { color: var(--cc-crimson); }
.cc-trader-stat-value--gain { color: color-mix(in srgb, var(--cc-fg) 90%, transparent); }

/* Ledger feed */
.cc-trader-ledger-entry {
  font-size: 10px; padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--cc-border) 30%, transparent);
  letter-spacing: 0.05em; opacity: 0.7;
}
.cc-trader-ledger-entry:last-child { border-bottom: none; }
.cc-trader-ledger-ts { opacity: 0.45; font-size: 9px; }
`;
  document.head.appendChild(s);
}

// ── HTML template ────────────────────────────────────────────────────────────

export function buildTraderTab() {
  return `
<div class="cc-trader-tab" id="cc-trader-root">

  <!-- PHASE 2 banner -->
  <div class="cc-trader-notice cc-trader-notice--active">
    <div class="cc-trader-notice-title">TRADER — PHASE 2 &nbsp;·&nbsp; PAPER TRADING ACTIVE</div>
    <div class="cc-trader-notice-body">
      Paper-trading loop live: brief → candidate → simulated order → P&amp;L.
      100% simulated — no real exchange, no real money, no real key.
      Real-order submission begins in Phase 3 (≥300 paper trades required).
      Ref: docs/TRADER_AGENT_RISK_AND_PHASING.md §5.
    </div>
  </div>

  <!-- MODE — ModeFlagsCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">MODE</div>
    <div class="cc-trader-mode-flags">
      <span class="cc-trader-flag" title="Phase 1: data + briefs only">SIM</span>
      <span class="cc-trader-flag cc-trader-flag--current" title="Phase 2: paper trading active">DEMO</span>
      <span class="cc-trader-flag" title="Live funded wallet — Phase 3, human-gated">LIVE</span>
      <span class="cc-trader-flag" title="Bounded automation — Phase 4, conditional">AUTOMATED</span>
    </div>
    <div class="cc-trader-empty">PHASE 2 — DEMO &nbsp;·&nbsp; PAPER SIM ONLY &nbsp;·&nbsp; NO REAL ORDERS</div>
  </div>

  <!-- KILL SWITCH — live state from /api/trader/status -->
  <div class="cc-trader-card">
    <div class="cc-section-label">KILL SWITCH</div>
    <div class="cc-trader-kill-row">
      <span class="cc-trader-kill-dot" id="cc-trader-kill-dot"></span>
      <span class="cc-trader-kill-label" id="cc-trader-kill-label">LOADING…</span>
    </div>
    <div class="cc-trader-empty">Drop data/trader/KILL to halt all paper sessions immediately.</div>
    <div class="cc-trader-circuit-bar-wrap">
      <div class="cc-trader-circuit-bar" id="cc-trader-circuit-bar" style="width:0%"></div>
    </div>
    <div class="cc-trader-empty" id="cc-trader-circuit-label"></div>
  </div>

  <!-- MARKET DATA — Phase 1 live panel -->
  <div class="cc-trader-card">
    <div class="cc-section-label">MARKET DATA &nbsp;·&nbsp; ≥50¢ CONTRACTS</div>
    <div id="cc-trader-markets-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
  </div>

  <!-- WALLET — live paper state -->
  <div class="cc-trader-card">
    <div class="cc-section-label">WALLET</div>
    <div id="cc-trader-wallet-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
  </div>

  <!-- STRATEGY -->
  <div class="cc-trader-card">
    <div class="cc-section-label">STRATEGY</div>
    <div class="cc-trader-empty">KALSHI FAVOURITE-LONGSHOT BIAS</div>
    <div class="cc-trader-empty">Target: ≥50-cent contracts, +2.6% maker ROI, GWU 2026.</div>
  </div>

  <!-- POSITIONS & P&L — live paper state -->
  <div class="cc-trader-card">
    <div class="cc-section-label">POSITIONS AND P&L</div>
    <div id="cc-trader-positions-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
  </div>

  <!-- PAPER PERFORMANCE — Phase 2 stats -->
  <div class="cc-trader-card">
    <div class="cc-section-label">PAPER PERFORMANCE</div>
    <div id="cc-trader-stats-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
  </div>

  <!-- RESEARCH BRIEFS — click to expand candidate + paper-order form -->
  <div class="cc-trader-card">
    <div class="cc-section-label">RESEARCH BRIEFS</div>
    <div id="cc-trader-briefs-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
    <button class="cc-trader-btn" id="cc-trader-gen-btn" onclick="window._traderGenerateBriefs()">
      GENERATE BRIEFS
    </button>
  </div>

  <!-- APPROVAL GATE -->
  <div class="cc-trader-card">
    <div class="cc-section-label">APPROVAL GATE</div>
    <div class="cc-trader-gate-notice">
      HUMAN APPROVAL REQUIRED FOR ALL ORDERS<br>
      Every paper order is human-initiated — brief data cannot auto-trigger a trade.
      Every real-money order in Phase 3 is approval-gated — no automated execution.
    </div>
  </div>

  <!-- AUDIT LEDGER — hash-chained events -->
  <div class="cc-trader-card">
    <div class="cc-section-label">AUDIT LEDGER</div>
    <div id="cc-trader-ledger-body">
      <div class="cc-trader-empty">NO EVENTS</div>
    </div>
  </div>

</div>`.trim();
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _loadMarkets(el) {
  try {
    const res = await fetch('/api/trader/markets/threshold?limit=15');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const markets = data.markets || [];
    el.innerHTML = markets.length
      ? _renderMarketCards(markets)
      : '<div class="cc-trader-empty">NO MARKETS ABOVE 50¢ THRESHOLD</div>';
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">MARKET DATA UNAVAILABLE — ${_esc(e.message)}</div>`;
  }
}

async function _loadBriefs(el) {
  try {
    const res = await fetch('/api/trader/briefs?limit=10');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const briefs = data.briefs || [];
    el.innerHTML = briefs.length
      ? _renderBriefCards(briefs)
      : '<div class="cc-trader-empty">NO BRIEFS YET — CLICK GENERATE BRIEFS TO RUN A COUNCIL CYCLE</div>';
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">BRIEFS UNAVAILABLE — ${_esc(e.message)}</div>`;
  }
}

async function _loadStats(el) {
  try {
    const res = await fetch('/api/trader/paper/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    el.innerHTML = _renderStats(s);
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">STATS UNAVAILABLE — ${_esc(e.message)}</div>`;
  }
}

async function _loadPaperState(root) {
  try {
    const [sRes, lRes] = await Promise.all([
      fetch('/api/trader/status'),
      fetch('/api/trader/ledger?limit=10'),
    ]);
    if (sRes.ok) {
      const s = await sRes.json();
      _killArmed = !!s.kill_armed;
      _applyStatus(root, s);
    }
    if (lRes.ok) {
      _applyLedger(root, (await lRes.json()).entries || []);
    }
  } catch (_) {
    // Network errors are silent — static shell stands on its own
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function _renderMarketCards(markets) {
  const rows = markets.slice(0, 12).map(m => {
    const mid    = typeof m._midpoint === 'number' ? (m._midpoint * 100).toFixed(0) + '¢' : '—';
    const vol    = m.volume != null ? _fmtVol(m.volume) : '—';
    const title  = _esc(m.title || m.ticker || '');
    const ticker = _esc(m.ticker || '');
    return `<div class="cc-trader-market-row">
      <span class="cc-trader-market-ticker">${ticker}</span>
      <span class="cc-trader-market-title" title="${title}">${title}</span>
      <span class="cc-trader-market-mid">${mid}</span>
      <span class="cc-trader-market-vol">vol ${vol}</span>
    </div>`;
  });
  return `<div class="cc-trader-market-list">${rows.join('')}</div>`;
}

function _renderBriefCards(briefs) {
  const rows = briefs.slice(0, 8).map(b => {
    const dir      = _esc(b.direction || 'PASS');
    const conf     = b.confidence != null ? `${b.confidence}%` : '—';
    const rationale = _esc(b.rationale || '');
    const ticker   = _esc(b.contract_ticker || '');
    const ts       = b.created_at ? new Date(b.created_at).toLocaleString() : '';
    const briefId  = _esc(b.id || '');
    const canOrder = dir !== 'PASS' && briefId;
    return `<div class="cc-trader-brief-row" onclick="window._traderToggleCandidate('${briefId}', this)">
      <div class="cc-trader-brief-header">
        <span class="cc-trader-brief-ticker">${ticker}</span>
        <span class="cc-trader-brief-dir cc-trader-brief-dir--${dir}">${dir}</span>
        <span class="cc-trader-brief-conf">${conf}</span>
        ${canOrder ? '<span class="cc-trader-brief-conf" style="opacity:0.3">▸ PAPER ORDER</span>' : ''}
      </div>
      ${rationale ? `<div class="cc-trader-brief-rationale">${rationale}</div>` : ''}
      ${ts ? `<div class="cc-trader-brief-ts">${ts}</div>` : ''}
      <div id="cc-trader-candidate-${briefId}" style="display:none"></div>
    </div>`;
  });
  return `<div class="cc-trader-brief-list">${rows.join('')}</div>`;
}

function _renderStats(s) {
  const pnlDollars = (s.total_pnl_cents / 100).toFixed(2);
  const pnlSign    = s.total_pnl_cents >= 0 ? '+' : '';
  const pnlClass   = s.total_pnl_cents >= 0 ? 'cc-trader-stat-value--gain' : 'cc-trader-stat-value--loss';
  const capFill    = s.mandate_cap > 0 ? `${s.today_fills}/${s.mandate_cap}` : `${s.today_fills}`;

  return `
    <div class="cc-trader-stat-row">
      <span class="cc-trader-stat-label">TOTAL PAPER TRADES</span>
      <span class="cc-trader-stat-value">${s.total_trades}</span>
    </div>
    <div class="cc-trader-stat-row">
      <span class="cc-trader-stat-label">WIN RATE</span>
      <span class="cc-trader-stat-value">${s.win_rate_pct.toFixed(1)}%</span>
    </div>
    <div class="cc-trader-stat-row">
      <span class="cc-trader-stat-label">REALISED P&amp;L</span>
      <span class="cc-trader-stat-value ${pnlClass}">${pnlSign}$${pnlDollars}</span>
    </div>
    <div class="cc-trader-stat-row">
      <span class="cc-trader-stat-label">TODAY FILLS / CAP</span>
      <span class="cc-trader-stat-value">${capFill}</span>
    </div>
    <div class="cc-trader-stat-row">
      <span class="cc-trader-stat-label">CLV EQUIVALENT</span>
      <span class="cc-trader-stat-value">${s.clv_equivalent_pct.toFixed(1)}%</span>
    </div>`;
}

function _applyStatus(root, s) {
  const dot   = root.querySelector('#cc-trader-kill-dot');
  const label = root.querySelector('#cc-trader-kill-label');
  if (dot && s.kill_armed) {
    dot.classList.add('cc-trader-kill-dot--armed');
    if (label) label.textContent = 'ARMED — KILL SWITCH ACTIVE — ALL SESSIONS HALTED';
  } else if (dot && label) {
    label.textContent = s.mandate_ok
      ? 'READY — PAPER SIM ACTIVE'
      : `MANDATE ERROR — ${s.mandate_err || 'check data/trader/mandate.json'}`;
  }

  const bar  = root.querySelector('#cc-trader-circuit-bar');
  const clbl = root.querySelector('#cc-trader-circuit-label');
  const p    = s.paper;
  if (bar && p) {
    const pct = Math.min(p.circuit_used_pct || 0, 100);
    bar.style.width = pct + '%';
    if (pct >= 80) bar.classList.add('cc-trader-circuit-bar--warn');
    if (clbl) clbl.textContent = `CIRCUIT ${pct.toFixed(0)}% — ${p.circuit_cap_pct}% daily-loss cap`;
  }

  const wallet = root.querySelector('#cc-trader-wallet-body');
  if (wallet && p) {
    const fmt = v => '$' + v.toFixed(2);
    wallet.innerHTML = `
      <div class="cc-trader-stat-row">
        <span class="cc-trader-stat-label">PAPER BALANCE</span>
        <span class="cc-trader-stat-value">${fmt(p.balance)}</span>
      </div>
      <div class="cc-trader-stat-row">
        <span class="cc-trader-stat-label">OPEN EXPOSURE</span>
        <span class="cc-trader-stat-value">${fmt(p.open_exposure)}</span>
      </div>
      <div class="cc-trader-stat-row">
        <span class="cc-trader-stat-label">TODAY FILLS</span>
        <span class="cc-trader-stat-value">${p.today_fills} / ${p.mandate.max_trades_per_day}</span>
      </div>
      <div class="cc-trader-stat-row">
        <span class="cc-trader-stat-label">DAILY LOSS</span>
        <span class="cc-trader-stat-value${p.daily_loss > 0 ? ' cc-trader-stat-value--loss' : ''}">${fmt(p.daily_loss)}</span>
      </div>`;
  }

  const posEl = root.querySelector('#cc-trader-positions-body');
  if (posEl && p) {
    const open = p.open_trades || [];
    posEl.innerHTML = open.length === 0
      ? '<div class="cc-trader-empty">NO POSITIONS</div>'
      : open.map(t => `<div class="cc-trader-stat-row">
          <span class="cc-trader-stat-label">${_esc(t.contract)} · ${t.side.toUpperCase()} x${t.size}</span>
          <span class="cc-trader-stat-value">¢${t.fill_price_cents} entry</span>
        </div>`).join('');
  }
}

function _applyLedger(root, entries) {
  const el = root.querySelector('#cc-trader-ledger-body');
  if (!el) return;
  if (!entries || entries.length === 0) {
    el.innerHTML = '<div class="cc-trader-empty">NO EVENTS</div>';
    return;
  }
  el.innerHTML = entries.slice(0, 10).map(e => {
    const ts = e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '';
    return `<div class="cc-trader-ledger-entry">
      <span class="cc-trader-ledger-ts">${_esc(ts)}</span>
      &nbsp;${_esc(e.event_type.toUpperCase())}
    </div>`;
  }).join('');
}

// ── Brief expand → candidate → paper order ────────────────────────────────────

window._traderToggleCandidate = async function(briefId, rowEl) {
  const panel = rowEl.querySelector(`#cc-trader-candidate-${briefId}`);
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="cc-trader-loading" style="margin-top:6px">FETCHING LIVE PRICE…</div>';

  try {
    const res = await fetch(`/api/trader/briefs/${briefId}/candidates`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      panel.innerHTML = '<div class="cc-trader-empty" style="margin-top:4px">NO CANDIDATE — BRIEF DIRECTION IS PASS</div>';
      return;
    }
    panel.innerHTML = candidates.map(c => _renderCandidate(c, briefId)).join('');
  } catch (e) {
    panel.innerHTML = `<div class="cc-trader-error" style="margin-top:4px">CANDIDATE UNAVAILABLE — ${_esc(e.message)}</div>`;
  }
};

function _renderCandidate(c, briefId) {
  const ticker    = _esc(c.ticker || '');
  const side      = _esc(c.side || 'buy');
  const priceStr  = c.live_price_cents != null ? `¢${c.live_price_cents} live` : 'PRICE UNAVAILABLE';
  const priceCents = c.live_price_cents != null ? c.live_price_cents : 0;
  const disabled  = _killArmed || priceCents === 0 ? 'disabled' : '';
  const killMsg   = _killArmed ? '<span class="cc-trader-order-btn--kill-msg">KILL SWITCH ARMED</span>' : '';
  const formId    = `order-form-${briefId}`;

  return `<div class="cc-trader-candidate">
    <div class="cc-trader-candidate-price">${ticker} · ${side.toUpperCase()} · ${priceStr}</div>
    <div class="cc-trader-order-row">
      <span style="font-size:9px;opacity:0.5;letter-spacing:0.08em">SIZE</span>
      <input type="number" class="cc-trader-size-input" id="${formId}-size"
        value="1" min="1" max="100" step="1">
      <button class="cc-trader-order-btn" ${disabled}
        onclick="window._traderPlaceOrder('${briefId}', '${_esc(c.ticker || '')}', '${side}', ${priceCents}, '${formId}')">
        PLACE PAPER ${side.toUpperCase()}
      </button>
      ${killMsg}
    </div>
    <div id="${formId}-result" style="font-size:9px;margin-top:4px;opacity:0.6;letter-spacing:0.08em"></div>
  </div>`;
}

window._traderPlaceOrder = async function(briefId, ticker, side, priceCents, formId) {
  // Human-initiated only: this function is called exclusively by the owner
  // clicking the PLACE PAPER button. Brief/market data cannot call this.
  if (_killArmed) {
    const r = document.getElementById(`${formId}-result`);
    if (r) r.textContent = 'BLOCKED — KILL SWITCH ARMED';
    return;
  }

  const sizeEl  = document.getElementById(`${formId}-size`);
  const resultEl = document.getElementById(`${formId}-result`);
  if (!sizeEl || !resultEl) return;

  const size = Math.max(1, parseInt(sizeEl.value, 10) || 1);
  resultEl.textContent = 'SUBMITTING…';

  try {
    const res = await fetch('/api/trader/paper/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract:    ticker,
        side:        side,
        size:        size,
        price_cents: priceCents,
        balance:     100.0,    // default paper balance
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      resultEl.textContent = `REJECTED — ${body.detail || res.status}`;
      return;
    }
    resultEl.textContent = `PLACED — trade ${(body.id || '').slice(0, 8)}`;

    // Refresh wallet + positions + ledger + stats
    const root = document.getElementById('cc-trader-root');
    if (root) {
      await _loadPaperState(root);
      const statsEl = root.querySelector('#cc-trader-stats-body');
      if (statsEl) await _loadStats(statsEl);
    }
  } catch (e) {
    resultEl.textContent = `ERROR — ${_esc(e.message)}`;
  }
};

// ── Generate briefs ────────────────────────────────────────────────────────────

window._traderGenerateBriefs = async function() {
  const btn = document.getElementById('cc-trader-gen-btn');
  const el  = document.getElementById('cc-trader-briefs-body');
  if (!el) return;
  if (btn) { btn.disabled = true; btn.textContent = 'GENERATING…'; }
  el.innerHTML = '<div class="cc-trader-loading">RUNNING COUNCIL DEBATE…</div>';
  try {
    const res = await fetch('/api/trader/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    await _loadBriefs(el);
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">BRIEF GENERATION FAILED — ${_esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'GENERATE BRIEFS'; }
  }
};

// ── Entry point ───────────────────────────────────────────────────────────────

export function loadTrader(root) {
  if (!root) return;
  _ensureStyles();

  if (!window._isAdmin) {
    const wrapper = root.querySelector('#cc-trader-root');
    if (wrapper) wrapper.innerHTML =
      '<div class="cc-trader-access-denied">ADMIN ACCESS REQUIRED</div>';
    return;
  }

  // Phase 1: market data + research briefs
  const marketsEl = root.querySelector('#cc-trader-markets-body');
  const briefsEl  = root.querySelector('#cc-trader-briefs-body');
  if (marketsEl) _loadMarkets(marketsEl);
  if (briefsEl)  _loadBriefs(briefsEl);

  // Phase 2: kill switch + paper wallet + positions + ledger + stats
  const statsEl = root.querySelector('#cc-trader-stats-body');
  _loadPaperState(root);
  if (statsEl) _loadStats(statsEl);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtVol(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}
