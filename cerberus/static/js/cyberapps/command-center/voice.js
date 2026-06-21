/**
 * voice.js — 1:1 voice call panel (Phase 4a).
 *
 * State machine: idle → listening → transcribing → thinking → speaking → your-turn
 * Push-to-talk: hold mic button while speaking, release to submit.
 * STT: provider-aware — browser → SpeechRecognition API; local/endpoint → POST /api/stt/transcribe.
 * LLM: POST /api/agents/{id}/thread/send (SSE stream, same path as chat).
 * TTS: GET /api/tts/stats → provider. browser → speechSynthesis; else base64 audio.
 * Text fallback always accessible via "Type instead" link.
 *
 * Exports openVoiceCall(container, agentId, agentName, agentAvatar, accentColor, ttsVoice).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATES = ['idle', 'listening', 'transcribing', 'thinking', 'speaking', 'your-turn'];

const STATE_LABELS = {
  idle:          'Ready',
  listening:     'Listening…',
  transcribing:  'Transcribing…',
  thinking:      'Thinking…',
  speaking:      'Speaking…',
  'your-turn':   'Your turn',
};

// ── Wake word (Feature 6) ────────────────────────────────────────────
// The phrase fires while the voice panel is open. On match the mic button
// is auto-pressed so the operator can speak the actual prompt immediately.

const WAKE_PHRASE             = 'hey cerberus';
const WAKE_PREF_KEY           = 'cerberus.wake_word_enabled';
let   _wakeActive             = false;
let   _wakeRecognition        = null;
let   _wakeMicTriggerCallback = null;

function _wakeSupported() {
  return typeof window !== 'undefined'
      && (typeof window.SpeechRecognition !== 'undefined'
       || typeof window.webkitSpeechRecognition !== 'undefined');
}

function _readWakePref() {
  try { return localStorage.getItem(WAKE_PREF_KEY) === '1'; }
  catch (_) { return false; }
}

function _writeWakePref(on) {
  try { localStorage.setItem(WAKE_PREF_KEY, on ? '1' : '0'); }
  catch (_) { /* private browsing — silent */ }
}

function startWakeWordListener(onTrigger) {
  if (!_wakeSupported()) return false;
  _wakeMicTriggerCallback = onTrigger || _wakeMicTriggerCallback;
  if (_wakeRecognition) return true; // already running
  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous     = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let transcript = '';
      try {
        transcript = Array.from(e.results || [])
          .map(r => (r[0] && r[0].transcript) || '')
          .join(' ')
          .toLowerCase();
      } catch (_) { transcript = ''; }
      if (transcript && transcript.includes(WAKE_PHRASE)) {
        // Stop the listener; the auto-restart in `onend` won't kick back
        // in because the trigger callback may close the panel (in which
        // case _wakeActive will be flipped off).
        try { rec.stop(); } catch (_) {}
        if (typeof _wakeMicTriggerCallback === 'function') {
          try { _wakeMicTriggerCallback(); } catch (_) {}
        }
      }
    };
    rec.onerror = () => { /* swallow — auto-restart on `onend` */ };
    rec.onend   = () => {
      _wakeRecognition = null;
      if (_wakeActive) {
        try { startWakeWordListener(); } catch (_) {}
      }
    };
    rec.start();
    _wakeRecognition = rec;
    _wakeActive = true;
    return true;
  } catch (_) {
    _wakeRecognition = null;
    return false;
  }
}

