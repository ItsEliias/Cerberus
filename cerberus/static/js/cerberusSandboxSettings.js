// Cerberus — Settings → Sandbox panel (admin)
//
// Wires the admin-only "Sandbox" settings tab to the desktop settings API
// (routes/desktop_settings_routes.py). Lets an admin toggle Docker-backed
// features and point SANDBOX_URL at a local or remote Docker server. Changes
// persist to <DATA_DIR>/desktop_settings.json and apply on the next launch.
//
// Self-initialising: binds on DOMContentLoaded, lazy-loads when the tab opens.

const _el = (id) => document.getElementById(id);

let _bound = false;
let _loaded = false;

function _setMsg(text, kind) {
  const msg = _el('settings-sandbox-msg');
  if (!msg) return;
  msg.textContent = text || '';
  // kind: 'ok' | 'warn' | 'err' | undefined — colour via theme tokens only.
  const colour = kind === 'ok' ? 'var(--color-success, #3fb950)'
    : kind === 'err' ? 'var(--color-error, #f85149)'
    : kind === 'warn' ? 'var(--color-warning, #d29922)'
    : 'inherit';
  msg.style.color = colour;
}

async function _load() {
  try {
    const res = await fetch('/api/desktop/settings', { credentials: 'same-origin' });
    if (res.status === 403) { _setMsg('Admin access required.', 'warn'); return; }
    if (res.status === 404) { _setMsg('Desktop settings API unavailable on this build.', 'warn'); return; }
    if (!res.ok) { _setMsg(`Could not load settings (HTTP ${res.status}).`, 'err'); return; }
    const data = await res.json();

    const enabled = _el('settings-sandbox-enabled');
    if (enabled) enabled.checked = !!data.CERBERUS_SANDBOX_ENABLED;
    const url = _el('settings-sandbox-url');
    if (url) url.value = data.SANDBOX_URL || '';
    const searxng = _el('settings-sandbox-searxng');
    if (searxng) searxng.value = data.SEARCH_SEARXNG_INSTANCE || '';
    const chroma = _el('settings-sandbox-chroma');
    if (chroma) chroma.value = data.CHROMA_URL || '';
    // API key: never populate the password field with the masked value; show a
    // hint instead so the admin knows one is already set.
    const key = _el('settings-sandbox-key');
    if (key) key.placeholder = data.SANDBOX_API_KEY ? '•••• (set — leave blank to keep)' : 'not set';

    _loaded = true;
    _setMsg('');
  } catch (e) {
    _setMsg('Could not reach the server.', 'err');
  }
}

// Render the prominent status banner so it's obvious whether Docker-backed
// features are actually on and reachable — the whole point of this panel.
function _setBanner(icon, html, kind) {
  const box = _el('settings-sandbox-banner');
  const ic = _el('settings-sandbox-banner-icon');
  const tx = _el('settings-sandbox-banner-text');
  if (!box || !tx) return;
  if (ic) ic.textContent = icon;
  tx.innerHTML = html;
  const border = kind === 'ok' ? 'var(--color-success, #3fb950)'
    : kind === 'err' ? 'var(--color-error, #f85149)'
    : kind === 'warn' ? 'var(--color-warning, #d29922)'
    : 'var(--border)';
  box.style.borderColor = border;
  box.style.background = kind
    ? `color-mix(in srgb, ${border} 12%, transparent)`
    : 'color-mix(in srgb, var(--panel) 60%, transparent)';
}

async function _refreshBanner() {
  _setBanner('⏳', 'Checking sandbox status…', null);
  try {
    const res = await fetch('/api/desktop/settings/status', { credentials: 'same-origin' });
    if (res.status === 404) {
      _setBanner('ℹ️', 'Desktop settings API is not available on this build.', 'warn');
      return;
    }
    if (!res.ok) { _setBanner('⚠️', `Could not read status (HTTP ${res.status}).`, 'warn'); return; }
    const s = await res.json();
    const url = s.sandbox_url || '(no URL set)';
    if (!s.enabled) {
      _setBanner('⚠️', 'Docker features are <strong>OFF</strong>. Sandboxed code execution, vectors and search need a running <strong>Docker</strong> server — enable the toggle below, set the URL, save, then restart.', 'warn');
    } else if (s.reachable) {
      _setBanner('✅', `Connected to the Docker sandbox at <code>${url}</code>. Docker features are active.`, 'ok');
    } else {
      _setBanner('⛔', `Enabled, but <strong>can't reach</strong> <code>${url}</code> — is <strong>Docker</strong> running and the server up? Code execution fails closed until it's reachable.`, 'err');
    }
  } catch (e) {
    _setBanner('⛔', "Couldn't reach the server to check sandbox status.", 'err');
  }
}

async function _save() {
  const body = {
    CERBERUS_SANDBOX_ENABLED: !!(_el('settings-sandbox-enabled') || {}).checked,
    SANDBOX_URL: (_el('settings-sandbox-url') || {}).value || '',
    SEARCH_SEARXNG_INSTANCE: (_el('settings-sandbox-searxng') || {}).value || '',
    CHROMA_URL: (_el('settings-sandbox-chroma') || {}).value || '',
  };
  // Only send the API key when the admin actually typed a new one.
  const keyEl = _el('settings-sandbox-key');
  if (keyEl && keyEl.value) body.SANDBOX_API_KEY = keyEl.value;

  _setMsg('Saving…');
  try {
    const res = await fetch('/api/desktop/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.detail) detail = j.detail; } catch (_) {}
      _setMsg(`Save failed: ${detail}`, 'err');
      return;
    }
    if (keyEl) keyEl.value = '';
    _setMsg('Saved — restart Cerberus to apply.', 'ok');
    _refreshBanner();
  } catch (e) {
    _setMsg('Save failed: could not reach the server.', 'err');
  }
}

async function _test() {
  _setMsg('Testing…');
  try {
    const res = await fetch('/api/desktop/settings/status', { credentials: 'same-origin' });
    if (!res.ok) { _setMsg(`Status check failed (HTTP ${res.status}).`, 'err'); return; }
    const s = await res.json();
    if (!s.enabled) { _setMsg('Sandbox is currently disabled in the running process.', 'warn'); return; }
    if (s.reachable) {
      _setMsg(`Reachable: ${s.sandbox_url}`, 'ok');
    } else {
      _setMsg(`Not reachable: ${s.sandbox_url || '(no URL)'}${s.detail ? ' — ' + s.detail : ''}`, 'err');
    }
  } catch (e) {
    _setMsg('Status check failed: could not reach the server.', 'err');
  }
}

function _bind() {
  if (_bound) return;
  const nav = document.querySelector('[data-settings-tab="sandbox"]');
  const saveBtn = _el('settings-sandbox-save');
  const testBtn = _el('settings-sandbox-test');
  if (!nav && !saveBtn) return;  // panel not in this DOM yet
  _bound = true;

  // On each open: load fields once, and always refresh the status banner so the
  // enabled/reachable state (and the Docker requirement) is immediately obvious.
  if (nav) nav.addEventListener('click', () => { if (!_loaded) _load(); else _refreshBanner(); });
  if (saveBtn) saveBtn.addEventListener('click', _save);
  if (testBtn) testBtn.addEventListener('click', () => { _test(); _refreshBanner(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bind);
} else {
  _bind();
}

export default { _load, _save, _test };
