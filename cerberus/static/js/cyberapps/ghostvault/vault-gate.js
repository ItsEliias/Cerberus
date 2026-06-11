/**
 * GhostVault — vault gate UI.
 * Renders an unlock form when vault is initialized but locked,
 * or a redirect message when the vault has not been set up yet.
 *
 * @param {HTMLElement} container
 * @param {'unlock'|'setup'} mode
 * @param {(token: string) => void} onUnlocked
 */
export function renderVaultGate(container, mode, onUnlocked) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'gv-vault-gate';

  if (mode === 'setup') {
    wrap.innerHTML = `
      <div class="gv-vault-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>
      <div class="gv-vault-title">Vault Not Initialised</div>
      <div class="gv-vault-desc">Open <strong>CyberLab</strong> to set up the shared vault first.<br>
        GhostVault uses the same master password as CyberLab, CredVault, and VaultCore.</div>
      <div class="gv-vault-hint">Once the vault is set up, return here to unlock.</div>
    `;
    container.appendChild(wrap);
    return;
  }

  // mode === 'unlock'
  wrap.innerHTML = `
    <div class="gv-vault-icon">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    <div class="gv-vault-title">GhostVault Locked</div>
    <div class="gv-vault-desc">Enter your master password to decrypt your notes.</div>
    <form class="gv-vault-form" id="gv-unlock-form" autocomplete="off">
      <input
        type="password"
        id="gv-password-input"
        class="gv-input"
        placeholder="Master password"
        autocomplete="current-password"
        required
      />
      <button type="submit" class="gv-btn gv-btn-primary" id="gv-unlock-btn">Unlock</button>
      <div id="gv-unlock-error" class="gv-error" style="display:none;"></div>
    </form>
  `;
  container.appendChild(wrap);

  const form = wrap.querySelector('#gv-unlock-form');
  const input = wrap.querySelector('#gv-password-input');
  const btn = wrap.querySelector('#gv-unlock-btn');
  const errEl = wrap.querySelector('#gv-unlock-error');

  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value;
    if (!password) return;

    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    errEl.style.display = 'none';

    try {
      const res = await fetch('/api/cyberapps/vault/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        _showError(errEl, data.detail || 'Unlock failed');
        btn.disabled = false;
        btn.textContent = 'Unlock';
        return;
      }
      input.value = '';
      onUnlocked(data.session_token);
    } catch (err) {
      _showError(errEl, 'Network error — is Cerberus running?');
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });
}

function _showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}
