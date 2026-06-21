/**
 * cc-settings.js — CC Settings overlay.
 *
 * Opened by the gear icon in the CC header or the , keyboard shortcut.
 * Five sections: GENERAL | GATEWAY | AGENTS | VOICE | ABOUT
 * Each section loads independently — one failing fetch never blanks the rest.
 *
 * Exports: openSettings(shell), closeSettings(), isSettingsOpen()
 */

import { t, setLocale, getLocale, AVAILABLE_LOCALES } from '/static/js/i18n.js';

const OVERLAY_ID = 'cc-settings-overlay';
const LS_WAKE    = 'cerberus.wake_word_enabled';

let _shell = null;

export function openSettings(shell) {
  _shell = shell || document.body;
  let overlay = _shell.querySelector(`#${OVERLAY_ID}`);
  if (!overlay) {
    _ensureStyles();
    overlay = _buildOverlay();
    _shell.appendChild(overlay);
    _wireOverlay(overlay);
    _loadAll(overlay);
  }
  overlay.removeAttribute('hidden');
  overlay.querySelector('.cc-settings-modal')?.focus();
}

export function closeSettings() {
  const overlay = (_shell?.querySelector(`#${OVERLAY_ID}`)) || document.getElementById(OVERLAY_ID);
  if (overlay) overlay.setAttribute('hidden', '');
}

export function isSettingsOpen() {
  const overlay = (_shell?.querySelector(`#${OVERLAY_ID}`)) || document.getElementById(OVERLAY_ID);
  return overlay ? !overlay.hasAttribute('hidden') : false;
}

// ── Build ────────────────────────────────────────────────────────────────────

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _buildOverlay() {
  const wrap = document.createElement('div');
  wrap.id = OVERLAY_ID;
  wrap.className = 'cc-sett-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Settings');

  const localeOptions = (AVAILABLE_LOCALES || ['en', 'es']).map(loc =>
    `<option value="${_esc(loc)}"${loc === getLocale() ? ' selected' : ''}>${loc.toUpperCase()}</option>`
  ).join('');

  wrap.innerHTML = `
<div class="cc-sett-modal" tabindex="-1">
  <div class="cc-sett-header">
    <span class="cc-sett-title">// SETTINGS</span>
    <button class="cc-sett-close" id="cc-sett-close-btn" aria-label="Close settings">✕</button>
  </div>
  <div class="cc-sett-body">

    <div class="cc-sett-section-head">// GENERAL</div>
    <div class="cc-sett-row">
      <label class="cc-sett-label" for="cc-sett-locale">Language</label>
      <select class="cc-sett-ctrl" id="cc-sett-locale" aria-label="Interface language">
        ${localeOptions}
      </select>
    </div>
    <div class="cc-sett-row">
      <span class="cc-sett-label">Theme</span>
      <span class="cc-sett-readonly">Nexus HUD (fixed)</span>
    </div>

    <div class="cc-sett-section-head">// GATEWAY</div>
    <div id="cc-sett-gw" class="cc-sett-async-block">
      <span class="cc-sett-loading">Loading…</span>
    </div>
    <div class="cc-sett-row">
      <span class="cc-sett-label">Email allowlist</span>
      <span class="cc-sett-readonly" id="cc-sett-email-note">configured in .env</span>
    </div>

    <div class="cc-sett-section-head">// AGENTS</div>
    <div class="cc-sett-row">
      <label class="cc-sett-label" for="cc-sett-ctx">Context window</label>
      <input class="cc-sett-ctrl cc-sett-num" type="number" id="cc-sett-ctx"
        min="1" max="200" placeholder="20" aria-label="Default agent context window">
    </div>
    <div class="cc-sett-row">
      <label class="cc-sett-label" for="cc-sett-mtc">Max tool calls</label>
      <input class="cc-sett-ctrl cc-sett-num" type="number" id="cc-sett-mtc"
        min="0" max="1000" placeholder="0 = unlimited" aria-label="Default agent max tool calls">
    </div>
    <div class="cc-sett-row cc-sett-row--actions">
      <button class="cc-sett-save-btn" id="cc-sett-agents-save">Save agents</button>
      <span class="cc-sett-save-status" id="cc-sett-agents-status"></span>
    </div>

    <div class="cc-sett-section-head">// VOICE</div>
    <div class="cc-sett-row">
      <label class="cc-sett-label" for="cc-sett-wakeword">Wake-word</label>
      <label class="cc-sett-toggle-wrap">
        <input class="cc-sett-toggle-input" type="checkbox" id="cc-sett-wakeword"
          aria-label="Enable wake-word activation">
        <span class="cc-sett-toggle-track"></span>
        <span class="cc-sett-toggle-text">Enable</span>
      </label>
    </div>
    <div class="cc-sett-row">
      <label class="cc-sett-label" for="cc-sett-voice">TTS voice</label>
      <select class="cc-sett-ctrl" id="cc-sett-voice" aria-label="Default TTS voice">
        <option value="">Loading…</option>
      </select>
    </div>

    <div class="cc-sett-section-head">// ABOUT</div>
    <div id="cc-sett-about" class="cc-sett-async-block">
      <span class="cc-sett-loading">Loading…</span>
    </div>
    <div class="cc-sett-row">
      <span class="cc-sett-label">Changelog</span>
      <button class="cc-sett-link-btn" id="cc-sett-changelog-btn">Open changelog</button>
    </div>

  </div>
</div>`;
  return wrap;
}

