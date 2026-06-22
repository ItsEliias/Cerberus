/**
 * trader.js — TRADER tab: inactive design-stage shell.
 *
 * NO trading logic, NO live data, NO API calls, NO money.
 * This is a visual placeholder so future trading work has a home in the CC.
 *
 * Panels mirror the apex-bento dashboard layout:
 *   MODE (ModeFlagsCard) · KILL SWITCH (KillSwitchCard) · WALLET
 *   STRATEGY (StrategyCard) · POSITIONS & P&L · RESEARCH BRIEFS
 *   APPROVAL GATE (GateCard) · AUDIT LEDGER (AuditFeedCard)
 *
 * Activation path: docs/TRADER_AGENT_RISK_AND_PHASING.md (phasing plan).
 * Admin-only: loadTrader() shows an access-denied state for non-admins.
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

/* NOT-YET-ACTIVE top banner */
.cc-trader-notice {
  background: color-mix(in srgb, var(--cc-crimson) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-crimson) 40%, transparent);
  border-radius: 4px;
  padding: 12px 16px;
  font-size: 10px;
  letter-spacing: 0.14em;
  line-height: 1.7;
}
.cc-trader-notice-title {
  color: var(--cc-crimson);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.18em;
  margin-bottom: 4px;
}
.cc-trader-notice-body {
  opacity: 0.65;
}

/* Card (HudCard equivalent) */
.cc-trader-card {
  background: var(--cc-void-mid);
  border: 1px solid var(--cc-border);
  border-radius: 6px;
  padding: 14px 16px;
}

/* Empty-state text */
.cc-trader-empty {
  font-size: 11px;
  opacity: 0.38;
  padding: 6px 0 2px;
  letter-spacing: 0.08em;
}

/* MODE flags row */
.cc-trader-mode-flags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.cc-trader-flag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  padding: 4px 10px;
  border-radius: 3px;
  border: 1px solid var(--cc-border);
  color: var(--cc-fg);
  opacity: 0.3;
  -webkit-appearance: none;
  appearance: none;
}
.cc-trader-flag--current {
  opacity: 0.8;
  border-color: color-mix(in srgb, var(--cc-fg) 40%, transparent);
  color: var(--cc-fg);
}

/* Kill switch row */
.cc-trader-kill-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  font-size: 11px;
}
.cc-trader-kill-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--cc-fg) 25%, transparent);
}
.cc-trader-kill-label {
  opacity: 0.55;
  letter-spacing: 0.06em;
}

/* Approval gate notice */
.cc-trader-gate-notice {
  margin-top: 10px;
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1.65;
  opacity: 0.55;
}

/* Admin access denied */
.cc-trader-access-denied {
  padding: 24px 16px;
  font-size: 10px;
  letter-spacing: 0.14em;
  opacity: 0.45;
  text-align: center;
}
`;
  document.head.appendChild(s);
}

export function buildTraderTab() {
  return `
<div class="cc-trader-tab" id="cc-trader-root">

  <!-- NOT-YET-ACTIVE banner -->
  <div class="cc-trader-notice">
    <div class="cc-trader-notice-title">TRADER — NOT YET ACTIVE</div>
    <div class="cc-trader-notice-body">
      Design-stage shell only. No data is connected, no trades are possible,
      no live service exists. This tab is a placeholder for the phased trading
      system described in docs/TRADER_AGENT_RISK_AND_PHASING.md.
      Phase 1 (data layer) has not yet begun.
    </div>
  </div>

  <!-- MODE — ModeFlagsCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">MODE</div>
    <div class="cc-trader-mode-flags">
      <span class="cc-trader-flag cc-trader-flag--current" title="Current state: design phase">SIM</span>
      <span class="cc-trader-flag" title="Demo mode — Phase 2 paper trading">DEMO</span>
      <span class="cc-trader-flag" title="Live funded wallet — Phase 3, human-gated">LIVE</span>
      <span class="cc-trader-flag" title="Bounded automation — Phase 4, conditional">AUTOMATED</span>
    </div>
    <div class="cc-trader-empty">PHASE 0 — DESIGN STAGE &nbsp;·&nbsp; SIM IS THE ONLY VALID STATE</div>
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

  <!-- WALLET -->
  <div class="cc-trader-card">
    <div class="cc-section-label">WALLET</div>
    <div class="cc-trader-empty">NO WALLET CONNECTED</div>
    <div class="cc-trader-empty">Max loss = funded wallet balance. No bank credentials. Trade-only API keys.</div>
  </div>

  <!-- STRATEGY — StrategyCard -->
  <div class="cc-trader-card">
    <div class="cc-section-label">STRATEGY</div>
    <div class="cc-trader-empty">NO STRATEGY LOADED</div>
    <div class="cc-trader-empty">Target: Kalshi favourite-longshot bias (≥50-cent contracts, +2.6% maker ROI, GWU 2026).</div>
  </div>

  <!-- POSITIONS & P&L -->
  <div class="cc-trader-card">
    <div class="cc-section-label">POSITIONS AND P&L</div>
    <div class="cc-trader-empty">NO POSITIONS — PAPER TRADING BEGINS IN PHASE 2</div>
    <div class="cc-trader-empty">Phase 2 requires ≥300 live forward-test trades before Phase 3 gate.</div>
  </div>

  <!-- RESEARCH BRIEFS -->
  <div class="cc-trader-card">
    <div class="cc-section-label">RESEARCH BRIEFS</div>
    <div class="cc-trader-empty">NO BRIEFS YET — PHASE 1 DELIVERABLE</div>
    <div class="cc-trader-empty">Phase 1: Council agent produces market briefs; quality assessed against real outcomes.</div>
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

export function loadTrader(root) {
  // Inactive shell — data wiring lands in Phase 1+ per docs/TRADER_AGENT_*.md
  if (!root) return;
  _ensureStyles();
  if (!window._isAdmin) {
    const wrapper = root.querySelector('#cc-trader-root');
    if (wrapper) wrapper.innerHTML =
      '<div class="cc-trader-access-denied">ADMIN ACCESS REQUIRED</div>';
  }
}
