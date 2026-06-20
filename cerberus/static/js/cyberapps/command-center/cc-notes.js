/**
 * cc-notes.js — NOTES panel for the Command Center ASSISTANT tab.
 *
 * Same pattern as cc-research.js / cc-notify.js: builds an inline panel and
 * wires loadNotes(container) on mount. The panel is layered into
 * assistant.js below the OPERATOR PROFILE section.
 *
 * Endpoint shapes verified against routes/note_routes.py:
 *   - GET    /api/notes          → { notes: [ {id, title, content, ...} ] }
 *   - POST   /api/notes          → create   { title, content }
 *   - PUT    /api/notes/{id}     → update
 *   - DELETE /api/notes/{id}     → delete
 *
 * Pinning is intentionally client-side per spec — pinned IDs live in
 * `localStorage.cerberus.notes.pinned` so a wipe of the server-side `pinned`
 * field doesn't disturb a user's CC arrangement. localStorage errors are
 * swallowed.
 *
 * The markdown renderer is hand-rolled and allowlist-only: it never lets
 * raw HTML through from a note's text — every emitted tag comes from the
 * renderer itself, so passing a malicious payload through .innerHTML is
 * safe by construction.
 */

const PINNED_KEY = 'cerberus.notes.pinned';

// ── Pin storage (localStorage; silent on private-browsing failures) ────

function _readPinned() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch (_) { return new Set(); }
}

function _writePinned(set) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...set])); }
  catch (_) { /* quota / private browsing — silent */ }
}

function _togglePinnedId(id) {
  const set = _readPinned();
  if (set.has(id)) set.delete(id); else set.add(id);
  _writePinned(set);
  return set.has(id);
}

// ── Sorting + search (pure helpers — exposed for tests) ────────────────

function _sortNotesForDisplay(notes, pinnedSet) {
  return [...notes].sort((a, b) => {
    const ap = pinnedSet.has(a.id) ? 0 : 1;
    const bp = pinnedSet.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    // Server gives most-recent-first via sort_order; preserve that for ties.
    return (a._idx ?? 0) - (b._idx ?? 0);
  });
}

function _matchesSearch(note, q) {
  if (!q) return true;
  const ql = q.trim().toLowerCase();
  if (!ql) return true;
  const hay = String((note?.title || '') + ' ' + (note?.content || '')).toLowerCase();
  return hay.includes(ql);
}

// ── Markdown renderer (allowlist-only — emits only b/i/code/h3/h4/p/br/pre) ─

const _MD_ALLOWED = new Set(['b', 'i', 'code', 'h3', 'h4', 'p', 'br', 'pre']);

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _renderInlineMd(s) {
  // Work on already-escaped text so embedded HTML stays inert; we only
  // re-emit the few tags from our allowlist below.
  let t = _esc(s);
  // Triple-backtick blocks are handled by the line-level renderer; here we
  // only deal with inline tokens.
  // `code`
  t = t.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // **bold**
  t = t.replace(/\*\*([^*\n]+)\*\*/g, (_, c) => `<b>${c}</b>`);
  // *italic* (after **bold** so they don't clash)
  t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, c) => `<i>${c}</i>`);
  return t;
}

function _renderMarkdown(src) {
  if (typeof src !== 'string' || !src) return '';
  const out = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  let fenceBuf = [];
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (!inFence) { inFence = true; fenceBuf = []; }
      else {
        out.push(`<pre><code>${_esc(fenceBuf.join('\n'))}</code></pre>`);
        inFence = false;
        fenceBuf = [];
      }
      continue;
    }
    if (inFence) { fenceBuf.push(line); continue; }

    if (/^#{2}\s+/.test(line)) {
      out.push(`<h4>${_renderInlineMd(line.replace(/^#{2}\s+/, ''))}</h4>`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      out.push(`<h3>${_renderInlineMd(line.replace(/^#\s+/, ''))}</h3>`);
      continue;
    }
    if (!line.trim()) { out.push(''); continue; }
    out.push(`<p>${_renderInlineMd(line)}</p>`);
  }
  // Close a dangling fence so we always render something rather than dropping
  // the tail silently.
  if (inFence && fenceBuf.length) {
    out.push(`<pre><code>${_esc(fenceBuf.join('\n'))}</code></pre>`);
  }
  return out.filter(Boolean).join('\n');
}

/**
 * Belt-and-braces sanitizer over the renderer's output. The renderer
 * already only emits allowlisted tags, but if a future refactor accidentally
 * passes untrusted text through, this strips anything outside the allowlist
 * and removes every attribute (no event handlers, no href, no src).
 *
 * Exposed for tests/test_notes_enhancements.test.mjs (sanitizer tests cover
 * the script/img cases).
 */
