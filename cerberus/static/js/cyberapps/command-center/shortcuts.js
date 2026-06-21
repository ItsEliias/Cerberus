/**
 * shortcuts.js — Keyboard shortcuts for the Command Center shell.
 *
 * Base set (PR #48):
 *   ?         Toggle the shortcuts help overlay
 *   n         Click the active tab's "+ New" button (if visible)
 *   Esc       Close any open overlay / form / detail panel
 *   /         Focus the active tab's filter input (if present)
 *   1–8       Switch CC tabs by index
 *   Cmd+K     Open the command palette (agents, rooms, tabs, actions)
 *
 * Expansion (this PR):
 *   r         In ROOMS tab — focus the room filter input
 *   t         In RESEARCH tab — focus the query textarea
 *   p         Dispatch `cerberus:open-profile` (assistant.js listens)
 *   g         Jump to GATEWAY tab
 *   Shift+R   Reset the active tab's primary form (COMPARE / RESEARCH)
 *   Cmd+Enter Submit the active tab's primary action — fires even
 *             while typing in an input/textarea
 *   Cmd+/     Toggle the help overlay — fires from anywhere
 *
 * Suppression rules: keys are silenced when focus is inside an
 * input/textarea/select/contenteditable EXCEPT Cmd+K, Cmd+Enter,
 * Cmd+/, and Escape, which always work so users can dismiss/open
 * overlays + submit forms from anywhere.
 *
 * Public API:
 *   initShortcuts(shell, tabs)  — wire global listener
 *   destroyShortcuts()          — remove listener + close overlays
 */

const STATE = {
  inited: false,
  shell: null,
  tabs: [],
  helpOpen: false,
  searchOpen: false,
  keydownHandler: null,
};

const HELP_ID   = 'cc-shortcuts-help';
const SEARCH_ID = 'cc-quick-search';
const LS_RECENT = 'cerberus.palette.recent';
const MAX_RECENT = 10;

const SHORTCUTS_LIST = [
  ['?',         'Toggle this help overlay'],
  ['Cmd+/',     'Toggle this help overlay (works in inputs)'],
  ['Cmd+K',     'Command palette — search agents, rooms, tabs & run actions'],
  ['Cmd+Enter', 'Submit the active tab\'s primary action'],
  ['Esc',       'Close overlay / form / panel'],
  ['n',         'Click "+ New" in active tab'],
  ['/',         'Focus filter input'],
  ['r',         'ROOMS — focus the room filter'],
  ['t',         'RESEARCH — focus the query'],
  ['p',         'ASSISTANT — open profile editor'],
  ['g',         'Jump to GATEWAY tab'],
  ['Shift+R',   'Reset the active tab\'s form (COMPARE / RESEARCH)'],
  [',',         'Open Settings overlay'],
  ['1–8',       'Switch tabs by index'],
];

// ── Lifecycle ─────────────────────────────────────────────────────────

export function initShortcuts(shell, tabs) {
  if (STATE.inited) destroyShortcuts();
  STATE.inited = true;
  STATE.shell = shell || null;
  STATE.tabs = Array.isArray(tabs) ? tabs : [];
  STATE.keydownHandler = (e) => _onKeyDown(e);
  document.addEventListener('keydown', STATE.keydownHandler, true);
}

export function destroyShortcuts() {
  if (STATE.keydownHandler) {
    document.removeEventListener('keydown', STATE.keydownHandler, true);
  }
  _closeHelp();
  _closeSearch();
  STATE.inited = false;
  STATE.shell = null;
  STATE.tabs = [];
  STATE.keydownHandler = null;
}

// ── Key dispatch ──────────────────────────────────────────────────────

