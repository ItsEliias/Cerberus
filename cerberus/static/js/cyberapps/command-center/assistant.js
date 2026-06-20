/**
 * assistant.js — ASSISTANT sub-tab.
 *
 * Slim chat box that posts to /api/chat_stream (Cerberus native SSE endpoint).
 * System prompt scoped to "Cerberus operations assistant".
 * Maintains message history in module-level state (cleared on destroy).
 *
 * Phase C Fix: restores SPEAK (TTS) + VOICE (STT) buttons + audio waveform.
 * - TTS: window.aiTTSManager (tts-ai.js) — .play(text), .stop()
 * - STT: voiceRecorder.js exports — startRecording(), stopRecording(), getIsRecording()
 */

import { startRecording, stopRecording, getIsRecording, init as initVoice } from '../../voiceRecorder.js';
import { buildNotesPanel, loadNotes } from './cc-notes.js';
import { buildResearchPanel, loadResearch } from './cc-research.js';

const SYSTEM_PROMPT = 'You are the Cerberus operations assistant. Answer concisely about the Cerberus system state, tasks, agents, and operations. Be direct and informative.';
const API = '/api/chat_stream';
const LS_TTS_KEY = 'cc_assistant_tts_on';

let _messages = [];  // {role, content}[]
let _streaming = false;
let _abortCtrl = null;
let _ttsOn = false;
let _waveAnimId = null;

// ---- TTS toggle state ----

function _loadTtsState() {
  try { _ttsOn = localStorage.getItem(LS_TTS_KEY) === '1'; } catch (_) { _ttsOn = false; }
}
function _saveTtsState() {
  try { localStorage.setItem(LS_TTS_KEY, _ttsOn ? '1' : '0'); } catch (_) {}
}

// ---- Waveform SVG helpers ----

const WAVE_IDLE   = 'M0,12 Q25,12 50,12 Q75,12 100,12 Q125,12 150,12 Q175,12 200,12';
const WAVE_ACTIVE = 'M0,12 Q25,2 50,22 Q75,2 100,22 Q125,2 150,22 Q175,2 200,12';

