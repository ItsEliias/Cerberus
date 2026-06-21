/**
 * cc-contacts.js — CONTACTS panel for the Command Center ASSISTANT tab.
 *
 * Same pattern as cc-notes.js / cc-research.js: builds an inline panel and
 * wires loadContacts(container) on mount. The panel is layered into
 * assistant.js right after the search-history panel.
 *
 * Endpoint shapes verified against routes/contacts_routes.py:
 *   GET    /api/contacts/list                   → { contacts: [...], count }
 *   GET    /api/contacts/search?q=…             → { results: [...] }
 *   POST   /api/contacts/add  {name, email}     → { success, contact? }
 *   PUT    /api/contacts/{uid} {name, emails, phones} → { success }
 *   DELETE /api/contacts/{uid}                  → { success }
 *   GET    /api/contacts/export?format=vcf      → Blob (Content-Disposition)
 *
 * Each contact row is `{uid, name, emails: [...], phones: [...]}`. The
 * backend doesn't carry organisation / first-name / last-name / notes
 * fields, so the panel doesn't surface inputs for them. Display name maps
 * to `name`; the form's "email" + "phone" inputs become single-entry
 * arrays on PUT.
 *
 * Token-only styling shipped via a one-time <style> tag injected by
 * `_ensureContactsStyles()` so styles.css stays untouched.
 */

const SEARCH_DEBOUNCE_MS = 300;

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// ─── Panel HTML ─────────────────────────────────────────────────────────────

export function buildContactsPanel() {
  return `
<section class="cc-contacts-panel" id="cc-contacts-panel" aria-label="Contacts">
  <header class="cc-agents-tab-header cc-contacts-header">
    <span class="cc-agents-tab-title">CONTACTS</span>
    <button class="cc-contacts-new-btn" id="cc-contacts-new-btn" type="button">+ New</button>
    <button class="cc-contacts-export-btn" id="cc-contacts-export-btn" type="button" title="Download all contacts as vCard">↓ vCard</button>
  </header>
  <input class="cc-contacts-search" id="cc-contacts-search"
    type="search" autocomplete="off" spellcheck="false"
    placeholder="// search contacts..." />
  <div class="cc-contacts-list" id="cc-contacts-list">
    <div class="cc-empty">Loading…</div>
  </div>
  <div class="cc-contacts-detail" id="cc-contacts-detail" style="display:none"></div>
  <div class="cc-contacts-msg" id="cc-contacts-msg" hidden></div>
</section>`.trim();
}

// ─── Public loader ──────────────────────────────────────────────────────────

export async function loadContacts(container) {
  _ensureContactsStyles();
  await _refreshList(container);
  _wireSearch(container);
  _wireNewButton(container);
  _wireExportButton(container);
}

// ─── List refresh ──────────────────────────────────────────────────────────

async function _refreshList(container) {
  const list = container.querySelector('#cc-contacts-list');
  if (!list) return;
  try {
    const data = await _fetchJSON('/api/contacts/list');
    _renderRows(container, data?.contacts || []);
  } catch (e) {
    list.innerHTML = `<div class="cc-empty">// CONTACTS UNAVAILABLE — ${_esc(e.message)}</div>`;
  }
}

function _renderRows(container, contacts) {
  const list = container.querySelector('#cc-contacts-list');
  if (!list) return;
  if (!contacts.length) {
    list.innerHTML = '<div class="cc-empty">// NO CONTACTS YET — import via CardDAV or click + NEW to add one.</div>';
    return;
  }
  list.innerHTML = contacts.map(c => _rowHTML(c)).join('');
  list.querySelectorAll('.cc-contacts-row').forEach(row => {
    row.addEventListener('click', () => {
      const uid = row.dataset.uid;
      const contact = contacts.find(c => c.uid === uid);
      if (contact) _renderDetail(container, contact);
    });
  });
}

function _rowHTML(c) {
  const name  = _esc(c.name || '(no name)');
  const email = _esc((c.emails || [])[0] || '');
  const phone = _esc((c.phones || [])[0] || '');
  const meta = [email, phone].filter(Boolean).join(' · ') || '(no contact info)';
  return `<div class="cc-contacts-row" data-uid="${_esc(c.uid || '')}">
    <span class="cc-contacts-name">${name}</span>
    <span class="cc-contacts-meta">${meta}</span>
  </div>`;
}

// ─── Search (server-side, debounced) ────────────────────────────────────────

let _searchTimer = null;

function _wireSearch(container) {
  const input = container.querySelector('#cc-contacts-search');
  if (!input) return;
  input.addEventListener('input', () => _scheduleSearch(container, input.value));
}

