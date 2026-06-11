/**
 * static/js/settings/cyberapps_section.js
 *
 * "Cyber Apps" category for the Cerberus Settings panel.
 * Injects a left-rail nav entry and right-pane panel at runtime — no
 * index.html edits needed beyond a single <script> tag.
 *
 * Exposes window.initCyberAppsSettings() which settings.js calls from
 * initAll(). Fires "cyber-apps:settings-updated" on every save.
 */
(function () {
  'use strict';

  // ── Per-app row spec ──────────────────────────────────────────────────────
  function sel(key, label, options) { return { type: 'select', key, label, options }; }
  function num(key, label, min, max, step) { return { type: 'number', key, label, min, max, step: step || 1 }; }
  function tog(key, label) { return { type: 'toggle', key, label }; }
  function txt(key, label) { return { type: 'text', key, label }; }

  const SHELL_OPTS = [
    { value: '/bin/bash', label: '/bin/bash' },
    { value: '/bin/zsh',  label: '/bin/zsh' },
    { value: '/bin/sh',   label: '/bin/sh' },
  ];
  const LAYOUT_OPTS = [
    { value: 'force',        label: 'Force-directed' },
    { value: 'hierarchical', label: 'Hierarchical' },
    { value: 'circular',     label: 'Circular' },
    { value: 'grid',         label: 'Grid' },
  ];
  const TMPL_OPTS = [
    { value: 'blank',   label: 'Blank' },
    { value: 'note',    label: 'Note' },
    { value: 'report',  label: 'Report' },
  ];
  const FORGE_TMPL = [
    { value: 'blank',   label: 'Blank' },
    { value: 'pentest', label: 'Pentest' },
    { value: 'audit',   label: 'Audit' },
  ];
  const MODEL_OPTS = [
    { value: '', label: 'Default (from AI Settings)' },
    { value: 'claude-opus-4-5',    label: 'Claude Opus 4.5' },
    { value: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5' },
  ];

  const APP_CONFIGS = {
    cyberlab:      { label: 'CyberLab',       rows: [sel('model','Model',MODEL_OPTS), num('max_tokens','Max tokens',256,65536,256), { type:'textarea', key:'system_prompt', label:'System prompt' }] },
    credvault:     { label: 'CredVault',       rows: [num('pw_length','Password length',8,128), tog('use_upper','Uppercase'), tog('use_lower','Lowercase'), tog('use_digits','Digits'), tog('use_symbols','Symbols (!@#…)'), num('auto_lock_minutes','Auto-lock (min)',1,60)] },
    ghostvault:    { label: 'GhostVault',      rows: [num('autosave_interval_ms','Autosave interval (ms)',500,30000,500), sel('default_template','Default template',TMPL_OPTS)] },
    vaultcore:     { label: 'VaultCore',       rows: [num('scrape_depth','Scrape depth',1,10), num('max_pages','Max pages',1,500), num('delay_ms','Delay (ms)',0,10000,100), tog('auto_wikilinks','Auto-wikilinks'), tog('auto_tag','Auto-tag'), tog('notifications','Notifications')] },
    networkmap:    { label: 'NetworkMap',      rows: [sel('default_layout','Default layout',LAYOUT_OPTS), tog('default_heatmap','Heatmap on by default'), tog('default_vuln_overlay','Vuln overlay on by default')] },
    netlab:        { label: 'NetLab',          rows: [] },
    recondesk:     { label: 'ReconDesk',       rows: [txt('nmap_binary','nmap binary path'), txt('default_engagement','Default engagement name')] },
    terminallink:  { label: 'TerminalLink',    rows: [sel('default_shell','Default shell',SHELL_OPTS), num('max_concurrent_sessions','Max concurrent sessions',1,20)] },
    launcher:      { label: 'Launcher',        rows: [] },
    dashboard:     { label: 'Dashboard',       rows: [num('polling_interval_seconds','Polling interval (s)',5,300,5)] },
    signalboard:   { label: 'SignalBoard',     rows: [tog('notify_critical','Critical alerts'), tog('notify_high','High alerts'), tog('notify_low','Low alerts')] },
    playbookstudio:{ label: 'PlaybookStudio',  rows: [] },
    reportforge:   { label: 'ReportForge',     rows: [sel('default_template','Default template',FORGE_TMPL), tog('default_markdown','Default Markdown export'), tog('default_html','Default HTML export')] },
    operations:    { label: 'Operations',      rows: [num('vitals_interval_seconds','Vitals poll (s)',2,60), num('agents_interval_seconds','Agents poll (s)',5,120,5)] },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function showToast(msg) {
    if (window.uiModule && typeof window.uiModule.showToast === 'function') window.uiModule.showToast(msg);
  }

  // ── Inject nav entry between Shortcuts divider and Account ────────────────
  function _injectNavEntry(modalEl) {
    if (modalEl.querySelector('[data-settings-tab="cyberapps"]')) return;
    const accountBtn = modalEl.querySelector('[data-settings-tab="account"]');
    if (!accountBtn) return;
    const sidebar = accountBtn.parentElement;
    const divider = document.createElement('div');
    divider.className = 'settings-sidebar-divider';
    const btn = document.createElement('button');
    btn.className = 'settings-nav-item';
    btn.dataset.settingsTab = 'cyberapps';
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' +
      '</svg><span>Cyber Apps</span>';
    // Wire tab-switch click manually (initTabs() runs before injection)
    btn.addEventListener('click', function () {
      modalEl.querySelectorAll('[data-settings-tab]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.settingsTab === 'cyberapps');
      });
      modalEl.querySelectorAll('[data-settings-panel]').forEach(function (p) {
        p.classList.toggle('hidden', p.dataset.settingsPanel !== 'cyberapps');
      });
    });
    sidebar.insertBefore(divider, accountBtn);
    sidebar.insertBefore(btn, accountBtn);
  }

  // ── Build panel HTML ──────────────────────────────────────────────────────
  function _buildPanelEl() {
    const panel = document.createElement('div');
    panel.setAttribute('data-settings-panel', 'cyberapps');
    panel.className = 'hidden';
    panel.id = 'settings-cyberapps-panel';
    const registry = window.CYBER_APPS_REGISTRY || [];
    const appIds = registry.map(function (a) { return a.id; });
    Object.keys(APP_CONFIGS).forEach(function (id) { if (appIds.indexOf(id) === -1) appIds.push(id); });

    let html =
      '<div class="admin-card">' +
        '<h2><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px;opacity:0.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Cyber Apps</h2>' +
        '<div class="admin-toggle-sub" style="margin-bottom:8px">Per-app configuration, credentials, and visibility</div>' +
        '<div class="admin-toggle-row">' +
          '<div><div class="admin-toggle-label">Show Cyber Apps in sidebar</div>' +
          '<div class="admin-toggle-sub">Master switch — hides the entire Cyber Apps sidebar entry if off</div></div>' +
          '<label class="admin-switch"><input type="checkbox" id="set-cyberapps-show-sidebar" checked><span class="admin-slider"></span></label>' +
        '</div>' +
      '</div>';

    appIds.forEach(function (appId) { html += _appCardHTML(appId, registry); });
    panel.innerHTML = html;
    return panel;
  }

  function _appCardHTML(appId, registry) {
    const regEntry = (registry || []).find(function (a) { return a.id === appId; });
    const cfg = APP_CONFIGS[appId];
    const label = (cfg && cfg.label) || (regEntry && regEntry.name) || appId;
    const icon = regEntry && regEntry.icon
      ? '<span style="display:inline-flex;color:var(--red,#c0392b);flex-shrink:0;margin-right:4px;">' + regEntry.icon + '</span>'
      : '';

    let rows = '<div class="admin-toggle-row">' +
      '<div><div class="admin-toggle-label">Default-active on open</div>' +
      '<div class="admin-toggle-sub">Opens first when the Cyber Apps panel is opened (one app at a time)</div></div>' +
      '<label class="admin-switch"><input type="checkbox" class="ca-toggle-default-active" data-app-id="' + esc(appId) + '"><span class="admin-slider"></span></label>' +
      '</div>';

    if (cfg && cfg.rows) cfg.rows.forEach(function (row) { rows += _rowHTML(appId, row); });

    rows +=
      '<div class="admin-toggle-row" style="margin-top:4px;">' +
        '<div><div class="admin-toggle-label" style="color:var(--color-error,#c0392b)">Reset app data</div>' +
        '<div class="admin-toggle-sub">Permanently wipe all data for this app. Irreversible.</div></div>' +
        '<button type="button" class="ca-reset-btn admin-btn-sm" data-app-id="' + esc(appId) + '"' +
          ' style="color:var(--color-error,#c0392b);border-color:color-mix(in srgb,var(--color-error,#c0392b) 35%,transparent);">Reset</button>' +
      '</div>';

    return '<div class="admin-card" data-cyberapps-card="' + esc(appId) + '">' +
      '<h2 style="display:flex;align-items:center;gap:6px;">' + icon +
        '<span style="flex:1;">' + esc(label) + '</span>' +
        '<label class="admin-switch" title="Show in pill nav"><input type="checkbox" class="ca-toggle-show-pill" data-app-id="' + esc(appId) + '" checked><span class="admin-slider"></span></label>' +
      '</h2>' +
      '<div class="settings-col">' + rows + '</div>' +
      '</div>';
  }

  function _rowHTML(appId, row) {
    const inputId = 'ca-' + appId + '-' + row.key;
    const dataAttrs = ' data-app-id="' + esc(appId) + '" data-key="' + esc(row.key) + '"';
    let control;
    if (row.type === 'toggle') {
      control = '<label class="admin-switch"><input type="checkbox" id="' + inputId + '" class="ca-field-toggle"' + dataAttrs + '><span class="admin-slider"></span></label>';
    } else if (row.type === 'select') {
      const opts = (row.options || []).map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('');
      control = '<select id="' + inputId + '" class="settings-select ca-field-select"' + dataAttrs + '>' + opts + '</select>';
    } else if (row.type === 'number') {
      control = '<input type="number" id="' + inputId + '" class="settings-select ca-field-number"' + dataAttrs +
        ' min="' + (row.min !== undefined ? row.min : '') + '" max="' + (row.max !== undefined ? row.max : '') +
        '" step="' + (row.step || 1) + '" style="max-width:100px;">';
    } else if (row.type === 'textarea') {
      control = '<textarea id="' + inputId + '" class="settings-select ca-field-textarea"' + dataAttrs +
        ' rows="3" style="resize:vertical;font-family:monospace;font-size:11px;"></textarea>';
    } else {
      control = '<input type="text" id="' + inputId + '" class="settings-select ca-field-text"' + dataAttrs + '>';
    }
    return '<div class="settings-row"><label class="settings-label" for="' + inputId + '">' + esc(row.label) + '</label>' + control + '</div>';
  }

  // ── Load prefs and populate ───────────────────────────────────────────────
  async function _loadAndPopulate(panelEl) {
    let prefs = {};
    try {
      const res = await fetch('/api/cyberapps/settings', { credentials: 'same-origin' });
      if (res.ok) prefs = await res.json();
    } catch (_) {}
    _populatePanel(panelEl, prefs);
  }

  function _populatePanel(panelEl, prefs) {
    const sidebarToggle = panelEl.querySelector('#set-cyberapps-show-sidebar');
    if (sidebarToggle) sidebarToggle.checked = !(prefs._global && prefs._global.showSidebar === false);

    Object.keys(prefs).forEach(function (appId) {
      if (appId === '_global') return;
      const appPrefs = prefs[appId] || {};
      const card = panelEl.querySelector('[data-cyberapps-card="' + appId + '"]');
      if (!card) return;
      const showPillEl = card.querySelector('.ca-toggle-show-pill[data-app-id="' + appId + '"]');
      if (showPillEl) showPillEl.checked = appPrefs.showPill !== false;
      const defaultActiveEl = card.querySelector('.ca-toggle-default-active[data-app-id="' + appId + '"]');
      if (defaultActiveEl) defaultActiveEl.checked = !!appPrefs.defaultActive;
      card.querySelectorAll('[data-key]').forEach(function (el) {
        const val = appPrefs[el.dataset.key];
        if (val === undefined) return;
        if (el.type === 'checkbox') el.checked = !!val;
        else el.value = val;
      });
    });
  }

  // ── Save helpers ──────────────────────────────────────────────────────────
  async function _saveAppPrefs(appId, patch) {
    try {
      const res = await fetch('/api/cyberapps/settings/' + encodeURIComponent(appId), {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      window.dispatchEvent(new CustomEvent('cyber-apps:settings-updated'));
    } catch (e) { showToast('Failed to save: ' + (e.message || e)); }
  }

  async function _saveGlobal(key, value) {
    try {
      await fetch('/api/cyberapps/settings/_global', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      window.dispatchEvent(new CustomEvent('cyber-apps:settings-updated'));
    } catch (_) {}
  }

  // ── Wire events ───────────────────────────────────────────────────────────
  function _wireEvents(panelEl) {
    const sidebarToggle = panelEl.querySelector('#set-cyberapps-show-sidebar');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('change', function () {
        const btn = document.getElementById('sidebar-cyber-apps-btn');
        if (btn) btn.style.display = sidebarToggle.checked ? '' : 'none';
        _saveGlobal('showSidebar', sidebarToggle.checked);
        showToast('Cyber Apps sidebar ' + (sidebarToggle.checked ? 'shown' : 'hidden'));
      });
    }
    panelEl.querySelectorAll('.ca-toggle-show-pill').forEach(function (el) {
      el.addEventListener('change', function () { _saveAppPrefs(el.dataset.appId, { showPill: el.checked }); });
    });
    panelEl.querySelectorAll('.ca-toggle-default-active').forEach(function (el) {
      el.addEventListener('change', function () {
        if (el.checked) panelEl.querySelectorAll('.ca-toggle-default-active').forEach(function (o) { if (o !== el) o.checked = false; });
        _saveAppPrefs(el.dataset.appId, { defaultActive: el.checked });
      });
    });
    panelEl.querySelectorAll('.ca-field-toggle').forEach(function (el) {
      el.addEventListener('change', function () { _saveAppPrefs(el.dataset.appId, { [el.dataset.key]: el.checked }); });
    });
    ['ca-field-select', 'ca-field-number', 'ca-field-text', 'ca-field-textarea'].forEach(function (cls) {
      panelEl.querySelectorAll('.' + cls).forEach(function (el) {
        el.addEventListener('change', function () {
          const v = el.type === 'number' ? Number(el.value) : el.value;
          _saveAppPrefs(el.dataset.appId, { [el.dataset.key]: v });
        });
      });
    });
    panelEl.querySelectorAll('.ca-reset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Reset all data for "' + btn.dataset.appId + '"?\n\nThis action is irreversible.')) return;
        fetch('/api/cyberapps/settings/reset/' + encodeURIComponent(btn.dataset.appId), {
          method: 'POST', credentials: 'same-origin',
        }).then(function (r) { return r.json(); }).then(function (d) {
          showToast(d.ok ? btn.dataset.appId + ' data reset' : (d.detail || btn.dataset.appId + ' has no reset endpoint'));
        }).catch(function (e) { showToast('Reset failed: ' + (e.message || e)); });
      });
    });
  }

  // ── Public init ───────────────────────────────────────────────────────────
  window.initCyberAppsSettings = function () {
    const modalEl = document.getElementById('settings-modal');
    if (!modalEl) return;
    _injectNavEntry(modalEl);
    if (!modalEl.querySelector('[data-settings-panel="cyberapps"]')) {
      const panelsEl = modalEl.querySelector('.settings-panels');
      if (panelsEl) panelsEl.appendChild(_buildPanelEl());
    }
    const panelEl = modalEl.querySelector('[data-settings-panel="cyberapps"]');
    if (!panelEl) return;
    if (!panelEl.dataset.wired) { panelEl.dataset.wired = '1'; _wireEvents(panelEl); }
    _loadAndPopulate(panelEl);
  };

})();
