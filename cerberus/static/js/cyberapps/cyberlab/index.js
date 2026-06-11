/**
 * CyberLab Companion — Cerberus native app entry point.
 *
 * Implements the CyberAppContext contract:
 *   init(container, ctx)  — render app into container
 *   destroy()             — clean up listeners / timers
 *
 * Vault flow:
 *   1. Check /api/cyberapps/vault/status.
 *   2a. Not initialized → show first-run setup form.
 *   2b. Initialized but locked → show unlock form.
 *   3. On unlock success → call window.CyberApps.notifyVaultUnlocked().
 *   4. Render full app.
 */

import { renderVaultGate } from './vault.js';
import { renderLabs }      from './labs.js';
import { renderSessions }  from './sessions.js';
import { renderChat }      from './chat.js';
import { renderReviews }   from './reviews.js';
import { renderKnowledge } from './knowledge.js';
import { renderSnippets }  from './snippets.js';
import { renderCheatsheets } from './cheatsheets.js';
import { renderSettings }  from './settings.js';
import { initPalette, destroyPalette } from './palette.js';

const API = '';  // same-origin
let _container = null;
let _ctx       = null;
let _vaultToken = null;
let _activeLab  = null;
let _activeTab  = 'chat';
let _timerInterval = null;
let _timerSeconds  = 0;
let _timerRunning  = false;
let _timerLabId    = null;

// -----------------------------------------------------------------------
// Public API (attached to window.CyberLabApp so registry can call it)
// -----------------------------------------------------------------------

export function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  _checkVaultAndRender();
}

export function destroy() {
  _stopTimer();
  destroyPalette();
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
      // Re-use any existing session token from sessionStorage
      _vaultToken = sessionStorage.getItem('cl-vault-token') || null;
      _renderApp();
    }
  } catch (err) {
    _container.innerHTML = `<div class="cl-error">Failed to reach Cerberus backend: ${_esc(String(err))}</div>`;
  }
}

function _onVaultUnlocked(token) {
  _vaultToken = token;
  sessionStorage.setItem('cl-vault-token', token);
  window.CyberApps.notifyVaultUnlocked();
  _renderApp();
}

// -----------------------------------------------------------------------
// App shell
// -----------------------------------------------------------------------

function _renderApp() {
  if (!_container) return;
  _container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'cl-shell';
  shell.innerHTML = `
    <div class="cl-header">
      <div class="cl-header-left">
        <span class="cl-logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </span>
        <span class="cl-title">CyberLab</span>
        <span class="cl-active-badge" id="cl-active-badge" style="display:none"></span>
      </div>
      <div class="cl-header-right">
        <span class="cl-timer-display" id="cl-timer-display" style="display:none">00:00:00</span>
        <button class="cl-btn cl-btn-ghost cl-palette-btn" id="cl-palette-btn" title="Command Palette (Cmd+K)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
      </div>
    </div>
    <nav class="cl-tabs" role="tablist">
      ${_tabBtn('chat','Chat')}
      ${_tabBtn('labs','Labs')}
      ${_tabBtn('sessions','Sessions')}
      ${_tabBtn('reviews','Reviews')}
      ${_tabBtn('knowledge','KB')}
      ${_tabBtn('snippets','Snippets')}
      ${_tabBtn('cheatsheets','Cheatsheets')}
      ${_tabBtn('settings','Settings')}
    </nav>
    <div class="cl-body" id="cl-body"></div>
  `;

  _container.appendChild(shell);
  _injectStyles();

  // Wire tab clicks
  shell.querySelectorAll('.cl-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
  });

  // Command palette button
  document.getElementById('cl-palette-btn').addEventListener('click', _openPalette);

  // Cmd+K / Ctrl+K
  document.addEventListener('keydown', _handlePaletteKey);

  // Load active lab then render default tab
  _loadActiveLab().then(() => _switchTab(_activeTab));
  _loadTimerFromStorage();
}

function _tabBtn(id, label) {
  return `<button class="cl-tab-btn${id === _activeTab ? ' active' : ''}" data-tab="${id}" role="tab">${label}</button>`;
}

