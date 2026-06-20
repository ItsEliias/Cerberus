/**
 * cc-research.js — RECENT + SAVED SEARCHES panel for the Command Center
 * ASSISTANT tab.
 *
 * Same pattern as cc-notes.js / cc-notify.js: builds an inline panel and
 * wires loadResearch(container) on mount. The panel is layered into
 * assistant.js right after the NOTES panel.
 *
 * Endpoint shapes verified against routes/search_routes.py:
 *   - GET    /api/search/history?limit=10  → { history: [ {id, query, ...} ] }
 *   - DELETE /api/search/history/{id}      → remove one
 *   - GET    /api/search/saved             → { saved: [ {id, query, label, ...} ] }
 *   - POST   /api/search/saved             → create   { query, label }
 *   - DELETE /api/search/saved/{id}        → remove one
 *
 * Re-run pre-populates `#cc-chat-input` (the ASSISTANT directive input);
 * if a different consumer wants to wire its own search input, it can
 * listen for the `cerberus:research-rerun` CustomEvent dispatched on the
 * document with the chosen query.
 *
 * Token-only styling shipped via a one-time <style> tag injection in
 * `_ensureResearchStyles()` so we don't have to touch styles.css.
 */

const RECENT_LIMIT = 10;
const PREVIEW_MAX = 60;

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function _relativeTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch (_) { return ''; }
}

// ─── Panel HTML ─────────────────────────────────────────────────────────────

export function buildResearchPanel() {
  return `
<section class="cc-research" id="cc-research-panel" aria-label="Research history">
  <header class="cc-research-head">
    <span class="cc-research-title">// RECENT SEARCHES</span>
    <button class="cc-research-clear" id="cc-research-clear" type="button" title="Clear all history">CLEAR</button>
  </header>
  <div class="cc-research-body" id="cc-research-body">
    <div class="cc-empty">Loading…</div>
  </div>
</section>`.trim();
}

// ─── Public loader ──────────────────────────────────────────────────────────

