/**
 * VaultCore — Cerberus native app entry point.
 *
 * Implements the CyberAppContext contract:
 *   init(container, ctx)  — render app into container
 *   destroy()             — clean up listeners / timers
 *
 * VaultCore is the centralized vault orchestration and scraping engine.
 * Features: Source Library, Scrape Jobs, Vault Health, Logs, Settings.
 *
 * Vault flow:
 *   1. Check /api/cyberapps/vault/status.
 *   2a. Not initialized → show CyberLab redirect message.
 *   2b. Initialized but locked → show unlock form.
 *   3. On unlock success → call window.CyberApps.notifyVaultUnlocked().
 *   4. Render full app.
 */

import { renderVaultGate } from './vault.js';
import { renderSources }   from './sources.js';
import { renderScrape }    from './scrape.js';
import { renderHealth }    from './health.js';
import { renderLogs }      from './logs.js';
import { renderSettings }  from './settings.js';

const API = '';
let _container  = null;
let _ctx        = null;
let _vaultToken = null;
let _activeTab  = 'scrape';

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

export function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  _checkVaultAndRender();
}

export function destroy() {
  _container = null;
  _ctx = null;
}

// -----------------------------------------------------------------------
// Vault gate
// -----------------------------------------------------------------------

async function _checkVaultAndRender() {
  try {
    const res = await fetch(`${API}/api/cyberapps/vault/status`);
    const data = await res.json();
    if (!data.initialized) {
      renderVaultGate(_container, 'setup', _onVaultUnlocked);
    } else if (data.locked) {
      renderVaultGate(_container, 'unlock', _onVaultUnlocked);
    } else {
      _vaultToken = sessionStorage.getItem('vc-vault-token') || null;
      _renderApp();
    }
  } catch (err) {
    _container.innerHTML = `<div class="vc-error">Failed to reach Cerberus backend: ${_esc(String(err))}</div>`;
  }
}

function _onVaultUnlocked(token) {
  _vaultToken = token;
  sessionStorage.setItem('vc-vault-token', token);
  if (window.CyberApps && window.CyberApps.notifyVaultUnlocked) {
    window.CyberApps.notifyVaultUnlocked();
  }
  _renderApp();
}

// -----------------------------------------------------------------------
// App shell
// -----------------------------------------------------------------------

function _renderApp() {
  if (!_container) return;
  _container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'vc-shell';
  shell.innerHTML = `
    <div class="vc-header">
      <div class="vc-header-left">
        <span class="vc-logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
        </span>
        <span class="vc-title">VaultCore</span>
      </div>
    </div>
    <nav class="vc-tabs" role="tablist">
      ${_tabBtn('scrape', 'Scrape')}
      ${_tabBtn('sources', 'Sources')}
      ${_tabBtn('health', 'Health')}
      ${_tabBtn('logs', 'Logs')}
      ${_tabBtn('settings', 'Settings')}
    </nav>
    <div class="vc-body" id="vc-body"></div>
  `;

  _container.appendChild(shell);
  _injectStyles();

  shell.querySelectorAll('.vc-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
  });

  _switchTab(_activeTab);
}

function _tabBtn(id, label) {
  return `<button class="vc-tab-btn${id === _activeTab ? ' active' : ''}" data-tab="${id}" role="tab">${label}</button>`;
}

function _switchTab(tab) {
  _activeTab = tab;
  const body = document.getElementById('vc-body');
  if (!body) return;
  body.innerHTML = '';

  document.querySelectorAll('.vc-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  switch (tab) {
    case 'scrape':   renderScrape(body); break;
    case 'sources':  renderSources(body); break;
    case 'health':   renderHealth(body); break;
    case 'logs':     renderLogs(body); break;
    case 'settings': renderSettings(body, _onLockVault); break;
  }
}

// -----------------------------------------------------------------------
// Vault lock
// -----------------------------------------------------------------------

function _onLockVault() {
  fetch(`${API}/api/cyberapps/vault/lock`, { method: 'POST' });
  _vaultToken = null;
  sessionStorage.removeItem('vc-vault-token');
  _checkVaultAndRender();
}

