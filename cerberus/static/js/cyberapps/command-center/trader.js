/**
 * trader.js — TRADER tab: Phase 1 data + research briefs.
 *
 * Phase 1 live panels (T1):
 *   MARKET DATA — live Kalshi ≥50¢ contracts from /api/trader/markets/threshold
 *   RESEARCH BRIEFS — Council-generated briefs from /api/trader/briefs
 *
 * Static panels owned by T2 (paper-trading phase):
 *   WALLET · POSITIONS & P&L
 *
 * Static informational panels (unchanged):
 *   MODE · KILL SWITCH · STRATEGY · APPROVAL GATE · AUDIT LEDGER
 *
 * Admin-only: loadTrader() shows access-denied for non-admins.
 * Activation path: docs/TRADER_AGENT_RISK_AND_PHASING.md
 */

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
.cc-trader-notice--active .cc-trader-notice-title {
  color: var(--cc-fg);
  opacity: 0.8;
}
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
.cc-trader-kill-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: color-mix(in srgb, var(--cc-fg) 25%, transparent); }
.cc-trader-kill-label { opacity: 0.55; letter-spacing: 0.06em; }

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
.cc-trader-market-mid {
  font-weight: 700; letter-spacing: 0.06em; min-width: 40px; text-align: right;
  color: color-mix(in srgb, var(--cc-fg) 85%, transparent);
}
.cc-trader-market-vol { opacity: 0.4; font-size: 9px; min-width: 50px; text-align: right; }

/* Brief cards */
.cc-trader-brief-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.cc-trader-brief-row {
  padding: 8px 10px; border-radius: 4px;
  background: color-mix(in srgb, var(--cc-fg) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border) 60%, transparent);
  font-size: 10px;
}
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

/* Loading / error states */
.cc-trader-loading { font-size: 10px; opacity: 0.4; padding: 6px 0; letter-spacing: 0.1em; }
.cc-trader-error { font-size: 10px; padding: 6px 0; letter-spacing: 0.08em; color: color-mix(in srgb, var(--cc-crimson) 70%, transparent); }

/* Generate button */
.cc-trader-btn {
  margin-top: 10px;
  font-family: inherit; font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  padding: 5px 14px; border-radius: 3px; cursor: pointer;
  background: transparent; color: var(--cc-fg);
  border: 1px solid color-mix(in srgb, var(--cc-border) 80%, transparent);
  opacity: 0.65;
  -webkit-appearance: none; appearance: none;
  transition: opacity 0.15s;
}
.cc-trader-btn:hover { opacity: 1; }
.cc-trader-btn:disabled { opacity: 0.25; cursor: not-allowed; }
`;
  document.head.appendChild(s);
}

export function buildTraderTab() {
  return `
<div class="cc-trader-tab" id="cc-trader-root">

  <!-- PHASE 1 banner -->
  <div class="cc-trader-notice cc-trader-notice--active">
    <div class="cc-trader-notice-title">TRADER — PHASE 1 &nbsp;·&nbsp; DATA + BRIEFS ACTIVE</div>
    <div class="cc-trader-notice-body">
      Market data and research briefs are live. No trading is connected —
      order submission begins in Phase 3 after ≥300 paper-trade forward tests (Phase 2).
      All briefs are advisory only. Ref: docs/TRADER_AGENT_RISK_AND_PHASING.md.
    </div>
  </div>

  <!-- MODE — ModeFlagsCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">MODE</div>
    <div class="cc-trader-mode-flags">
      <span class="cc-trader-flag cc-trader-flag--current" title="Phase 1: data + briefs, no trading">SIM</span>
      <span class="cc-trader-flag" title="Demo mode — Phase 2 paper trading">DEMO</span>
      <span class="cc-trader-flag" title="Live funded wallet — Phase 3, human-gated">LIVE</span>
      <span class="cc-trader-flag" title="Bounded automation — Phase 4, conditional">AUTOMATED</span>
    </div>
    <div class="cc-trader-empty">PHASE 1 — SIM &nbsp;·&nbsp; DATA + BRIEFS ONLY &nbsp;·&nbsp; NO ORDER CODE</div>
  </div>

  <!-- KILL SWITCH — KillSwitchCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">KILL SWITCH</div>
    <div class="cc-trader-kill-row">
      <span class="cc-trader-kill-dot"></span>
      <span class="cc-trader-kill-label">ARMED &nbsp;·&nbsp; NO ACTIVE TRADING</span>
    </div>
    <div class="cc-trader-empty">Drop data/trader/KILL to halt any future session immediately.</div>
  </div>

  <!-- MARKET DATA — Phase 1 live panel (T1) -->
  <div class="cc-trader-card">
    <div class="cc-section-label">MARKET DATA &nbsp;·&nbsp; ≥50¢ CONTRACTS</div>
    <div id="cc-trader-markets-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
  </div>

  <!-- WALLET — T2 panel, do not modify -->
  <div class="cc-trader-card">
    <div class="cc-section-label">WALLET</div>
    <div class="cc-trader-empty">NO WALLET CONNECTED</div>
    <div class="cc-trader-empty">Max loss = funded wallet balance. No bank credentials. Trade-only API keys.</div>
  </div>

  <!-- STRATEGY — StrategyCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">STRATEGY</div>
    <div class="cc-trader-empty">KALSHI FAVOURITE-LONGSHOT BIAS</div>
    <div class="cc-trader-empty">Target: ≥50-cent contracts, +2.6% maker ROI, GWU 2026. Phase 1 validates data pipeline.</div>
  </div>

  <!-- POSITIONS & P&L — T2 panel, do not modify -->
  <div class="cc-trader-card">
    <div class="cc-section-label">POSITIONS AND P&L</div>
    <div class="cc-trader-empty">NO POSITIONS — PAPER TRADING BEGINS IN PHASE 2</div>
    <div class="cc-trader-empty">Phase 2 requires ≥300 live forward-test trades before Phase 3 gate.</div>
  </div>

  <!-- RESEARCH BRIEFS — Phase 1 live panel (T1) -->
  <div class="cc-trader-card">
    <div class="cc-section-label">RESEARCH BRIEFS</div>
    <div id="cc-trader-briefs-body">
      <div class="cc-trader-loading">LOADING…</div>
    </div>
    <button class="cc-trader-btn" id="cc-trader-gen-btn" onclick="window._traderGenerateBriefs()">
      GENERATE BRIEFS
    </button>
  </div>

  <!-- APPROVAL GATE — GateCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">APPROVAL GATE</div>
    <div class="cc-trader-gate-notice">
      HUMAN APPROVAL REQUIRED FOR ALL ORDERS<br>
      Every real-money order in Phase 3 is approval-gated — no automated execution.
      Untrusted content (news, gateway messages, notes) cannot trigger or approve a trade.
    </div>
  </div>

  <!-- AUDIT LEDGER — AuditFeedCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">AUDIT LEDGER</div>
    <div class="cc-trader-empty">NO EVENTS</div>
    <div class="cc-trader-empty">Every proposal, approval, rejection, and trade will be logged here.</div>
  </div>

