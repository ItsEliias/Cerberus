/**
 * council-call-view.js — Phase E3 per-agent voice call overlay.
 *
 * Exports:
 *   openCallView(root, agent)  — show full-screen call overlay for `agent`
 *   closeCallView(root)        — tear down overlay (keeps conversation history)
 *
 * Voice flow:
 *   hold → startRecording → release → capture transcript from #message →
 *   POST to /api/agents/{id}/messages → SSE stream → TTS playback
 *
 * TTS: window.aiTTSManager.play(text) — always on in call mode.
 * Voice input: voiceRecorder module (browser STT / server Whisper).
 * Waveform: SVG-based, three states: idle / recording / speaking.
 */

import { getGlyph } from './council-glyphs.js';
import { startRecording, stopRecording } from '../../voiceRecorder.js';

const AGENTS_API = '/api/agents';
const OVERLAY_CLASS = 'cc-call-overlay';
const TRANSCRIPT_WAIT_MS = 3000;
const TRANSCRIPT_POLL_MS = 120;

// ---- Helpers ----

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function _playTts(text) {
  try {
    if (window.aiTTSManager && typeof window.aiTTSManager.play === 'function') {
      window.aiTTSManager.play(text);
    }
  } catch (_) { /* tts optional */ }
}

function _ttsEndPromise(text) {
  return new Promise(resolve => {
    try {
      const mgr = window.aiTTSManager;
      if (!mgr || typeof mgr.play !== 'function') { resolve(); return; }
      if (typeof mgr.onEnd === 'function') {
        mgr.onEnd(resolve);
      } else {
        // Estimate: 70ms per char, min 800ms, max 25000ms
        const ms = Math.min(25000, Math.max(800, text.length * 70));
        setTimeout(resolve, ms);
      }
    } catch (_) { resolve(); }
  });
}

// ---- Waveform ----

function _buildWaveformSvg() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 60');
  svg.setAttribute('width', '320');
  svg.setAttribute('height', '60');
  svg.setAttribute('aria-hidden', 'true');
  svg.className = 'cc-call-waveform';

  const idle = document.createElementNS(NS, 'line');
  idle.setAttribute('x1', '0'); idle.setAttribute('y1', '30');
  idle.setAttribute('x2', '320'); idle.setAttribute('y2', '30');
  idle.className = 'cc-wf-idle';

  const recPath = document.createElementNS(NS, 'path');
  recPath.className = 'cc-wf-recording';
  recPath.style.display = 'none';

  const spkPath = document.createElementNS(NS, 'path');
  spkPath.className = 'cc-wf-speaking';
  spkPath.style.display = 'none';

  svg.appendChild(idle);
  svg.appendChild(recPath);
  svg.appendChild(spkPath);
  return svg;
}

function _setWaveformState(svg, state) {
  if (!svg) return;
  const idle = svg.querySelector('.cc-wf-idle');
  const rec  = svg.querySelector('.cc-wf-recording');
  const spk  = svg.querySelector('.cc-wf-speaking');
  if (idle) idle.style.display = state === 'idle' ? '' : 'none';
  if (rec)  rec.style.display  = state === 'recording' ? '' : 'none';
  if (spk)  spk.style.display  = state === 'speaking' ? '' : 'none';
}

// ---- Transcript helpers ----