function _buildWaveformSvg() {
  return `<svg class="cc-waveform-svg" viewBox="0 0 200 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" preserveAspectRatio="none">
    <path id="cc-wave-path" class="cc-wave-path" d="${WAVE_IDLE}" fill="none"
      stroke="var(--cc-crimson)" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

function _animateWave(root, active) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const path = root.querySelector('#cc-wave-path');
  if (!path) return;
  cancelAnimationFrame(_waveAnimId);
  if (!active) {
    path.setAttribute('d', WAVE_IDLE);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const t = (now - start) / 600;
    const amp = 8 + Math.sin(t * 3.1) * 3;
    const d = `M0,12 Q25,${12 - amp} 50,${12 + amp} Q75,${12 - amp} 100,${12 + amp} Q125,${12 - amp} 150,${12 + amp} Q175,${12 - amp} 200,12`;
    path.setAttribute('d', d);
    _waveAnimId = requestAnimationFrame(tick);
  }
  _waveAnimId = requestAnimationFrame(tick);
}

// ---- Build HTML ----

export function buildAssistantTab() {
  return `<div class="cc-assistant-tab">
    <section class="cc-op-profile" id="cc-op-profile" aria-label="Operator profile">
      <header class="cc-op-profile-head">
        <span class="cc-op-profile-title">// OPERATOR PROFILE</span>
        <button class="cc-op-profile-edit" id="cc-op-profile-edit" type="button">EDIT</button>
      </header>
      <div class="cc-op-profile-body" id="cc-op-profile-body">
        <div class="cc-empty">Loading profile…</div>
      </div>
    </section>
    ${buildNotesPanel()}
    ${buildResearchPanel()}
    <div class="cc-chat-history" id="cc-chat-history">
      <div class="cc-empty" style="margin-top:32px;">
        Cerberus Operations Assistant ready. Ask about tasks, agents, or system state.
      </div>
    </div>
    <div id="cc-chat-typing" class="cc-chat-typing" style="display:none;padding:0 16px 4px;">Thinking...</div>
    <div class="cc-voice-bar" id="cc-voice-bar">
      <div class="cc-waveform-wrap" id="cc-waveform-wrap" aria-hidden="true">${_buildWaveformSvg()}</div>
      <div class="cc-voice-btns">
        <button class="cc-voice-btn cc-speak-btn" id="cc-speak-btn" title="Toggle TTS playback" type="button">
          <span class="cc-voice-btn-icon">&#128266;</span> SPEAK
        </button>
        <button class="cc-voice-btn cc-mic-btn" id="cc-mic-btn" title="Hold to record voice input" type="button">
          <span class="cc-voice-btn-icon">&#127908;</span> VOICE
        </button>
      </div>
      <div class="cc-voice-error" id="cc-voice-error" style="display:none;" role="alert"></div>
    </div>
    <div class="cc-chat-input-row">
      <textarea class="cc-chat-input" id="cc-chat-input"
        placeholder="Send directive to Cerberus..." rows="1"></textarea>
      <button class="cc-chat-send-btn" id="cc-chat-send">SEND</button>
    </div>
  </div>`;
}

// ---- Init ----

export function initAssistant(root) {
  _loadTtsState();
  initVoice();

  const input     = root.querySelector('#cc-chat-input');
  const btn       = root.querySelector('#cc-chat-send');
  const speakBtn  = root.querySelector('#cc-speak-btn');
  const micBtn    = root.querySelector('#cc-mic-btn');
  const errDiv    = root.querySelector('#cc-voice-error');
  if (!input || !btn) return;

  // Apply persisted TTS state
  _applySpeakState(speakBtn);

  // OPERATOR PROFILE — load + wire edit toggle.
  _loadOpProfile(root);
  // NOTES — wire search / pin / preview / editor / word count.
  loadNotes(root);
  // RESEARCH — recent + saved searches (re-run, save, delete).
  loadResearch(root);
  // Re-render when the onboarding wizard reports a successful save so the
  // panel reflects the latest state immediately.
  const _profileBus = () => _loadOpProfile(root);
  document.addEventListener('cerberus:onboarded', _profileBus);
  root.addEventListener('DOMNodeRemoved', () => {
    document.removeEventListener('cerberus:onboarded', _profileBus);
  }, { once: true });

  // SEND
  const send = () => {
    const text = (input.value || '').trim();
    if (!text || _streaming) return;
    input.value = '';
    _sendMessage(root, text);
  };
  btn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // SPEAK toggle
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      _ttsOn = !_ttsOn;
      _saveTtsState();
      _applySpeakState(speakBtn);
    });
  }

  // VOICE push-to-talk
  if (micBtn) {
    const showErr = (msg) => {
      if (!errDiv) return;
      errDiv.textContent = msg;
      errDiv.style.display = 'block';
      setTimeout(() => { errDiv.style.display = 'none'; }, 5000);
    };
    const showToast = (msg) => console.info('[CC Voice]', msg);
    const onFileCreated = () => {};

    const startVoice = () => {
      if (getIsRecording()) return;
      micBtn.classList.add('recording');
      _animateWave(root, true);
      startRecording(onFileCreated, showToast, showErr);
    };
    const stopVoice = () => {
      if (!getIsRecording()) return;
      micBtn.classList.remove('recording');
      _animateWave(root, false);
      stopRecording();
      // voiceRecorder inserts transcript into #message; transfer then auto-send
      setTimeout(() => {
        _transferTranscript(input);
        setTimeout(() => { if (input.value.trim()) send(); }, 80);
      }, 400);
    };

    micBtn.addEventListener('mousedown', startVoice);
    micBtn.addEventListener('mouseup', stopVoice);
    micBtn.addEventListener('mouseleave', stopVoice);
    micBtn.addEventListener('touchstart', e => { e.preventDefault(); startVoice(); });
    micBtn.addEventListener('touchend', e => { e.preventDefault(); stopVoice(); });
  }
}

function _applySpeakState(btn) {
  if (!btn) return;
  if (_ttsOn) {
    btn.classList.add('on');
    btn.title = 'TTS ON — click to mute';
  } else {
    btn.classList.remove('on');
    btn.title = 'TTS OFF — click to enable';
  }
}

function _transferTranscript(input) {
  const main = document.getElementById('message');
  if (main && main.value && !input.value) {
    input.value = main.value;
    main.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }
}

// ---- Destroy ----

export function destroyAssistant() {
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  cancelAnimationFrame(_waveAnimId);
  _waveAnimId = null;
  _messages = [];
  _streaming = false;
}

// ---- Send / Stream ----

async function _sendMessage(root, text) {
  _messages.push({ role: 'user', content: text });
  _renderMessages(root);
  _setStreaming(root, true);

  const history = root.querySelector('#cc-chat-history');
  const bubble = document.createElement('div');
  bubble.className = 'cc-chat-msg assistant';
  bubble.innerHTML = '<div class="cc-chat-role">Assistant</div><div class="cc-chat-bubble"></div>';
  if (history) history.appendChild(bubble);
  const bText = bubble.querySelector('.cc-chat-bubble');

  let assembled = '';
  _abortCtrl = new AbortController();

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: _messages,
        system: SYSTEM_PROMPT,
        stream: true,
      }),
      signal: _abortCtrl.signal,
    });

    if (!res.ok) {
      assembled = `Error: ${await res.text()}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break;
            try {
              const j = JSON.parse(raw);
              const token = j.choices?.[0]?.delta?.content || j.text || j.token || '';
              assembled += token;
              if (bText) bText.textContent = assembled;
              if (history) history.scrollTop = history.scrollHeight;
            } catch (_) {}
          }
        }
      }
    }
  } catch (e) {
    assembled = e.name === 'AbortError' ? (assembled || '(cancelled)') : `Error: ${String(e)}`;
  }

  if (bText) bText.textContent = assembled || '(no response)';
  _messages.push({ role: 'assistant', content: assembled || '' });
  _setStreaming(root, false);
  if (history) history.scrollTop = history.scrollHeight;

  // TTS playback
  if (_ttsOn && assembled && assembled !== '(cancelled)') {
    const mgr = window.aiTTSManager;
    if (mgr && mgr.available) {
      mgr.play(assembled).catch(err => {
        console.warn('[CC TTS]', err.message);
      });
    }
  }
}