function _sanitizeHtml(html) {
  return String(html ?? '').replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?>/g, (full, name) => {
    const tag = name.toLowerCase();
    if (!_MD_ALLOWED.has(tag)) return '';
    // Re-emit the tag without any attributes.
    return full[1] === '/' ? `</${tag}>` : `<${tag}>`;
  });
}

// ── Word count (pure — exposed for tests) ──────────────────────────────

function _wordCount(text) {
  const t = String(text ?? '');
  const trimmed = t.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { words, chars: t.length };
}

function _formatCount(text) {
  const { words, chars } = _wordCount(text);
  return `${words} words · ${chars} chars`;
}

// ── Build ──────────────────────────────────────────────────────────────

export function buildNotesPanel() {
  return `
<section class="cc-notes-panel" aria-label="Notes">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">NOTES</span>
    <button class="cc-notes-new-btn" type="button">+ New</button>
  </div>

  <input class="cc-notes-search" id="cc-notes-search"
         type="search" placeholder="// search notes..."
         autocomplete="off" spellcheck="false"
         aria-label="Filter notes by title or content" />

  <div class="cc-notes-list" id="cc-notes-list">
    <div class="cc-empty">Loading notes…</div>
  </div>

  <div class="cc-notes-editor" id="cc-notes-editor" style="display:none">
    <input class="cc-notes-title-input" id="cc-notes-title-input"
           placeholder="// title" autocomplete="off" spellcheck="false" />
    <div class="cc-notes-word-count" id="cc-notes-word-count">0 words · 0 chars</div>
    <textarea class="cc-notes-body-input" id="cc-notes-body-input"
              rows="8" placeholder="// write here..."
              spellcheck="false"></textarea>
    <div class="cc-notes-editor-actions">
      <button class="cc-notes-save-btn"   type="button">// SAVE</button>
      <button class="cc-notes-cancel-btn" type="button">// CANCEL</button>
      <button class="cc-notes-delete-btn" type="button">// DELETE</button>
    </div>
  </div>

  <div class="cc-notes-preview" id="cc-notes-preview" style="display:none">
    <div class="cc-notes-preview-title" id="cc-notes-preview-title"></div>
    <div class="cc-notes-preview-body"  id="cc-notes-preview-body"></div>
    <div class="cc-notes-preview-actions">
      <button class="cc-notes-edit-btn" type="button">// EDIT</button>
      <button class="cc-notes-pin-btn"  type="button" aria-pressed="false" title="Toggle pin">📌</button>
      <button class="cc-notes-back-btn" type="button">← BACK</button>
    </div>
  </div>
</section>`.trim();
}

// ── Load + wire ────────────────────────────────────────────────────────