function _scrollBottom(list) {
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

function _appendBubble(list, role, content) {
  const el = document.createElement('div');
  el.className = role === 'user' ? 'cc-call-bubble-user' : 'cc-call-bubble-agent';
  el.textContent = content;
  list.appendChild(el);
  _scrollBottom(list);
  return el;
}

// ---- Capture transcript from #message ----

function _captureTranscript() {
  return new Promise(resolve => {
    const input = document.getElementById('message');
    if (!input) { resolve(''); return; }

    const initial = input.value;
    let elapsed = 0;

    const poll = setInterval(() => {
      elapsed += TRANSCRIPT_POLL_MS;
      const current = input.value;
      if (current !== initial && current.trim()) {
        clearInterval(poll);
        const text = current.trim();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        resolve(text);
        return;
      }
      if (elapsed >= TRANSCRIPT_WAIT_MS) {
        clearInterval(poll);
        // Still grab whatever is there (even if unchanged)
        const text = input.value.trim();
        if (text) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        resolve(text);
      }
    }, TRANSCRIPT_POLL_MS);
  });
}

// ---- SSE streaming send ----

async function _sendToAgent(agentId, content, agentBubble, list) {
  const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agentId)}/messages`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    agentBubble.textContent = `Error ${res.status}: ${txt}`;
    return '';
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;
      try {
        const obj = JSON.parse(payload);
        if (obj.delta) {
          accumulated += obj.delta;
          agentBubble.textContent = accumulated;
          _scrollBottom(list);
        } else if (obj.error) {
          agentBubble.textContent = `Error: ${obj.error}`;
        }
      } catch (_) { /* non-JSON chunk */ }
    }
  }
  return accumulated;
}

// ---- State machine ----

const STATE = { idle: 'idle', recording: 'recording', speaking: 'speaking' };

function _setState(ctx, newState) {
  ctx.state = newState;
  const svg = ctx.overlay.querySelector('.cc-call-waveform');
  _setWaveformState(svg, newState);

  const holdBtn = ctx.overlay.querySelector('.cc-call-btn-hold');
  const liveEl  = ctx.overlay.querySelector('.cc-call-live-dot');

  if (holdBtn) {
    holdBtn.disabled = (newState === STATE.speaking);
    holdBtn.classList.toggle('cc-call-btn-hold--recording', newState === STATE.recording);
    holdBtn.textContent = newState === STATE.recording ? '[ RELEASE TO SEND ]' : '[ HOLD TO SPEAK ]';
  }
  if (liveEl) {
    liveEl.classList.toggle('cc-call-live-dot--active', newState !== STATE.idle);
  }
}

function _showError(ctx, msg) {
  const existing = ctx.overlay.querySelector('.cc-call-error');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'cc-call-error';
  el.textContent = msg;
  const controls = ctx.overlay.querySelector('.cc-call-controls');
  if (controls) controls.insertAdjacentElement('beforebegin', el);
}

// ---- Close ----

export function closeCallView(root) {
  const overlay = root.querySelector(`.${OVERLAY_CLASS}`);
  if (!overlay) return;

  // Cleanup spacebar handler
  const kh = overlay._keyHandler;
  if (kh) document.removeEventListener('keydown', kh);
  const ku = overlay._keyUpHandler;
  if (ku) document.removeEventListener('keyup', ku);

  if (_reduced()) {
    overlay.remove();
    return;
  }
  overlay.classList.remove('cc-call-overlay--visible');
  setTimeout(() => overlay.remove(), 240);
}

// ---- Open ----

export function openCallView(root, agent) {
  // Close existing call first
  const existing = root.querySelector(`.${OVERLAY_CLASS}`);
  if (existing) closeCallView(root);

  const portrait = getGlyph(agent.name);
  const nameDisp = (agent.name || '').toUpperCase();

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `Voice call with ${agent.name}`);
  overlay.setAttribute('aria-modal', 'true');

  const waveformSvg = _buildWaveformSvg();

  overlay.innerHTML = `
    <div class="cc-call-panel">
      <div class="cc-call-left">
        <div class="cc-call-stage">
          <div class="cc-call-portrait" aria-label="${_esc(nameDisp)} portrait">
            ${portrait}
          </div>
          <div class="cc-call-agent-name">${_esc(nameDisp)}</div>
          <div class="cc-call-agent-role">${_esc(agent.role || '')}</div>
          <div class="cc-call-live-row">
            <span class="cc-call-live-dot cc-call-live-dot--active" aria-label="Live"></span>
            <span class="cc-call-live-label">LIVE</span>
          </div>
        </div>
        <div class="cc-call-waveform-wrap"></div>
      </div>
      <div class="cc-call-right">
        <div class="cc-call-transcript-list" aria-live="polite" aria-label="Call transcript"></div>
      </div>
    </div>
    <div class="cc-call-controls">
      <button class="cc-call-btn-hold" aria-label="Hold to speak">[ HOLD TO SPEAK ]</button>
      <button class="cc-call-btn-end" aria-label="End call">[ END CALL ]</button>
    </div>
  `;

  // Insert waveform SVG
  overlay.querySelector('.cc-call-waveform-wrap').appendChild(waveformSvg);

  root.appendChild(overlay);

  // Animate in (double rAF so transition fires; reduced-motion = CSS handles it)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('cc-call-overlay--visible');
    });
  });

  // Context object
  const ctx = { overlay, agent, state: STATE.idle };
  _setState(ctx, STATE.idle);

  // ---- Wire hold button (mousedown/up, touchstart/end) ----

  const holdBtn = overlay.querySelector('.cc-call-btn-hold');

  function _onHoldStart(e) {
    e.preventDefault();
    if (ctx.state !== STATE.idle) return;
    _startRecordingPhase(ctx);
  }

  function _onHoldEnd(e) {
    e.preventDefault();
    if (ctx.state !== STATE.recording) return;
    _endRecordingPhase(ctx);
  }

  holdBtn.addEventListener('mousedown', _onHoldStart);
  holdBtn.addEventListener('mouseup', _onHoldEnd);
  holdBtn.addEventListener('mouseleave', e => { if (ctx.state === STATE.recording) _onHoldEnd(e); });
  holdBtn.addEventListener('touchstart', _onHoldStart, { passive: false });
  holdBtn.addEventListener('touchend', _onHoldEnd);
  holdBtn.addEventListener('touchcancel', e => { if (ctx.state === STATE.recording) _onHoldEnd(e); });

  // ---- Wire spacebar ----

  let _spaceHeld = false;

  const _keyHandler = e => {
    if (e.key === ' ' && !_spaceHeld && ctx.state === STATE.idle) {
      e.preventDefault();
      _spaceHeld = true;
      _startRecordingPhase(ctx);
    }
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', _keyHandler);
      document.removeEventListener('keyup', _keyUpHandler);
      closeCallView(root);
    }
  };
  const _keyUpHandler = e => {
    if (e.key === ' ') {
      _spaceHeld = false;
      if (ctx.state === STATE.recording) _endRecordingPhase(ctx);
    }
  };

  document.addEventListener('keydown', _keyHandler);
  document.addEventListener('keyup', _keyUpHandler);

  // Attach handlers to overlay for cleanup
  overlay._keyHandler   = _keyHandler;
  overlay._keyUpHandler = _keyUpHandler;

  // ---- Wire end call button ----

  overlay.querySelector('.cc-call-btn-end').addEventListener('click', () => {
    closeCallView(root);
  });

  // ---- Attempt mic init ----
  _initMic(ctx);
}

function _startRecordingPhase(ctx) {
  if (ctx.state !== STATE.idle) return;
  _setState(ctx, STATE.recording);

  // Clear existing #message content before recording so transcript capture is clean
  const input = document.getElementById('message');
  if (input) { input.value = ''; }

  startRecording(
    null,
    null,
    (errMsg) => {
      _setState(ctx, STATE.idle);
      _showError(ctx, `Microphone unavailable — ${errMsg}. Hold HOLD TO SPEAK to retry, or END CALL to close.`);
    }
  );
}

function _endRecordingPhase(ctx) {
  if (ctx.state !== STATE.recording) return;
  stopRecording();
  _processAfterRecord(ctx);
}

async function _processAfterRecord(ctx) {
  const transcript = await _captureTranscript();

  if (!transcript) {
    _setState(ctx, STATE.idle);
    return;
  }

  const list = ctx.overlay.querySelector('.cc-call-transcript-list');
  _appendBubble(list, 'user', transcript);
  _setState(ctx, STATE.speaking);

  const agentBubble = _appendBubble(list, 'agent', '');
  agentBubble.classList.add('streaming');

  try {
    const fullReply = await _sendToAgent(ctx.agent.id, transcript, agentBubble, list);
    agentBubble.classList.remove('streaming');

    if (fullReply) {
      _playTts(fullReply);
      await _ttsEndPromise(fullReply);
    }
  } catch (err) {
    agentBubble.classList.remove('streaming');
    agentBubble.textContent = `Stream error: ${err.message}`;
    console.warn('[CallView] agent reply error', err);
  } finally {
    _setState(ctx, STATE.idle);
  }
}

function _initMic(ctx) {
  // Pre-warm mic permission check — non-blocking
  if (!window.isSecureContext) {
    _showError(ctx, 'Microphone requires HTTPS. Use a reverse proxy with SSL or access via localhost.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _showError(ctx, 'Microphone not supported in this browser.');
  }
}
