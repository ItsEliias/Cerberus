/**
 * CredVault — Cerberus native app entry point.
 *
 * Self-registers into window.CYBER_APPS_REGISTRY.
 * Provides: vault gate, credential list/detail, dashboard, import view,
 * settings, standalone password generator, and Cmd+K command palette.
 */

import { renderVaultGate }   from './vault-gate.js';
import { renderVaultView }   from './vault-view.js';
import { renderImportView }  from './import-view.js';
import { renderSettingsView } from './settings-view.js';
import { renderGenerator }   from './generator.js';
import { renderPalette }     from './palette.js';

// ---------------------------------------------------------------------------
// Module-level state (persists across panel open/close cycles)
// ---------------------------------------------------------------------------
let _vaultToken   = null;
let _currentView  = 'vault';  // 'vault' | 'import' | 'settings'
let _container    = null;
let _paletteOpen  = false;
let _credentials  = [];  // cached for palette

// ---------------------------------------------------------------------------
// Keyboard shortcut (Cmd+K / Ctrl+K) — wired once at module load
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (_container && (e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    if (_vaultToken) {
      _paletteOpen = !_paletteOpen;
      if (_paletteOpen) openPalette();
    }
  }
  if (e.key === 'Escape' && _paletteOpen) {
    _paletteOpen = false;
    closePalette();
  }
});

let _paletteOverlay = null;

function openPalette() {
  if (!_container) return;
  _paletteOverlay = document.createElement('div');
  _paletteOverlay.id = 'cv-palette-overlay';
  _paletteOverlay.style.cssText = 'position:fixed;inset:0;z-index:400;';
  document.body.appendChild(_paletteOverlay);
  renderPalette(
    _paletteOverlay,
    _credentials,
    {
      navigate: (view) => { _currentView = view; mountView(_container); },
      openAdd:  () => { _currentView = 'vault'; mountView(_container); },
      openGen:  () => openGenerator(),
      runHibp:  () => { _currentView = 'vault'; mountView(_container); },
      lock:     async () => {
        await fetch('/api/cyberapps/vault/lock', { method: 'POST' }).catch(() => {});
        _vaultToken = null;
        _currentView = 'vault';
        mountView(_container);
      },
    },
    () => { _paletteOpen = false; closePalette(); }
  );
}

function closePalette() {
  if (_paletteOverlay) { _paletteOverlay.remove(); _paletteOverlay = null; }
}

function openGenerator() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:350;';
  document.body.appendChild(overlay);
  renderGenerator(overlay, null, () => overlay.remove());
}

// ---------------------------------------------------------------------------
// Tab nav bar
// ---------------------------------------------------------------------------
function renderNavBar(container) {
  const existing = container.querySelector('#cv-nav-bar');
  if (existing) { existing.remove(); }

  const nav = document.createElement('div');
  nav.id = 'cv-nav-bar';
  nav.style.cssText = `
    display:flex;align-items:center;gap:2px;
    padding:6px 12px;border-bottom:1px solid rgba(42,51,71,.35);
    background:rgba(10,10,15,.7);flex-shrink:0;
  `;
  nav.innerHTML = `
    ${[['vault','Credentials'],['import','Import'],['settings','Settings']].map(([view, label]) => `
      <button class="cv-nav-tab" data-view="${view}" style="
        font-size:11px;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;
        background:${_currentView===view ? 'rgba(192,57,43,.15)' : 'transparent'};
        color:${_currentView===view ? '#c0392b' : '#8b949e'};
        font-weight:${_currentView===view ? 600 : 400};
        border-bottom:${_currentView===view ? '2px solid #c0392b' : '2px solid transparent'};
        transition:color .15s,background .15s;
      ">${label}</button>
    `).join('')}
    <div style="flex:1;"></div>
    <button id="cv-lock-btn" title="Lock vault" style="font-size:11px;padding:3px 8px;border-radius:6px;
      border:1px solid rgba(192,57,43,.25);background:transparent;color:#6b7280;cursor:pointer;">
      Lock
    </button>
  `;
  container.insertBefore(nav, container.firstChild);

  nav.querySelectorAll('.cv-nav-tab').forEach(btn =>
    btn.addEventListener('click', () => { _currentView = btn.dataset.view; mountView(container); })
  );
  nav.querySelector('#cv-lock-btn')?.addEventListener('click', async () => {
    await fetch('/api/cyberapps/vault/lock', { method: 'POST' }).catch(() => {});
    _vaultToken = null;
    _currentView = 'vault';
    mountView(container);
  });
}

// ---------------------------------------------------------------------------
// Mount the active view
// ---------------------------------------------------------------------------
function mountView(container) {
  // Remove old view (keep nav bar)
  const viewEl = container.querySelector('#cv-view-area');
  if (viewEl) viewEl.remove();

  renderNavBar(container);

  const area = document.createElement('div');
  area.id = 'cv-view-area';
  area.style.cssText = 'flex:1;overflow-y:auto;min-height:0;';
  container.appendChild(area);

  if (_currentView === 'vault') {
    renderVaultView(area, _vaultToken, (action) => {
      if (action === 'import') { _currentView = 'import'; mountView(container); }
    });
  } else if (_currentView === 'import') {
    renderImportView(area, _vaultToken);
  } else if (_currentView === 'settings') {
    renderSettingsView(area, _vaultToken);
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function init(container, ctx) {
  _container = container;

  container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

  if (_vaultToken) {
    // Already unlocked — go straight to app
    mountView(container);
    return;
  }

  // Show vault gate
  const gateEl = document.createElement('div');
  gateEl.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
  container.appendChild(gateEl);

  renderVaultGate(gateEl, (token) => {
    _vaultToken = token;
    // Notify the CyberApps bootstrap that the vault is unlocked
    if (window.CyberApps?.notifyVaultUnlocked) {
      window.CyberApps.notifyVaultUnlocked();
    } else {
      window.dispatchEvent(new CustomEvent('cyberapp:vault-unlocked'));
    }
    gateEl.remove();
    mountView(container);
  });

  // If the vault was already unlocked by CyberLab, use ctx.onVaultUnlock
  if (ctx && ctx.onVaultUnlock) {
    ctx.onVaultUnlock(() => {
      if (!_vaultToken) {
        // Session token was set externally — try to get one
        // Calling the gate flow inline is safe; it will show unlock
      }
    });
  }
}

function destroy() {
  _container = null;
  closePalette();
}

// ---------------------------------------------------------------------------
// Self-register
// ---------------------------------------------------------------------------
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id:   'credvault',
    name: 'CredVault',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>`,
    init,
    destroy,
    vault: true,
  });
}