function _scheduleSearch(container, query) {
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => _doSearch(container, query), SEARCH_DEBOUNCE_MS);
}

async function _doSearch(container, query) {
  const q = (query || '').trim();
  if (!q) {
    // Empty query → restore the full list.
    await _refreshList(container);
    return;
  }
  try {
    const data = await _fetchJSON(`/api/contacts/search?q=${encodeURIComponent(q)}`);
    _renderRows(container, data?.results || []);
  } catch (e) {
    const list = container.querySelector('#cc-contacts-list');
    if (list) list.innerHTML = `<div class="cc-empty">// SEARCH FAILED — ${_esc(e.message)}</div>`;
  }
}

// ─── Detail / edit / delete ─────────────────────────────────────────────────

function _renderDetail(container, contact) {
  const panel = container.querySelector('#cc-contacts-detail');
  if (!panel) return;
  const emails = (contact.emails || []).map(e => _esc(e)).join(', ') || '—';
  const phones = (contact.phones || []).map(p => _esc(p)).join(', ') || '—';
  const firstEmail = (contact.emails || [])[0] || '';
  panel.innerHTML = `
    <div class="cc-contacts-detail-head">
      <span class="cc-contacts-name">${_esc(contact.name || '(no name)')}</span>
      <button class="cc-contacts-close" id="cc-contacts-close" type="button">✕</button>
    </div>
    <div class="cc-contacts-field"><span class="cc-contacts-lbl">EMAIL</span><span>${emails}</span></div>
    <div class="cc-contacts-field"><span class="cc-contacts-lbl">PHONE</span><span>${phones}</span></div>
    <div class="cc-contacts-actions">
      <button class="cc-contacts-btn" id="cc-contacts-edit" type="button">EDIT</button>
      <button class="cc-contacts-btn" id="cc-contacts-copy" type="button" ${firstEmail ? '' : 'disabled'}>COPY EMAIL</button>
      <button class="cc-contacts-btn cc-contacts-danger" id="cc-contacts-del" type="button">DELETE</button>
    </div>
    <div class="cc-contacts-edit" id="cc-contacts-edit-form" hidden></div>
  `.trim();
  panel.style.display = 'block';
  panel.querySelector('#cc-contacts-close')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });
  panel.querySelector('#cc-contacts-edit')?.addEventListener('click', () => _openEditForm(container, contact));
  panel.querySelector('#cc-contacts-copy')?.addEventListener('click', () => _copyEmail(container, firstEmail));
  panel.querySelector('#cc-contacts-del')?.addEventListener('click', (e) =>
    _twoStepDelete(container, contact, e.currentTarget),
  );
}

