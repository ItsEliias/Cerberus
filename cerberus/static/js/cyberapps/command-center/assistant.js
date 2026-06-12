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
      // voiceRecorder inserts transcript via insertTranscription into #message,
      // but our input is #cc-chat-input — patch after small delay
      setTimeout(() => _transferTranscript(input), 400);
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