function _isTypingTarget(t) {
  if (!t) return false;
  const tag = (t.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

function _activeTabId() {
  const btn = STATE.shell?.querySelector('.cc-tab-btn.active');
  return btn?.dataset?.tab || '';
}

function _onKeyDown(e) {
  // ── Always-on combos (fire even while typing) ──

  // Cmd+K / Ctrl+K — command palette
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    _toggleSearch();
    return;
  }

  // Cmd+/ / Ctrl+/ — toggle help (works in inputs)
  if ((e.metaKey || e.ctrlKey) && e.key === '/') {
    e.preventDefault();
    _toggleHelp();
    return;
  }

  // Cmd+Enter / Ctrl+Enter — submit the active tab's primary action
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (_submitActiveForm(e.target)) e.preventDefault();
    return;
  }

  // Escape — close overlays / forms / panels (always available)
  if (e.key === 'Escape') {
    if (STATE.searchOpen) { _closeSearch(); e.preventDefault(); return; }
    if (STATE.helpOpen)   { _closeHelp();   e.preventDefault(); return; }
    if (_closeAnyOpenChrome()) { e.preventDefault(); return; }
    return;
  }

  // ── From here on, only fire when not typing and no modifier (except shift) ──
  if (_isTypingTarget(e.target)) return;
  if (e.altKey || e.metaKey || e.ctrlKey) return;

  if (e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    if (_resetActiveTab()) e.preventDefault();
    return;
  }
  if (e.shiftKey && e.key !== '?') return;

  switch (e.key) {
    case '?':
      e.preventDefault();
      _toggleHelp();
      return;
    case 'n':
    case 'N':
      if (_clickNewInActiveTab()) e.preventDefault();
      return;
    case '/':
      if (_focusFilterInput()) e.preventDefault();
      return;
    case 'r':
      if (_activeTabId() === 'rooms' && _focusFilterInput()) e.preventDefault();
      return;
    case 't':
      if (_activeTabId() === 'research' && _focusResearchQuery()) e.preventDefault();
      return;
    case 'p':
      _dispatchOpenProfile();
      e.preventDefault();
      return;
    case 'g':
      _switchTabById('gateway');
      e.preventDefault();
      return;
    case ',':
      document.dispatchEvent(new CustomEvent('cerberus:open-settings'));
      e.preventDefault();
      return;
    default: {
      const idx = '12345678'.indexOf(e.key);
      if (idx >= 0 && idx < STATE.tabs.length) {
        e.preventDefault();
        _switchTabByIndex(idx);
      }
    }
  }
}

// ── Tab + button glue ─────────────────────────────────────────────────

function _switchTabByIndex(idx) {
  const tab = STATE.tabs[idx];
  if (!tab) return;
  const btn = STATE.shell?.querySelector(`.cc-tab-btn[data-tab="${tab.id}"]`);
  btn?.click();
}

function _activeContent() {
  return STATE.shell?.querySelector('#cc-tab-content') || null;
}

function _clickNewInActiveTab() {
  const content = _activeContent();
  if (!content) return false;
  const btn = content.querySelector(
    '[data-cc-new], #cc-rooms-new-btn, #cc-ag-new-btn, .cc-ag-new-btn'
  );
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}

function _focusFilterInput() {
  const content = _activeContent();
  if (!content) return false;
  const input = content.querySelector(
    '[data-cc-filter], input[type="search"], .cc-filter-input, .cc-rooms-filter-input'
  );
  if (!input) return false;
  input.focus();
  if (typeof input.select === 'function') input.select();
  return true;
}

function _focusResearchQuery() {
  const content = _activeContent();
  if (!content) return false;
  const ta = content.querySelector('.cc-research-query');
  if (!ta) return false;
  ta.focus();
  if (typeof ta.select === 'function') ta.select();
  return true;
}

function _dispatchOpenProfile() {
  try {
    document.dispatchEvent(new CustomEvent('cerberus:open-profile'));
  } catch (_) {}
}

function _switchTabById(id) {
  const btn = STATE.shell?.querySelector(`.cc-tab-btn[data-tab="${id}"]`);
  btn?.click();
}

function _dispatch(event, detail = {}) {
  try { document.dispatchEvent(new CustomEvent(event, { detail, bubbles: true })); } catch (_) {}
}

const _SUBMIT_SELECTORS_BY_TAB = {
  research:  '.cc-research-start-btn',
  compare:   '.cc-compare-run-btn',
  rooms:     '#cc-room-create-btn, .cc-room-send-btn, #cc-room-send-btn',
  assistant: '.cc-chat-send-btn, #cc-chat-send, .cc-notes-save-btn',
  agents:    '.cc-ag-submit-btn',
};

function _submitActiveForm(target) {
  if (target && typeof target.closest === 'function') {
    const explicit = target.closest('[data-cc-submit]');
    if (explicit) {
      const sel = explicit.getAttribute('data-cc-submit') || '';
      const btn = sel
        ? (_activeContent()?.querySelector(sel) || document.querySelector(sel))
        : null;
      if (btn && !btn.disabled) { btn.click(); return true; }
    }
  }
  const content = _activeContent();
  if (!content) return false;
  const sel = _SUBMIT_SELECTORS_BY_TAB[_activeTabId()];
  if (sel) {
    const btn = content.querySelector(sel);
    if (btn && !btn.disabled) { btn.click(); return true; }
  }
  const fallback = content.querySelector(
    '[data-cc-submit-fallback], .cc-research-start-btn, .cc-compare-run-btn'
  );
  if (fallback && !fallback.disabled) { fallback.click(); return true; }
  return false;
}

