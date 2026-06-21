/**
 * cc-documents.js — DOCUMENTS panel for the Command Center ASSISTANT tab.
 *
 * Surfaces the existing document library so an operator can browse / view
 * / import / create / delete documents without leaving the assistant. Sits
 * below the OPERATOR PROFILE section (or below contacts / search history
 * once those land — they're not present yet).
 *
 * Endpoint shapes verified against routes/document_routes.py:
 *   - GET    /api/documents/library         → { documents: [{id, title,
 *                                              preview, created_at,
 *                                              updated_at, version_count,
 *                                              language, session_name}], ... }
 *   - GET    /api/document/{doc_id}         → single doc (with content)
 *   - POST   /api/document                  → create
 *                                              body { title, content,
 *                                                     language?, session_id? }
 *   - POST   /api/documents/import-pdf      → multipart
 *   - DELETE /api/document/{doc_id}         → soft delete (SINGULAR path)
 *
 * styles.css is locked for this branch, so styles are injected once via a
 * single <style id="cc-docs-styles"> appended to <head> on first load. All
 * rules use --cc-* / --cc-fg / color-mix(...) tokens — no hardcoded hex.
 */

const STYLE_ID = 'cc-docs-styles';

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.cc-docs-panel {
  margin: 8px 12px 0; padding: 12px;
  background: color-mix(in srgb, var(--cc-void-mid, var(--bg, #1a1d23)) 92%, transparent);
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  border-radius: 3px;
  display: flex; flex-direction: column; gap: 8px;
}
.cc-docs-panel .cc-agents-tab-header {
  display: flex; align-items: center; gap: 8px;
}
.cc-docs-upload-btn,
.cc-docs-new-btn,
.cc-docs-copy-btn,
.cc-docs-delete-btn,
.cc-docs-back-btn,
.cc-docs-save-btn,
.cc-docs-cancel-btn,
.cc-docs-confirm-btn {
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 70%, transparent);
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
  padding: 4px 10px; border-radius: 2px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  transition: border-color 0.15s, color 0.15s;
}
.cc-docs-upload-btn:hover,
.cc-docs-new-btn:hover,
.cc-docs-copy-btn:hover,
.cc-docs-back-btn:hover,
.cc-docs-save-btn:hover,
.cc-docs-cancel-btn:hover {
  border-color: var(--cc-crimson, var(--red, #c0392b));
  color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-docs-delete-btn,
.cc-docs-confirm-btn {
  border-color: color-mix(in srgb, var(--cc-crit, #e74c3c) 60%, transparent);
  color: var(--cc-crit, #e74c3c);
}
.cc-docs-confirm-btn { border-color: var(--cc-crit, #e74c3c); }
.cc-docs-new-btn { margin-left: auto; }
.cc-docs-search {
  width: 100%; box-sizing: border-box;
  padding: 5px 10px;
  background: var(--cc-void-mid, var(--bg, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: var(--cc-fg, var(--fg, #c5c9d0));
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px; letter-spacing: 0.02em;
  outline: none;
  -webkit-appearance: none; appearance: none;
}
.cc-docs-search::placeholder {
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 40%, transparent);
}
.cc-docs-search:focus { border-color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-docs-list {
  display: flex; flex-direction: column;
  max-height: 240px; overflow-y: auto;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  border-radius: 2px;
}
.cc-docs-row {
  display: grid; grid-template-columns: 1fr auto; gap: 8px;
  padding: 8px 10px;
  border: none; border-bottom: 1px solid var(--cc-border, var(--border, #3a2a2a));
  background: transparent; color: inherit; cursor: pointer; text-align: left;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-docs-row:last-child { border-bottom: none; }
.cc-docs-row:hover {
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 7%, transparent);
}
.cc-docs-row-title {
  font-size: 11px; letter-spacing: 0.04em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cc-docs-row-meta {
  font-size: 9px; letter-spacing: 0.02em; white-space: nowrap;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 40%, transparent);
}
.cc-docs-row--hidden { display: none; }
.cc-docs-viewer,
.cc-docs-editor { display: flex; flex-direction: column; gap: 8px; }
.cc-docs-viewer-title {
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 12px; letter-spacing: 0.06em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
}
.cc-docs-viewer-body {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px; line-height: 1.6;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  white-space: pre-wrap; word-break: break-word;
  max-height: 360px; overflow-y: auto;
  padding: 8px 10px;
  background: var(--cc-void-mid, var(--bg, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  border-radius: 2px;
}
.cc-docs-viewer-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
.cc-docs-editor-title-input,
.cc-docs-editor-body-input {
  width: 100%; box-sizing: border-box;
  background: var(--cc-void-mid, var(--bg, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: var(--cc-fg, var(--fg, #c5c9d0));
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  padding: 6px 10px;
  outline: none;
  -webkit-appearance: none; appearance: none;
}
.cc-docs-editor-title-input { font-size: 12px; letter-spacing: 0.04em; }
.cc-docs-editor-body-input  { font-size: 11px; line-height: 1.5; resize: vertical; min-height: 140px; }
.cc-docs-editor-title-input:focus,
.cc-docs-editor-body-input:focus { border-color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-docs-status {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 10px; letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 60%, transparent);
  margin-left: auto;
}
.cc-docs-status[data-tone="ok"]  { color: var(--cc-ok, #27ae60); }
.cc-docs-status[data-tone="err"] { color: var(--cc-crit, #e74c3c); }
`.trim();
  document.head.appendChild(style);
}

// ── Pure helpers (exposed via __testables) ────────────────────────────

function _matchesQuery(doc, q) {
  if (!q) return true;
  const ql = String(q).trim().toLowerCase();
  if (!ql) return true;
  return String(doc?.title || '').toLowerCase().includes(ql);
}

function _formatMeta(doc) {
  const parts = [];
  if (doc?.created_at) {
    try {
      const d = new Date(doc.created_at);
      if (!isNaN(d.getTime())) parts.push(d.toISOString().slice(0, 10));
    } catch (_) {}
  }
  const wc = _wordCount(doc?.preview || '');
  if (wc > 0) parts.push(`${wc} words`);
  return parts.join(' · ');
}

function _wordCount(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// ── Build ──────────────────────────────────────────────────────────────

export function buildDocsPanel() {
  _injectStyles();
  return `
<section class="cc-docs-panel" aria-label="Documents">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">DOCUMENTS</span>
    <label class="cc-docs-upload-label">
      <input type="file" id="cc-docs-pdf-input" accept=".pdf" hidden />
      <span class="cc-docs-upload-btn">↑ Import PDF</span>
    </label>
    <button class="cc-docs-new-btn" type="button">+ New</button>
    <span class="cc-docs-status" id="cc-docs-status" data-tone=""></span>
  </div>

  <input class="cc-docs-search" id="cc-docs-search"
         type="search" placeholder="// filter documents..."
         autocomplete="off" spellcheck="false"
         aria-label="Filter documents by title" />

  <div class="cc-docs-list" id="cc-docs-list">
    <div class="cc-empty">Loading documents…</div>
  </div>

  <div class="cc-docs-viewer" id="cc-docs-viewer" style="display:none">
    <div class="cc-docs-viewer-title" id="cc-docs-viewer-title"></div>
    <div class="cc-docs-viewer-body"  id="cc-docs-viewer-body"></div>
    <div class="cc-docs-viewer-actions">
      <button class="cc-docs-copy-btn"    type="button">// COPY</button>
      <button class="cc-docs-delete-btn"  type="button">// DELETE</button>
      <button class="cc-docs-confirm-btn" type="button" style="display:none">// CONFIRM DELETE</button>
      <button class="cc-docs-back-btn"    type="button">← BACK</button>
    </div>
  </div>

  <div class="cc-docs-editor" id="cc-docs-editor" style="display:none">
    <input class="cc-docs-editor-title-input" id="cc-docs-new-title"
           placeholder="// title" autocomplete="off" spellcheck="false" />
    <textarea class="cc-docs-editor-body-input" id="cc-docs-new-body"
              rows="8" placeholder="// content..." spellcheck="false"></textarea>
    <div class="cc-docs-viewer-actions">
      <button class="cc-docs-save-btn"   type="button">// SAVE</button>
      <button class="cc-docs-cancel-btn" type="button">// CANCEL</button>
    </div>
  </div>
</section>`.trim();
}

// ── Load + wire ────────────────────────────────────────────────────────

export async function loadDocs(container) {
  _injectStyles();
  const root      = container.querySelector('.cc-docs-panel') || container;
  const searchEl  = root.querySelector('#cc-docs-search');
  const listEl    = root.querySelector('#cc-docs-list');
  const viewerEl  = root.querySelector('#cc-docs-viewer');
  const editorEl  = root.querySelector('#cc-docs-editor');
  const newBtn    = root.querySelector('.cc-docs-new-btn');
  const pdfInput  = root.querySelector('#cc-docs-pdf-input');
  const statusEl  = root.querySelector('#cc-docs-status');

  const titleEl    = root.querySelector('#cc-docs-viewer-title');
  const bodyEl     = root.querySelector('#cc-docs-viewer-body');
  const copyBtn    = root.querySelector('.cc-docs-copy-btn');
  const deleteBtn  = root.querySelector('.cc-docs-delete-btn');
  const confirmBtn = root.querySelector('.cc-docs-confirm-btn');
  const backBtn    = root.querySelector('.cc-docs-back-btn');

  const newTitle   = root.querySelector('#cc-docs-new-title');
  const newBody    = root.querySelector('#cc-docs-new-body');
  const saveBtn    = root.querySelector('.cc-docs-save-btn');
  const cancelBtn  = root.querySelector('.cc-docs-cancel-btn');

  let docs       = [];
  let viewingId  = null;
  let lastQuery  = '';

  function _setStatus(msg, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.dataset.tone = tone;
  }

  function _showList() {
    if (listEl)   listEl.style.display   = '';
    if (viewerEl) viewerEl.style.display = 'none';
    if (editorEl) editorEl.style.display = 'none';
    if (searchEl) searchEl.style.display = '';
  }
  function _showViewer() {
    if (listEl)   listEl.style.display   = 'none';
    if (viewerEl) viewerEl.style.display = '';
    if (editorEl) editorEl.style.display = 'none';
    if (searchEl) searchEl.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
  }
  function _showEditor() {
    if (listEl)   listEl.style.display   = 'none';
    if (viewerEl) viewerEl.style.display = 'none';
    if (editorEl) editorEl.style.display = '';
    if (searchEl) searchEl.style.display = 'none';
    newTitle?.focus?.();
  }

  function _renderList() {
    const filtered = docs.filter(d => _matchesQuery(d, lastQuery));
    if (!filtered.length) {
      listEl.innerHTML = lastQuery
        ? '<div class="cc-empty">No documents match.</div>'
        : '<div class="cc-empty">No documents yet. Hit "+ New" or "↑ Import PDF" to add one.</div>';
      return;
    }
    listEl.innerHTML = filtered.map(d => {
      const meta = _formatMeta(d);
      return `<button class="cc-docs-row" data-id="${_esc(d.id)}">
        <span class="cc-docs-row-title">${_esc(d.title || '(untitled)')}</span>
        <span class="cc-docs-row-meta">${_esc(meta)}</span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.cc-docs-row').forEach(row => {
      row.addEventListener('click', () => _openDoc(row.dataset.id));
    });
  }

  async function _fetchLibrary() {
    try {
      const r = await fetch('/api/documents/library?limit=50', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      docs = Array.isArray(data?.documents) ? data.documents : [];
      _renderList();
    } catch (e) {
      listEl.innerHTML = `<div class="cc-empty">Could not load documents — ${_esc(e.message)}</div>`;
    }
  }

  async function _openDoc(id) {
    if (!id) return;
    viewingId = id;
    _showViewer();
    titleEl.textContent = 'Loading…';
    bodyEl.textContent  = '';
    try {
      const r = await fetch(`/api/document/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // Untrusted content — write via textContent so any embedded markup
      // stays as visible text, never as live HTML.
      titleEl.textContent = String(data?.title || '(untitled)');
      bodyEl.textContent  = String(data?.current_content || data?.content || '');
    } catch (e) {
      titleEl.textContent = 'Could not load document.';
      bodyEl.textContent  = String(e.message || '');
    }
  }

  searchEl?.addEventListener('input', () => {
    lastQuery = searchEl.value || '';
    _renderList();
  });

  newBtn?.addEventListener('click', () => {
    newTitle.value = '';
    newBody.value  = '';
    _showEditor();
  });

  cancelBtn?.addEventListener('click', () => {
    newTitle.value = ''; newBody.value = '';
    _showList();
  });

  saveBtn?.addEventListener('click', async () => {
    const title   = (newTitle.value || '').trim();
    const content = newBody.value || '';
    if (!title && !content) return;
    saveBtn.disabled = true;
    _setStatus('// SAVING…', '');
    try {
      const r = await fetch('/api/document', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Untitled', content }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _setStatus('// SAVED', 'ok');
      await _fetchLibrary();
      _showList();
    } catch (e) {
      _setStatus(`// SAVE FAILED — ${e.message}`, 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });

  backBtn?.addEventListener('click', () => {
    viewingId = null;
    _showList();
  });

  copyBtn?.addEventListener('click', async () => {
    const text = bodyEl.textContent || '';
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        _setStatus('// COPIED', 'ok');
        return;
      }
      throw new Error('clipboard unavailable');
    } catch (_) {
      _setStatus('// COPY FAILED', 'err');
    }
  });

  // Two-step delete: first click reveals CONFIRM; second click does it.
  deleteBtn?.addEventListener('click', () => {
    if (!confirmBtn) return;
    confirmBtn.style.display = '';
    deleteBtn.disabled = true;
  });
  confirmBtn?.addEventListener('click', async () => {
    if (!viewingId) return;
    confirmBtn.disabled = true;
    try {
      const r = await fetch(`/api/document/${encodeURIComponent(viewingId)}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _setStatus('// DELETED', 'ok');
      viewingId = null;
      await _fetchLibrary();
      _showList();
    } catch (e) {
      _setStatus(`// DELETE FAILED — ${e.message}`, 'err');
    } finally {
      confirmBtn.disabled = false;
      deleteBtn.disabled  = false;
      if (confirmBtn) confirmBtn.style.display = 'none';
    }
  });

  pdfInput?.addEventListener('change', async () => {
    const file = pdfInput.files && pdfInput.files[0];
    if (!file) return;
    _setStatus('// IMPORTING…', '');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/documents/import-pdf', {
        method: 'POST', credentials: 'same-origin', body: fd,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _setStatus('// DONE', 'ok');
      await _fetchLibrary();
    } catch (e) {
      _setStatus(`// FAILED — ${e.message}`, 'err');
    } finally {
      pdfInput.value = '';
    }
  });

  _showList();
  await _fetchLibrary();
}

// ── Exposed for tests/test_cc_documents.test.mjs ─────────────────────

export const __testables = {
  STYLE_ID,
  _matchesQuery, _formatMeta, _wordCount, _esc,
};
