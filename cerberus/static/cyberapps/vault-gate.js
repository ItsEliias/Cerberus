/**
 * static/cyberapps/vault-gate.js
 *
 * Shared vault gate UI for the Cyber Apps bootstrap.
 * Renders an inline setup or unlock form directly inside the app content area.
 *
 * Usage (browser global — no module bundler):
 *   CyberAppsVaultGate.render(container, onUnlocked)
 *
 * Flow:
 *   1. Calls GET /api/cyberapps/vault/status
 *   2. If initialized=false  → shows setup form (set master password twice)
 *   3. If initialized=true   → shows unlock form
 *   4. On success: calls onUnlocked(token) and dispatches cyberapp:vault-unlocked
 */

(function (global) {
  'use strict';

  var BASE = '';

  /**
   * Render the vault gate (setup or unlock) inside container.
   * @param {HTMLElement} container
   * @param {function(string):void} onUnlocked - called with session_token on success
   */
  function render(container, onUnlocked) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:220px;">' +
      '<span style="opacity:0.4;font-size:13px;">Checking vault…</span></div>';

    fetch(BASE + '/api/cyberapps/vault/status', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var mode = data.initialized ? 'unlock' : 'setup';
        _renderForm(container, mode, onUnlocked);
      })
      .catch(function () {
        _renderForm(container, 'unlock', onUnlocked);
      });
  }

  // ---------------------------------------------------------------------------
  // Internal: build and wire the form
  // ---------------------------------------------------------------------------

  function _renderForm(container, mode, onUnlocked) {
    var isSetup = mode === 'setup';
    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.minHeight = '220px';

    var box = document.createElement('div');
    box.style.cssText = [
      'max-width:320px', 'width:100%', 'padding:24px',
      'background:rgba(255,255,255,.04)',
      'border:1px solid var(--border,#3a2a2a)',
      'border-radius:8px',
    ].join(';');

    box.innerHTML =
      '<div style="text-align:center;margin-bottom:16px;">' +
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--red,#c0392b)"' +
            ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="3" y="11" width="18" height="11" rx="2"/>' +
          '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>' +
        '</svg>' +
        '<div style="font-size:15px;font-weight:600;margin-top:8px;">' +
          (isSetup ? 'Create Vault Password' : 'Unlock Vault') +
        '</div>' +
        '<div style="font-size:12px;opacity:.55;margin-top:4px;">' +
          (isSetup
            ? 'Set a master password to protect your credentials and sensitive data.'
            : 'Enter your master password to continue.') +
        '</div>' +
      '</div>' +
      '<div id="cvg-err" style="display:none;color:var(--red,#c0392b);font-size:11px;margin-bottom:8px;"></div>' +
      '<div style="margin-bottom:10px;">' +
        '<label style="font-size:11px;opacity:.65;display:block;margin-bottom:3px;">Master Password</label>' +
        '<input id="cvg-pw" type="password" placeholder="Enter password…" autocomplete="current-password"' +
          ' style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);' +
          'border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);' +
          'border-radius:4px;padding:7px 10px;font-size:13px;">' +
      '</div>' +
      (isSetup
        ? '<div style="margin-bottom:14px;">' +
            '<label style="font-size:11px;opacity:.65;display:block;margin-bottom:3px;">Confirm Password</label>' +
            '<input id="cvg-pw2" type="password" placeholder="Confirm password…" autocomplete="new-password"' +
              ' style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);' +
              'border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);' +
              'border-radius:4px;padding:7px 10px;font-size:13px;">' +
          '</div>'
        : '') +
      '<button id="cvg-submit" style="width:100%;background:var(--red,#c0392b);color:#fff;' +
        'border:none;border-radius:4px;padding:8px;font-size:13px;cursor:pointer;font-weight:500;">' +
        (isSetup ? 'Create Vault' : 'Unlock') +
      '</button>';

    container.appendChild(box);

    var pwEl = box.querySelector('#cvg-pw');
    var errEl = box.querySelector('#cvg-err');
    var btn = box.querySelector('#cvg-submit');

    function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
    function hideErr() { errEl.style.display = 'none'; }

    btn.addEventListener('click', function () {
      hideErr();
      var pw = pwEl.value;
      if (!pw) { showErr('Password is required.'); return; }

      if (isSetup) {
        var pw2El = box.querySelector('#cvg-pw2');
        var pw2 = pw2El ? pw2El.value : '';
        if (pw.length < 8) { showErr('Password must be at least 8 characters.'); return; }
        if (pw !== pw2) { showErr('Passwords do not match.'); return; }
        _doSetup(pw, onUnlocked, showErr, btn);
      } else {
        _doUnlock(pw, onUnlocked, showErr, btn);
      }
    });

    pwEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    var pw2El = box.querySelector('#cvg-pw2');
    if (pw2El) pw2El.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
  }

  function _doSetup(password, onUnlocked, showErr, btn) {
    btn.disabled = true;
    btn.textContent = 'Creating…';
    fetch(BASE + '/api/cyberapps/vault/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.detail || 'Setup failed.'); }); })
      .then(function (data) {
        _notify(data.session_token);
        onUnlocked(data.session_token);
      })
      .catch(function (err) {
        showErr(String(err.message || err));
        btn.disabled = false;
        btn.textContent = 'Create Vault';
      });
  }

  function _doUnlock(password, onUnlocked, showErr, btn) {
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    fetch(BASE + '/api/cyberapps/vault/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    })
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.detail || 'Incorrect password.'); }); })
      .then(function (data) {
        _notify(data.session_token);
        onUnlocked(data.session_token);
      })
      .catch(function (err) {
        showErr(String(err.message || err));
        btn.disabled = false;
        btn.textContent = 'Unlock';
      });
  }

  function _notify(token) {
    window.dispatchEvent(new CustomEvent('cyberapp:vault-unlocked', { detail: { token: token } }));
  }

  // Expose as global
  global.CyberAppsVaultGate = { render: render };

}(window));