function _resetActiveTab() {
  const content = _activeContent();
  if (!content) return false;
  const id = _activeTabId();
  if (id === 'compare') {
    const resetBtn = content.querySelector('.cc-compare-reset-btn');
    if (resetBtn) { resetBtn.click(); return true; }
    return false;
  }
  if (id === 'research') {
    const q = content.querySelector('.cc-research-query');
    if (q) { q.value = ''; q.focus(); return true; }
    return false;
  }
  return false;
}

function _closeAnyOpenChrome() {
  let closed = false;
  document.querySelectorAll(
    '.cc-room-new-form, #cc-ag-create-form, .cc-ag-invoke-form'
  ).forEach(el => {
    if (el.style && el.style.display && el.style.display !== 'none') {
      el.style.display = 'none';
      closed = true;
    }
  });
  document.querySelectorAll('.cc-agent-row.expanded').forEach(row => {
    row.classList.remove('expanded');
    closed = true;
  });
  document.querySelectorAll('.cc-agent-detail.visible, .cc-agent-detail.open').forEach(d => {
    d.classList.remove('visible');
    d.classList.remove('open');
    closed = true;
  });
  document.querySelectorAll('.cc-agent-overlay').forEach(o => {
    o.remove();
    closed = true;
  });
  return closed;
}

// ── Help overlay ──────────────────────────────────────────────────────

function _toggleHelp() {
  if (STATE.helpOpen) _closeHelp(); else _openHelp();
}

function _openHelp() {
  if (STATE.helpOpen) return;
  const overlay = document.createElement('div');
  overlay.id = HELP_ID;
  overlay.className = 'cc-shortcuts-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Keyboard shortcuts');
  overlay.innerHTML = `
<div class="cc-shortcuts-panel" role="document">
  <div class="cc-shortcuts-header">
    <span class="cc-shortcuts-title">KEYBOARD SHORTCUTS</span>
    <button class="cc-shortcuts-close" aria-label="Close" type="button" style="-webkit-appearance:none;appearance:none;">×</button>
  </div>
  <table class="cc-shortcuts-table">
    <tbody>
      ${SHORTCUTS_LIST.map(([k, d]) => `<tr>
        <td class="cc-sc-key">${k}</td>
        <td class="cc-sc-desc">${d}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>`.trim();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeHelp(); });
  overlay.querySelector('.cc-shortcuts-close')?.addEventListener('click', _closeHelp);
  document.body.appendChild(overlay);
  STATE.helpOpen = true;
}

function _closeHelp() {
  const el = document.getElementById(HELP_ID);
  if (el) el.remove();
  STATE.helpOpen = false;
}

// ── Command palette ───────────────────────────────────────────────────

function _getRecent() {
  try { return JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); } catch (_) { return []; }
}

function _addRecent(id) {
  try {
    const r = _getRecent().filter(x => x !== id);
    r.unshift(id);
    localStorage.setItem(LS_RECENT, JSON.stringify(r.slice(0, MAX_RECENT)));
  } catch (_) {}
}

function _fuzzyScore(haystack, q) {
  if (!q) return 1;
  const h = haystack.toLowerCase();
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.every(t => h.includes(t))) return 0;
  if (h === q) return 10;
  if (h.startsWith(q)) return 6;
  if (h.includes(q)) return 3;
  return 1;
}

function _buildCommands() {
  return [
    { id: 'new-note', kind: 'command', label: 'New note', desc: 'Create a new note', haystack: 'new note create note', action: () => _dispatch('cerberus:new-note') },
    { id: 'new-scheduled-task', kind: 'command', label: 'New scheduled task', desc: 'Open the task scheduler', haystack: 'new scheduled task create schedule', action: () => _dispatch('cerberus:new-scheduled-task') },
    { id: 'create-room', kind: 'command', label: 'Create room', desc: 'Open the new room form', haystack: 'create room new conference', action: () => { _switchTabById('rooms'); setTimeout(() => document.querySelector('#cc-rooms-new-btn, [data-cc-new]')?.click(), 80); } },
    { id: 'run-research', kind: 'command', label: 'Run research', desc: 'Switch to Research and focus query', haystack: 'run research search query', action: () => { _switchTabById('research'); setTimeout(_focusResearchQuery, 80); } },
    { id: 'open-settings', kind: 'command', label: 'Open settings', desc: 'Open the settings panel', haystack: 'open settings preferences config', action: () => _dispatch('cerberus:open-settings') },
    { id: 'toggle-wake-word', kind: 'command', label: 'Toggle wake word', desc: 'Enable / disable wake-word detection', haystack: 'toggle wake word voice activation hotword', action: () => _dispatch('cerberus:toggle-wake-word') },
    { id: 'export-thread', kind: 'command', label: 'Export current thread', desc: 'Export the active chat thread', haystack: 'export thread download chat session', action: () => _dispatch('cerberus:export-thread') },
    { id: 'summarise-thread', kind: 'command', label: 'Summarise current thread', desc: 'Ask the assistant to summarise', haystack: 'summarise summarize thread chat tldr', action: () => _dispatch('cerberus:summarise-thread') },
    { id: 'clear-search-history', kind: 'command', label: 'Clear search history', desc: 'Wipe the research search history', haystack: 'clear search history research wipe', action: () => _dispatch('cerberus:clear-search-history') },
    { id: 'view-changelog', kind: 'command', label: 'View changelog', desc: "Open the What's New panel", haystack: "view changelog what's new updates releases", action: () => _dispatch('cerberus:view-changelog') },
  ];
}

function _renderPalette(matches, selected) {
  if (!matches.length) return '<li class="cc-palette-empty">No matches.</li>';
  const ORDER  = ['agent', 'room', 'tab', 'command'];
  const LABELS = { agent: 'AGENTS', room: 'ROOMS', tab: 'TABS', command: 'ACTIONS' };
  const groups = {};
  matches.forEach((it, i) => { (groups[it.kind] = groups[it.kind] || []).push({ it, i }); });
  let html = '';
  for (const kind of ORDER) {
    const items = groups[kind];
    if (!items?.length) continue;
    html += `<li class="cc-palette-group-header" aria-hidden="true">// ${LABELS[kind]}</li>`;
    for (const { it, i } of items) {
      const text = _esc(it.label || it.name || '');
      const sub  = _esc(it.desc  || it.sub  || '');
      if (it.kind === 'agent' || it.kind === 'room') {
        html += `<li class="cc-quick-search-item${i === selected ? ' selected' : ''}"
            data-palette-idx="${i}" role="option" aria-selected="${i === selected}">
          <span class="cc-sr-tag cc-sr-tag--${_esc(it.kind)}">${it.kind === 'agent' ? 'AG' : 'RM'}</span>
          <span class="cc-sr-name">${text}</span>
          ${sub ? `<span class="cc-sr-sub">${sub}</span>` : ''}
        </li>`;
      } else {
        html += `<li class="cc-palette-item${i === selected ? ' selected' : ''}"
            data-palette-idx="${i}" role="option" aria-selected="${i === selected}">
          <span class="cc-pr-name">${text}</span>
          ${sub ? `<span class="cc-pr-desc">${sub}</span>` : ''}
        </li>`;
      }
    }
  }
  return html;
}