function _switchTab(tab) {
  _activeTab = tab;
  const body = document.getElementById('cl-body');
  if (!body) return;
  body.innerHTML = '';

  // Update active pill
  document.querySelectorAll('.cl-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  const tabCtx = { vaultToken: _vaultToken, activeLab: _activeLab, onLabChange: _onLabChange, onTimerChange: _onTimerChange, timerState: _getTimerState };

  switch (tab) {
    case 'chat':       renderChat(body, tabCtx); break;
    case 'labs':       renderLabs(body, tabCtx); break;
    case 'sessions':   renderSessions(body, tabCtx); break;
    case 'reviews':    renderReviews(body, tabCtx); break;
    case 'knowledge':  renderKnowledge(body, tabCtx); break;
    case 'snippets':   renderSnippets(body, tabCtx); break;
    case 'cheatsheets': renderCheatsheets(body, tabCtx); break;
    case 'settings':   renderSettings(body, tabCtx, _vaultToken, _onLockVault); break;
  }
}

// -----------------------------------------------------------------------
// Active lab
// -----------------------------------------------------------------------

async function _loadActiveLab() {
  try {
    const res = await fetch(`${API}/api/cyberlab/active-lab`);
    _activeLab = await res.json();
    _updateActiveBadge();
  } catch { _activeLab = {}; }
}

function _onLabChange(lab) {
  _activeLab = lab || {};
  _updateActiveBadge();
  // Re-render current tab to pick up new lab context
  if (_activeTab === 'chat') _switchTab('chat');
}

function _updateActiveBadge() {
  const badge = document.getElementById('cl-active-badge');
  if (!badge) return;
  if (_activeLab && _activeLab.name) {
    badge.textContent = _activeLab.name;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// -----------------------------------------------------------------------
// Timer
// -----------------------------------------------------------------------

function _getTimerState() {
  return { seconds: _timerSeconds, running: _timerRunning, labId: _timerLabId };
}

function _onTimerChange(action, labId) {
  switch (action) {
    case 'start':
      _timerLabId = labId;
      _timerRunning = true;
      _startTimer();
      break;
    case 'pause':
      _timerRunning = false;
      _stopTimer();
      break;
    case 'resume':
      _timerRunning = true;
      _startTimer();
      break;
    case 'reset':
      _timerRunning = false;
      _timerSeconds = 0;
      _timerLabId = null;
      _stopTimer();
      _saveTimerToStorage();
      _updateTimerDisplay();
      break;
  }
  _saveTimerToStorage();
}

function _startTimer() {
  _stopTimer();
  const display = document.getElementById('cl-timer-display');
  if (display) display.style.display = 'inline-block';
  _timerInterval = setInterval(() => {
    _timerSeconds++;
    _updateTimerDisplay();
    if (_timerSeconds % 30 === 0) _saveTimerToStorage();
  }, 1000);
}

function _stopTimer() {
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
}

function _updateTimerDisplay() {
  const display = document.getElementById('cl-timer-display');
  if (!display) return;
  const h = Math.floor(_timerSeconds / 3600);
  const m = Math.floor((_timerSeconds % 3600) / 60);
  const s = _timerSeconds % 60;
  display.textContent = `${_pad(h)}:${_pad(m)}:${_pad(s)}`;
  display.style.display = _timerSeconds > 0 || _timerRunning ? 'inline-block' : 'none';
}

function _pad(n) { return String(n).padStart(2, '0'); }

function _saveTimerToStorage() {
  localStorage.setItem('cl-timer', JSON.stringify({ seconds: _timerSeconds, running: _timerRunning, labId: _timerLabId }));
}

function _loadTimerFromStorage() {
  try {
    const raw = localStorage.getItem('cl-timer');
    if (!raw) return;
    const t = JSON.parse(raw);
    _timerSeconds = t.seconds || 0;
    _timerLabId = t.labId || null;
    // Don't auto-resume — user must explicitly resume
    _timerRunning = false;
    _updateTimerDisplay();
  } catch { /* ignore */ }
}

// -----------------------------------------------------------------------
// Vault lock
// -----------------------------------------------------------------------

function _onLockVault() {
  fetch(`${API}/api/cyberapps/vault/lock`, { method: 'POST' });
  _vaultToken = null;
  sessionStorage.removeItem('cl-vault-token');
  _checkVaultAndRender();
}

// -----------------------------------------------------------------------
// Command palette
// -----------------------------------------------------------------------

function _openPalette() {
  initPalette({
    vaultToken: _vaultToken,
    activeLab: _activeLab,
    onSwitchTab: _switchTab,
    onLabChange: _onLabChange,
    onTimerChange: _onTimerChange,
    onLockVault: _onLockVault,
  });
}

function _handlePaletteKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    _openPalette();
  }
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
  if (document.getElementById('cl-styles')) return;
  const style = document.createElement('style');
  style.id = 'cl-styles';
  style.textContent = `
    .cl-shell { display:flex; flex-direction:column; height:100%; background:var(--bg,#1a1d23); color:var(--fg,#c5c9d0); font-family:inherit; }
    .cl-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border,#3a2a2a); flex-shrink:0; }
    .cl-header-left { display:flex; align-items:center; gap:8px; }
    .cl-header-right { display:flex; align-items:center; gap:6px; }
    .cl-logo-icon { color:var(--red,#c0392b); }
    .cl-title { font-weight:600; font-size:14px; letter-spacing:.5px; }
    .cl-active-badge { background:var(--red,#c0392b); color:#fff; font-size:10px; padding:2px 7px; border-radius:20px; font-weight:500; }
    .cl-timer-display { font-family:monospace; font-size:12px; color:var(--red,#c0392b); background:rgba(192,57,43,.12); padding:2px 8px; border-radius:4px; }
    .cl-tabs { display:flex; gap:2px; padding:6px 10px 0; border-bottom:1px solid var(--border,#3a2a2a); flex-shrink:0; overflow-x:auto; scrollbar-width:none; }
    .cl-tabs::-webkit-scrollbar { display:none; }
    .cl-tab-btn { background:none; border:none; color:var(--fg,#c5c9d0); opacity:.6; font-size:12px; padding:5px 10px; cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; white-space:nowrap; }
    .cl-tab-btn:hover { opacity:1; }
    .cl-tab-btn.active { opacity:1; color:var(--red,#c0392b); border-bottom-color:var(--red,#c0392b); }
    .cl-body { flex:1; overflow-y:auto; padding:12px; }
    .cl-btn { border:none; cursor:pointer; border-radius:4px; font-size:12px; padding:5px 10px; transition:all .15s; }
    .cl-btn-primary { background:var(--red,#c0392b); color:#fff; }
    .cl-btn-primary:hover { background:color-mix(in srgb, var(--red,#c0392b) 85%, white); }
    .cl-btn-ghost { background:transparent; color:var(--fg,#c5c9d0); border:1px solid var(--border,#3a2a2a); }
    .cl-btn-ghost:hover { background:rgba(255,255,255,.06); }
    .cl-btn-danger { background:rgba(192,57,43,.18); color:var(--red,#c0392b); border:1px solid rgba(192,57,43,.3); }
    .cl-btn-danger:hover { background:rgba(192,57,43,.3); }
    .cl-input { background:rgba(255,255,255,.05); border:1px solid var(--border,#3a2a2a); color:var(--fg,#c5c9d0); border-radius:4px; padding:6px 9px; font-size:12px; width:100%; box-sizing:border-box; }
    .cl-input:focus { outline:none; border-color:var(--red,#c0392b); }
    .cl-textarea { resize:vertical; min-height:80px; font-family:inherit; }
    .cl-select { background:rgba(255,255,255,.05); border:1px solid var(--border,#3a2a2a); color:var(--fg,#c5c9d0); border-radius:4px; padding:6px 9px; font-size:12px; }
    .cl-label { font-size:11px; opacity:.65; margin-bottom:3px; display:block; }
    .cl-field { margin-bottom:10px; }
    .cl-row { display:flex; gap:8px; align-items:center; }
    .cl-card { background:rgba(255,255,255,.04); border:1px solid var(--border,#3a2a2a); border-radius:6px; padding:10px 12px; margin-bottom:8px; }
    .cl-card:hover { background:rgba(255,255,255,.06); }
    .cl-card-title { font-size:13px; font-weight:500; margin-bottom:4px; }
    .cl-card-meta { font-size:11px; opacity:.55; display:flex; gap:8px; flex-wrap:wrap; }
    .cl-tag { background:rgba(192,57,43,.15); color:var(--red,#c0392b); font-size:10px; padding:1px 6px; border-radius:10px; }
    .cl-empty { text-align:center; opacity:.45; padding:32px 0; font-size:13px; }
    .cl-section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .cl-section-title { font-size:13px; font-weight:600; opacity:.8; }
    .cl-error { color:var(--red,#c0392b); font-size:12px; padding:8px; background:rgba(192,57,43,.1); border-radius:4px; margin-bottom:8px; }
    .cl-palette-btn { padding:4px 6px; }
    .cl-code { font-family:monospace; background:rgba(0,0,0,.35); padding:2px 6px; border-radius:3px; font-size:11px; }
    pre.cl-pre { background:rgba(0,0,0,.4); border:1px solid var(--border,#3a2a2a); border-radius:4px; padding:10px; overflow-x:auto; font-size:11px; margin:6px 0; }
    .cl-copy-btn { font-size:10px; float:right; margin-left:8px; }
    :root.light .cl-shell { background:var(--bg,#f5f5f7); color:var(--fg,#1a1d23); }
    :root.light .cl-card { background:rgba(0,0,0,.03); }
    :root.light .cl-input, :root.light .cl-select, :root.light .cl-textarea { background:#fff; color:#1a1d23; }
  `;
  document.head.appendChild(style);
}

// -----------------------------------------------------------------------
// Self-register in Cyber Apps registry
// -----------------------------------------------------------------------

window.CyberLabApp = { init, destroy };

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'cyberlab',
    name: 'CyberLab',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    init: (container, ctx) => window.CyberLabApp.init(container, ctx),
    destroy: () => window.CyberLabApp.destroy(),
    vault: true,
  });
}
