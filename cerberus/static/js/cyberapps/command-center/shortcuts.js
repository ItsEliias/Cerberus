/**
 * shortcuts.js — Keyboard shortcuts for the Command Center shell.
 *
 * Base set (PR #48):
 *   ?         Toggle the shortcuts help overlay
 *   n         Click the active tab's "+ New" button (if visible)
 *   Esc       Close any open overlay / form / detail panel
 *   /         Focus the active tab's filter input (if present)
 *   1–8       Switch CC tabs by index
 *   Cmd+K     Open the quick-search overlay (agents + rooms)
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

const SHORTCUTS_LIST = [
  ['?',         'Toggle this help overlay'],
  ['Cmd+/',     'Toggle this help overlay (works in inputs)'],
  ['Cmd+K',     'Quick search agents and rooms'],
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

  // Cmd+K / Ctrl+K — quick search
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
    return; // nothing to close — let other handlers see Esc
  }

  // ── From here on, only fire when not typing and no modifier (except shift) ──
  if (_isTypingTarget(e.target)) return;
  if (e.altKey || e.metaKey || e.ctrlKey) return;

  // Shift+R — reset the active tab's primary form. Check before the
  // letter-key switch so the bare 'R' / 'r' branches don't swallow it.
  if (e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    if (_resetActiveTab()) e.preventDefault();
    return;
  }
  // Any other shift+letter combo is owned by the browser — don't fight it.
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
  } catch (_) { /* old browsers — non-fatal */ }
}

function _switchTabById(id) {
  const btn = STATE.shell?.querySelector(`.cc-tab-btn[data-tab="${id}"]`);
  btn?.click();
}

// Primary action per active tab. Looks first for a known submit class,
// then falls back to a [data-cc-submit] hook so other modules can opt in.
const _SUBMIT_SELECTORS_BY_TAB = {
  research:  '.cc-research-start-btn',
  compare:   '.cc-compare-run-btn',
  rooms:     '#cc-room-create-btn, .cc-room-send-btn, #cc-room-send-btn',
  assistant: '.cc-chat-send-btn, #cc-chat-send, .cc-notes-save-btn',
  agents:    '.cc-ag-submit-btn',
};

function _submitActiveForm(target) {
  // 1. Closest form-aware submit hook on the focused element's ancestors.
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
  // 2. Tab-specific defaults
  const content = _activeContent();
  if (!content) return false;
  const sel = _SUBMIT_SELECTORS_BY_TAB[_activeTabId()];
  if (sel) {
    const btn = content.querySelector(sel);
    if (btn && !btn.disabled) { btn.click(); return true; }
  }
  // 3. Last resort — any primary-looking button in the active tab
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
  // Hide visible inline forms that follow the show/hide-by-style pattern
  document.querySelectorAll(
    '.cc-room-new-form, #cc-ag-create-form, .cc-ag-invoke-form'
  ).forEach(el => {
    if (el.style && el.style.display && el.style.display !== 'none') {
      el.style.display = 'none';
      closed = true;
    }
  });
  // Collapse expanded detail panels
  document.querySelectorAll('.cc-agent-row.expanded').forEach(row => {
    row.classList.remove('expanded');
    closed = true;
  });
  document.querySelectorAll('.cc-agent-detail.visible, .cc-agent-detail.open').forEach(d => {
    d.classList.remove('visible');
    d.classList.remove('open');
    closed = true;
  });
  // Free-floating CC overlays (built by agents.js, etc.)
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
    <button class="cc-shortcuts-close" aria-label="Close">×</button>
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

// ── Quick-search overlay ──────────────────────────────────────────────

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
  overlay.setAttribute('aria-label', 'Quick search');
  overlay.innerHTML = `
<div class="cc-quick-search-panel" role="document">
  <input class="cc-quick-search-input" id="cc-quick-search-input"
         type="search" autocomplete="off" spellcheck="false"
         placeholder="Search agents and rooms…"
         aria-label="Search agents and rooms" />
  <ul class="cc-quick-search-results" id="cc-quick-search-results"
      role="listbox" aria-label="Search results"></ul>
  <div class="cc-quick-search-hint" id="cc-quick-search-hint" aria-hidden="true">
    <span><kbd>↑↓</kbd> navigate</span>
    <span class="cc-quick-search-hint-dot">·</span>
    <span><kbd>↵</kbd> select</span>
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
    matches = q
      ? pool.filter(it => it.haystack.includes(q)).slice(0, 12)
      : pool.slice(0, 12);
    selected = Math.max(0, Math.min(selected, matches.length - 1));
    if (!matches.length) {
      results.innerHTML = '<li class="cc-quick-search-empty">No matches.</li>';
      return;
    }
    results.innerHTML = matches.map((it, i) => `
<li class="cc-quick-search-item${i === selected ? ' selected' : ''}"
    data-kind="${_esc(it.kind)}" data-id="${_esc(it.id)}"
    role="option" aria-selected="${i === selected ? 'true' : 'false'}">
  <span class="cc-sr-tag cc-sr-tag--${_esc(it.kind)}">${it.kind === 'agent' ? 'AG' : 'RM'}</span>
  <span class="cc-sr-name">${_esc(it.name)}</span>
  ${it.sub ? `<span class="cc-sr-sub">${_esc(it.sub)}</span>` : ''}
</li>`).join('');
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
      const item = matches[selected];
      if (item) _activate(item);
    }
  });
  results.addEventListener('click', (e) => {
    const li = e.target.closest('.cc-quick-search-item');
    if (!li) return;
    const item = matches.find(it => it.kind === li.dataset.kind && it.id === li.dataset.id);
    if (item) _activate(item);
  });

  render();
  // Defer focus until the overlay is in the layout
  setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
}

function _closeSearch() {
  const el = document.getElementById(SEARCH_ID);
  if (el) el.remove();
  STATE.searchOpen = false;
}

function _gatherSearchPool() {
  const pool = [];
  document.querySelectorAll('.cc-agent-row').forEach(row => {
    const name = (row.dataset.agentName
      || row.querySelector('.cc-row-name')?.textContent || '').trim();
    const id   = row.dataset.id || '';
    const role = row.querySelector('.cc-row-role')?.textContent?.trim() || '';
    if (!id || !name) return;
    pool.push({
      kind: 'agent', id, name, sub: role,
      haystack: (name + ' ' + role).toLowerCase(),
    });
  });
  document.querySelectorAll('.cc-room-card').forEach(card => {
    const name = (card.dataset.roomName
      || card.querySelector('.cc-room-name')?.textContent || '').trim();
    const id   = card.dataset.roomId || '';
    const cnt  = card.querySelector('.cc-room-count')?.textContent?.trim() || '';
    if (!id || !name) return;
    pool.push({
      kind: 'room', id, name, sub: cnt,
      haystack: (name + ' ' + cnt).toLowerCase(),
    });
  });
  return pool;
}

function _activate(item) {
  _closeSearch();
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

// ── Testables (consumed by tests/test_cc_shortcuts.test.mjs) ───────────

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
};
