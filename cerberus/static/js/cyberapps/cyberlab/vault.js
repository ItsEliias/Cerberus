/**
 * vault.js — Vault setup / unlock UI for CyberLab.
 *
 * renderVaultGate(container, mode, onUnlocked)
 *   mode: 'setup' | 'unlock'
 *   onUnlocked: (token: string) => void
 */

const API = '';

export function renderVaultGate(container, mode, onUnlocked) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.minHeight = '300px';

  const box = document.createElement('div');
  box.style.cssText = 'max-width:320px;width:100%;padding:24px;background:rgba(255,255,255,.04);border:1px solid var(--border,#3a2a2a);border-radius:8px;';

  const isSetup = mode === 'setup';
  box.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--red,#c0392b)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <div style="font-size:15px;font-weight:600;margin-top:8px;">${isSetup ? 'Create Vault Password' : 'Unlock Vault'}</div>
      <div style="font-size:12px;opacity:.55;margin-top:4px;">
        ${isSetup ? 'Set a master password to protect your credentials and sensitive data.' : 'Enter your master password to continue.'}
      </div>
    </div>
    <div id="cl-vault-err" style="display:none;color:var(--red,#c0392b);font-size:11px;margin-bottom:8px;"></div>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px;opacity:.65;display:block;margin-bottom:3px;">Master Password</label>
      <input id="cl-vault-pw" type="password" placeholder="Enter password..." autocomplete="current-password"
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);border-radius:4px;padding:7px 10px;font-size:13px;">
    </div>
    ${isSetup ? `
    <div style="margin-bottom:14px;">
      <label style="font-size:11px;opacity:.65;display:block;margin-bottom:3px;">Confirm Password</label>
      <input id="cl-vault-pw2" type="password" placeholder="Confirm password..." autocomplete="new-password"
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);border-radius:4px;padding:7px 10px;font-size:13px;">
    </div>` : ''}
    <button id="cl-vault-submit" style="width:100%;background:var(--red,#c0392b);color:#fff;border:none;border-radius:4px;padding:8px;font-size:13px;cursor:pointer;font-weight:500;">
      ${isSetup ? 'Create Vault' : 'Unlock'}
    </button>
  `;

  container.appendChild(box);

  const pwInput = box.querySelector('#cl-vault-pw');
  const errEl = box.querySelector('#cl-vault-err');
  const submitBtn = box.querySelector('#cl-vault-submit');

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }

  function hideErr() { errEl.style.display = 'none'; }

  submitBtn.addEventListener('click', async () => {
    hideErr();
    const pw = pwInput.value;
    if (!pw) { showErr('Password is required.'); return; }

    if (isSetup) {
      const pw2 = box.querySelector('#cl-vault-pw2').value;
      if (pw.length < 8) { showErr('Password must be at least 8 characters.'); return; }
      if (pw !== pw2) { showErr('Passwords do not match.'); return; }
      await _doVaultSetup(pw, onUnlocked, showErr, submitBtn);
    } else {
      await _doVaultUnlock(pw, onUnlocked, showErr, submitBtn);
    }
  });

  pwInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitBtn.click();
  });

  if (isSetup) {
    const pw2 = box.querySelector('#cl-vault-pw2');
    if (pw2) pw2.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
  }
}

async function _doVaultSetup(password, onUnlocked, showErr, btn) {
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch(`${API}/api/cyberapps/vault/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showErr(d.detail || 'Setup failed.');
      btn.disabled = false;
      btn.textContent = 'Create Vault';
      return;
    }
    const data = await res.json();
    onUnlocked(data.session_token);
  } catch (err) {
    showErr(String(err));
    btn.disabled = false;
    btn.textContent = 'Create Vault';
  }
}

async function _doVaultUnlock(password, onUnlocked, showErr, btn) {
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    const res = await fetch(`${API}/api/cyberapps/vault/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      showErr(d.detail || 'Incorrect password.');
      btn.disabled = false;
      btn.textContent = 'Unlock';
      return;
    }
    const data = await res.json();
    onUnlocked(data.session_token);
  } catch (err) {
    showErr(String(err));
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}
