/**
 * voice.js — 1:1 voice call panel (Phase 4a).
 *
 * State machine: idle → listening → transcribing → thinking → speaking → your-turn
 * Push-to-talk: hold mic button while speaking, release to submit.
 * STT: POST /api/stt/transcribe (multipart). On 503 → text fallback.
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
  </div>
  <div class="cc-voice-transcript" id="cc-voice-transcript">
    <div class="cc-empty">Hold the mic button to speak.</div>
  </div>
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

async function _speak(text, ttsVoice, onStart, onEnd) {
  const provider = await _getTtsProvider();

  if (provider === 'browser') {
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
    audio.onended = onEnd;
    audio.onerror = onEnd;
    await audio.play();
  } catch (_) {
    onEnd?.();
  }
}

// ---------------------------------------------------------------------------
// STT: record audio and transcribe
// ---------------------------------------------------------------------------

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
  let mediaRecorder = null;
  let audioChunks   = [];

  async function _startRecording() {
    const state = panel.dataset.voiceState;
    if (state === 'listening' || state === 'transcribing' || state === 'thinking' || state === 'speaking') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.start();
      _setState(panel, 'listening');
    } catch (_) {
      // Mic unavailable — switch to text mode
      textMode = true;
      fallbackDiv.style.display = 'flex';
      micBtn.style.display = 'none';
      toggleText.textContent = 'Use mic';
    }
  }

  async function _stopRecording() {
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
      if (err.code === 503) {
        // STT unavailable — fall back to text input
        textMode = true;
        fallbackDiv.style.display = 'flex';
        micBtn.style.display = 'none';
        toggleText.textContent = 'Use mic';
      }
      _setState(panel, 'your-turn');
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
      await new Promise(resolve => _speak(agentText, ttsVoice, null, resolve));
    }
    _setState(panel, 'your-turn');
  }
}
