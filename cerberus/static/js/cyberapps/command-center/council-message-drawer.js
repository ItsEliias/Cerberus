/**
 * council-message-drawer.js — Phase E2 per-agent 1-on-1 messaging drawer.
 *
 * Exports:
 *   openMessageDrawer(root, agent)  — slide in the drawer for `agent`
 *   closeMessageDrawer(root)        — slide out and clean up
 */

import { getGlyph } from './council-glyphs.js';

const AGENTS_API = '/api/agents';

// ---- Helpers ----

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _ttsKey(agentId) {
  return `cc_msg_tts_${agentId}`;
}

function _isTtsOn(agentId) {
  try { return localStorage.getItem(_ttsKey(agentId)) === '1'; } catch (_) { return false; }
}

function _setTts(agentId, on) {
  try { localStorage.setItem(_ttsKey(agentId), on ? '1' : '0'); } catch (_) { /* noop */ }
}

function _playTts(text) {
  try {
    if (window.aiTTSManager && typeof window.aiTTSManager.play === 'function') {
      window.aiTTSManager.play(text);
    }
  } catch (_) { /* ignore */ }
}

// ---- Close ----

export function closeMessageDrawer(root) {
  const backdrop = root.querySelector('.cc-msg-drawer-backdrop');
  const drawer   = root.querySelector('.cc-msg-drawer');
  const reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function _remove() {
    backdrop && backdrop.remove();
    drawer   && drawer.remove();
  }

  if (reduced || !drawer) { _remove(); return; }

  drawer.classList.remove('cc-msg-drawer--open');
  backdrop && backdrop.classList.remove('cc-msg-backdrop--visible');
  setTimeout(_remove, 270);
}

// ---- Open ----

export function openMessageDrawer(root, agent) {
  // Close any existing drawer first
  const existing = root.querySelector('.cc-msg-drawer');
  if (existing) {
    closeMessageDrawer(root);
    // If same agent re-clicked: just close
    if (existing.dataset.agentId === agent.id) return;
  }

  const reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portrait = getGlyph(agent.name);
  const ttsOn    = _isTtsOn(agent.id);

  // Build backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'cc-msg-drawer-backdrop';
  backdrop.addEventListener('click', () => closeMessageDrawer(root));

  // Build drawer
  const drawer = document.createElement('div');
  drawer.className = 'cc-msg-drawer jx2-hud-frame';
  drawer.dataset.agentId = agent.id;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', `Chat with ${agent.name}`);
  drawer.innerHTML = `
    <span class="jx2-bracket-tl" aria-hidden="true"></span>
    <span class="jx2-bracket-br" aria-hidden="true"></span>

    <div class="cc-msg-header">
      <div class="cc-msg-header-portrait">${portrait}</div>
      <div class="cc-msg-header-info">
        <span class="cc-msg-header-name">${_esc(agent.name).toUpperCase()}</span>
        <span class="cc-msg-header-role">${_esc(agent.role || '')}</span>
      </div>
      <button class="cc-msg-close-btn" aria-label="Close chat">[ X ]</button>
    </div>

    <div class="cc-msg-list" id="cc-msg-list-${_esc(agent.id)}"></div>

    <div class="cc-msg-footer">
      <button class="cc-msg-tts-toggle${ttsOn ? ' cc-msg-tts-on' : ''}"
        title="Toggle TTS" aria-pressed="${ttsOn}" aria-label="Toggle text-to-speech">TTS</button>
      <textarea class="cc-msg-input" id="cc-msg-input-${_esc(agent.id)}"
        placeholder="Type a message..."
        rows="1" aria-label="Message input"></textarea>
      <button class="cc-msg-send-btn" id="cc-msg-send-${_esc(agent.id)}">SEND</button>
    </div>
  `;

  root.appendChild(backdrop);
  root.appendChild(drawer);

  // Animate in
  requestAnimationFrame(() => {
    if (!reduced) {
      requestAnimationFrame(() => {
        drawer.classList.add('cc-msg-drawer--open');
        backdrop.classList.add('cc-msg-backdrop--visible');
      });
    } else {
      drawer.classList.add('cc-msg-drawer--open');
      backdrop.classList.add('cc-msg-backdrop--visible');
    }
  });

  // Wire close
  drawer.querySelector('.cc-msg-close-btn').addEventListener('click', () => closeMessageDrawer(root));

  // Wire Esc
  const _onKey = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', _onKey); closeMessageDrawer(root); } };
  document.addEventListener('keydown', _onKey);

  // Wire TTS toggle
  const ttsBtn = drawer.querySelector('.cc-msg-tts-toggle');
  ttsBtn.addEventListener('click', () => {
    const next = !_isTtsOn(agent.id);
    _setTts(agent.id, next);
    ttsBtn.classList.toggle('cc-msg-tts-on', next);
    ttsBtn.setAttribute('aria-pressed', String(next));
  });

  // Wire textarea Enter / Shift+Enter
  const textarea = drawer.querySelector(`#cc-msg-input-${agent.id}`);
  textarea.addEventListener('keydown', async e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await _sendMessage(root, agent, drawer);
    }
  });

  // Wire send button
  const sendBtn = drawer.querySelector(`#cc-msg-send-${agent.id}`);
  sendBtn.addEventListener('click', async () => _sendMessage(root, agent, drawer));

  // Load history
  _loadHistory(agent, drawer);
}

