/**
 * VaultCore — Settings tab.
 */

const API = '';

let _container = null;

export function renderSettings(container, onLockVault) {
  _container = container;
  _load(onLockVault);
}

async function _load(onLockVault) {
  let settings = {};
  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/settings`);
    settings = await res.json();
  } catch { /* use defaults */ }
  _render(settings, onLockVault);
}

function _render(s, onLockVault) {
  if (!_container) return;
  _container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vc-settings';

  wrap.innerHTML = `
    <div class="vc-section-title" style="margin-bottom:12px">VaultCore Settings</div>
    <div class="vc-card" style="margin-bottom:12px">
      <div class="vc-card-title" style="margin-bottom:10px">Vault Storage</div>
      <div class="vc-field">
        <label class="vc-label">Obsidian Vault Path</label>
        <input class="vc-input" id="vs-vault-path" value="${_esc(s.vault_path || '')}" placeholder="/path/to/your/obsidian/vault">
        <span class="vc-hint">Where scraped notes will be saved (Obsidian-compatible)</span>
      </div>
    </div>

    <div class="vc-card" style="margin-bottom:12px">
      <div class="vc-card-title" style="margin-bottom:10px">Scraping Defaults</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="vc-field">
          <label class="vc-label">Default Conflict Strategy</label>
          <select class="vc-select" id="vs-conflict" style="width:100%">
            <option value="skip"${s.default_conflict_strategy==='skip'?' selected':''}>Skip existing</option>
            <option value="overwrite"${s.default_conflict_strategy==='overwrite'?' selected':''}>Overwrite</option>
            <option value="keepBoth"${s.default_conflict_strategy==='keepBoth'?' selected':''}>Keep both</option>
          </select>
        </div>
        <div class="vc-field">
          <label class="vc-label">Default Max Pages</label>
          <input class="vc-input" id="vs-maxpages" type="number" value="${s.default_max_pages || 50}" min="1" max="500">
        </div>
        <div class="vc-field">
          <label class="vc-label">Default Crawl Depth</label>
          <input class="vc-input" id="vs-depth" type="number" value="${s.default_depth || 3}" min="1" max="10">
        </div>
        <div class="vc-field">
          <label class="vc-label">Default Delay (sec)</label>
          <input class="vc-input" id="vs-delay" type="number" value="${s.default_delay || 1}" min="0" max="30">
        </div>
      </div>
    </div>

    <div class="vc-card" style="margin-bottom:12px">
      <div class="vc-card-title" style="margin-bottom:10px">Post-Processing</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <label class="vc-label" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" id="vs-autowikilinks" ${s.auto_wikilinks ? 'checked' : ''}>
          Auto-wikilinks (insert [[links]] for matching note titles)
        </label>
        <label class="vc-label" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" id="vs-autotag" ${s.auto_tag ? 'checked' : ''}>
          Auto-tag (cybersecurity keyword detection)
        </label>
        <label class="vc-label" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" id="vs-notifications" ${s.notifications ? 'checked' : ''}>
          Notifications on job completion
        </label>
      </div>
    </div>

    <div class="vc-error" id="vs-error" style="display:none"></div>
    <div id="vs-success" class="vc-success" style="display:none">Settings saved.</div>
    <div style="display:flex;gap:8px">
      <button class="vc-btn vc-btn-primary" id="vs-save">Save Settings</button>
      <button class="vc-btn vc-btn-danger" id="vs-lock-vault">Lock Vault</button>
    </div>
  `;

  _container.appendChild(wrap);

  _container.querySelector('#vs-save').addEventListener('click', _saveSettings);
  _container.querySelector('#vs-lock-vault').addEventListener('click', () => {
    if (onLockVault) onLockVault();
  });
}

async function _saveSettings() {
  const errEl = _container.querySelector('#vs-error');
  const okEl = _container.querySelector('#vs-success');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const payload = {
    vault_path: _container.querySelector('#vs-vault-path').value.trim(),
    default_conflict_strategy: _container.querySelector('#vs-conflict').value,
    default_max_pages: parseInt(_container.querySelector('#vs-maxpages').value) || 50,
    default_depth: parseInt(_container.querySelector('#vs-depth').value) || 3,
    default_delay: parseInt(_container.querySelector('#vs-delay').value) || 1,
    auto_wikilinks: _container.querySelector('#vs-autowikilinks').checked,
    auto_tag: _container.querySelector('#vs-autotag').checked,
    notifications: _container.querySelector('#vs-notifications').checked,
  };

  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      okEl.style.display = 'block';
      setTimeout(() => { if (okEl) okEl.style.display = 'none'; }, 3000);
    } else {
      const d = await res.json();
      errEl.textContent = d.detail || 'Save failed';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = String(e);
    errEl.style.display = 'block';
  }
}

function _esc(str) { const d = document.createElement('div'); d.textContent = String(str || ''); return d.innerHTML; }
