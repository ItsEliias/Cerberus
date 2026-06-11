/**
 * VaultCore — Sources tab.
 * CRUD for saved scrape source configurations.
 */

const API = '';

const SOURCE_TYPES = [
  'website', 'github', 'obsidian-publish', 'youtube',
  'reddit', 'twitter', 'notion', 'medium', 'cve', 'rss', 'pdf',
];

const TYPE_LABELS = {
  'website': 'Website', 'github': 'GitHub', 'obsidian-publish': 'Obsidian Publish',
  'youtube': 'YouTube', 'reddit': 'Reddit', 'twitter': 'Twitter/X',
  'notion': 'Notion', 'medium': 'Medium/Substack', 'cve': 'CVE (NVD)',
  'rss': 'RSS Feed', 'pdf': 'PDF',
};

const STATUS_COLORS = {
  healthy: '#27ae60', warning: '#f39c12', error: '#c0392b', unknown: '#666',
};

let _container = null;
let _sources = [];
let _editingId = null;
let _searchQ = '';

export function renderSources(container) {
  _container = container;
  _load();
}

async function _load() {
  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/sources`);
    _sources = await res.json();
  } catch { _sources = []; }
  _render();
}

function _render() {
  if (!_container) return;
  _container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vc-sources';

  const header = document.createElement('div');
  header.className = 'vc-section-header';
  header.innerHTML = `
    <span class="vc-section-title">Source Library</span>
    <div style="display:flex;gap:6px;align-items:center">
      <input class="vc-input" id="vc-src-search" placeholder="Search…" style="width:140px" value="${_esc(_searchQ)}">
      <button class="vc-btn vc-btn-primary" id="vc-src-add">+ Add Source</button>
    </div>
  `;
  wrap.appendChild(header);

  const filtered = _searchQ
    ? _sources.filter(s =>
        s.name.toLowerCase().includes(_searchQ.toLowerCase()) ||
        (s.url || '').toLowerCase().includes(_searchQ.toLowerCase()) ||
        (s.type || '').toLowerCase().includes(_searchQ.toLowerCase()))
    : _sources;

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vc-empty';
    empty.textContent = _searchQ ? 'No sources match your search.' : 'No sources yet. Add one to get started.';
    wrap.appendChild(empty);
  } else {
    filtered.forEach(src => wrap.appendChild(_sourceCard(src)));
  }

  _container.appendChild(wrap);

  _container.querySelector('#vc-src-add').addEventListener('click', () => _openForm(null));
  const search = _container.querySelector('#vc-src-search');
  search.addEventListener('input', e => { _searchQ = e.target.value; _render(); });
}

function _sourceCard(src) {
  const card = document.createElement('div');
  card.className = 'vc-card';
  const health = src.health || {};
  const statusColor = STATUS_COLORS[health.status] || STATUS_COLORS.unknown;
  const lastScraped = src.lastScraped ? new Date(src.lastScraped).toLocaleDateString() : 'Never';
  const schedEnabled = src.schedule?.enabled ? 'Scheduled' : 'Manual';

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div style="flex:1;min-width:0">
        <div class="vc-card-title" style="display:flex;align-items:center;gap:6px">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
          ${_esc(src.name)}
          <span class="vc-tag">${TYPE_LABELS[src.type] || src.type}</span>
        </div>
        <div class="vc-card-meta">
          <span title="URL">${src.url ? _esc(_truncate(src.url, 50)) : '—'}</span>
          <span>Notes: ${src.noteCount || 0}</span>
          <span>Last: ${lastScraped}</span>
          <span>${schedEnabled}</span>
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px">
        <button class="vc-btn vc-btn-ghost vc-src-edit" data-id="${src.id}" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="vc-btn vc-btn-danger vc-src-del" data-id="${src.id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `;

  card.querySelector('.vc-src-edit').addEventListener('click', () => _openForm(src));
  card.querySelector('.vc-src-del').addEventListener('click', () => _deleteSource(src.id, src.name));
  return card;
}

