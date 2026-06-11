/**
 * GhostVault — settings & vault stats view.
 *
 * @param {HTMLElement} container
 * @param {string} vaultToken
 * @param {() => void} onLock
 */
export function renderSettings(container, vaultToken, onLock) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'gv-settings';

  wrap.innerHTML = `
    <div class="gv-section-header"><span class="gv-section-title">Vault Stats</span></div>
    <div id="gv-stats-grid" class="gv-health-grid">
      <div class="gv-stat-card"><div class="gv-stat-value" id="st-notes">—</div><div class="gv-stat-label">Notes</div></div>
      <div class="gv-stat-card"><div class="gv-stat-value" id="st-folders">—</div><div class="gv-stat-label">Folders</div></div>
      <div class="gv-stat-card"><div class="gv-stat-value" id="st-pinned">—</div><div class="gv-stat-label">Pinned</div></div>
      <div class="gv-stat-card"><div class="gv-stat-value" id="st-words">—</div><div class="gv-stat-label">Words</div></div>
    </div>

    <div class="gv-section-header" style="margin-top:16px;"><span class="gv-section-title">Preferences</span></div>
    <div id="gv-prefs-form"></div>

    <div class="gv-section-header" style="margin-top:16px;"><span class="gv-section-title">Vault</span></div>
    <p style="font-size:12px;opacity:.65;margin-bottom:8px;">
      GhostVault uses the shared Cerberus vault.<br>
      All note content is Fernet-encrypted at rest with a domain-derived key.
    </p>
    <button class="gv-btn gv-btn-danger" id="gv-lock-btn">Lock Vault</button>
  `;
  container.appendChild(wrap);

  wrap.querySelector('#gv-lock-btn').addEventListener('click', async () => {
    await fetch('/api/cyberapps/vault/lock', { method: 'POST' }).catch(() => {});
    onLock();
  });

  _loadStats(wrap, vaultToken);
  _loadPrefs(wrap, vaultToken);
}

async function _loadStats(wrap, vaultToken) {
  try {
    const res = await fetch('/api/cyberapps/ghostvault/stats', {
      headers: { 'X-Vault-Token': vaultToken },
    });
    if (!res.ok) return;
    const d = await res.json();
    wrap.querySelector('#st-notes').textContent = d.total_notes;
    wrap.querySelector('#st-folders').textContent = d.total_folders;
    wrap.querySelector('#st-pinned').textContent = d.pinned;
    wrap.querySelector('#st-words').textContent =
      d.total_words > 999 ? `${(d.total_words / 1000).toFixed(1)}k` : d.total_words;
  } catch (_) {}
}

async function _loadPrefs(wrap, vaultToken) {
  const form = wrap.querySelector('#gv-prefs-form');
  try {
    const res = await fetch('/api/cyberapps/ghostvault/settings');
    const settings = res.ok ? await res.json() : {};

    form.innerHTML = `
      <div class="gv-field">
        <label class="gv-label">Default Folder</label>
        <input type="text" class="gv-input" id="gv-pref-folder" value="${_esc(settings.default_folder || 'Notes')}" />
      </div>
      <div class="gv-field">
        <label class="gv-label">AI Context</label>
        <select class="gv-select" id="gv-pref-ctx">
          ${['work', 'cyber', 'personal'].map(c =>
            `<option value="${c}"${settings.default_ai_context === c ? ' selected' : ''}>${c}</option>`
          ).join('')}
        </select>
      </div>
      <div class="gv-field">
        <label class="gv-label">Editor Mode</label>
        <select class="gv-select" id="gv-pref-editor">
          ${['edit', 'split', 'preview'].map(m =>
            `<option value="${m}"${settings.editor_mode === m ? ' selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>
      <button class="gv-btn gv-btn-primary" id="gv-save-prefs">Save Preferences</button>
      <div id="gv-prefs-status" style="display:none;"></div>
    `;

    form.querySelector('#gv-save-prefs').addEventListener('click', async () => {
      const btn = form.querySelector('#gv-save-prefs');
      const status = form.querySelector('#gv-prefs-status');
      btn.disabled = true;
      try {
        const res2 = await fetch('/api/cyberapps/ghostvault/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            default_folder: form.querySelector('#gv-pref-folder').value,
            default_ai_context: form.querySelector('#gv-pref-ctx').value,
            editor_mode: form.querySelector('#gv-pref-editor').value,
          }),
        });
        status.textContent = res2.ok ? 'Saved.' : 'Save failed.';
        status.className = res2.ok ? 'gv-success' : 'gv-error';
        status.style.display = 'block';
        setTimeout(() => { status.style.display = 'none'; }, 2500);
      } catch (_) {
        status.textContent = 'Network error.';
        status.className = 'gv-error';
        status.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    });
  } catch (_) {
    form.innerHTML = '<div class="gv-error">Failed to load preferences.</div>';
  }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}