function _openEditForm(container, contact) {
  const wrap = container.querySelector('#cc-contacts-edit-form');
  if (!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="cc-contacts-edit-row">
      <label class="cc-contacts-lbl" for="cc-contacts-name-input">NAME</label>
      <input class="cc-contacts-input" id="cc-contacts-name-input"
        value="${_esc(contact.name || '')}" />
    </div>
    <div class="cc-contacts-edit-row">
      <label class="cc-contacts-lbl" for="cc-contacts-email-input">EMAIL</label>
      <input class="cc-contacts-input" id="cc-contacts-email-input"
        value="${_esc((contact.emails || [])[0] || '')}" />
    </div>
    <div class="cc-contacts-edit-row">
      <label class="cc-contacts-lbl" for="cc-contacts-phone-input">PHONE</label>
      <input class="cc-contacts-input" id="cc-contacts-phone-input"
        value="${_esc((contact.phones || [])[0] || '')}" />
    </div>
    <div class="cc-contacts-actions">
      <button class="cc-contacts-btn cc-contacts-primary" id="cc-contacts-save" type="button">SAVE</button>
      <button class="cc-contacts-btn" id="cc-contacts-edit-cancel" type="button">CANCEL</button>
    </div>
  `.trim();
  wrap.querySelector('#cc-contacts-save')?.addEventListener('click', () =>
    _saveEdit(container, contact.uid),
  );
  wrap.querySelector('#cc-contacts-edit-cancel')?.addEventListener('click', () => {
    wrap.hidden = true;
    wrap.innerHTML = '';
  });
}

async function _saveEdit(container, uid) {
  const wrap  = container.querySelector('#cc-contacts-edit-form');
  const name  = wrap?.querySelector('#cc-contacts-name-input')?.value?.trim() || '';
  const email = wrap?.querySelector('#cc-contacts-email-input')?.value?.trim() || '';
  const phone = wrap?.querySelector('#cc-contacts-phone-input')?.value?.trim() || '';
  if (!uid) return;
  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(uid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        name,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _flashMessage(container, 'Saved.');
    await _refreshList(container);
    // Hide the detail since the row index just changed.
    const detail = container.querySelector('#cc-contacts-detail');
    if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  } catch (e) {
    _flashMessage(container, `Save failed — ${e.message}`, true);
  }
}

function _twoStepDelete(container, contact, btn) {
  if (!btn || !contact?.uid) return;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.dataset.original = btn.textContent;
    btn.textContent = 'CONFIRM DELETE';
    btn.classList.add('cc-contacts-armed');
    setTimeout(() => {
      if (btn.dataset.armed === '1') {
        btn.dataset.armed = '0';
        btn.textContent = btn.dataset.original || 'DELETE';
        btn.classList.remove('cc-contacts-armed');
      }
    }, 4000);
    return;
  }
  _performDelete(container, contact, btn);
}

async function _performDelete(container, contact, btn) {
  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(contact.uid)}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _flashMessage(container, 'Deleted.');
    await _refreshList(container);
    const detail = container.querySelector('#cc-contacts-detail');
    if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  } catch (e) {
    btn.dataset.armed = '0';
    btn.textContent = btn.dataset.original || 'DELETE';
    btn.classList.remove('cc-contacts-armed');
    _flashMessage(container, `Delete failed — ${e.message}`, true);
  }
}

async function _copyEmail(container, email) {
  if (!email) return;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(email);
      _flashMessage(container, 'Email copied.');
      return;
    }
  } catch (_) { /* fall through to no-op below */ }
  _flashMessage(container, 'Clipboard unavailable.', true);
}

// ─── New contact ───────────────────────────────────────────────────────────

function _wireNewButton(container) {
  const btn = container.querySelector('#cc-contacts-new-btn');
  if (!btn) return;
  btn.addEventListener('click', () => _renderNewForm(container));
}

function _renderNewForm(container) {
  const panel = container.querySelector('#cc-contacts-detail');
  if (!panel) return;
  panel.innerHTML = `
    <div class="cc-contacts-detail-head">
      <span class="cc-contacts-name">// NEW CONTACT</span>
      <button class="cc-contacts-close" id="cc-contacts-close-new" type="button">✕</button>
    </div>
    <div class="cc-contacts-edit-row">
      <label class="cc-contacts-lbl" for="cc-contacts-new-name">NAME</label>
      <input class="cc-contacts-input" id="cc-contacts-new-name" placeholder="Full name" />
    </div>
    <div class="cc-contacts-edit-row">
      <label class="cc-contacts-lbl" for="cc-contacts-new-email">EMAIL <span class="cc-contacts-req">*</span></label>
      <input class="cc-contacts-input" id="cc-contacts-new-email" placeholder="name@example.com" />
    </div>
    <div class="cc-contacts-actions">
      <button class="cc-contacts-btn cc-contacts-primary" id="cc-contacts-create" type="button">CREATE</button>
      <button class="cc-contacts-btn" id="cc-contacts-new-cancel" type="button">CANCEL</button>
    </div>
  `.trim();
  panel.style.display = 'block';
  const close = () => { panel.style.display = 'none'; panel.innerHTML = ''; };
  panel.querySelector('#cc-contacts-close-new')?.addEventListener('click', close);
  panel.querySelector('#cc-contacts-new-cancel')?.addEventListener('click', close);
  panel.querySelector('#cc-contacts-create')?.addEventListener('click', async () => {
    const name  = panel.querySelector('#cc-contacts-new-name')?.value?.trim() || '';
    const email = panel.querySelector('#cc-contacts-new-email')?.value?.trim() || '';
    if (!email) {
      _flashMessage(container, 'Email is required.', true);
      return;
    }
    try {
      const res = await fetch('/api/contacts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _flashMessage(container, 'Contact created.');
      close();
      await _refreshList(container);
    } catch (e) {
      _flashMessage(container, `Create failed — ${e.message}`, true);
    }
  });
}

// ─── Export ────────────────────────────────────────────────────────────────

function _wireExportButton(container) {
  const btn = container.querySelector('#cc-contacts-export-btn');
  if (!btn) return;
  btn.addEventListener('click', () => _downloadExport(container));
}

async function _downloadExport(container) {
  const btn = container.querySelector('#cc-contacts-export-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  let url = null;
  try {
    const res = await fetch('/api/contacts/export?format=vcf', {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    const m  = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = m ? m[1] : 'cerberus-contacts.vcf';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    _flashMessage(container, `Export failed — ${e.message}`, true);
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (btn) { btn.disabled = false; btn.textContent = '↓ vCard'; }
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────

function _flashMessage(container, text, isError = false) {
  const el = container.querySelector('#cc-contacts-msg');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('cc-contacts-msg--err', !!isError);
  clearTimeout(_flashMessage._t);
  _flashMessage._t = setTimeout(() => { el.hidden = true; }, 2200);
}

async function _fetchJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Style injection ───────────────────────────────────────────────────────

const _STYLE_ID = 'cc-contacts-styles';
function _ensureContactsStyles() {
  if (typeof document === 'undefined') return;
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function'
      && document.getElementById(_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = _STYLE_ID;
  style.textContent = `
.cc-contacts-panel {
  margin: 8px 12px 4px;
  padding: 10px 12px;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 3%, transparent);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-contacts-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cc-contacts-header .cc-agents-tab-title { flex: 1; }
.cc-contacts-new-btn, .cc-contacts-export-btn, .cc-contacts-btn, .cc-contacts-close {
  -webkit-appearance: none; appearance: none;
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 70%, transparent);
  font-family: inherit;
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 4px 9px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.cc-contacts-new-btn:hover, .cc-contacts-export-btn:hover,
.cc-contacts-btn:hover, .cc-contacts-close:hover {
  color: var(--cc-crimson, var(--red, #c0392b));
  border-color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-contacts-btn:disabled, .cc-contacts-export-btn:disabled { opacity: 0.5; cursor: wait; }
.cc-contacts-primary {
  color: var(--cc-crimson, var(--red, #c0392b));
  border-color: var(--cc-crimson, var(--red, #c0392b));
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 10%, transparent);
}
.cc-contacts-danger {
  color: var(--cc-crimson, var(--red, #c0392b));
  border-color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-contacts-armed {
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 18%, transparent);
  color: var(--cc-fg, var(--fg, #c5c9d0));
}

.cc-contacts-search {
  -webkit-appearance: none; appearance: none;
  width: 100%; box-sizing: border-box;
  background: var(--cc-void-mid, var(--bg, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: var(--cc-fg, var(--fg, #c5c9d0));
  font-family: inherit;
  font-size: 11px; letter-spacing: 0.04em;
  padding: 6px 9px;
  outline: none;
  margin-bottom: 6px;
}
.cc-contacts-search:focus { border-color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-contacts-search::placeholder { color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 40%, transparent); }

.cc-contacts-list { display: flex; flex-direction: column; }
.cc-contacts-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--cc-border, var(--border, #3a2a2a));
  cursor: pointer;
  transition: background 0.15s;
}
.cc-contacts-row:hover {
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 6%, transparent);
}
.cc-contacts-row:last-child { border-bottom: none; }
.cc-contacts-name {
  font-family: 'Orbitron', 'JetBrains Mono', monospace;
  font-size: 12px; letter-spacing: 0.06em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
}
.cc-contacts-meta {
  font-family: inherit;
  font-size: 10px; letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 50%, transparent);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}

.cc-contacts-detail {
  margin-top: 8px;
  padding: 12px;
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 4%, transparent);
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
}
.cc-contacts-detail-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
}
.cc-contacts-field {
  display: grid; grid-template-columns: 60px 1fr; gap: 8px;
  font-size: 10px; padding: 4px 0;
}
.cc-contacts-lbl {
  font-size: 8.5px; letter-spacing: 0.14em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 45%, transparent);
}
.cc-contacts-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }

.cc-contacts-edit { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.cc-contacts-edit-row { display: flex; flex-direction: column; gap: 3px; }
.cc-contacts-input {
  -webkit-appearance: none; appearance: none;
  background: var(--cc-void-mid, var(--bg, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: var(--cc-fg, var(--fg, #c5c9d0));
  font-family: inherit;
  font-size: 11px; letter-spacing: 0.02em;
  padding: 5px 8px;
  outline: none;
}
.cc-contacts-input:focus { border-color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-contacts-req { color: var(--cc-crimson, var(--red, #c0392b)); }

.cc-contacts-msg {
  margin-top: 6px;
  padding: 4px 8px;
  font-size: 10px; letter-spacing: 0.04em;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 4%, transparent);
  color: var(--cc-fg, var(--fg, #c5c9d0));
}
.cc-contacts-msg--err {
  border-color: var(--cc-crimson, var(--red, #c0392b));
  color: var(--cc-crimson, var(--red, #c0392b));
}
  `.trim();
  document.head.appendChild(style);
}

// Test surface — exposes the private helpers reachable from node:test
// without leaking them to module consumers.
export const __testables = {
  SEARCH_DEBOUNCE_MS,
  _rowHTML, _renderRows, _doSearch, _scheduleSearch,
  _twoStepDelete, _performDelete, _copyEmail,
  _downloadExport, _renderDetail, _saveEdit, _flashMessage,
};