function _openForm(src) {
  _editingId = src ? src.id : null;
  const existing = document.getElementById('vc-src-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'vc-src-modal';
  modal.className = 'vc-modal-overlay';
  const sch = src?.schedule || {};
  modal.innerHTML = `
    <div class="vc-modal">
      <div class="vc-modal-header">
        <span>${src ? 'Edit Source' : 'Add Source'}</span>
        <button class="vc-btn vc-btn-ghost" id="vc-src-modal-close">✕</button>
      </div>
      <div class="vc-modal-body">
        <div class="vc-field"><label class="vc-label">Name *</label>
          <input class="vc-input" id="vsf-name" value="${_esc(src?.name || '')}" placeholder="My Source"></div>
        <div class="vc-field"><label class="vc-label">Type</label>
          <select class="vc-select" id="vsf-type">
            ${SOURCE_TYPES.map(t => `<option value="${t}"${(src?.type||'website')===t?' selected':''}>${TYPE_LABELS[t]||t}</option>`).join('')}
          </select></div>
        <div class="vc-field"><label class="vc-label">URL</label>
          <input class="vc-input" id="vsf-url" value="${_esc(src?.url || '')}" placeholder="https://…"></div>
        <div class="vc-field">
          <label class="vc-label" style="display:flex;gap:6px;align-items:center">
            <input type="checkbox" id="vsf-sched-enabled" ${sch.enabled ? 'checked' : ''}> Enable Schedule
          </label>
        </div>
        <div class="vc-field" id="vsf-cron-field" style="${sch.enabled ? '' : 'display:none'}">
          <label class="vc-label">Cron Expression</label>
          <input class="vc-input" id="vsf-cron" value="${_esc(sch.cronExpression || '')}" placeholder="0 2 * * *">
          <span class="vc-hint">e.g. <code>0 2 * * *</code> = daily at 2 AM</span>
        </div>
        <div class="vc-field"><label class="vc-label">Conflict Strategy</label>
          <select class="vc-select" id="vsf-conflict">
            <option value="skip"${(sch.conflictStrategy||'skip')==='skip'?' selected':''}>Skip existing</option>
            <option value="overwrite"${sch.conflictStrategy==='overwrite'?' selected':''}>Overwrite</option>
            <option value="keepBoth"${sch.conflictStrategy==='keepBoth'?' selected':''}>Keep both</option>
          </select></div>
        <div class="vc-error" id="vsf-error" style="display:none"></div>
      </div>
      <div class="vc-modal-footer">
        <button class="vc-btn vc-btn-ghost" id="vc-src-modal-cancel">Cancel</button>
        <button class="vc-btn vc-btn-primary" id="vc-src-modal-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const schedEl = modal.querySelector('#vsf-sched-enabled');
  const cronField = modal.querySelector('#vsf-cron-field');
  schedEl.addEventListener('change', () => {
    cronField.style.display = schedEl.checked ? '' : 'none';
  });

  modal.querySelector('#vc-src-modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#vc-src-modal-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#vc-src-modal-save').addEventListener('click', () => _saveSource(modal));
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function _saveSource(modal) {
  const name = modal.querySelector('#vsf-name').value.trim();
  const type = modal.querySelector('#vsf-type').value;
  const url = modal.querySelector('#vsf-url').value.trim();
  const schedEnabled = modal.querySelector('#vsf-sched-enabled').checked;
  const scheduleCron = modal.querySelector('#vsf-cron').value.trim();
  const conflictStrategy = modal.querySelector('#vsf-conflict').value;
  const errEl = modal.querySelector('#vsf-error');

  if (!name) { errEl.textContent = 'Name is required'; errEl.style.display = 'block'; return; }

  const payload = { name, type, url, schedule_enabled: schedEnabled, schedule_cron: scheduleCron, conflict_strategy: conflictStrategy };

  try {
    const method = _editingId ? 'PATCH' : 'POST';
    const endpoint = _editingId
      ? `${API}/api/cyberapps/vaultcore/sources/${_editingId}`
      : `${API}/api/cyberapps/vaultcore/sources`;
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json();
      errEl.textContent = d.detail || 'Save failed';
      errEl.style.display = 'block';
      return;
    }
    modal.remove();
    _load();
  } catch (e) {
    errEl.textContent = String(e);
    errEl.style.display = 'block';
  }
}

async function _deleteSource(id, name) {
  if (!confirm(`Delete source "${name}"?`)) return;
  await fetch(`${API}/api/cyberapps/vaultcore/sources/${id}`, { method: 'DELETE' });
  _load();
}

function _truncate(str, max) { return str.length > max ? str.slice(0, max) + '…' : str; }
function _esc(str) { const d = document.createElement('div'); d.textContent = String(str || ''); return d.innerHTML; }