</div>`.trim();
}

// ── Data loading ────────────────────────────────────────────────────────────

async function _loadMarkets(el) {
  try {
    const res = await fetch('/api/trader/markets/threshold?limit=15');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const markets = data.markets || [];
    el.innerHTML = markets.length ? _renderMarketCards(markets) : '<div class="cc-trader-empty">NO MARKETS ABOVE 50¢ THRESHOLD</div>';
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">MARKET DATA UNAVAILABLE — ${e.message}</div>`;
  }
}

async function _loadBriefs(el) {
  try {
    const res = await fetch('/api/trader/briefs?limit=10');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const briefs = data.briefs || [];
    el.innerHTML = briefs.length ? _renderBriefCards(briefs) : '<div class="cc-trader-empty">NO BRIEFS YET — CLICK GENERATE BRIEFS TO RUN A COUNCIL CYCLE</div>';
  } catch (e) {
    el.innerHTML = `<div class="cc-trader-error">BRIEFS UNAVAILABLE — ${e.message}</div>`;
  }
}

function _renderMarketCards(markets) {
  const rows = markets.slice(0, 12).map(m => {
    const mid = typeof m._midpoint === 'number' ? (m._midpoint * 100).toFixed(0) + '¢' : '—';
    const vol = m.volume != null ? _fmtVol(m.volume) : '—';
    const title = _esc(m.title || m.ticker || '');
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
    const dir = _esc(b.direction || 'PASS');
    const conf = b.confidence != null ? `${b.confidence}%` : '—';
    const rationale = _esc(b.rationale || '');
    const ticker = _esc(b.contract_ticker || '');
    const ts = b.created_at ? new Date(b.created_at).toLocaleString() : '';
    return `<div class="cc-trader-brief-row">
      <div class="cc-trader-brief-header">
        <span class="cc-trader-brief-ticker">${ticker}</span>
        <span class="cc-trader-brief-dir cc-trader-brief-dir--${dir}">${dir}</span>
        <span class="cc-trader-brief-conf">${conf}</span>
      </div>
      ${rationale ? `<div class="cc-trader-brief-rationale">${rationale}</div>` : ''}
      ${ts ? `<div class="cc-trader-brief-ts">${ts}</div>` : ''}
    </div>`;
  });
  return `<div class="cc-trader-brief-list">${rows.join('')}</div>`;
}

// ── Public API (called by generate button and loadTrader) ───────────────────

window._traderGenerateBriefs = async function() {
  const btn = document.getElementById('cc-trader-gen-btn');
  const el = document.getElementById('cc-trader-briefs-body');
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

export function loadTrader(root) {
  if (!root) return;
  _ensureStyles();

  if (!window._isAdmin) {
    const wrapper = root.querySelector('#cc-trader-root');
    if (wrapper) wrapper.innerHTML =
      '<div class="cc-trader-access-denied">ADMIN ACCESS REQUIRED</div>';
    return;
  }

  const marketsEl = root.querySelector('#cc-trader-markets-body');
  const briefsEl = root.querySelector('#cc-trader-briefs-body');
  if (marketsEl) _loadMarkets(marketsEl);
  if (briefsEl) _loadBriefs(briefsEl);
}

// ── Utilities ───────────────────────────────────────────────────────────────

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
