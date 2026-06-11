/**
 * static/js/cyberapps/terminallink/index.js
 *
 * TerminalLink — native Cerberus browser terminal.
 *
 * Dependencies (loaded via <script> tags in index.html before app.js):
 *   /static/lib/xterm.min.js          — @xterm/xterm 5.5.0 UMD
 *   /static/lib/xterm-addon-fit.min.js — @xterm/addon-fit 0.10.0 UMD
 *   /static/lib/xterm.min.css         — loaded as <link> in index.html
 *
 * WebSocket endpoint: /api/cyberapps/terminallink/ws
 * Auth: Cerberus session cookie is sent automatically (same-origin).
 * Protocol:
 *   server → client: raw PTY bytes OR JSON control frames
 *   client → server: raw keystroke strings OR {"type":"resize","cols":N,"rows":M}
 *   server → client: {"type":"ready"} on PTY spawn
 *   server → client: {"type":"exit"} on PTY exit
 */

(function () {
  'use strict';

  // State managed across init/destroy cycles
  var _term = null;
  var _ws = null;
  var _fitAddon = null;
  var _resizeObserver = null;
  var _container = null;

  // -------------------------------------------------------------------------
  // Theme helpers
  // -------------------------------------------------------------------------
  function _cssVar(name, fallback) {
    var val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }

  function _buildTheme() {
    return {
      background:          _cssVar('--bg',    '#060708'),
      foreground:          _cssVar('--fg',    '#c8cdd8'),
      cursor:              _cssVar('--red',   '#E63946'),
      cursorAccent:        _cssVar('--bg',    '#060708'),
      selectionBackground: 'rgba(230,57,70,0.25)',
      black:   '#1a1d23',
      red:     _cssVar('--red',   '#E63946'),
      green:   '#22c55e',
      yellow:  '#eab308',
      blue:    '#60a5fa',
      magenta: '#c084fc',
      cyan:    '#22d3ee',
      white:   '#c8cdd8',
      brightBlack:   '#4b5563',
      brightRed:     '#ff7a5c',
      brightGreen:   '#4ade80',
      brightYellow:  '#fbbf24',
      brightBlue:    '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan:    '#67e8f9',
      brightWhite:   '#f1f5f9',
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket URL — same-origin, no explicit host needed
  // -------------------------------------------------------------------------
  function _wsUrl() {
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.host + '/api/cyberapps/terminallink/ws';
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------
  function _connect(mountEl) {
    if (!window.Terminal || !window.FitAddon) {
      mountEl.textContent = 'TerminalLink: xterm.js libraries not loaded.';
      return;
    }

    // Clean up any previous instance
    _teardown();

    // Build wrapper DOM
    var wrapper = document.createElement('div');
    wrapper.className = 'terminallink-wrapper';
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;background:' +
      _cssVar('--bg', '#060708') + ';';
    mountEl.appendChild(wrapper);

    // Topbar
    var topbar = document.createElement('div');
    topbar.className = 'terminallink-topbar';
    topbar.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:6px 12px', 'border-bottom:1px solid ' + _cssVar('--border', '#1a1d24'),
      'background:' + _cssVar('--panel', '#0f1115'),
      'font-family:' + _cssVar('--font-family', "'JetBrains Mono',monospace"),
      'font-size:11px', 'letter-spacing:0.08em', 'user-select:none',
    ].join(';');

    var dot = document.createElement('span');
    dot.id = 'tl-status-dot';
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#eab308;' +
      'box-shadow:0 0 6px #eab308;flex-shrink:0;';

    var title = document.createElement('span');
    title.textContent = 'TERMINAL LINK';
    title.style.cssText = 'color:' + _cssVar('--fg', '#c8cdd8') + ';font-weight:600;';

    var statusLabel = document.createElement('span');
    statusLabel.id = 'tl-status-label';
    statusLabel.textContent = 'CONNECTING';
    statusLabel.style.cssText = 'color:#eab308;margin-left:auto;';

    topbar.appendChild(dot);
    topbar.appendChild(title);
    topbar.appendChild(statusLabel);
    wrapper.appendChild(topbar);

    // Terminal body
    var body = document.createElement('div');
    body.style.cssText = 'position:relative;flex:1;overflow:hidden;';
    wrapper.appendChild(body);

    var xtermEl = document.createElement('div');
    xtermEl.style.cssText = 'width:100%;height:100%;';
    body.appendChild(xtermEl);

    // Overlay (disconnect / error)
    var overlay = document.createElement('div');
    overlay.id = 'tl-overlay';
    overlay.style.cssText = [
      'display:none', 'position:absolute', 'inset:0',
      'background:rgba(6,7,8,0.88)', 'backdrop-filter:blur(4px)',
      'display:none', 'flex-direction:column', 'align-items:center',
      'justify-content:center', 'gap:16px',
    ].join(';');

    var overlayTitle = document.createElement('span');
    overlayTitle.id = 'tl-overlay-title';
    overlayTitle.style.cssText = 'color:' + _cssVar('--red', '#E63946') +
      ';font-family:monospace;font-size:13px;font-weight:700;letter-spacing:0.1em;';
    overlayTitle.textContent = 'DISCONNECTED';

    var overlayDetail = document.createElement('span');
    overlayDetail.id = 'tl-overlay-detail';
    overlayDetail.style.cssText = 'color:' + _cssVar('--fg', '#c8cdd8') +
      ';font-size:12px;text-align:center;max-width:320px;opacity:0.7;';

    var reconnectBtn = document.createElement('button');
    reconnectBtn.textContent = 'RECONNECT';
    reconnectBtn.style.cssText = [
      'margin-top:8px', 'padding:8px 20px',
      'background:transparent',
      'border:1px solid ' + _cssVar('--red', '#E63946'),
      'color:' + _cssVar('--red', '#E63946'),
      'font-family:monospace', 'font-size:12px', 'letter-spacing:0.08em',
      'cursor:pointer', 'border-radius:2px',
    ].join(';');
    reconnectBtn.addEventListener('click', function () { _connect(mountEl); });

    overlay.appendChild(overlayTitle);
    overlay.appendChild(overlayDetail);
    overlay.appendChild(reconnectBtn);
    body.appendChild(overlay);

    // xterm.js Terminal
    var term = new window.Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono','Fira Code','Geist Mono',monospace",
      fontSize: 14,
      lineHeight: 1.4,
      theme: _buildTheme(),
      allowTransparency: false,
      scrollback: 5000,
    });

    // xterm-addon-fit UMD sets window.FitAddon = FitAddon class directly
    var FitAddonClass = window.FitAddon.FitAddon || window.FitAddon;
    var fit = new FitAddonClass();
    term.loadAddon(fit);
    term.open(xtermEl);
    fit.fit();

    _term = term;
    _fitAddon = fit;
    _container = mountEl;

    // WebSocket
    var ws = new WebSocket(_wsUrl());
    _ws = ws;

    ws.onopen = function () {
      _setStatus('connecting', 'CONNECTING', '#eab308');
    };

    ws.onmessage = function (ev) {
      var data = (ev.data instanceof ArrayBuffer)
        ? new TextDecoder().decode(ev.data)
        : ev.data;

      // Control frame check
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'ready') {
          _setStatus('ready', 'CONNECTED', '#22c55e');
          _hideOverlay();
          return;
        }
        if (msg.type === 'exit') {
          _setStatus('disconnected', 'DISCONNECTED', '#6b7280');
          _showOverlay('DISCONNECTED', 'Shell session ended.');
          return;
        }
      } catch (_) { /* not JSON — raw PTY output */ }

      term.write(data);
    };

    ws.onerror = function () {
      _setStatus('error', 'ERROR', '#E63946');
      _showOverlay('CONNECTION ERROR', 'Failed to reach PTY bridge.');
    };

    ws.onclose = function () {
      _setStatus('disconnected', 'DISCONNECTED', '#6b7280');
      _showOverlay('DISCONNECTED', 'Connection closed.');
    };

    // Wire keystrokes
    term.onData(function (data) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize observer
    var ro = new ResizeObserver(function () {
      try { fit.fit(); } catch (_) { return; }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(xtermEl);
    _resizeObserver = ro;

    // ---- helpers ----
    function _setStatus(state, label, color) {
      var d = document.getElementById('tl-status-dot');
      var l = document.getElementById('tl-status-label');
      if (d) { d.style.background = color; d.style.boxShadow = '0 0 6px ' + color; }
      if (l) { l.textContent = label; l.style.color = color; }
    }

    function _showOverlay(title, detail) {
      var ol = document.getElementById('tl-overlay');
      var ot = document.getElementById('tl-overlay-title');
      var od = document.getElementById('tl-overlay-detail');
      if (!ol) return;
      if (ot) ot.textContent = title;
      if (od) od.textContent = detail;
      ol.style.display = 'flex';
    }

    function _hideOverlay() {
      var ol = document.getElementById('tl-overlay');
      if (ol) ol.style.display = 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------
  function _teardown() {
    if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (_) {} _resizeObserver = null; }
    if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
    if (_term) { try { _term.dispose(); } catch (_) {} _term = null; }
    _fitAddon = null;
    if (_container) { _container.innerHTML = ''; _container = null; }
  }

  // -------------------------------------------------------------------------
  // Registry entry
  // -------------------------------------------------------------------------
  if (window.CYBER_APPS_REGISTRY) {
    window.CYBER_APPS_REGISTRY.push({
      id: 'terminallink',
      name: 'TerminalLink',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      init: function (container, ctx) { _connect(container); },
      destroy: _teardown,
      vault: false,
    });
  }

})();