function _toggleSearch() {
  if (STATE.searchOpen) _closeSearch(); else _openSearch();
}

function _openSearch() {
  if (STATE.searchOpen) return;
  const overlay = document.createElement('div');
  overlay.id = SEARCH_ID;
  overlay.className = 'cc-quick-search-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');
  overlay.innerHTML = `
<div class="cc-quick-search-panel" role="document">
  <input class="cc-quick-search-input" id="cc-quick-search-input"
         type="search" autocomplete="off" spellcheck="false"
         placeholder="Search agents, rooms, tabs, commands…"
         aria-label="Command palette" style="-webkit-appearance:none;appearance:none;" />
  <ul class="cc-quick-search-results" id="cc-quick-search-results"
      role="listbox" aria-label="Results"></ul>
  <div class="cc-quick-search-hint" aria-hidden="true">
    <span><kbd>↑↓</kbd> navigate</span>
    <span class="cc-quick-search-hint-dot">·</span>
    <span><kbd>↵</kbd> execute</span>
    <span class="cc-quick-search-hint-dot">·</span>
    <span><kbd>Esc</kbd> close</span>
  </div>
</div>`.trim();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _closeSearch(); });
  document.body.appendChild(overlay);
  STATE.searchOpen = true;

  const input   = overlay.querySelector('#cc-quick-search-input');
  const results = overlay.querySelector('#cc-quick-search-results');
  const pool    = _gatherSearchPool();
  let selected  = 0;
  let matches   = [];

  function render() {
    const q = (input.value || '').trim().toLowerCase();
    if (q) {
      matches = pool
        .map(it => ({ ...it, _score: _fuzzyScore(it.haystack, q) }))
        .filter(it => it._score > 0)
        .sort((a, b) => b._score - a._score)
        .slice(0, 20);
    } else {
      const recent = _getRecent();
      matches = pool
        .filter(it => it.kind === 'command' || it.kind === 'tab')
        .sort((a, b) => {
          const ra = recent.indexOf(a.id), rb = recent.indexOf(b.id);
          if (ra === -1 && rb === -1) return 0;
          if (ra === -1) return 1;
          if (rb === -1) return -1;
          return ra - rb;
        })
        .slice(0, 12);
    }
    selected = Math.max(0, Math.min(selected, matches.length - 1));
    results.innerHTML = _renderPalette(matches, selected);
  }

  input.addEventListener('input', () => { selected = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      selected = Math.min(selected + 1, matches.length - 1);
      e.preventDefault(); render();
    } else if (e.key === 'ArrowUp') {
      selected = Math.max(selected - 1, 0);
      e.preventDefault(); render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[selected]) _activate(matches[selected]);
    }
  });
  results.addEventListener('click', (e) => {
    const li = e.target.closest('[data-palette-idx]');
    if (!li) return;
    const idx = parseInt(li.dataset.paletteIdx, 10);
    if (!isNaN(idx) && matches[idx]) _activate(matches[idx]);
  });

  render();
  setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
}