// ── Wire events ──────────────────────────────────────────────────────────────

function _wireOverlay(overlay) {
  // Close button
  overlay.querySelector('#cc-sett-close-btn')?.addEventListener('click', closeSettings);

  // Backdrop click closes
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSettings();
  });

  // Escape key
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeSettings(); }
  });

  // Language picker
  const localePicker = overlay.querySelector('#cc-sett-locale');
  if (localePicker) {
    localePicker.addEventListener('change', () => setLocale(localePicker.value));
  }

  // Wake-word toggle — localStorage
  const wakeChk = overlay.querySelector('#cc-sett-wakeword');
  if (wakeChk) {
    wakeChk.checked = localStorage.getItem(LS_WAKE) === 'true';
    wakeChk.addEventListener('change', () =>
      localStorage.setItem(LS_WAKE, String(wakeChk.checked))
    );
  }

  // Agents save
  overlay.querySelector('#cc-sett-agents-save')?.addEventListener('click', () =>
    _saveAgentSettings(overlay)
  );

  // Changelog shortcut
  overlay.querySelector('#cc-sett-changelog-btn')?.addEventListener('click', () => {
    closeSettings();
    document.dispatchEvent(new CustomEvent('cerberus:switch-tab', { detail: { tab: 'council' } }));
  });
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _loadAll(overlay) {
  await Promise.allSettled([
    _loadGateway(overlay),
    _loadAgentSettings(overlay),
    _loadVoices(overlay),
    _loadAbout(overlay),
  ]);
}

async function _loadGateway(overlay) {
  const block = overlay.querySelector('#cc-sett-gw');
  if (!block) return;
  try {
    const res = await fetch('/api/gateway/autoapprove', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const platforms = ['discord', 'telegram', 'slack'];
    block.innerHTML = platforms.map(p => `
      <div class="cc-sett-row">
        <label class="cc-sett-label" for="cc-sett-gw-${_esc(p)}">
          ${_esc(p.charAt(0).toUpperCase() + p.slice(1))} auto-approve
        </label>
        <label class="cc-sett-toggle-wrap">
          <input class="cc-sett-toggle-input" type="checkbox" id="cc-sett-gw-${_esc(p)}"
            data-platform="${_esc(p)}" ${data[p] ? 'checked' : ''}
            aria-label="${_esc(p)} auto-approve">
          <span class="cc-sett-toggle-track"></span>
        </label>
      </div>`).join('');

    block.querySelectorAll('input[data-platform]').forEach(chk => {
      chk.addEventListener('change', async () => {
        try {
          await fetch('/api/gateway/autoapprove', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: chk.dataset.platform, enabled: chk.checked }),
          });
        } catch (_) { /* best-effort */ }
      });
    });
  } catch (err) {
    block.innerHTML = `<div class="cc-sett-note">Gateway auto-approve not configured (${_esc(err.message)})</div>`;
  }
}

