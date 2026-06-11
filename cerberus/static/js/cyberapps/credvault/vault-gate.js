/**
 * CredVault — vault gate UI
 * Renders the master-password setup / unlock form and calls the shared
 * CyberApps vault endpoints (/api/cyberapps/vault/*).
 * After unlock, calls onUnlocked(sessionToken).
 */

const API = {
  status:  '/api/cyberapps/vault/status',
  setup:   '/api/cyberapps/vault/setup',
  unlock:  '/api/cyberapps/vault/unlock',
};

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Render the vault gate into container.
 * @param {HTMLElement} container
 * @param {(token: string) => void} onUnlocked
 */
export async function renderVaultGate(container, onUnlocked) {
  let status;
  try {
    status = await apiFetch(API.status);
  } catch {
    status = { initialized: false, locked: true };
  }

  const isSetup = !status.initialized;

  container.innerHTML = `
    <div class="cv-gate" style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100%; min-height:320px; gap:20px; padding:32px;
    ">
      <div style="
        width:52px; height:52px; border-radius:14px;
        background:rgba(192,57,43,0.15); border:1px solid rgba(192,57,43,0.35);
        display:flex; align-items:center; justify-content:center; color:#c0392b;
      ">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div style="text-align:center;">
        <div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:6px;">
          ${isSetup ? 'Set Up CredVault' : 'Unlock CredVault'}
        </div>
        <div style="font-size:12px;color:#8b949e;max-width:300px;line-height:1.5;">
          ${isSetup
            ? 'Create a master password to encrypt your credentials at rest.'
            : 'Enter your master password to access your encrypted credentials.'}
        </div>
      </div>

      <form id="cv-gate-form" style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:320px;">
        <input
          id="cv-gate-pw"
          type="password"
          placeholder="${isSetup ? 'New master password (min 8 chars)' : 'Master password'}"
          autocomplete="${isSetup ? 'new-password' : 'current-password'}"
          style="font-size:13px;"
          autofocus
        />
        ${isSetup ? `
        <input
          id="cv-gate-pw2"
          type="password"
          placeholder="Confirm master password"
          autocomplete="new-password"
          style="font-size:13px;"
        />` : ''}
        <div id="cv-gate-err" style="font-size:12px;color:#f85149;display:none;"></div>
        <button type="submit" style="
          padding:9px; border-radius:8px; font-size:13px; font-weight:600;
          background:var(--red, #c0392b); border:none; color:#fff; cursor:pointer;
        ">
          ${isSetup ? 'Create Vault' : 'Unlock'}
        </button>
      </form>
    </div>
  `;

  const form = container.querySelector('#cv-gate-form');
  const errEl = container.querySelector('#cv-gate-err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display = 'none';
    const pw = container.querySelector('#cv-gate-pw').value;
    if (!pw) return;

    if (isSetup) {
      const pw2 = container.querySelector('#cv-gate-pw2').value;
      if (pw !== pw2) {
        errEl.textContent = 'Passwords do not match.';
        errEl.style.display = 'block';
        return;
      }
      if (pw.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters.';
        errEl.style.display = 'block';
        return;
      }
      try {
        const res = await apiFetch(API.setup, {
          method: 'POST',
          body: JSON.stringify({ password: pw }),
        });
        onUnlocked(res.session_token);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    } else {
      try {
        const res = await apiFetch(API.unlock, {
          method: 'POST',
          body: JSON.stringify({ password: pw }),
        });
        onUnlocked(res.session_token);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    }
  });
}
