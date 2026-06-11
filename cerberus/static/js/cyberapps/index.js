/**
 * static/js/cyberapps/index.js
 *
 * Bootstrap module for the Cyber Apps overlay panel.
 * Reads window.CYBER_APPS_REGISTRY, renders the pill nav,
 * and wires mount/destroy lifecycle for each app.
 *
 * Dependencies (loaded before this module):
 *   - static/js/cyberapps/registry.js  (sets window.CYBER_APPS_REGISTRY)
 *
 * Context object passed to each app's init(container, ctx):
 *   ctx.user     : string | null  — current Cerberus username
 *   ctx.theme    : 'dark' | 'light'
 *   ctx.onVaultUnlock : (cb) => void  — subscribe to vault-unlock events
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Panel + DOM refs
  // -------------------------------------------------------------------------
  const panel    = document.getElementById('cyber-apps-panel');
  const pillNav  = panel && panel.querySelector('.cyber-apps-pill-nav');
  const content  = document.getElementById('cyber-apps-content');
  const closeBtn = document.getElementById('cyber-apps-close-btn');
  const sidebarBtn = document.getElementById('sidebar-cyber-apps-btn');

  if (!panel || !pillNav || !content) {
    // Panel not present — DOM not ready or was removed; bail silently.
    return;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let _activeId = null;
  let _vaultUnlocked = false;
  const _vaultListeners = [];

  // -------------------------------------------------------------------------
  // Context factory
  // -------------------------------------------------------------------------
  function _buildCtx() {
    const themeRoot = document.documentElement;
    return {
      user: (window.__CERBERUS_USER__ || null),
      theme: themeRoot.classList.contains('light') ? 'light' : 'dark',
      onVaultUnlock: function (cb) { _vaultListeners.push(cb); },
    };
  }

  // -------------------------------------------------------------------------
  // Vault unlock event — dispatched by CyberLab (and any other vault-gated
  // app) when the master password is validated. All registered listeners are
  // called once, then cleared so they don't fire on future vault re-locks.
  // -------------------------------------------------------------------------
  window.addEventListener('cyberapp:vault-unlocked', function () {
    _vaultUnlocked = true;
    _vaultListeners.splice(0).forEach(function (cb) {
      try { cb(); } catch (e) { /* ignore */ }
    });
  });

  // -------------------------------------------------------------------------
  // Pill rendering
  // -------------------------------------------------------------------------
  function _renderPills() {
    pillNav.innerHTML = '';
    const registry = window.CYBER_APPS_REGISTRY || [];
    registry.forEach(function (app) {
      const btn = document.createElement('button');
      btn.className = 'cyber-apps-pill';
      btn.dataset.app = app.id;
      btn.title = app.name;
      btn.setAttribute('aria-label', app.name);
      btn.innerHTML = (app.icon || '') + '<span class="cyber-apps-pill-label">' + _esc(app.name) + '</span>';
      btn.addEventListener('click', function () { _activate(app.id); });
      pillNav.appendChild(btn);
    });
  }

  function _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // -------------------------------------------------------------------------
  // Mount / unmount
  // -------------------------------------------------------------------------
  function _activate(id) {
    const registry = window.CYBER_APPS_REGISTRY || [];
    const app = registry.find(function (a) { return a.id === id; });
    if (!app) return;

    // Unmount current
    if (_activeId && _activeId !== id) {
      const prev = registry.find(function (a) { return a.id === _activeId; });
      if (prev && typeof prev.destroy === 'function') {
        try { prev.destroy(); } catch (e) { /* ignore */ }
      }
    }

    // Update pill active state
    pillNav.querySelectorAll('.cyber-apps-pill').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.app === id);
    });

    // Clear content
    content.innerHTML = '';
    _activeId = id;

    // Vault gate
    if (app.vault && !_vaultUnlocked) {
      _renderVaultPrompt(app, content);
      return;
    }

    // Mount
    if (typeof app.init === 'function') {
      try { app.init(content, _buildCtx()); } catch (e) {
        content.textContent = 'Error loading ' + app.name + ': ' + (e && e.message ? e.message : String(e));
      }
    }
  }

  function _renderVaultPrompt(app, container) {
    container.innerHTML =
      '<div class="cyber-apps-vault-gate">' +
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red,#c0392b)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
          '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
        '</svg>' +
        '<p class="cyber-apps-vault-msg">This app requires vault unlock. Enter your master password in the vault prompt to continue.</p>' +
      '</div>';
  }

  // -------------------------------------------------------------------------
  // Panel open / close
  // -------------------------------------------------------------------------
  function _openPanel() {
    panel.style.display = 'block';
    const chat = document.getElementById('chat-container');
    if (chat) chat.style.visibility = 'hidden';
    if (sidebarBtn) sidebarBtn.classList.add('active');

    // Render pills fresh each open (registry may have been pushed to)
    _renderPills();

    // Auto-activate first app if none active and registry is populated
    const registry = window.CYBER_APPS_REGISTRY || [];
    if (!_activeId && registry.length > 0) {
      _activate(registry[0].id);
    } else if (_activeId) {
      // Re-highlight the active pill
      pillNav.querySelectorAll('.cyber-apps-pill').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.app === _activeId);
      });
    }
  }

  function _closePanel() {
    panel.style.display = 'none';
    const chat = document.getElementById('chat-container');
    if (chat) chat.style.visibility = '';
    if (sidebarBtn) sidebarBtn.classList.remove('active');
  }

  // -------------------------------------------------------------------------
  // Sidebar button + Esc + sidebar dismiss sync
  // -------------------------------------------------------------------------
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', function () {
      panel.style.display === 'block' ? _closePanel() : _openPanel();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', _closePanel);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.style.display === 'block') _closePanel();
  });

  // Close when another sidebar item is clicked (same pattern as Command Center)
  document.querySelectorAll('.sidebar .list-item').forEach(function (el) {
    if (el.id !== 'sidebar-cyber-apps-btn') {
      el.addEventListener('click', _closePanel);
    }
  });

  // -------------------------------------------------------------------------
  // Public API (optional — allows apps to call from their own module)
  // -------------------------------------------------------------------------
  window.CyberApps = {
    open: _openPanel,
    close: _closePanel,
    activate: _activate,
    notifyVaultUnlocked: function () {
      window.dispatchEvent(new CustomEvent('cyberapp:vault-unlocked'));
    },
  };

})();