async function _loadAgentSettings(overlay) {
  try {
    const res = await fetch('/api/auth/settings', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ctxEl = overlay.querySelector('#cc-sett-ctx');
    const mtcEl = overlay.querySelector('#cc-sett-mtc');
    if (ctxEl && data.agent_context_window != null) ctxEl.value = data.agent_context_window;
    if (mtcEl && data.agent_max_tool_calls   != null) mtcEl.value = data.agent_max_tool_calls;
  } catch (_) { /* degrade silently — inputs keep placeholder */ }
}

async function _saveAgentSettings(overlay) {
  const ctxEl    = overlay.querySelector('#cc-sett-ctx');
  const mtcEl    = overlay.querySelector('#cc-sett-mtc');
  const statusEl = overlay.querySelector('#cc-sett-agents-status');
  const body = {};
  if (ctxEl?.value !== '') body.agent_context_window = Number(ctxEl.value);
  if (mtcEl?.value !== '') body.agent_max_tool_calls  = Number(mtcEl.value);
  try {
    const res = await fetch('/api/auth/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (statusEl) { statusEl.textContent = 'Saved'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error: ${_esc(err.message)}`;
  }
}

async function _loadVoices(overlay) {
  const sel = overlay.querySelector('#cc-sett-voice');
  if (!sel) return;
  try {
    const res = await fetch('/api/tts/voices', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const voices = Array.isArray(data) ? data : (data.voices || []);
    if (!voices.length) { sel.innerHTML = '<option value="">No voices available</option>'; return; }
    sel.innerHTML = voices.map(v => {
      const val  = typeof v === 'string' ? v : (v.id || v.name || '');
      const label = typeof v === 'string' ? v : (v.name || v.id || '');
      return `<option value="${_esc(val)}">${_esc(label)}</option>`;
    }).join('');
  } catch (err) {
    sel.innerHTML = `<option value="">Voices unavailable (${_esc(err.message)})</option>`;
  }
}

async function _loadAbout(overlay) {
  const block = overlay.querySelector('#cc-sett-about');
  if (!block) return;
  try {
    const res = await fetch('/api/health', { credentials: 'same-origin' });
    const data = res.ok ? await res.json() : {};
    const status = data.status || (res.ok ? 'ok' : 'degraded');
    const version = data.version || '—';
    const okCol = status === 'ok' ? 'var(--cc-ok, #27ae60)' : 'var(--cc-warn, #e67e22)';
    block.innerHTML = `
      <div class="cc-sett-row">
        <span class="cc-sett-label">Version</span>
        <span class="cc-sett-readonly">${_esc(version)}</span>
      </div>
      <div class="cc-sett-row">
        <span class="cc-sett-label">Backend status</span>
        <span class="cc-sett-readonly" style="color:${okCol}">${_esc(status.toUpperCase())}</span>
      </div>`;
  } catch (_) {
    block.innerHTML = `<div class="cc-sett-note">Health endpoint unreachable</div>`;
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

function _ensureStyles() {
  if (document.getElementById('cc-sett-styles')) return;
  const s = document.createElement('style');
  s.id = 'cc-sett-styles';
  s.textContent = `
.cc-sett-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: color-mix(in srgb, var(--cc-void, #060708) 70%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.cc-sett-overlay[hidden] { display: none; }
.cc-sett-modal {
  background: var(--cc-surface-raise, var(--surface-raise, #1a1d23));
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  border-radius: 4px; width: 100%; max-width: 560px; max-height: 88vh;
  display: flex; flex-direction: column; outline: none;
  animation: cc-sett-in .18s ease;
}
@keyframes cc-sett-in { from { opacity:0; transform:translateY(-8px); } }
@media (prefers-reduced-motion: reduce) {
  .cc-sett-modal { animation: none; }
}
.cc-sett-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px 12px; border-bottom: 1px solid var(--cc-border);
  flex-shrink: 0;
}
.cc-sett-title {
  font-family: 'Orbitron', monospace; font-size: 13px; font-weight: 700;
  letter-spacing: .1em; color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-sett-close {
  background: none; border: none; cursor: pointer;
  color: var(--cc-fg); font-size: 16px; padding: 2px 6px; border-radius: 2px;
  -webkit-appearance: none; appearance: none;
}
.cc-sett-close:hover { color: var(--cc-crimson, var(--red)); }
.cc-sett-body {
  padding: 16px 18px 20px; overflow-y: auto; flex: 1;
  color: var(--cc-fg); font-family: 'JetBrains Mono','Fira Code',monospace; font-size: 12px;
}
.cc-sett-section-head {
  font-family: 'Orbitron', monospace; font-size: 10px; font-weight: 700;
  letter-spacing: .14em; color: var(--cc-crimson, var(--red, #c0392b));
  margin: 18px 0 10px; opacity: .85;
}
.cc-sett-section-head:first-child { margin-top: 0; }
.cc-sett-row {
  display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
}
.cc-sett-row--actions { margin-top: 4px; }
.cc-sett-label {
  width: 160px; flex-shrink: 0; opacity: .8; font-size: 11px;
}
.cc-sett-readonly { opacity: .55; font-size: 11px; }
.cc-sett-note { font-size: 11px; opacity: .45; padding: 4px 0; }
.cc-sett-loading { font-size: 11px; opacity: .4; }
.cc-sett-ctrl {
  flex: 1; background: var(--cc-void-mid, #0d0f12);
  border: 1px solid var(--cc-border); color: var(--cc-fg);
  padding: 5px 8px; border-radius: 3px; font-size: 11px;
  font-family: inherit; -webkit-appearance: none; appearance: none;
}
.cc-sett-ctrl:focus { outline: 1px solid var(--cc-crimson); outline-offset: 1px; }
.cc-sett-num { max-width: 100px; flex: none; }
.cc-sett-toggle-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.cc-sett-toggle-input { -webkit-appearance: none; appearance: none; position: absolute; opacity: 0; }
.cc-sett-toggle-track {
  width: 32px; height: 16px; background: var(--cc-border);
  border-radius: 8px; position: relative; transition: background .15s;
  flex-shrink: 0;
}
.cc-sett-toggle-track::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--cc-fg); transition: transform .15s;
}
.cc-sett-toggle-input:checked + .cc-sett-toggle-track { background: var(--cc-crimson); }
.cc-sett-toggle-input:checked + .cc-sett-toggle-track::after { transform: translateX(16px); }
@media (prefers-reduced-motion: reduce) {
  .cc-sett-toggle-track, .cc-sett-toggle-track::after { transition: none; }
}
.cc-sett-toggle-text { font-size: 11px; opacity: .7; }
.cc-sett-save-btn {
  background: none; border: 1px solid var(--cc-border);
  color: var(--cc-fg); padding: 4px 12px; border-radius: 3px;
  cursor: pointer; font-size: 11px; font-family: inherit;
  -webkit-appearance: none; appearance: none;
}
.cc-sett-save-btn:hover { border-color: var(--cc-crimson); color: var(--cc-crimson); }
.cc-sett-save-status { font-size: 11px; opacity: .6; }
.cc-sett-link-btn {
  background: none; border: none; cursor: pointer;
  color: var(--cc-crimson); font-size: 11px; padding: 0;
  font-family: inherit; text-decoration: underline;
  -webkit-appearance: none; appearance: none;
}
.cc-sett-async-block { margin-bottom: 4px; }
`;
  document.head.appendChild(s);
}

// ── Testables ────────────────────────────────────────────────────────────────
export const __testables = { _loadGateway, _loadAgentSettings, _loadVoices, _loadAbout };
