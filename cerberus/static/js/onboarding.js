/**
 * onboarding.js — operator-profile setup wizard.
 *
 * Auto-fires once on first login when GET /api/profile/onboarding-status
 * returns {onboarded: false}. Five steps, one question per screen:
 *   1. Welcome
 *   2. Identity (display_name + role)
 *   3. Location
 *   4. Interests (tag chips + suggestion row)
 *   5. Avatar (file upload OR emoji fallback)
 *
 * On COMPLETE SETUP: optionally POSTs the file to /api/profile/avatar,
 * then PATCH /api/profile with the collected fields and onboarded=true,
 * removes the overlay, and dispatches `cerberus:onboarded` on document.
 */

const ENDPOINT_STATUS = '/api/profile/onboarding-status';
const ENDPOINT_PATCH  = '/api/profile';
const ENDPOINT_AVATAR = '/api/profile/avatar';

const SUGGESTIONS = [
  'AI', 'Security', 'Development', 'Design',
  'Research', 'Finance', 'Operations', 'Data', 'Mobile', 'DevOps',
];

const EMOJI_FALLBACKS = ['🛡', '⚡', '🎯', '🧠', '🔭', '🐉', '🦊', '🦉'];

const OVERLAY_ID = 'cerberus-onboarding-overlay';

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// State carried across steps. Persisted via _state object so steps can
// pre-fill / round-trip values without re-querying the DOM each time.
const _state = {
  step: 0,
  display_name: '',
  role: '',
  bio: '',
  location: '',
  interests: [],
  avatar_url: '',
  avatar_file: null,    // pending File object, uploaded on complete
  avatar_emoji: '',     // chosen emoji fallback when no file
};

let _root = null;

// ─── Public API ─────────────────────────────────────────────────────────────

export async function maybeShowOnboarding() {
  if (document.getElementById(OVERLAY_ID)) return false;
  let status;
  try {
    const res = await fetch(ENDPOINT_STATUS, { credentials: 'same-origin' });
    if (!res.ok) return false;
    status = await res.json();
  } catch (_) {
    return false;
  }
  if (status?.onboarded) return false;
  _hydrateState(status?.profile || {});
  _mount();
  return true;
}

export function dismissOnboarding() {
  if (_root) {
    _root.remove();
    _root = null;
  }
}

// ─── Mount + step routing ───────────────────────────────────────────────────

function _hydrateState(profile) {
  _state.display_name = profile.display_name || '';
  _state.role         = profile.role         || '';
  _state.location     = profile.location     || '';
  _state.interests    = Array.isArray(profile.interests) ? [...profile.interests] : [];
  _state.avatar_url   = profile.avatar_url   || '';
  _state.step = 0;
}

function _mount() {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'ob-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Operator profile setup');
  overlay.innerHTML = `
    <div class="ob-bg" aria-hidden="true"></div>
    <div class="ob-card-wrap">
      <div class="ob-card" id="ob-card"></div>
      <div class="ob-dots" id="ob-dots" aria-hidden="true"></div>
    </div>
  `.trim();
  document.body.appendChild(overlay);
  _root = overlay;
  _render();
}

function _render() {
  const card = _root?.querySelector('#ob-card');
  if (!card) return;
  card.innerHTML = _stepHTML(_state.step);
  _wireStep(card, _state.step);
  _renderDots();
  // Focus the first focusable input/button after a tick so the step
  // transition doesn't fight the focus call.
  setTimeout(() => {
    const firstInput = card.querySelector('input, textarea, button');
    firstInput?.focus();
  }, 0);
}

function _renderDots() {
  const dots = _root?.querySelector('#ob-dots');
  if (!dots) return;
  dots.innerHTML = [0, 1, 2, 3, 4]
    .map(i => `<span class="ob-dot${i === _state.step ? ' ob-dot--active' : ''}"></span>`)
    .join('');
}

// ─── Step HTML ──────────────────────────────────────────────────────────────

function _stepHTML(step) {
  if (step === 0) return _welcome();
  if (step === 1) return _identity();
  if (step === 2) return _location();
  if (step === 3) return _interests();
  return _avatar();
}

