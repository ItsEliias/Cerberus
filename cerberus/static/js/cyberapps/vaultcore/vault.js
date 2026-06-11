/**
 * VaultCore — vault gate (unlock / setup redirect).
 */

const API = '';

export function renderVaultGate(container, mode, onUnlocked) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'vc-vault-gate';

  if (mode === 'setup') {
    wrap.innerHTML = `
      <div class="vc-vault-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          <circle cx="12" cy="16" r="1"/>
        </svg>
      </div>
      <h3 class="vc-vault-title">Vault Not Initialized</h3>
      <p class="vc-vault-desc">
        VaultCore uses the shared Cerberus vault.<br>
        Open <strong>CyberLab</strong> first to set up the master password.
      </p>
      <p class="vc-vault-hint">Once CyberLab's vault is initialized, come back here to unlock it.</p>
    `;
  } else {
    wrap.innerHTML = `
      <div class="vc-vault-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          <circle cx="12" cy="16" r="1"/>
        </svg>
      </div>
      <h3 class="vc-vault-title">Vault Locked</h3>
      <p class="vc-vault-desc">Enter your master password to unlock VaultCore.</p>
      <div class="vc-vault-form">
        <input type="password" id="vc-vault-pw" class="vc-input" placeholder="Master password" autocomplete="current-password">
        <button class="vc-btn vc-btn-primary" id="vc-vault-unlock-btn">Unlock</button>
        <div class="vc-error" id="vc-vault-error" style="display:none"></div>
      </div>
    `;

    const pw = wrap.querySelector('#vc-vault-pw');
    const btn = wrap.querySelector('#vc-vault-unlock-btn');
    const err = wrap.querySelector('#vc-vault-error');

    async function doUnlock() {
      const password = pw.value;
      if (!password) return;
      btn.disabled = true;
      btn.textContent = 'Unlocking…';
      err.style.display = 'none';
      try {
        const res = await fetch(`${API}/api/cyberapps/vault/unlock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (res.ok) {
          onUnlocked(data.session_token);
        } else {
          err.textContent = data.detail || 'Invalid password';
          err.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Unlock';
        }
      } catch (e) {
        err.textContent = String(e);
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Unlock';
      }
    }

    btn.addEventListener('click', doUnlock);
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
    setTimeout(() => pw.focus(), 50);
  }

  container.appendChild(wrap);
}