// ---- Load history ----

async function _loadHistory(agent, drawer) {
  const list = drawer.querySelector(`#cc-msg-list-${agent.id}`);
  if (!list) return;
  try {
    const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agent.id)}/messages?limit=100`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const data = await res.json();
    list.innerHTML = '';
    (data.messages || []).forEach(m => _appendBubble(list, m.role, m.content));
    _scrollBottom(list);
  } catch (_) { /* silent */ }
}

// ---- Send message ----

async function _sendMessage(root, agent, drawer) {
  const textarea = drawer.querySelector(`#cc-msg-input-${agent.id}`);
  const list     = drawer.querySelector(`#cc-msg-list-${agent.id}`);
  const sendBtn  = drawer.querySelector(`#cc-msg-send-${agent.id}`);
  if (!textarea || !list) return;

  const content = textarea.value.trim();
  if (!content) return;

  if (agent._demo) {
    _appendBubble(list, 'user', content);
    _appendBubble(list, 'agent', '[DEMO] Connect to the API to chat with agents.');
    _scrollBottom(list);
    textarea.value = '';
    return;
  }

  textarea.value = '';
  sendBtn.disabled = true;

  // Optimistic user bubble
  _appendBubble(list, 'user', content);
  _scrollBottom(list);

  // Placeholder agent bubble
  const agentBubble = _appendBubble(list, 'agent', '');
  agentBubble.classList.add('streaming');
  _scrollBottom(list);

  let accumulated = '';

  try {
    const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agent.id)}/messages`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const txt = await res.text();
      agentBubble.textContent = `Error ${res.status}: ${txt}`;
      agentBubble.classList.remove('streaming');
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

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
  } catch (err) {
    agentBubble.textContent = `Stream error: ${err.message}`;
  } finally {
    agentBubble.classList.remove('streaming');
    sendBtn.disabled = false;
    // TTS playback after full stream
    if (accumulated && _isTtsOn(agent.id)) {
      _playTts(accumulated);
    }
  }
}

// ---- Bubble factory ----

function _appendBubble(list, role, content) {
  const wrap = document.createElement('div');
  wrap.className = role === 'user' ? 'cc-msg-bubble-user' : 'cc-msg-bubble-agent';
  wrap.textContent = content;
  list.appendChild(wrap);
  return wrap;
}

// ---- Scroll ----

function _scrollBottom(list) {
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}