export async function loadNotes(container) {
  const root      = container.querySelector('.cc-notes-panel') || container;
  const searchEl  = root.querySelector('#cc-notes-search');
  const listEl    = root.querySelector('#cc-notes-list');
  const editorEl  = root.querySelector('#cc-notes-editor');
  const previewEl = root.querySelector('#cc-notes-preview');
  const newBtn    = root.querySelector('.cc-notes-new-btn');

  const titleInput = root.querySelector('#cc-notes-title-input');
  const bodyInput  = root.querySelector('#cc-notes-body-input');
  const countEl    = root.querySelector('#cc-notes-word-count');
  const saveBtn    = root.querySelector('.cc-notes-save-btn');
  const cancelBtn  = root.querySelector('.cc-notes-cancel-btn');
  const deleteBtn  = root.querySelector('.cc-notes-delete-btn');

  const previewTitleEl = root.querySelector('#cc-notes-preview-title');
  const previewBodyEl  = root.querySelector('#cc-notes-preview-body');
  const editBtn        = root.querySelector('.cc-notes-edit-btn');
  const pinBtn         = root.querySelector('.cc-notes-pin-btn');
  const backBtn        = root.querySelector('.cc-notes-back-btn');

  let notes      = [];
  let editingId  = null;  // null = creating; set = updating
  let viewingId  = null;
  let lastQuery  = '';

  function _showList() {
    editorEl.style.display  = 'none';
    previewEl.style.display = 'none';
    listEl.style.display    = '';
    if (searchEl) searchEl.style.display = '';
  }
  function _showEditor() {
    listEl.style.display    = 'none';
    previewEl.style.display = 'none';
    if (searchEl) searchEl.style.display = 'none';
    editorEl.style.display  = '';
    bodyInput?.dispatchEvent(new Event('input', { bubbles: true }));
    titleInput?.focus();
  }
  function _showPreview() {
    listEl.style.display    = 'none';
    editorEl.style.display  = 'none';
    if (searchEl) searchEl.style.display = 'none';
    previewEl.style.display = '';
  }

  function _renderList() {
    const pinned = _readPinned();
    const tagged = notes.map((n, idx) => ({ ...n, _idx: idx }));
    const filtered = tagged.filter(n => _matchesSearch(n, lastQuery));
    const sorted   = _sortNotesForDisplay(filtered, pinned);
    if (!sorted.length) {
      listEl.innerHTML = lastQuery
        ? '<div class="cc-empty">No notes match.</div>'
        : '<div class="cc-empty">No notes yet. Hit "+ New" to add one.</div>';
      return;
    }
    listEl.innerHTML = sorted.map(n => {
      const isPinned = pinned.has(n.id);
      const title = _esc((n.title || '').trim() || '(untitled)');
      const snip  = _esc(String(n.content || '').slice(0, 80).replace(/\s+/g, ' '));
      return `<button class="cc-notes-row${isPinned ? ' pinned' : ''}" data-id="${_esc(n.id)}">
        <span class="cc-notes-row-title">${title}</span>
        <span class="cc-notes-row-snip">${snip}</span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.cc-notes-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const note = notes.find(n => n.id === id);
        if (note) _openPreview(note);
      });
    });
  }

  function _openPreview(note) {
    viewingId = note.id;
    previewTitleEl.textContent = (note.title || '').trim() || '(untitled)';
    // _renderMarkdown only emits allowlisted tags, but the sanitizer is a
    // belt-and-braces guard so a future change to the renderer doesn't
    // silently widen what reaches innerHTML.
    previewBodyEl.innerHTML = _sanitizeHtml(_renderMarkdown(note.content || ''));
    const pinned = _readPinned();
    const isPinned = pinned.has(note.id);
    pinBtn.classList.toggle('pinned', isPinned);
    pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    _showPreview();
  }

  function _openEditor(note) {
    editingId = note?.id || null;
    titleInput.value = note?.title || '';
    bodyInput.value  = note?.content || '';
    countEl.textContent = _formatCount(bodyInput.value);
    deleteBtn.style.display = editingId ? '' : 'none';
    _showEditor();
  }

  async function _fetchNotes() {
    try {
      const r = await fetch('/api/notes', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      notes = (data?.notes || []).filter(n => !n.archived);
      _renderList();
    } catch (e) {
      listEl.innerHTML = `<div class="cc-empty">Could not load notes — ${_esc(e.message)}</div>`;
    }
  }

  // ── Search ──────────────────────────────────────────────────────────
  searchEl?.addEventListener('input', () => {
    lastQuery = searchEl.value || '';
    _renderList();
  });

  // ── New / Edit / Save / Cancel / Delete ─────────────────────────────
  newBtn?.addEventListener('click', () => _openEditor(null));
  editBtn?.addEventListener('click', () => {
    const note = notes.find(n => n.id === viewingId);
    if (note) _openEditor(note);
  });
  backBtn?.addEventListener('click', () => { viewingId = null; _showList(); });
  cancelBtn?.addEventListener('click', () => {
    editingId = null;
    _showList();
  });

  bodyInput?.addEventListener('input', () => {
    countEl.textContent = _formatCount(bodyInput.value);
  });

  saveBtn?.addEventListener('click', async () => {
    const title   = (titleInput.value || '').trim();
    const content = bodyInput.value || '';
    if (!title && !content) return; // nothing to save
    saveBtn.disabled = true;
    try {
      if (editingId) {
        const r = await fetch(`/api/notes/${encodeURIComponent(editingId)}`, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } else {
        const r = await fetch('/api/notes', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      editingId = null;
      await _fetchNotes();
      _showList();
    } catch (_) {
      saveBtn.disabled = false;
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!editingId) return;
    deleteBtn.disabled = true;
    try {
      const r = await fetch(`/api/notes/${encodeURIComponent(editingId)}`, {
        method: 'DELETE', credentials: 'same-origin',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      editingId = null;
      await _fetchNotes();
      _showList();
    } catch (_) {
      deleteBtn.disabled = false;
    }
  });

  // ── Pin toggle ──────────────────────────────────────────────────────
  pinBtn?.addEventListener('click', () => {
    if (!viewingId) return;
    const nowPinned = _togglePinnedId(viewingId);
    pinBtn.classList.toggle('pinned', nowPinned);
    pinBtn.setAttribute('aria-pressed', nowPinned ? 'true' : 'false');
  });

  _showList();
  await _fetchNotes();
}

// ── Exposed for tests/test_notes_enhancements.test.mjs ────────────────

export const __testables = {
  PINNED_KEY,
  _sortNotesForDisplay, _matchesSearch,
  _renderMarkdown, _sanitizeHtml, _renderInlineMd,
  _wordCount, _formatCount,
  _readPinned, _writePinned, _togglePinnedId,
};