// -----------------------------------------------------------------------
// Escape helper
// -----------------------------------------------------------------------

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// -----------------------------------------------------------------------
// Inline styles
// -----------------------------------------------------------------------

function _injectStyles() {
  if (document.getElementById('vc-styles')) return;
  const style = document.createElement('style');
  style.id = 'vc-styles';
  style.textContent = `
    .vc-shell { display:flex; flex-direction:column; height:100%; background:var(--bg,#1a1d23); color:var(--fg,#c5c9d0); font-family:inherit; }
    .vc-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border,#3a2a2a); flex-shrink:0; }
    .vc-header-left { display:flex; align-items:center; gap:8px; }
    .vc-logo-icon { color:var(--red,#c0392b); }
    .vc-title { font-weight:600; font-size:14px; letter-spacing:.5px; }
    .vc-tabs { display:flex; gap:2px; padding:6px 10px 0; border-bottom:1px solid var(--border,#3a2a2a); flex-shrink:0; overflow-x:auto; scrollbar-width:none; }
    .vc-tabs::-webkit-scrollbar { display:none; }
    .vc-tab-btn { background:none; border:none; color:var(--fg,#c5c9d0); opacity:.6; font-size:12px; padding:5px 10px; cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; white-space:nowrap; }
    .vc-tab-btn:hover { opacity:1; }
    .vc-tab-btn.active { opacity:1; color:var(--red,#c0392b); border-bottom-color:var(--red,#c0392b); }
    .vc-body { flex:1; overflow-y:auto; padding:12px; }
    .vc-btn { border:none; cursor:pointer; border-radius:4px; font-size:12px; padding:5px 10px; transition:all .15s; }
    .vc-btn-primary { background:var(--red,#c0392b); color:#fff; }
    .vc-btn-primary:hover { opacity:.85; }
    .vc-btn-ghost { background:transparent; color:var(--fg,#c5c9d0); border:1px solid var(--border,#3a2a2a); }
    .vc-btn-ghost:hover { background:rgba(255,255,255,.06); }
    .vc-btn-danger { background:rgba(192,57,43,.18); color:var(--red,#c0392b); border:1px solid rgba(192,57,43,.3); }
    .vc-btn-danger:hover { background:rgba(192,57,43,.3); }
    .vc-btn:disabled { opacity:.45; cursor:not-allowed; }
    .vc-input { background:rgba(255,255,255,.05); border:1px solid var(--border,#3a2a2a); color:var(--fg,#c5c9d0); border-radius:4px; padding:6px 9px; font-size:12px; width:100%; box-sizing:border-box; }
    .vc-input:focus { outline:none; border-color:var(--red,#c0392b); }
    .vc-select { background:rgba(255,255,255,.05); border:1px solid var(--border,#3a2a2a); color:var(--fg,#c5c9d0); border-radius:4px; padding:6px 9px; font-size:12px; }
    .vc-select:focus { outline:none; border-color:var(--red,#c0392b); }
    .vc-label { font-size:11px; opacity:.65; margin-bottom:3px; display:block; }
    .vc-field { margin-bottom:10px; }
    .vc-hint { font-size:10px; opacity:.5; margin-top:3px; display:block; }
    .vc-row { display:flex; gap:8px; align-items:center; }
    .vc-card { background:rgba(255,255,255,.04); border:1px solid var(--border,#3a2a2a); border-radius:6px; padding:10px 12px; margin-bottom:8px; }
    .vc-card:hover { background:rgba(255,255,255,.06); }
    .vc-card-title { font-size:13px; font-weight:500; margin-bottom:4px; }
    .vc-card-meta { font-size:11px; opacity:.55; display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
    .vc-tag { background:rgba(192,57,43,.15); color:var(--red,#c0392b); font-size:10px; padding:1px 6px; border-radius:10px; display:inline-block; }
    .vc-empty { text-align:center; opacity:.45; padding:32px 0; font-size:13px; }
    .vc-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .vc-section-title { font-size:13px; font-weight:600; opacity:.8; }
    .vc-error { color:var(--red,#c0392b); font-size:12px; padding:8px; background:rgba(192,57,43,.1); border-radius:4px; margin-top:6px; }
    .vc-success { color:#27ae60; font-size:12px; padding:8px; background:rgba(39,174,96,.1); border-radius:4px; margin-top:6px; }
    /* Vault gate */
    .vc-vault-gate { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; text-align:center; height:100%; }
    .vc-vault-icon { color:var(--red,#c0392b); opacity:.6; margin-bottom:16px; }
    .vc-vault-title { font-size:16px; font-weight:600; margin-bottom:8px; }
    .vc-vault-desc { font-size:13px; opacity:.7; margin-bottom:12px; line-height:1.5; }
    .vc-vault-hint { font-size:11px; opacity:.5; }
    .vc-vault-form { display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:12px; }
    /* Modal */
    .vc-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999; display:flex; align-items:center; justify-content:center; }
    .vc-modal { background:var(--bg,#1a1d23); border:1px solid var(--border,#3a2a2a); border-radius:8px; min-width:420px; max-width:560px; max-height:85vh; display:flex; flex-direction:column; }
    .vc-modal-header { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--border,#3a2a2a); font-weight:600; font-size:13px; }
    .vc-modal-body { padding:14px; overflow-y:auto; flex:1; }
    .vc-modal-footer { display:flex; gap:8px; justify-content:flex-end; padding:10px 14px; border-top:1px solid var(--border,#3a2a2a); }
    /* Health grid */
    .vc-health-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:4px; }
    .vc-stat-card { background:rgba(255,255,255,.04); border:1px solid var(--border,#3a2a2a); border-radius:6px; padding:10px; text-align:center; }
    .vc-stat-value { font-size:22px; font-weight:700; margin-bottom:4px; }
    .vc-stat-label { font-size:10px; opacity:.6; text-transform:uppercase; letter-spacing:.5px; }
    /* Log table */
    .vc-log-table { display:flex; flex-direction:column; gap:2px; }
    .vc-log-row { display:flex; gap:8px; font-size:11px; padding:4px 8px; border-radius:3px; align-items:baseline; font-family:monospace; }
    .vc-log-ts { opacity:.45; flex-shrink:0; min-width:130px; }
    .vc-log-status { flex-shrink:0; min-width:70px; font-weight:600; }
    .vc-log-src { flex-shrink:0; min-width:100px; opacity:.8; }
    .vc-log-msg { flex:1; opacity:.75; word-break:break-all; }
    .vc-log-queued .vc-log-status { color:#f39c12; }
    .vc-log-running .vc-log-status { color:#3498db; }
    .vc-log-completed .vc-log-status { color:#27ae60; }
    .vc-log-error .vc-log-status { color:var(--red,#c0392b); }
    .vc-log-error { background:rgba(192,57,43,.06); }
    /* Progress */
    .vc-progress-bar { height:4px; background:rgba(255,255,255,.1); border-radius:2px; overflow:hidden; margin-top:4px; }
    .vc-progress-fill { height:100%; background:var(--red,#c0392b); transition:width .3s; }
    /* Job status colors */
    .vc-job-completed { color:#27ae60; }
    .vc-job-failed { color:var(--red,#c0392b); }
    .vc-job-running { color:#3498db; }
    .vc-job-queued { color:#f39c12; }
    /* Settings */
    .vc-settings code { font-family:monospace; background:rgba(0,0,0,.3); padding:1px 5px; border-radius:3px; font-size:10px; }
    /* Light theme */
    :root.light .vc-shell { background:var(--bg,#f5f5f7); color:var(--fg,#1a1d23); }
    :root.light .vc-card { background:rgba(0,0,0,.03); }
    :root.light .vc-input, :root.light .vc-select { background:#fff; color:#1a1d23; }
    :root.light .vc-stat-card { background:rgba(0,0,0,.03); }
    :root.light .vc-modal { background:#f5f5f7; }
  `;
  document.head.appendChild(style);
}

// -----------------------------------------------------------------------
// Self-register in Cyber Apps registry
// -----------------------------------------------------------------------

window.VaultCoreApp = { init, destroy };

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'vaultcore',
    name: 'VaultCore',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    init: (container, ctx) => window.VaultCoreApp.init(container, ctx),
    destroy: () => window.VaultCoreApp.destroy(),
    vault: true,
  });
}