function stopWakeWordListener() {
  _wakeActive = false;
  if (_wakeRecognition) {
    try { _wakeRecognition.stop(); } catch (_) {}
    _wakeRecognition = null;
  }
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _buildVoicePanel(agentName, agentAvatar, accentColor) {
  const glyph = agentAvatar || (agentName || '?')[0];
  return `
<div class="cc-voice-panel" id="cc-voice-panel" style="--cat-accent:${_esc(accentColor)}">
  <div class="cc-voice-header">
    <button class="cc-voice-back-btn" title="Back to chat">← Back</button>
    <span class="cc-voice-sigil" style="background:${_esc(accentColor)}">${_esc(glyph)}</span>
    <span class="cc-voice-name">${_esc(agentName)}</span>
    <span class="cc-voice-state-badge" id="cc-voice-state-badge">Ready</span>
    <button class="cc-voice-wake-btn" id="cc-voice-wake-toggle" type="button"
            title="Hands-free wake phrase: '${WAKE_PHRASE}'" hidden>
      <span class="cc-voice-wake-dot" aria-hidden="true"></span>
      <span class="cc-voice-wake-label">// WAKE WORD: OFF</span>
    </button>
  </div>
  <div class="cc-voice-transcript" id="cc-voice-transcript">
    <div class="cc-empty">Hold the mic button to speak.</div>
  </div>
  <div id="cc-voice-recent-mount"></div>
  <div class="cc-voice-controls">
    <button class="cc-voice-mic-btn" id="cc-voice-mic-btn" title="Hold to speak">🎤</button>
    <div class="cc-voice-fallback" id="cc-voice-fallback" style="display:none">
      <textarea class="cc-voice-text-input" id="cc-voice-text-input"
        placeholder="Type your message… (Enter to send)" rows="2"></textarea>
      <button class="cc-voice-text-send" id="cc-voice-text-send">Send</button>
    </div>
    <button class="cc-voice-toggle-text" id="cc-voice-toggle-text">Type instead</button>
  </div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

function _appendTranscript(transcriptEl, role, text) {
  const div = document.createElement('div');
  div.className = `cc-voice-turn cc-voice-turn--${role}`;
  div.innerHTML = `<span class="cc-voice-turn-label">${role === 'user' ? 'YOU' : 'AGENT'}</span>
<span class="cc-voice-turn-text">${_esc(text)}</span>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div;
}

function _appendStreamingTurn(transcriptEl) {
  const div = document.createElement('div');
  div.className = 'cc-voice-turn cc-voice-turn--agent';
  div.innerHTML = `<span class="cc-voice-turn-label">AGENT</span>
<span class="cc-voice-turn-text cc-voice-streaming" id="cc-voice-streaming-text"></span>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div.querySelector('#cc-voice-streaming-text');
}

// ---------------------------------------------------------------------------
// TTS provider detection + playback
// ---------------------------------------------------------------------------

// Kokoro voice ID prefixes — these must always route to the server (Bug 2)
const _KOKORO_PREFIXES = ['af_', 'am_', 'bf_', 'bm_'];

let _ttsProvider = null;

async function _getTtsProvider() {
  if (_ttsProvider) return _ttsProvider;
  try {
    const res = await fetch('/api/tts/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _ttsProvider = data.provider || 'disabled';
  } catch (_) {
    _ttsProvider = 'disabled';
  }
  return _ttsProvider;
}

// _speak returns a function that cancels playback when called (Bug 3).
// onStart/onEnd callbacks fire at the usual points.
async function _speak(text, ttsVoice, onStart, onEnd, cancelRef) {
  const isKokoroVoice = !!ttsVoice && _KOKORO_PREFIXES.some(p => ttsVoice.startsWith(p));
  // Kokoro voice IDs always route to server regardless of provider setting
  const provider = isKokoroVoice ? 'local' : await _getTtsProvider();

  if (!isKokoroVoice && provider === 'browser') {
    const utt = new SpeechSynthesisUtterance(text);
    if (ttsVoice) {
      const voices = speechSynthesis.getVoices();
      const match = voices.find(v => v.name === ttsVoice || v.voiceURI === ttsVoice);
      if (match) utt.voice = match;
    }
    utt.onstart  = onStart;
    utt.onend    = onEnd;
    utt.onerror  = onEnd;
    speechSynthesis.speak(utt);
    if (cancelRef) cancelRef.cancel = () => { speechSynthesis.cancel(); onEnd?.(); };
    return;
  }

  if (provider === 'disabled') {
    onStart?.();
    onEnd?.();
    return;
  }

  // Server-side TTS: request base64
  try {
    onStart?.();
    const body = { text, format: 'base64' };
    if (ttsVoice) body.voice = ttsVoice;
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.json();
    const b64 = data.audio_base64 || data.audio || '';
    if (!b64) { onEnd?.(); return; }
    const audio = new Audio(`data:audio/wav;base64,${b64}`);
    // Bug 3: expose cancel handle so the caller can stop mid-playback
    if (cancelRef) cancelRef.cancel = () => { audio.pause(); audio.currentTime = 0; onEnd?.(); };
    audio.onended = () => { if (cancelRef) cancelRef.cancel = null; onEnd?.(); };
    audio.onerror = () => { if (cancelRef) cancelRef.cancel = null; onEnd?.(); };
    await audio.play();
  } catch (_) {
    onEnd?.();
  }
}

// ---------------------------------------------------------------------------
// STT provider detection + transcription
// ---------------------------------------------------------------------------

let _sttProvider = null;

async function _getSttProvider() {
  if (_sttProvider) return _sttProvider;
  try {
    const res = await fetch('/api/stt/stats');
    if (!res.ok) throw new Error();
    const data = await res.json();
    _sttProvider = data.provider || 'disabled';
  } catch (_) {
    _sttProvider = 'disabled';
  }
  return _sttProvider;
}

async function _transcribeBlob(blob) {
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  const res = await fetch('/api/stt/transcribe', { method: 'POST', body: form });
  if (res.status === 503) throw Object.assign(new Error('STT unavailable'), { code: 503 });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const data = await res.json();
  return (data.text || '').trim();
}

// ---------------------------------------------------------------------------
// LLM streaming via thread/send
// ---------------------------------------------------------------------------

async function _streamAgentReply(agentId, message, contentEl, transcriptEl) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/thread/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:'))  { eventType = 'message'; continue; }
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') return fullText;
      if (eventType === 'error') { eventType = 'message'; continue; }
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'usage') continue;
        const delta = obj.delta || obj.text || obj.content || '';
        if (delta) {
          fullText += delta;
          contentEl.textContent = fullText;
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
      } catch (_) {}
      eventType = 'message';
    }
  }
  return fullText;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transcript persistence
// ---------------------------------------------------------------------------
//
// On back, the panel posts the user/agent transcript to /api/notes with
// `source = "voice"` so the new GET /api/voice/sessions route can pick it
// back up. Fire-and-forget: failure never blocks navigation.

function _collectTranscriptLines(transcriptEl) {
  if (!transcriptEl) return [];
  const turns = [...transcriptEl.querySelectorAll('.cc-voice-turn')];
  const lines = [];
  for (const t of turns) {
    // Role comes from the cc-voice-turn--<role> modifier class.
    let role = 'unknown';
    for (const cls of t.classList) {
      if (cls.startsWith('cc-voice-turn--')) {
        role = cls.slice('cc-voice-turn--'.length);
        break;
      }
    }
    const text = (t.querySelector('.cc-voice-turn-text')?.textContent || '').trim();
    if (!text) continue;
    const line = `[${role.toUpperCase()}] ${text}`;
    if (line.length > 10) lines.push(line);
  }
  return lines;
}

function _saveTranscriptToNotes(container, transcriptEl, agentName) {
  const lines = _collectTranscriptLines(transcriptEl);
  if (lines.length === 0) return; // nothing to save → silent skip
  const title = `Voice session — ${agentName} — ${new Date().toLocaleString()}`;
  const body = {
    title,
    content: lines.join('\n'),
    note_type: 'note',
    source: 'voice',
    label: agentName || '',
  };
  // Fire-and-forget POST. Errors are swallowed so navigation is never blocked.
  fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  }).catch(() => {});
  _flashSavedToast(container);
}

function _flashSavedToast(container) {
  const panel = container.querySelector('#cc-voice-panel');
  if (!panel) return;
  // Idempotent — don't stack multiple toasts if back is hammered.
  if (panel.querySelector('.cc-voice-saved-toast')) return;
  const toast = document.createElement('div');
  toast.className = 'cc-voice-saved-toast';
  toast.textContent = '// TRANSCRIPT SAVED';
  panel.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

// ---------------------------------------------------------------------------
// Recent voice sessions
// ---------------------------------------------------------------------------

async function _renderRecentSessions(container) {
  const mount = container.querySelector('#cc-voice-recent-mount');
  if (!mount) return;
  let sessions = [];
  try {
    const res = await fetch('/api/voice/sessions?limit=5', {
      credentials: 'same-origin',
    });
    if (!res.ok) return; // silent — section just stays empty
    const data = await res.json();
    sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  } catch (_) {
    return;
  }
  if (!sessions.length) return; // nothing recent → render nothing
  const rows = sessions.map(s => {
    const title = _esc(_truncate(s.title || 'Voice session', 48));
    const when = s.created_at ? _formatRelative(s.created_at) : '';
    return `<li class="cc-voice-recent-row" data-note-id="${_esc(s.id)}">
  <span class="cc-voice-recent-title">${title}</span>
  <span class="cc-voice-recent-when">${_esc(when)}</span>
</li>`;
  }).join('');
  mount.innerHTML = `<div class="cc-voice-recent">
  <div class="cc-voice-recent-label">// RECENT SESSIONS</div>
  <ul class="cc-voice-recent-list">${rows}</ul>
</div>`;
  mount.querySelectorAll('.cc-voice-recent-row').forEach(row => {
    row.addEventListener('click', () => _openNote(row.dataset.noteId));
  });
}

function _truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function _formatRelative(iso) {
  try {
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return ''; }
}

function _openNote(noteId) {
  if (!noteId) return;
  // Notify any listening notes UI to surface this note. If nobody listens the
  // event is a harmless no-op — we deliberately avoid hard-coding a route.
  try {
    document.dispatchEvent(new CustomEvent('cerberus:open-note', {
      detail: { id: noteId },
    }));
  } catch (_) { /* CustomEvent unsupported (very old browser) — ignore */ }
}

function _setState(panel, state) {
  if (!STATES.includes(state)) return;
  const badge = panel.querySelector('#cc-voice-state-badge');
  if (badge) badge.textContent = STATE_LABELS[state] || state;
  panel.dataset.voiceState = state;
  const micBtn = panel.querySelector('#cc-voice-mic-btn');
  if (micBtn) {
    micBtn.classList.toggle('cc-voice-mic-btn--active', state === 'listening');
    micBtn.disabled = ['transcribing', 'thinking', 'speaking'].includes(state);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openVoiceCall(container, agentId, agentName, agentAvatar, accentColor, ttsVoice = '') {
  container.innerHTML = _buildVoicePanel(agentName, agentAvatar, accentColor || 'rgba(197,201,208,0.5)');

  const panel       = container.querySelector('#cc-voice-panel');
  const transcriptEl = container.querySelector('#cc-voice-transcript');
  const micBtn      = container.querySelector('#cc-voice-mic-btn');
  const backBtn     = container.querySelector('.cc-voice-back-btn');
  const fallbackDiv = container.querySelector('#cc-voice-fallback');
  const textInput   = container.querySelector('#cc-voice-text-input');
  const textSend    = container.querySelector('#cc-voice-text-send');
  const toggleText  = container.querySelector('#cc-voice-toggle-text');

  _setState(panel, 'idle');
  _ttsProvider = null; // reset per session
  _sttProvider = null;
  const _speakCancel = { cancel: null }; // Bug 3: mutable cancel handle for active audio

  // Surface the user's most recent voice transcripts so they can re-open one
  // without leaving the call panel. Fire-and-forget — silent on failure.
  _renderRecentSessions(container);

  // ---- Wake-word toggle (hidden when SpeechRecognition isn't supported) ----
  const wakeBtn   = container.querySelector('#cc-voice-wake-toggle');
  const wakeLabel = container.querySelector('.cc-voice-wake-label');
  if (wakeBtn) {
    if (!_wakeSupported()) {
      wakeBtn.hidden = true;
    } else {
      wakeBtn.hidden = false;
      const _applyWakeUi = (on) => {
        wakeBtn.classList.toggle('cc-voice-wake-btn--on', on);
        if (wakeLabel) wakeLabel.textContent = on ? '// WAKE WORD: ON' : '// WAKE WORD: OFF';
      };
      const _onWakeTriggered = () => {
        try { micBtn?.click(); } catch (_) {}
      };
      if (_readWakePref()) {
        startWakeWordListener(_onWakeTriggered);
        _applyWakeUi(true);
      } else {
        _applyWakeUi(false);
      }
      wakeBtn.addEventListener('click', () => {
        if (_wakeActive) {
          stopWakeWordListener();
          _writeWakePref(false);
          _applyWakeUi(false);
        } else {
          const ok = startWakeWordListener(_onWakeTriggered);
          if (ok) {
            _writeWakePref(true);
            _applyWakeUi(true);
          }
        }
      });
    }
  }

  // ---- Text fallback toggle ----
  let textMode = false;
  toggleText?.addEventListener('click', () => {
    textMode = !textMode;
    fallbackDiv.style.display = textMode ? 'flex' : 'none';
    micBtn.style.display      = textMode ? 'none' : 'block';
    toggleText.textContent    = textMode ? 'Use mic' : 'Type instead';
  });

  // ---- Back: restore chat panel ----
  backBtn?.addEventListener('click', async () => {
    speechSynthesis?.cancel();
    _speakCancel.cancel?.(); // stop any server-side audio (Bug 3)
    // Fire-and-forget transcript save → /api/notes. Never blocks navigation:
    // failure is swallowed; the success flash is purely cosmetic.
    _saveTranscriptToNotes(container, transcriptEl, agentName);
    const { openAgentChat } = await import('./chat.js');
    openAgentChat(container, agentId, agentName, agentAvatar, accentColor, ttsVoice);
  });

  // ---- Text fallback submit ----
  async function _handleTextSubmit() {
    const text = textInput?.value?.trim();
    if (!text || panel.dataset.voiceState === 'thinking' || panel.dataset.voiceState === 'speaking') return;
    textInput.value = '';
    await _processTurn(text);
  }
  textSend?.addEventListener('click', _handleTextSubmit);
  textInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleTextSubmit(); }
  });

  // ---- Push-to-talk ----
  let mediaRecorder  = null;
  let audioChunks    = [];
  let _isBrowserStt  = false;
  let _sttRecognizer = null;
  let _sttPending    = null;

  function _sttRevealFallback(msg) {
    transcriptEl.insertAdjacentHTML('beforeend',
      `<div class="cc-voice-stt-notice">${_esc(msg)}</div>`);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    textMode = true;
    fallbackDiv.style.display = 'flex';
    micBtn.style.display = 'none';
    toggleText.textContent = 'Use mic';
  }

  async function _startRecording() {
    const state = panel.dataset.voiceState;
    if (['listening', 'transcribing', 'thinking', 'speaking'].includes(state)) return;
    const provider = await _getSttProvider();

    if (provider === 'browser') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        _sttRevealFallback('Voice input requires Chrome or Safari — type instead.');
        return;
      }
      _isBrowserStt = true;
      _sttRecognizer = new SR();
      _sttRecognizer.lang = navigator.language || 'en-US';
      _sttRecognizer.interimResults = false;
      _sttRecognizer.maxAlternatives = 1;
      _sttPending = new Promise(resolve => {
        _sttRecognizer.onresult = e => resolve(e.results[0][0].transcript.trim());
        _sttRecognizer.onerror  = () => resolve('');
        _sttRecognizer.onend    = () => resolve('');
      });
      _sttRecognizer.start();
      _setState(panel, 'listening');
      return;
    }

    _isBrowserStt = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.start();
      _setState(panel, 'listening');
    } catch (_) {
      textMode = true;
      fallbackDiv.style.display = 'flex';
      micBtn.style.display = 'none';
      toggleText.textContent = 'Use mic';
    }
  }

  async function _stopRecording() {
    if (_isBrowserStt) {
      if (!_sttRecognizer) return;
      _setState(panel, 'transcribing');
      _sttRecognizer.stop();
      _sttRecognizer = null;
      const text = (await _sttPending) || '';
      _sttPending = null;
      _isBrowserStt = false;
      if (!text) { _setState(panel, 'your-turn'); return; }
      await _processTurn(text);
      return;
    }

    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    _setState(panel, 'transcribing');
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    await new Promise(resolve => { mediaRecorder.onstop = resolve; });
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];
    mediaRecorder = null;
    try {
      const text = await _transcribeBlob(blob);
      if (!text) { _setState(panel, 'your-turn'); return; }
      await _processTurn(text);
    } catch (err) {
      _sttRevealFallback(err.code === 503
        ? "Voice input isn't enabled — turn on STT in Settings, or type instead."
        : "Transcription failed — type instead.");
      _setState(panel, 'your-turn');
      textInput?.focus();
    }
  }

  micBtn?.addEventListener('mousedown',  _startRecording);
  micBtn?.addEventListener('touchstart', e => { e.preventDefault(); _startRecording(); }, { passive: false });
  micBtn?.addEventListener('mouseup',    _stopRecording);
  micBtn?.addEventListener('mouseleave', _stopRecording);
  micBtn?.addEventListener('touchend',   _stopRecording);

  // ---- Core turn handler ----
  async function _processTurn(userText) {
    _appendTranscript(transcriptEl, 'user', userText);
    _setState(panel, 'thinking');

    const contentEl = _appendStreamingTurn(transcriptEl);
    let agentText = '';
    try {
      agentText = await _streamAgentReply(agentId, userText, contentEl, transcriptEl);
    } catch (_) {
      contentEl.textContent = '[Error — could not reach agent]';
      contentEl.classList.add('cc-voice-error');
      _setState(panel, 'your-turn');
      return;
    }

    if (agentText) {
      _setState(panel, 'speaking');
      await new Promise(resolve => _speak(agentText, ttsVoice, null, resolve, _speakCancel));
    }
    _speakCancel.cancel = null;
    _setState(panel, 'your-turn');
  }
}

// ── Wake-word: testables (consumed by tests/test_wake_memory.test.mjs) ──
export {
  WAKE_PHRASE, startWakeWordListener, stopWakeWordListener,
};
export const __wakeTestables = {
  WAKE_PHRASE, WAKE_PREF_KEY,
  isWakeActive: () => _wakeActive,
  isSupported:  _wakeSupported,
  readPref:     _readWakePref,
  writePref:    _writeWakePref,
  start:        startWakeWordListener,
  stop:         stopWakeWordListener,
};