function _welcome() {
  return `
    <div class="ob-wordmark" aria-hidden="true">
      <span class="ob-bracket">[</span><span class="ob-lead">C</span>ERBERUS<span class="ob-bracket">]</span>
    </div>
    <div class="ob-tag">// INITIALISING OPERATOR PROFILE</div>
    <p class="ob-lead-copy">Let's get to know you.</p>
    <div class="ob-actions">
      <button class="ob-btn ob-btn--primary" data-action="next">[ BEGIN ]</button>
    </div>
  `.trim();
}

function _identity() {
  return `
    <div class="ob-tag">// WHO ARE YOU?</div>
    <div class="ob-field">
      <label class="ob-label" for="ob-display-name">Name</label>
      <input class="ob-input" id="ob-display-name" autocomplete="off"
             placeholder="e.g. Eliias" maxlength="128"
             value="${_esc(_state.display_name)}" />
    </div>
    <div class="ob-field">
      <label class="ob-label" for="ob-role">Role</label>
      <input class="ob-input" id="ob-role" autocomplete="off"
             placeholder="e.g. Founder" maxlength="128"
             value="${_esc(_state.role)}" />
    </div>
    <div class="ob-actions">
      <button class="ob-btn ob-btn--ghost" data-action="back">[ BACK ]</button>
      <button class="ob-btn ob-btn--primary" data-action="next">[ NEXT ]</button>
    </div>
  `.trim();
}

function _location() {
  return `
    <div class="ob-tag">// WHERE ARE YOU OPERATING FROM?</div>
    <div class="ob-field">
      <label class="ob-label" for="ob-location">Location</label>
      <input class="ob-input" id="ob-location" autocomplete="off"
             placeholder="City, Country" maxlength="128"
             value="${_esc(_state.location)}" />
    </div>
    <div class="ob-actions">
      <button class="ob-btn ob-btn--ghost" data-action="back">[ BACK ]</button>
      <button class="ob-btn ob-btn--primary" data-action="next">[ NEXT ]</button>
    </div>
  `.trim();
}

function _interests() {
  const chips = _state.interests.map(i => `
    <span class="ob-chip" data-interest="${_esc(i)}">
      ${_esc(i)}
      <button class="ob-chip-x" data-action="remove-interest" data-interest="${_esc(i)}" title="Remove">×</button>
    </span>
  `).join('');
  const suggestions = SUGGESTIONS.filter(s => !_state.interests.includes(s)).map(s => `
    <button class="ob-sugg" data-action="add-suggestion" data-interest="${_esc(s)}">${_esc(s)}</button>
  `).join('');
  return `
    <div class="ob-tag">// WHAT ARE YOUR DOMAINS?</div>
    <div class="ob-chip-row" id="ob-chip-row">${chips || ''}</div>
    <div class="ob-field">
      <input class="ob-input" id="ob-interest-input" autocomplete="off"
             placeholder="Type an interest, press Enter to add" maxlength="50" />
    </div>
    <div class="ob-sugg-row" id="ob-sugg-row">${suggestions}</div>
    <div class="ob-actions">
      <button class="ob-btn ob-btn--ghost" data-action="back">[ BACK ]</button>
      <button class="ob-btn ob-btn--primary" data-action="next">[ NEXT ]</button>
    </div>
  `.trim();
}

function _avatar() {
  const preview = _state.avatar_url
    ? `<img src="${_esc(_state.avatar_url)}" alt="Avatar preview" />`
    : `<span class="ob-avatar-emoji">${_esc(_state.avatar_emoji || '◆')}</span>`;
  const emojiRow = EMOJI_FALLBACKS.map(e => `
    <button class="ob-emoji${_state.avatar_emoji === e ? ' ob-emoji--active' : ''}"
            data-action="pick-emoji" data-emoji="${_esc(e)}">${_esc(e)}</button>
  `).join('');
  return `
    <div class="ob-tag">// OPERATOR SIGNATURE</div>
    <p class="ob-lead-copy">Upload a profile image or choose an emoji avatar.</p>
    <div class="ob-avatar-preview" id="ob-avatar-preview">${preview}</div>
    <div class="ob-field">
      <label class="ob-btn ob-btn--ghost" for="ob-avatar-file">Upload image</label>
      <input class="ob-file" id="ob-avatar-file" type="file" accept="image/*" hidden />
    </div>
    <div class="ob-emoji-row">${emojiRow}</div>
    <div class="ob-actions">
      <button class="ob-btn ob-btn--ghost" data-action="back">[ BACK ]</button>
      <button class="ob-btn ob-btn--primary" data-action="complete">[ COMPLETE SETUP ]</button>
    </div>
    <div class="ob-error" id="ob-error" hidden></div>
  `.trim();
}

