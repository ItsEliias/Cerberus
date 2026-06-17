// Cerberus OS — Settings → Desktop Bridge / App Launcher

let _deps = {};
let _apps = [];
let _editingId = null;

function _el(id) {
  return document.getElementById(id);
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _fetchJson(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts });
  return res.json();
}

function _parseAliases(raw) {
  return String(raw || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

function _renderList() {
  const list = _el('cerberus-launcher-apps-list');
  if (!list) return;
  if (!_apps.length) {
    list.innerHTML = '<p class="cerberus-panel-empty">No apps configured yet. Add your first desktop app path below.</p>';
    return;
  }
  list.innerHTML = _apps.map((app) => {
    const ok = !!app.pathExists;
    const status = ok ? 'Available' : 'Missing';
    const badge = ok ? 'available' : 'missing';
    return `
      <article class="cerberus-launcher-app-card" data-app-id="${_esc(app.id)}">
        <div class="cerberus-launcher-app-head">
          <h3>${_esc(app.name || app.id)}</h3>
          <span class="cerberus-desktop-apps-badge atlas-desktop-apps-badge--${badge}">${status}</span>
        </div>
        <p class="cerberus-launcher-app-path">${_esc(app.executablePath || '')}</p>
        <p class="cerberus-launcher-app-aliases">${_esc((app.aliases || []).join(', '))}</p>
        <div class="cerberus-launcher-app-actions">
          <label class="cerberus-launcher-toggle"><input type="checkbox" data-toggle-app="${_esc(app.id)}" ${app.enabled !== false ? 'checked' : ''} /> Enabled</label>
          <button type="button" class="admin-btn-sm" data-edit-app="${_esc(app.id)}">Edit</button>
          <button type="button" class="admin-btn-sm" data-test-app="${_esc(app.id)}">Test launch</button>
          <button type="button" class="admin-btn-delete" data-delete-app="${_esc(app.id)}">Delete</button>
        </div>
      </article>`;
  }).join('');
}

function _fillForm(app) {
  _el('cerberus-launcher-form-id').value = app?.id || '';
  _el('cerberus-launcher-form-name').value = app?.name || '';
  _el('cerberus-launcher-form-path').value = app?.executablePath || '';
  _el('cerberus-launcher-form-args').value = (app?.args || []).join(', ');
  _el('cerberus-launcher-form-workdir').value = app?.workingDirectory || '';
  _el('cerberus-launcher-form-aliases').value = (app?.aliases || []).join(', ');
  _el('cerberus-launcher-form-enabled').checked = app?.enabled !== false;
  _editingId = app?.id || null;
  const title = _el('cerberus-launcher-form-title');
  if (title) title.textContent = _editingId ? `Edit ${app.name || _editingId}` : 'Add desktop app';
}

function _readForm() {
  return {
    id: _el('cerberus-launcher-form-id')?.value?.trim() || undefined,
    name: _el('cerberus-launcher-form-name')?.value?.trim(),
    executablePath: _el('cerberus-launcher-form-path')?.value?.trim(),
    args: _parseAliases(_el('cerberus-launcher-form-args')?.value),
    workingDirectory: _el('cerberus-launcher-form-workdir')?.value?.trim() || '',
    aliases: _parseAliases(_el('cerberus-launcher-form-aliases')?.value),
    enabled: !!_el('cerberus-launcher-form-enabled')?.checked,
  };
}

async function _loadApps() {
  const statusEl = _el('cerberus-launcher-bridge-status');
  try {
    const [appsRes, statusRes] = await Promise.all([
      _fetchJson('/api/cerberus/desktop/launcher-apps'),
      _fetchJson('/api/cerberus/desktop/status'),
    ]);
    _apps = appsRes.apps || [];
    if (statusEl) {
      statusEl.textContent = statusRes.label || statusRes.message || 'Bridge status unknown';
    }
    _renderList();
  } catch (_) {
    if (statusEl) statusEl.textContent = 'Could not load launcher settings.';
    _apps = [];
    _renderList();
  }
}

async function _saveApp() {
  const body = _readForm();
  if (!body.name || !body.executablePath) {
    _deps.showToast?.('Name and executable path are required.');
    return;
  }
  const url = _editingId
    ? `/api/cerberus/desktop/launcher-apps/${encodeURIComponent(_editingId)}`
    : '/api/cerberus/desktop/launcher-apps';
  const method = _editingId ? 'PUT' : 'POST';
  const res = await _fetchJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  _deps.showToast?.(res.message || (res.ok ? 'App saved' : 'Save failed'));
  if (res.ok) {
    _apps = res.apps || _apps;
    _fillForm(null);
    _editingId = null;
    await _loadApps();
  }
}

function _bindEvents() {
  const panel = _el('cerberus-launcher-settings-panel');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  _el('cerberus-launcher-add-btn')?.addEventListener('click', () => _fillForm(null));
  _el('cerberus-launcher-save-btn')?.addEventListener('click', () => { void _saveApp(); });
  _el('cerberus-launcher-cancel-btn')?.addEventListener('click', () => _fillForm(null));

  panel.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-app]');
    if (editBtn) {
      const app = _apps.find((a) => a.id === editBtn.dataset.editApp);
      if (app) _fillForm(app);
      return;
    }
    const testBtn = e.target.closest('[data-test-app]');
    if (testBtn) {
      const res = await _fetchJson(`/api/cerberus/desktop/launcher-apps/${encodeURIComponent(testBtn.dataset.testApp)}/test`, { method: 'POST' });
      _deps.showToast?.(res.message || (res.ok ? 'Launch sent' : 'Test launch failed'));
      return;
    }
    const delBtn = e.target.closest('[data-delete-app]');
    if (delBtn) {
      const res = await _fetchJson(`/api/cerberus/desktop/launcher-apps/${encodeURIComponent(delBtn.dataset.deleteApp)}`, { method: 'DELETE' });
      _deps.showToast?.(res.message || (res.ok ? 'App deleted' : 'Delete failed'));
      if (res.ok) await _loadApps();
      return;
    }
  });

  panel.addEventListener('change', async (e) => {
    const toggle = e.target.closest('[data-toggle-app]');
    if (!toggle) return;
    const app = _apps.find((a) => a.id === toggle.dataset.toggleApp);
    if (!app) return;
    const res = await _fetchJson(`/api/cerberus/desktop/launcher-apps/${encodeURIComponent(app.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...app, enabled: toggle.checked }),
    });
    if (!res.ok) {
      toggle.checked = !toggle.checked;
      _deps.showToast?.(res.message || 'Could not update app');
    } else {
      await _loadApps();
    }
  });
}

export async function renderLauncherSettings() {
  _bindEvents();
  await _loadApps();
  if (!_editingId) _fillForm(null);
}

export function initAtlasLauncherSettings(deps = {}) {
  _deps = deps;
  _bindEvents();
}

const cerberusLauncherSettings = {
  initAtlasLauncherSettings,
  renderLauncherSettings,
};

export default cerberusLauncherSettings;
