/**
 * settings.js — Settings panel for CyberLab.
 *
 * Features: model dropdown, max_tokens, system-prompt override,
 *           vault settings (change password, lock now),
 *           feature toggles, credentials vault management.
 */

const API = '';

export async function renderSettings(container, ctx, vaultToken, onLockVault) {
  container.innerHTML = '<div class="cl-empty">Loading settings…</div>';

  let settings = {};
  let credentials = {};

  try {
    const [sRes, cRes] = await Promise.all([
      fetch(`${API}/api/cyberlab/settings`),
      vaultToken
        ? fetch(`${API}/api/cyberlab/credentials`, { headers: { 'X-Vault-Token': vaultToken } })
        : Promise.resolve({ ok: false }),
    ]);
    settings = await sRes.json();
    if (cRes.ok) credentials = await cRes.json();
  } catch { /* use defaults */ }

  let changePwMode = false;

  function render() {
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'cl-section-title';
    title.style.marginBottom = '14px';
    title.textContent = 'CyberLab Settings';
    container.appendChild(title);

    // AI Settings
    _section(container, 'AI Settings', `
      <div class="cl-field">
        <label class="cl-label">Default Model</label>
        <select class="cl-select" id="cl-set-model" style="width:100%">
          ${['claude-sonnet-4-6','claude-opus-4-5','claude-haiku-4-5'].map(m=>`<option value="${m}" ${settings.default_model===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="cl-field">
        <label class="cl-label">Max Tokens</label>
        <input type="number" class="cl-input" id="cl-set-tokens" value="${settings.max_tokens||2048}" min="256" max="8192">
      </div>
      <div class="cl-field">
        <label class="cl-label">System Prompt Override (leave blank for default)</label>
        <textarea class="cl-input cl-textarea" id="cl-set-sysprompt" style="min-height:80px">${_esc(settings.system_prompt_override||'')}</textarea>
      </div>
      <button class="cl-btn cl-btn-primary" id="cl-set-save-ai" style="margin-top:4px">Save AI Settings</button>
    `);

    container.querySelector('#cl-set-save-ai').addEventListener('click', async () => {
      const model = container.querySelector('#cl-set-model').value;
      const tokens = parseInt(container.querySelector('#cl-set-tokens').value, 10);
      const sysPrompt = container.querySelector('#cl-set-sysprompt').value;
      await fetch(`${API}/api/cyberlab/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_model: model, max_tokens: tokens, system_prompt_override: sysPrompt }),
      });
      _flash(container.querySelector('#cl-set-save-ai'), 'Saved!');
    });

    // Feature Toggles
    _section(container, 'Features', `
      <div class="cl-row" style="margin-bottom:8px">
        <input type="checkbox" id="cl-set-autocontext" ${settings.auto_context_inject!==false?'checked':''}>
        <label for="cl-set-autocontext" style="font-size:12px;cursor:pointer">Auto-inject active lab context into chat</label>
      </div>
      <div class="cl-row" style="margin-bottom:8px">
        <input type="checkbox" id="cl-set-kbsurface" ${settings.kb_auto_surface!==false?'checked':''}>
        <label for="cl-set-kbsurface" style="font-size:12px;cursor:pointer">Auto-surface KB entries matching active lab</label>
      </div>
      <button class="cl-btn cl-btn-primary" id="cl-set-save-features">Save Feature Settings</button>
    `);

    container.querySelector('#cl-set-save-features').addEventListener('click', async () => {
      await fetch(`${API}/api/cyberlab/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_context_inject: container.querySelector('#cl-set-autocontext').checked,
          kb_auto_surface: container.querySelector('#cl-set-kbsurface').checked,
        }),
      });
      _flash(container.querySelector('#cl-set-save-features'), 'Saved!');
    });

    // Vault Settings
    _section(container, 'Vault', `
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button class="cl-btn cl-btn-ghost" id="cl-set-lock">Lock Vault Now</button>
        <button class="cl-btn cl-btn-ghost" id="cl-set-changepw">${changePwMode ? 'Cancel' : 'Change Master Password'}</button>
      </div>
      ${changePwMode ? `
        <div class="cl-field"><label class="cl-label">Current Password</label><input type="password" class="cl-input" id="cl-set-oldpw"></div>
        <div class="cl-field"><label class="cl-label">New Password</label><input type="password" class="cl-input" id="cl-set-newpw"></div>
        <div class="cl-field"><label class="cl-label">Confirm New Password</label><input type="password" class="cl-input" id="cl-set-newpw2"></div>
        <div id="cl-set-pw-err" style="display:none" class="cl-error"></div>
        <button class="cl-btn cl-btn-primary" id="cl-set-dopwchange">Change Password</button>
      ` : ''}
    `);

    container.querySelector('#cl-set-lock').addEventListener('click', () => {
      if (confirm('Lock the vault now? You will need to re-enter your master password.')) {
        onLockVault();
      }
    });

    container.querySelector('#cl-set-changepw').addEventListener('click', () => {
      changePwMode = !changePwMode;
      render();
    });

    if (changePwMode) {
      container.querySelector('#cl-set-dopwchange').addEventListener('click', async () => {
        const oldPw = container.querySelector('#cl-set-oldpw').value;
        const newPw = container.querySelector('#cl-set-newpw').value;
        const newPw2 = container.querySelector('#cl-set-newpw2').value;
        const errEl = container.querySelector('#cl-set-pw-err');
        errEl.style.display = 'none';

        if (!oldPw || !newPw) { errEl.textContent = 'All fields required.'; errEl.style.display = 'block'; return; }
        if (newPw !== newPw2) { errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return; }
        if (newPw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.style.display = 'block'; return; }

        const res = await fetch(`${API}/api/cyberapps/vault/change-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
        });
        if (res.ok) {
          changePwMode = false;
          alert('Password changed successfully. Please unlock with your new password.');
          onLockVault();
        } else {
          const d = await res.json().catch(()=>({}));
          errEl.textContent = d.detail || 'Failed to change password.';
          errEl.style.display = 'block';
        }
      });
    }

    // Credentials Vault
    _section(container, 'Credentials Vault', `
      <div id="cl-creds-list" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:6px;align-items:flex-end">
        <div class="cl-field" style="flex:0 0 100px;margin-bottom:0"><label class="cl-label">Platform</label><input class="cl-input" id="cl-cred-plat" placeholder="htb,thm…"></div>
        <div class="cl-field" style="flex:1;margin-bottom:0"><label class="cl-label">Token / Secret</label><input type="password" class="cl-input" id="cl-cred-tok" placeholder="Paste token…"></div>
        <button class="cl-btn cl-btn-primary" id="cl-cred-save" style="flex-shrink:0">Save</button>
      </div>
    `);

    _renderCredsList(container.querySelector('#cl-creds-list'), credentials, vaultToken, async () => {
      try {
        const res = await fetch(`${API}/api/cyberlab/credentials`, { headers: { 'X-Vault-Token': vaultToken } });
        if (res.ok) credentials = await res.json();
      } catch { /* ignore */ }
      render();
    });

    container.querySelector('#cl-cred-save').addEventListener('click', async () => {
      const platform = container.querySelector('#cl-cred-plat').value.trim().toLowerCase();
      const token = container.querySelector('#cl-cred-tok').value.trim();
      if (!platform || !token) { alert('Platform and token are required.'); return; }
      if (!vaultToken) { alert('Vault is locked. Unlock to save credentials.'); return; }
      await fetch(`${API}/api/cyberlab/credentials/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Vault-Token': vaultToken },
        body: JSON.stringify({ token }),
      });
      container.querySelector('#cl-cred-plat').value = '';
      container.querySelector('#cl-cred-tok').value = '';
      try {
        const res = await fetch(`${API}/api/cyberlab/credentials`, { headers: { 'X-Vault-Token': vaultToken } });
        if (res.ok) credentials = await res.json();
      } catch { /* ignore */ }
      render();
    });
  }

  render();
}

function _renderCredsList(container, credentials, vaultToken, onDelete) {
  if (!credentials || Object.keys(credentials).length === 0) {
    container.innerHTML = '<div style="font-size:12px;opacity:.5;margin-bottom:6px;">No credentials saved.</div>';
    return;
  }
  container.innerHTML = '';
  Object.values(credentials).forEach(cred => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;background:rgba(255,255,255,.04);border-radius:4px;margin-bottom:4px;font-size:12px;';
    row.innerHTML = `
      <span style="font-weight:500;flex:0 0 80px">${_esc(cred.platform)}</span>
      <span style="flex:1;opacity:.5">Saved ${_esc(cred.saved_at||'')}</span>
      <button class="cl-btn cl-btn-danger" style="font-size:10px;padding:2px 7px">Remove</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`Remove credentials for ${cred.platform}?`)) return;
      await fetch(`${API}/api/cyberlab/credentials/${cred.platform}`, {
        method: 'DELETE',
        headers: { 'X-Vault-Token': vaultToken },
      });
      onDelete();
    });
    container.appendChild(row);
  });
}

function _section(container, title, innerHtml) {
  const div = document.createElement('div');
  div.style.cssText = 'background:rgba(255,255,255,.03);border:1px solid var(--border,#3a2a2a);border-radius:6px;padding:12px 14px;margin-bottom:12px;';
  div.innerHTML = `<div style="font-size:12px;font-weight:600;opacity:.7;margin-bottom:10px;">${_esc(title)}</div>${innerHtml}`;
  container.appendChild(div);
}

function _flash(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
