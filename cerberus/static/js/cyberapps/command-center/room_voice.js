/**
 * room_voice.js — Group conference voice call (Phase 4b).
 *
 * Layered on Phase 3 conference rooms. Each participant agent speaks in turn
 * (ORCHESTRATOR-conducted or round-robin). User can request the floor between
 * agent turns via push-to-talk or text fallback.
 *
 * Architecture:
 *   1. User speaks first message (STT or text) → POST /api/rooms/{id}/send
 *   2. Parse SSE stream: collect per-agent turns, stream text to transcript
 *   3. TTS each completed agent turn sequentially (using tts_voice from route event)
 *   4. After each agent: check floor-request flag; if set → user speaks
 *   5. After all agents (DONE or cap_reached): offer full user floor or continue
 *
 * Exports openRoomVoiceCall(container, room).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RV_STATES = {
  IDLE:          'idle',
  LISTENING:     'listening',
  TRANSCRIBING:  'transcribing',
  PROCESSING:    'processing',   // agents responding
  AGENT_SPEAK:   'agent-speaking',
  USER_FLOOR:    'user-floor',
  DONE:          'done',
};

const RV_LABELS = {
  idle:           'Ready',
  listening:      'Listening…',
  transcribing:   'Transcribing…',
  processing:     'Agents responding…',
  'agent-speaking': 'Agent speaking…',
  'user-floor':   'Your floor',
  done:           'Call ended',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Panel HTML
// ---------------------------------------------------------------------------

function _buildPanel(room) {
  return `
<div class="cc-agents-tab cc-rv-panel" id="cc-rv-panel">
  <div class="cc-agent-chat-header cc-rv-header">
    <button class="cc-rv-back-btn">← Room</button>
    <span class="cc-agent-chat-name">${_esc(room.name)}</span>
    <span class="cc-rv-state-badge" id="cc-rv-state">Ready</span>
    <button class="cc-rv-floor-btn" id="cc-rv-floor-btn" title="Request floor after current agent" disabled>
      ✋ Floor
    </button>
  </div>
  <div class="cc-chat-messages cc-rv-transcript" id="cc-rv-transcript">
    <div class="cc-empty">Starting call…</div>
  </div>
  <div class="cc-rv-controls">
    <button class="cc-voice-mic-btn" id="cc-rv-mic-btn" title="Hold to speak">🎤</button>
    <div class="cc-voice-fallback" id="cc-rv-fallback" style="display:none">
      <textarea class="cc-voice-text-input" id="cc-rv-text-input"
        placeholder="Type message… (Enter to send)" rows="2"></textarea>
      <button class="cc-voice-text-send" id="cc-rv-text-send">Send</button>
    </div>
    <button class="cc-voice-toggle-text" id="cc-rv-toggle-text">Type instead</button>
  </div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

function _appendTurn(transcriptEl, role, senderName, text, color) {
  const div = document.createElement('div');
  div.className = `cc-chat-msg cc-chat-msg--${role === 'user' ? 'user' : 'assistant'}`;
  div.innerHTML = `<div class="cc-chat-msg-meta">
  <span class="cc-chat-msg-role" style="${color ? `color:${color}` : ''}">${_esc(senderName)}</span>
</div><div class="cc-chat-msg-content">${_esc(text)}</div>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function _startStreamingTurn(transcriptEl, agentName, color) {
  const div = document.createElement('div');
  div.className = 'cc-chat-msg cc-chat-msg--assistant';
  div.innerHTML = `<div class="cc-chat-msg-meta">
  <span class="cc-chat-msg-role" style="${color ? `color:${color}` : ''}">${_esc(agentName)}</span>
</div><div class="cc-chat-msg-content cc-chat-streaming" id="cc-rv-streaming"></div>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div.querySelector('#cc-rv-streaming');
}

// ---------------------------------------------------------------------------
// State badge
// ---------------------------------------------------------------------------

function _setState(panel, state) {
  const badge = panel.querySelector('#cc-rv-state');
  if (badge) badge.textContent = RV_LABELS[state] || state;
  panel.dataset.rvState = state;
  const micBtn = panel.querySelector('#cc-rv-mic-btn');
  const floorBtn = panel.querySelector('#cc-rv-floor-btn');
  if (micBtn) {
    micBtn.classList.toggle('cc-voice-mic-btn--active', state === RV_STATES.LISTENING);
    micBtn.disabled = [RV_STATES.TRANSCRIBING, RV_STATES.PROCESSING, RV_STATES.AGENT_SPEAK].includes(state);
  }
  if (floorBtn) {
    floorBtn.disabled = [RV_STATES.LISTENING, RV_STATES.TRANSCRIBING, RV_STATES.USER_FLOOR, RV_STATES.DONE].includes(state);
  }
}

// ---------------------------------------------------------------------------
// TTS (reuses provider detection from voice.js pattern)
// ---------------------------------------------------------------------------

let _rvTtsProvider = null;

async function _getTtsProvider() {
  if (_rvTtsProvider) return _rvTtsProvider;
  try {
    const res = await fetch('/api/tts/stats');
    const data = await res.json();
    _rvTtsProvider = data.provider || 'disabled';
  } catch (_) { _rvTtsProvider = 'disabled'; }
  return _rvTtsProvider;
}

async function _speakTurn(text, ttsVoice) {
  if (!text) return;
  const provider = await _getTtsProvider();

  if (provider === 'browser') {
    await new Promise(resolve => {
      const utt = new SpeechSynthesisUtterance(text);
      if (ttsVoice) {
        const match = speechSynthesis.getVoices().find(v => v.name === ttsVoice || v.voiceURI === ttsVoice);
        if (match) utt.voice = match;
      }
      utt.onend = resolve; utt.onerror = resolve;
      speechSynthesis.speak(utt);
    });
    return;
  }

  if (provider === 'disabled') return;

  try {
    const body = { text, format: 'base64' };
    if (ttsVoice) body.voice = ttsVoice;
    const res = await fetch('/api/tts/synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const data = await res.json();
    const b64 = data.audio_base64 || data.audio || '';
    if (!b64) return;
    await new Promise(resolve => {
      const audio = new Audio(`data:audio/wav;base64,${b64}`);
      audio.onended = resolve; audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// STT
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
// SSE stream parser — collects agent turns and streams text live to transcript
// Returns [{agentName, agentId, ttsVoice, text}] + capMeta | null
// ---------------------------------------------------------------------------

async function _collectStream(body, transcriptEl) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let eventType = 'message';

  const turns = [];
  let current = null;  // {agentName, agentId, ttsVoice, text, contentEl}
  let capMeta = null;

  function _finalizeCurrent() {
    if (current?.contentEl) current.contentEl.classList.remove('cc-chat-streaming');
    if (current) turns.push({ agentName: current.agentName, agentId: current.agentId, ttsVoice: current.ttsVoice, text: current.text });
    current = null;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) { eventType = 'message'; continue; }
      const raw = line.slice(5).trim();

      if (raw === '[DONE]') { _finalizeCurrent(); return { turns, capMeta }; }

      if (eventType === 'route') {
        _finalizeCurrent();
        try {
          const { agent, agent_id, tts_voice } = JSON.parse(raw);
          const contentEl = _startStreamingTurn(transcriptEl, agent, null);
          current = { agentName: agent, agentId: agent_id, ttsVoice: tts_voice || '', text: '', contentEl };
        } catch (_) {}
        eventType = 'message'; continue;
      }

      if (eventType === 'cap_reached') {
        _finalizeCurrent();
        try { capMeta = JSON.parse(raw); } catch (_) {}
        eventType = 'message'; continue;
      }

      if (eventType === 'error') { eventType = 'message'; continue; }

      if (current?.contentEl) {
        try {
          const obj = JSON.parse(raw);
          if (obj.type === 'usage') continue;
          const delta = obj.delta || obj.text || obj.content || '';
          if (delta) { current.text += delta; current.contentEl.textContent = current.text; }
        } catch (_) {}
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
      }
      eventType = 'message';
    }
  }
  _finalizeCurrent();
  return { turns, capMeta };
}

// ---------------------------------------------------------------------------
// Push-to-talk recorder
// ---------------------------------------------------------------------------

function _makeRecorder(onMicUnavailable) {
  let mediaRecorder = null;
  let chunks = [];

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.start();
      return true;
    } catch (_) {
      onMicUnavailable();
      return false;
    }
  }

  async function stop() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return null;
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    await new Promise(r => { mediaRecorder.onstop = r; });
    const blob = new Blob(chunks, { type: 'audio/webm' });
    chunks = []; mediaRecorder = null;
    return blob;
  }

  return { start, stop };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openRoomVoiceCall(container, room) {
  container.innerHTML = _buildPanel(room);

  const panel       = container.querySelector('#cc-rv-panel');
  const transcript  = container.querySelector('#cc-rv-transcript');
  const micBtn      = container.querySelector('#cc-rv-mic-btn');
  const floorBtn    = container.querySelector('#cc-rv-floor-btn');
  const fallbackDiv = container.querySelector('#cc-rv-fallback');
  const textInput   = container.querySelector('#cc-rv-text-input');
  const textSend    = container.querySelector('#cc-rv-text-send');
  const toggleText  = container.querySelector('#cc-rv-toggle-text');
  const backBtn     = container.querySelector('.cc-rv-back-btn');

  _rvTtsProvider = null;
  let _floorRequested = false;
  let _textMode = false;
  let _done = false;

  _setState(panel, RV_STATES.IDLE);
  transcript.innerHTML = '<div class="cc-empty">Speak or type your opening message to begin.</div>';

  // ---- Back → room chat ----
  backBtn?.addEventListener('click', () => {
    speechSynthesis?.cancel();
    _done = true;
    import('./rooms.js').then(({ buildRoomsTab, loadRooms }) => {
      container.innerHTML = buildRoomsTab();
      loadRooms(container);
    });
  });

  // ---- Text fallback toggle ----
  toggleText?.addEventListener('click', () => {
    _textMode = !_textMode;
    fallbackDiv.style.display = _textMode ? 'flex' : 'none';
    micBtn.style.display      = _textMode ? 'none' : 'block';
    toggleText.textContent    = _textMode ? 'Use mic' : 'Type instead';
  });

  // ---- Floor request button ----
  floorBtn?.addEventListener('click', () => {
    _floorRequested = true;
    floorBtn.classList.add('cc-rv-floor-btn--active');
    floorBtn.textContent = '✋ Floor (queued)';
  });

  // ---- Mic helper ----
  function _revealTextFallback() {
    _textMode = true;
    fallbackDiv.style.display = 'flex';
    micBtn.style.display = 'none';
    toggleText.textContent = 'Use mic';
  }

  const recorder = _makeRecorder(_revealTextFallback);

  // ---- Core turn: collect user speech, send to room ----
  async function _getUserMessage() {
    if (_textMode) {
      return await new Promise(resolve => {
        _setState(panel, RV_STATES.USER_FLOOR);
        function _submit() {
          const t = textInput?.value?.trim();
          if (!t) return;
          textInput.value = '';
          textSend.removeEventListener('click', _submit);
          textInput.removeEventListener('keydown', _kd);
          resolve(t);
        }
        function _kd(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _submit(); } }
        textSend?.addEventListener('click', _submit);
        textInput?.addEventListener('keydown', _kd);
        textInput?.focus();
      });
    }

    // Push-to-talk
    return await new Promise(resolve => {
      _setState(panel, RV_STATES.USER_FLOOR);
      async function _onUp() {
        micBtn.removeEventListener('mouseup', _onUp);
        micBtn.removeEventListener('touchend', _onUp);
        micBtn.removeEventListener('mouseleave', _onUp);
        _setState(panel, RV_STATES.TRANSCRIBING);
        const blob = await recorder.stop();
        if (!blob) { resolve(''); return; }
        try {
          const text = await _transcribeBlob(blob);
          resolve(text);
        } catch (err) {
          if (err.code === 503) _revealTextFallback();
          resolve('');
        }
      }
      async function _onDown() {
        micBtn.removeEventListener('mousedown', _onDown);
        micBtn.removeEventListener('touchstart', _onDown);
        const ok = await recorder.start();
        if (ok) {
          _setState(panel, RV_STATES.LISTENING);
          micBtn.addEventListener('mouseup',   _onUp);
          micBtn.addEventListener('touchend',  _onUp);
          micBtn.addEventListener('mouseleave', _onUp);
        } else {
          resolve('');
        }
      }
      micBtn.addEventListener('mousedown',  _onDown);
      micBtn.addEventListener('touchstart', e => { e.preventDefault(); _onDown(); }, { passive: false });
    });
  }

  // ---- Main voice loop ----
  async function _runLoop(initialMessage) {
    let userMessage = initialMessage;

    while (!_done) {
      if (!userMessage) {
        userMessage = await _getUserMessage();
        if (_done || !userMessage) break;
      }

      // Show user turn in transcript
      _appendTurn(transcript, 'user', 'YOU', userMessage, '');
      _setState(panel, RV_STATES.PROCESSING);

      // Send to room → get SSE stream
      let res;
      try {
        res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ message: userMessage }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        _appendTurn(transcript, 'error', 'ERROR', e.message, '#e74c3c');
        _setState(panel, RV_STATES.USER_FLOOR);
        userMessage = null;
        continue;
      }

      // Collect stream + live-stream text to transcript
      const { turns, capMeta } = await _collectStream(res.body, transcript);

      // TTS each agent turn sequentially; pause for floor if requested
      for (const turn of turns) {
        if (_done) break;
        _setState(panel, RV_STATES.AGENT_SPEAK);
        await _speakTurn(turn.text, turn.ttsVoice);
        if (_done) break;

        if (_floorRequested) {
          _floorRequested = false;
          if (floorBtn) { floorBtn.classList.remove('cc-rv-floor-btn--active'); floorBtn.textContent = '✋ Floor'; }
          userMessage = await _getUserMessage();
          if (_done || !userMessage) { _done = true; break; }
          _appendTurn(transcript, 'user', 'YOU', userMessage, '');
          _setState(panel, RV_STATES.PROCESSING);
          // Inject user message and restart loop
          break;
        }
      }

      if (_done) break;

      if (capMeta) {
        // Cap reached — offer continue or end
        userMessage = await new Promise(resolve => {
          const el = document.createElement('div');
          el.className = 'cc-room-cap-prompt';
          el.innerHTML = `<span class="cc-room-cap-msg">${capMeta.rounds} round${capMeta.rounds !== 1 ? 's' : ''} completed.</span>
<button class="cc-rv-continue-btn">Continue</button>
<button class="cc-rv-end-btn">End call</button>`.trim();
          el.querySelector('.cc-rv-continue-btn').addEventListener('click', () => {
            el.remove();
            resolve('continue');
          });
          el.querySelector('.cc-rv-end-btn').addEventListener('click', () => {
            el.remove();
            resolve(null);
          });
          transcript.appendChild(el);
          transcript.scrollTop = transcript.scrollHeight;
        });

        if (!userMessage) { _done = true; break; }
        if (userMessage === 'continue') {
          // Use /continue endpoint instead of /send
          _setState(panel, RV_STATES.PROCESSING);
          try {
            res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/continue`, {
              method: 'POST', headers: { Accept: 'text/event-stream' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { turns: moreTurns, capMeta: nextCap } = await _collectStream(res.body, transcript);
            for (const turn of moreTurns) {
              if (_done) break;
              _setState(panel, RV_STATES.AGENT_SPEAK);
              await _speakTurn(turn.text, turn.ttsVoice);
            }
            userMessage = null;  // ask user after this batch
            continue;
          } catch (e) {
            _appendTurn(transcript, 'error', 'ERROR', e.message, '#e74c3c');
            userMessage = null;
          }
        }
      } else {
        // Normal end of round — ask user for next message
        userMessage = null;
      }
    }

    _setState(panel, RV_STATES.DONE);
    if (micBtn) micBtn.disabled = true;
    if (floorBtn) floorBtn.disabled = true;
    transcript.insertAdjacentHTML('beforeend',
      '<div class="cc-empty" style="margin-top:12px">Call ended. ← Back to return to room.</div>');
    transcript.scrollTop = transcript.scrollHeight;
  }

  // ---- Text submit handler for initial message ----
  async function _handleInitialTextSubmit() {
    const text = textInput?.value?.trim();
    if (!text) return;
    textInput.value = '';
    textSend.removeEventListener('click', _handleInitialTextSubmit);
    textInput.removeEventListener('keydown', _initKd);
    await _runLoop(text);
  }
  function _initKd(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleInitialTextSubmit(); }
  }

  if (_textMode) {
    textSend?.addEventListener('click', _handleInitialTextSubmit);
    textInput?.addEventListener('keydown', _initKd);
    textInput?.focus();
  } else {
    // Push-to-talk for initial message
    micBtn.addEventListener('mousedown', async function _initDown() {
      micBtn.removeEventListener('mousedown', _initDown);
      micBtn.removeEventListener('touchstart', _initTouch);
      const ok = await recorder.start();
      if (!ok) return;
      _setState(panel, RV_STATES.LISTENING);
      async function _initUp() {
        micBtn.removeEventListener('mouseup', _initUp);
        micBtn.removeEventListener('mouseleave', _initUp);
        micBtn.removeEventListener('touchend', _initUp);
        _setState(panel, RV_STATES.TRANSCRIBING);
        const blob = await recorder.stop();
        if (!blob) return;
        try {
          const text = await _transcribeBlob(blob);
          if (text) await _runLoop(text);
        } catch (err) {
          if (err.code === 503) _revealTextFallback();
        }
      }
      micBtn.addEventListener('mouseup',   _initUp);
      micBtn.addEventListener('mouseleave', _initUp);
      micBtn.addEventListener('touchend',   _initUp);
    });
    function _initTouch(e) { e.preventDefault(); micBtn.dispatchEvent(new MouseEvent('mousedown')); }
    micBtn.addEventListener('touchstart', _initTouch, { passive: false });
  }
}