function _closeSearch() {
  const el = document.getElementById(SEARCH_ID);
  if (el) el.remove();
  STATE.searchOpen = false;
}

function _gatherSearchPool() {
  const pool = [];
  const recent = _getRecent();

  document.querySelectorAll('.cc-agent-row').forEach(row => {
    const name = (row.dataset.agentName || row.querySelector('.cc-row-name')?.textContent || '').trim();
    const id   = row.dataset.id || '';
    const role = row.querySelector('.cc-row-role')?.textContent?.trim() || '';
    if (!id || !name) return;
    pool.push({ kind: 'agent', id, name, sub: role, haystack: `new chat with ${name} ${role}`.toLowerCase() });
  });

  document.querySelectorAll('.cc-room-card').forEach(card => {
    const name = (card.dataset.roomName || card.querySelector('.cc-room-name')?.textContent || '').trim();
    const id   = card.dataset.roomId || '';
    const cnt  = card.querySelector('.cc-room-count')?.textContent?.trim() || '';
    if (!id || !name) return;
    pool.push({ kind: 'room', id, name, sub: cnt, haystack: (name + ' ' + cnt).toLowerCase() });
  });

  STATE.tabs.forEach(tab => {
    const label = `Switch to ${tab.label || tab.id}`;
    pool.push({
      kind: 'tab', id: `switch-tab-${tab.id}`, label, desc: tab.desc || '',
      haystack: label.toLowerCase(),
      action: () => _switchTabById(tab.id),
    });
  });

  const commands = _buildCommands();
  const recentIds = recent;
  commands
    .sort((a, b) => {
      const ra = recentIds.indexOf(a.id), rb = recentIds.indexOf(b.id);
      if (ra === -1 && rb === -1) return 0;
      if (ra === -1) return 1;
      if (rb === -1) return -1;
      return ra - rb;
    })
    .forEach(c => pool.push(c));

  return pool;
}

function _activate(item) {
  if (item.kind === 'command' || item.kind === 'tab') _addRecent(item.id);
  _closeSearch();
  if (item.action) { item.action(); return; }
  if (item.kind === 'agent') {
    const row = document.querySelector(`.cc-agent-row[data-id="${CSS.escape(item.id)}"]`);
    const chatBtn = row?.querySelector('.cc-row-btn-chat');
    if (chatBtn) chatBtn.click(); else _switchTabById('agents');
  } else if (item.kind === 'room') {
    const card = document.querySelector(`.cc-room-card[data-room-id="${CSS.escape(item.id)}"]`);
    const openBtn = card?.querySelector('.cc-room-open-btn');
    if (openBtn) openBtn.click(); else _switchTabById('rooms');
  }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Testables ─────────────────────────────────────────────────────────

export const __testables = {
  STATE,
  SHORTCUTS_LIST,
  isTypingTarget: _isTypingTarget,
  onKeyDown: _onKeyDown,
  openHelp:   _openHelp,
  closeHelp:  _closeHelp,
  toggleHelp: _toggleHelp,
  openSearch:  _openSearch,
  closeSearch: _closeSearch,
  toggleSearch: _toggleSearch,
  submitActiveForm: _submitActiveForm,
  resetActiveTab:   _resetActiveTab,
  dispatchOpenProfile: _dispatchOpenProfile,
  gatherSearchPool: _gatherSearchPool,
  buildCommands:    _buildCommands,
  fuzzyScore:       _fuzzyScore,
  getRecent:        _getRecent,
  addRecent:        _addRecent,
  activate:         _activate,
  renderPalette:    _renderPalette,
};
