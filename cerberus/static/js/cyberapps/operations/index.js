/**
 * static/js/cyberapps/operations/index.js
 *
 * Operations — real-time JARVIS-aesthetic overview of Cerberus + CyberOS.
 * Replaces the deprecated Command Center landing experience.
 *
 * Self-registers with window.CYBER_APPS_REGISTRY with priority: 'first'
 * so it always appears as the leftmost pill.
 */

import { createOrb, updateOrb }                   from './orb.js';
import { createDials, updateDial }                 from './dials.js';
import { createSparklines, updateSparklines }      from './sparklines.js';
import { createAgentsTable, updateAgentsTable }    from './agents.js';
import * as Poll                                   from './poll.js';

// Inject CSS
(function injectCSS() {
  const id = 'ops-styles-link';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = '/static/js/cyberapps/operations/styles.css';
  document.head.appendChild(link);
})();

// -------------------------------------------------------------------------
// Module-level state
// -------------------------------------------------------------------------
let _container = null;
let _orbWrap   = null;
let _dialsEl   = null;
let _sparklinesEl = null;
let _agentsEl  = null;
let _clockTimer = null;

// -------------------------------------------------------------------------
// Shell template
// -------------------------------------------------------------------------
function _buildShell(container) {
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'ops-shell';

  // Header
  shell.innerHTML = `
    <div class="ops-header">
      <span class="ops-title">Operations</span>
      <span class="ops-clock" id="ops-clock">--:--:-- --</span>
      <button class="ops-refresh-btn" id="ops-refresh">REFRESH</button>
    </div>

    <div class="ops-top-row">
      <!-- Orb card -->
      <div class="ops-card" id="ops-orb-card">
        <div class="ops-card-title">Cerberus Core</div>
        <div id="ops-orb-mount"></div>
      </div>

      <!-- Swarm card -->
      <div class="ops-card">
        <div class="ops-card-title">Swarm Health</div>
        <div class="ops-swarm-grid">
          <div>
            <div class="ops-swarm-num" id="sw-active">—</div>
            <div class="ops-swarm-lbl">Active</div>
          </div>
          <div>
            <div class="ops-swarm-num" id="sw-total">—</div>
            <div class="ops-swarm-lbl">Total</div>
          </div>
          <div>
            <div class="ops-swarm-num" id="sw-queued">—</div>
            <div class="ops-swarm-lbl">Running</div>
          </div>
        </div>
      </div>

      <!-- Vitals card -->
      <div class="ops-card">
        <div class="ops-card-title">System Vitals</div>
        <div class="ops-vitals-row" id="ops-dials"></div>
      </div>
    </div>

    <!-- Telemetry -->
    <div class="ops-telemetry">
      <div class="ops-telemetry-header">
        <span>Telemetry Feed</span>
      </div>
      <div id="ops-sparklines"></div>
    </div>

    <!-- Agents -->
    <div class="ops-agents">
      <div class="ops-agents-header">Active Tasks / Agents</div>
      <div id="ops-agents-table"></div>
    </div>
  `.trim();

  container.appendChild(shell);
  _container = container;
}

// -------------------------------------------------------------------------
// Clock
// -------------------------------------------------------------------------
function _startClock() {
  const el = document.getElementById('ops-clock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
  };
  tick();
  _clockTimer = setInterval(tick, 1000);
}

// -------------------------------------------------------------------------
// Orb state derivation
// -------------------------------------------------------------------------
function _orbStateFromSwarm(swarm) {
  if (!swarm) return 'offline';
  if (swarm.status === 'DEGRADED') return 'degraded';
  if (swarm.status === 'ACTIVE' || swarm.queued > 0) return 'active';
  if (swarm.active > 0) return 'idle';
  return 'offline';
}

// -------------------------------------------------------------------------
// Vitals update
// -------------------------------------------------------------------------
function _applyVitals(v) {
  if (!_dialsEl) return;
  updateDial(_dialsEl, 'cpu',     v.cpu_percent,  `${v.cpu_percent < 0 ? '—' : v.cpu_percent + '%'}`);
  updateDial(_dialsEl, 'ram',     v.ram_percent,  `${v.ram_percent < 0 ? '—' : v.ram_percent + '%'}`);
  updateDial(_dialsEl, 'disk',    v.disk_percent, `${v.disk_percent < 0 ? '—' : v.disk_percent + '%'}`);
  updateDial(_dialsEl, 'latency', v.latency_ms,   `${v.latency_ms < 0  ? '—' : v.latency_ms + 'ms'}`);
}

// -------------------------------------------------------------------------
// Swarm update
// -------------------------------------------------------------------------
function _applySwarm(sw) {
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val != null ? val : '—';
  };
  setEl('sw-active', sw.active);
  setEl('sw-total',  sw.total);
  setEl('sw-queued', sw.queued);

  if (_orbWrap) updateOrb(_orbWrap, _orbStateFromSwarm(sw));
}

// -------------------------------------------------------------------------
// init / destroy (CyberAppContext contract)
// -------------------------------------------------------------------------
export function init(container, ctx) {
  _buildShell(container);

  // Wire sub-components
  _orbWrap      = createOrb(document.getElementById('ops-orb-mount'));
  _dialsEl      = document.getElementById('ops-dials');
  _sparklinesEl = document.getElementById('ops-sparklines');
  _agentsEl     = document.getElementById('ops-agents-table');

  if (_dialsEl)      createDials(_dialsEl);
  if (_sparklinesEl) createSparklines(_sparklinesEl);
  if (_agentsEl)     createAgentsTable(_agentsEl);

  _startClock();

  // Manual refresh button
  const refreshBtn = document.getElementById('ops-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      Poll.destroy();
      Poll.start(_callbacks());
    });
  }

  // Start polling
  Poll.start(_callbacks());
}

export function destroy() {
  Poll.destroy();
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
  _container = _orbWrap = _dialsEl = _sparklinesEl = _agentsEl = null;
}

function _callbacks() {
  return {
    onVitals(v)      { _applyVitals(v); },
    onTimeseries(ts) { if (_sparklinesEl) updateSparklines(_sparklinesEl, ts); },
    onSwarm(sw)      { _applySwarm(sw); },
    onAgents(agents) { if (_agentsEl) updateAgentsTable(_agentsEl, agents); },
    onError(e)       { console.warn('[Operations] poll error:', e); },
  };
}

// -------------------------------------------------------------------------
// Self-register with priority: 'first'
// -------------------------------------------------------------------------
const SHIELD_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2L3 6V12C3 17.5 7 22 12 24C17 22 21 17.5 21 12V6Z"/>
  <line x1="9" y1="12" x2="11.5" y2="15" stroke="currentColor" stroke-width="1.6"/>
  <line x1="11.5" y1="15" x2="16" y2="10" stroke="currentColor" stroke-width="1.6"/>
</svg>`.trim();

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.unshift({
    id:       'operations',
    name:     'Operations',
    icon:     SHIELD_ICON,
    init,
    destroy,
    vault:    false,
    priority: 'first',
  });
}