export async function loadResearch(container) {
  _ensureResearchStyles();
  await _renderPanel(container);
  // Wire the document-level event so callers (chat.js search button, etc.)
  // can fire `cerberus:research-recorded` and we'll refresh.
  if (!container._researchBus) {
    container._researchBus = () => _renderPanel(container);
    document.addEventListener('cerberus:research-recorded', container._researchBus);
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────

async function _renderPanel(container) {
  const body  = container.querySelector('#cc-research-body');
  const clearBtn = container.querySelector('#cc-research-clear');
  if (!body) return;

  const [history, saved] = await Promise.allSettled([
    _fetchJSON(`/api/search/history?limit=${RECENT_LIMIT}`),
    _fetchJSON('/api/search/saved'),
  ]);

  const recents = history.status === 'fulfilled'
    ? (history.value?.history || []) : [];
  const bookmarks = saved.status === 'fulfilled'
    ? (saved.value?.saved || []) : [];

  if (!recents.length && !bookmarks.length) {
    body.innerHTML = '<div class="cc-empty">No searches yet — run a search to see it here.</div>';
    if (clearBtn) clearBtn.disabled = true;
    return;
  }
  if (clearBtn) clearBtn.disabled = !recents.length;

  // Saved entries render at the top with the ⭐ prefix.
  const rows = [
    ...bookmarks.map(s => _row(s, { saved: true })),
    ...recents.map(r => _row(r, { saved: false })),
  ];
  body.innerHTML = rows.join('');
  _wireRows(container);
  if (clearBtn) {
    clearBtn.onclick = () => _confirmClearAll(container);
  }
}

function _row(entry, { saved }) {
  const query    = _esc(_truncate(entry.query || '', PREVIEW_MAX));
  const fullQ    = _esc(entry.query || '');
  const sourceTag = entry.source ? `<span class="cc-rs-tag">${_esc(String(entry.source).toUpperCase())}</span>` : '';
  const time     = _esc(_relativeTime(entry.timestamp));
  const prefix   = saved ? '<span class="cc-rs-star" aria-hidden="true">★</span>' : '';
  const idAttr   = _esc(entry.id);
  const star     = saved
    ? `<button class="cc-rs-action cc-rs-unsave" data-action="unsave" data-id="${idAttr}" title="Remove saved">★</button>`
    : `<button class="cc-rs-action cc-rs-save"   data-action="save"   data-id="${idAttr}" data-query="${fullQ}" title="Save">☆</button>`;
  const del = saved
    ? '' // saved rows have only the star toggle for removal
    : `<button class="cc-rs-action cc-rs-del" data-action="delete" data-id="${idAttr}" title="Remove from history">×</button>`;
  return `<div class="cc-rs-row" data-saved="${saved ? '1' : '0'}">
    ${prefix}
    <button class="cc-rs-rerun" data-action="rerun" data-query="${fullQ}" title="${fullQ}">${query}</button>
    ${sourceTag}
    <span class="cc-rs-time">${time}</span>
    ${star}
    ${del}
  </div>`;
}

function _wireRows(container) {
  container.querySelectorAll('.cc-rs-row [data-action]').forEach(btn => {
    const a = btn.dataset.action;
    if (a === 'rerun')   btn.onclick = () => _rerun(btn.dataset.query, container);
    if (a === 'delete')  btn.onclick = () => _deleteHistory(btn.dataset.id, container);
    if (a === 'save')    btn.onclick = () => _save(btn.dataset.query, container);
    if (a === 'unsave')  btn.onclick = () => _unsave(btn.dataset.id, container);
  });
}

// ─── Actions ────────────────────────────────────────────────────────────────

function _rerun(query, container) {
  if (!query) return;
  // Two routes: the assistant chat input, or any listener that wires its
  // own search box (CustomEvent gives consumers a clean hook).
  const input = document.getElementById('cc-chat-input');
  if (input) {
    input.value = query;
    input.focus();
  }
  try {
    document.dispatchEvent(new CustomEvent('cerberus:research-rerun', {
      detail: { query },
    }));
  } catch (_) { /* CustomEvent unsupported — ignore */ }
}

async function _deleteHistory(id, container) {
  if (!id) return;
  try {
    await fetch(`/api/search/history/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
  } catch (_) { /* swallowed; UI refresh below will surface any 404 */ }
  await _renderPanel(container);
}

async function _save(query, container) {
  if (!query) return;
  try {
    await fetch('/api/search/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query }),
    });
  } catch (_) { /* swallowed */ }
  await _renderPanel(container);
}

async function _unsave(id, container) {
  if (!id) return;
  try {
    await fetch(`/api/search/saved/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
  } catch (_) { /* swallowed */ }
  await _renderPanel(container);
}

async function _confirmClearAll(container) {
  if (typeof confirm === 'function'
      && !confirm('Clear all search history?')) return;
  try {
    await fetch('/api/search/history', {
      method: 'DELETE', credentials: 'same-origin',
    });
  } catch (_) { /* swallowed */ }
  await _renderPanel(container);
}

async function _fetchJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Style injection ────────────────────────────────────────────────────────

const _STYLE_ID = 'cc-research-styles';
function _ensureResearchStyles() {
  if (typeof document === 'undefined') return;
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function'
      && document.getElementById(_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = _STYLE_ID;
  style.textContent = `
.cc-research {
  margin: 8px 12px 4px;
  padding: 10px 12px;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 3%, transparent);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-research-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
}
.cc-research-title {
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-research-clear {
  -webkit-appearance: none; appearance: none;
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 60%, transparent);
  font-family: inherit;
  font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase;
  padding: 3px 7px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cc-research-clear:hover { color: var(--cc-crimson, var(--red, #c0392b)); border-color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-research-clear:disabled { opacity: 0.4; cursor: default; }

.cc-research-body { display: flex; flex-direction: column; gap: 2px; }

.cc-rs-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto auto;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--cc-border, var(--border, #3a2a2a)) 60%, transparent);
}
.cc-rs-row:last-child { border-bottom: none; }
.cc-rs-row[data-saved="0"] { grid-template-columns: 1fr auto auto auto auto; }
.cc-rs-star {
  color: var(--cc-crimson, var(--red, #c0392b));
  font-size: 11px; line-height: 1; padding-left: 1px;
}

.cc-rs-rerun {
  -webkit-appearance: none; appearance: none;
  text-align: left; min-width: 0;
  background: transparent; border: none;
  font-family: inherit; font-size: 11px; letter-spacing: 0.02em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  cursor: pointer; padding: 2px 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cc-rs-rerun:hover { color: var(--cc-crimson, var(--red, #c0392b)); }

.cc-rs-tag {
  font-size: 8.5px; letter-spacing: 0.10em; text-transform: uppercase;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 55%, transparent);
  padding: 1px 5px;
}

.cc-rs-time {
  font-size: 9px; letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 35%, transparent);
  white-space: nowrap;
}

.cc-rs-action {
  -webkit-appearance: none; appearance: none;
  background: transparent; border: none;
  cursor: pointer;
  font-family: inherit; font-size: 12px; line-height: 1;
  padding: 2px 4px;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 50%, transparent);
  transition: color 0.15s;
}
.cc-rs-action:hover { color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-rs-unsave { color: var(--cc-crimson, var(--red, #c0392b)); }
  `.trim();
  document.head.appendChild(style);
}

// Test surface — keeps the private helpers reachable from node:test without
// exposing them to module consumers.
export const __testables = {
  _truncate, _relativeTime, _row, _esc,
};
