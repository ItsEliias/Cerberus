/**
 * finance.js — FINANCE sub-tab.
 *
 * STUB ONLY. No financial data source exists in Cerberus.
 * All numbers are placeholders — clearly marked "(no data source connected)".
 * The JARVIS aesthetic is maintained; numbers are greyed-out to signal stub state.
 */

export function buildFinanceTab() {
  return `<div class="cc-finance-tab">
    <div class="cc-finance-stub-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span class="jx-no-data-badge">(no data source connected)</span>
      <span style="font-size:10px;opacity:0.7;margin-left:8px;">Finance tab is a placeholder. Connect a financial data source to populate real metrics.</span>
    </div>

    <div class="cc-section-header">Finance Overview</div>
    <div class="cc-finance-stub-grid">
      <div class="cc-finance-stub-card">
        <div class="cc-finance-stub-label">Portfolio Value</div>
        <div class="cc-finance-stub-val">$—</div>
      </div>
      <div class="cc-finance-stub-card">
        <div class="cc-finance-stub-label">24h P&amp;L</div>
        <div class="cc-finance-stub-val">$—</div>
      </div>
      <div class="cc-finance-stub-card">
        <div class="cc-finance-stub-label">Open Positions</div>
        <div class="cc-finance-stub-val">—</div>
      </div>
    </div>

    <div class="cc-section-header">Market Sparklines</div>
    <div class="cc-finance-stub-grid">
      ${['BTC/USD','ETH/USD','SPY'].map(sym => `
        <div class="cc-finance-stub-card">
          <div class="cc-finance-stub-label">${sym}</div>
          <div class="cc-finance-spark-placeholder">(no source)</div>
        </div>`).join('')}
    </div>
  </div>`;
}

// No async load needed — all stub
export function loadFinance(_root) {}