function _renderMessages(root) {
  const h = root.querySelector('#cc-chat-history');
  if (!h) return;
  h.innerHTML = _messages.map(m => `
    <div class="cc-chat-msg ${m.role}">
      <div class="cc-chat-role">${m.role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="cc-chat-bubble">${_esc(m.content)}</div>
    </div>`).join('');
  h.scrollTop = h.scrollHeight;
}

function _setStreaming(root, val) {
  _streaming = val;
  const btn    = root.querySelector('#cc-chat-send');
  const typing = root.querySelector('#cc-chat-typing');
  if (btn)    btn.disabled = val;
  if (typing) typing.style.display = val ? 'block' : 'none';
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

// ─── Operator profile panel ────────────────────────────────────────────────
//
// Renders /api/profile inside the ASSISTANT tab. EDIT toggles an inline form
// (display_name, role, bio with 280-char counter, location, interest chips,
// avatar upload). Save is optimistic: the read-only view repaints immediately
// from local state and the PATCH error reverts on failure.

const _opProfileState = {
  loaded: false,
  editing: false,
  data: {
    display_name: '', role: '', bio: '', location: '',
    interests: [], avatar_url: '', onboarded: false,
  },
};

async function _loadOpProfile(root) {
  try {
    const res = await fetch('/api/profile', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _opProfileState.data = { ..._opProfileState.data, ...(await res.json()) };
    _opProfileState.loaded = true;
  } catch (_) {
    _opProfileState.loaded = true; // render the placeholder once
  }
  _renderOpProfile(root);
}

function _renderOpProfile(root) {
  const body = root.querySelector('#cc-op-profile-body');
  const editBtn = root.querySelector('#cc-op-profile-edit');
  if (!body) return;
  if (_opProfileState.editing) {
    editBtn?.setAttribute('hidden', '');
    body.innerHTML = _opProfileEditHTML();
    _wireOpProfileEdit(root);
  } else {
    editBtn?.removeAttribute('hidden');
    body.innerHTML = _opProfileViewHTML();
    editBtn?.addEventListener('click', () => {
      _opProfileState.editing = true;
      _renderOpProfile(root);
    }, { once: true });
  }
}

function _opProfileViewHTML() {
  const p = _opProfileState.data;
  if (!p.display_name && !p.role && !p.bio) {
    return `<div class="cc-empty">No profile yet. Click EDIT to add one.</div>`;
  }
  const avatar = p.avatar_url
    ? `<img class="cc-op-avatar" src="${_esc(p.avatar_url)}" alt="" />`
    : `<span class="cc-op-avatar cc-op-avatar--placeholder">${_esc((p.display_name || '?')[0])}</span>`;
  const chips = (p.interests || []).map(i =>
    `<span class="cc-op-chip">${_esc(i)}</span>`
  ).join('');
  return `
    <div class="cc-op-row">
      ${avatar}
      <div class="cc-op-meta">
        <div class="cc-op-name">${_esc(p.display_name || '—')}</div>
        <div class="cc-op-role">${_esc(p.role || '')}</div>
        <div class="cc-op-loc">${_esc(p.location || '')}</div>
      </div>
    </div>
    ${p.bio ? `<div class="cc-op-bio">${_esc(p.bio)}</div>` : ''}
    ${chips ? `<div class="cc-op-chips">${chips}</div>` : ''}
  `.trim();
}

function _opProfileEditHTML() {
  const p = _opProfileState.data;
  const chips = (p.interests || []).map(i => `
    <span class="cc-op-chip-editable" data-interest="${_esc(i)}">
      ${_esc(i)}
      <button class="cc-op-chip-x" data-action="rm" data-interest="${_esc(i)}" type="button">×</button>
    </span>
  `).join('');
  return `
    <div class="cc-op-edit">
      <div class="cc-op-edit-row">
        <input class="cc-op-input" id="cc-op-name" placeholder="Display name"
               value="${_esc(p.display_name || '')}" maxlength="128" />
        <input class="cc-op-input" id="cc-op-role" placeholder="Role"
               value="${_esc(p.role || '')}" maxlength="128" />
      </div>
      <div class="cc-op-edit-row">
        <input class="cc-op-input" id="cc-op-loc" placeholder="Location"
               value="${_esc(p.location || '')}" maxlength="128" />
      </div>
      <textarea class="cc-op-textarea" id="cc-op-bio" placeholder="Short bio"
                maxlength="280" rows="2">${_esc(p.bio || '')}</textarea>
      <div class="cc-op-bio-count" id="cc-op-bio-count">${(p.bio || '').length}/280</div>
      <div class="cc-op-chips-edit" id="cc-op-chips-edit">${chips}</div>
      <input class="cc-op-input" id="cc-op-interest" placeholder="Add interest (Enter)" maxlength="50" />
      <div class="cc-op-edit-row">
        <label class="cc-op-btn cc-op-btn--ghost" for="cc-op-file">Upload avatar</label>
        <input id="cc-op-file" type="file" accept="image/*" hidden />
      </div>
      <div class="cc-op-edit-actions">
        <button class="cc-op-btn cc-op-btn--ghost" id="cc-op-cancel" type="button">CANCEL</button>
        <button class="cc-op-btn cc-op-btn--primary" id="cc-op-save" type="button">SAVE</button>
      </div>
      <div class="cc-op-err" id="cc-op-err" hidden></div>
    </div>
  `.trim();
}

function _wireOpProfileEdit(root) {
  const bioEl  = root.querySelector('#cc-op-bio');
  const cnt    = root.querySelector('#cc-op-bio-count');
  bioEl?.addEventListener('input', () => {
    cnt.textContent = `${bioEl.value.length}/280`;
  });

  const interestEl = root.querySelector('#cc-op-interest');
  const chipsEl    = root.querySelector('#cc-op-chips-edit');
  interestEl?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = (interestEl.value || '').trim();
    if (!v) return;
    const current = _readChips(chipsEl);
    if (current.includes(v) || current.length >= 20) return;
    current.push(v);
    chipsEl.innerHTML = current.map(i => `
      <span class="cc-op-chip-editable" data-interest="${_esc(i)}">
        ${_esc(i)}
        <button class="cc-op-chip-x" data-action="rm" data-interest="${_esc(i)}" type="button">×</button>
      </span>
    `).join('');
    interestEl.value = '';
  });
  chipsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="rm"]');
    if (!btn) return;
    const v = btn.dataset.interest;
    const next = _readChips(chipsEl).filter(i => i !== v);
    chipsEl.innerHTML = next.map(i => `
      <span class="cc-op-chip-editable" data-interest="${_esc(i)}">
        ${_esc(i)}
        <button class="cc-op-chip-x" data-action="rm" data-interest="${_esc(i)}" type="button">×</button>
      </span>
    `).join('');
  });

  let pendingAvatar = null;
  root.querySelector('#cc-op-file')?.addEventListener('change', (e) => {
    pendingAvatar = e.target.files?.[0] || null;
  });

  root.querySelector('#cc-op-cancel')?.addEventListener('click', () => {
    _opProfileState.editing = false;
    _renderOpProfile(root);
  });

  root.querySelector('#cc-op-save')?.addEventListener('click', async () => {
    const errEl = root.querySelector('#cc-op-err');
    const saveBtn = root.querySelector('#cc-op-save');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    const previous = { ..._opProfileState.data };
    // Optimistic update: paint the new values immediately.
    _opProfileState.data = {
      ..._opProfileState.data,
      display_name: root.querySelector('#cc-op-name').value.trim(),
      role:         root.querySelector('#cc-op-role').value.trim(),
      location:     root.querySelector('#cc-op-loc').value.trim(),
      bio:          root.querySelector('#cc-op-bio').value.trim(),
      interests:    _readChips(root.querySelector('#cc-op-chips-edit')),
    };
    _opProfileState.editing = false;
    _renderOpProfile(root);

    try {
      if (pendingAvatar) {
        const form = new FormData();
        form.append('file', pendingAvatar);
        const r = await fetch('/api/profile/avatar', {
          method: 'POST', body: form, credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(`avatar HTTP ${r.status}`);
        const d = await r.json();
        _opProfileState.data.avatar_url = d?.avatar_url || '';
      }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          display_name: _opProfileState.data.display_name,
          role:         _opProfileState.data.role,
          location:     _opProfileState.data.location,
          bio:          _opProfileState.data.bio,
          interests:    _opProfileState.data.interests,
        }),
      });
      if (!res.ok) throw new Error(`profile HTTP ${res.status}`);
      _opProfileState.data = { ..._opProfileState.data, ...(await res.json()) };
      _renderOpProfile(root);
    } catch (e) {
      // Revert on error.
      _opProfileState.data = previous;
      _opProfileState.editing = true;
      _renderOpProfile(root);
      const err = root.querySelector('#cc-op-err');
      if (err) {
        err.textContent = `Save failed — ${e.message}`;
        err.hidden = false;
      }
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function _readChips(chipsEl) {
  if (!chipsEl) return [];
  return [...chipsEl.querySelectorAll('[data-interest]')]
    .map(el => el.dataset.interest)
    .filter((v, i, a) => v && a.indexOf(v) === i);
}