// ─── Step wiring ─────────────────────────────────────────────────────────────

function _wireStep(card, step) {
  card.querySelectorAll('[data-action]').forEach(el => {
    const action = el.dataset.action;
    if (action === 'next')  el.addEventListener('click', _next);
    if (action === 'back')  el.addEventListener('click', _back);
    if (action === 'complete') el.addEventListener('click', _complete);
    if (action === 'add-suggestion') el.addEventListener('click', () => _addInterest(el.dataset.interest));
    if (action === 'remove-interest') el.addEventListener('click', () => _removeInterest(el.dataset.interest));
    if (action === 'pick-emoji') el.addEventListener('click', () => _pickEmoji(el.dataset.emoji));
  });

  if (step === 3) {
    const input = card.querySelector('#ob-interest-input');
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = (input.value || '').trim();
        if (v) {
          _addInterest(v);
          input.value = '';
        }
      }
    });
  }

  if (step === 4) {
    const file = card.querySelector('#ob-avatar-file');
    file?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      _state.avatar_file = f;
      const reader = new FileReader();
      reader.onload = () => {
        _state.avatar_url = String(reader.result || '');
        _state.avatar_emoji = '';
        _render();
      };
      reader.readAsDataURL(f);
    });
  }
}

function _next() {
  if (_state.step === 1) {
    _state.display_name = _root.querySelector('#ob-display-name')?.value?.trim() || '';
    _state.role         = _root.querySelector('#ob-role')?.value?.trim()         || '';
  }
  if (_state.step === 2) {
    _state.location = _root.querySelector('#ob-location')?.value?.trim() || '';
  }
  if (_state.step < 4) {
    _state.step += 1;
    _render();
  }
}

function _back() {
  if (_state.step > 0) {
    _state.step -= 1;
    _render();
  }
}

function _addInterest(value) {
  const v = (value || '').trim().slice(0, 50);
  if (!v || _state.interests.includes(v)) return;
  if (_state.interests.length >= 10) return; // wizard cap; backend allows 20
  _state.interests.push(v);
  _render();
}

function _removeInterest(value) {
  _state.interests = _state.interests.filter(i => i !== value);
  _render();
}

function _pickEmoji(e) {
  _state.avatar_emoji = e || '';
  if (e) {
    _state.avatar_file = null;
    // Keep avatar_url empty so the agent profile records the emoji choice
    // implicitly through display_name → emoji-fallback rendering downstream.
    if (_state.avatar_url && _state.avatar_url.startsWith('data:')) {
      _state.avatar_url = '';
    }
  }
  _render();
}

// ─── Complete ────────────────────────────────────────────────────────────────

async function _complete() {
  const errEl = _root?.querySelector('#ob-error');
  if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
  const btn = _root?.querySelector('[data-action="complete"]');
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = 'SAVING…'; }
  try {
    // 1. Upload avatar (if a real file was chosen — emoji fallback stays
    //    client-side; the avatar_url on profile remains whatever the user
    //    last actually uploaded).
    let avatarUrl = '';
    if (_state.avatar_file) {
      const form = new FormData();
      form.append('file', _state.avatar_file);
      const res = await fetch(ENDPOINT_AVATAR, {
        method: 'POST', body: form, credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`avatar upload failed: HTTP ${res.status}`);
      const data = await res.json();
      avatarUrl = data?.avatar_url || '';
    }

    // 2. Patch the rest of the profile + onboarded=true.
    const patch = {
      display_name: _state.display_name,
      role:         _state.role,
      location:     _state.location,
      interests:    _state.interests,
      onboarded:    true,
    };
    if (avatarUrl) patch.avatar_url = avatarUrl;

    const res = await fetch(ENDPOINT_PATCH, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`profile save failed: HTTP ${res.status}`);

    // 3. Notify the rest of the app and tear down the overlay.
    try {
      document.dispatchEvent(new CustomEvent('cerberus:onboarded', {
        detail: { profile: await res.json() },
      }));
    } catch (_) { /* CustomEvent unsupported — ignore */ }
    dismissOnboarding();
  } catch (e) {
    if (errEl) {
      errEl.textContent = `Could not finish setup — ${e.message}`;
      errEl.hidden = false;
    }
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}
