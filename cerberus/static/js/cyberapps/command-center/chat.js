/**
 * chat.js — 1:1 agent chat panel (Phase 2).
 *
 * Exports openAgentChat(container, agentId, agentName, agentAvatar, accentColor).
 * Replaces the AGENTS tab content with a threaded chat view; "← Back" restores
 * the roster via buildAgentsTab / loadAgents.
 */

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _buildChatPanel(agentName, agentAvatar, accentColor, ttsVoice) {
  const glyph = agentAvatar || (agentName || '?')[0];
  const callBtn = `<button class="cc-chat-call-btn" title="Voice call">📞</button>`;
  return `
<div class="cc-agents-tab cc-agent-chat" id="cc-agent-chat">
  <div class="cc-agent-chat-header" style="--cat-accent:${_esc(accentColor)}">
    <button class="cc-chat-back-btn" title="Back to roster">← Back</button>
    <span class="cc-agent-chat-sigil" style="background:${_esc(accentColor)}">${_esc(glyph)}</span>
    <span class="cc-agent-chat-name">${_esc(agentName)}</span>
    ${callBtn}
    <button class="cc-chat-clear-btn" title="Clear conversation">Clear</button>
  </div>
  <div class="cc-chat-messages" id="cc-chat-messages">
    <div class="cc-empty">Loading…</div>
  </div>
  <div class="cc-chat-input-row">
    <textarea class="cc-chat-input" id="cc-chat-input"
      placeholder="Message ${_esc(agentName)}… (Ctrl+Enter to send)" rows="2"></textarea>
    <button class="cc-chat-send-btn" id="cc-chat-send-btn">Send</button>
  </div>
</div>`.trim();
}

function _msgBubble(role, content, timestamp) {
  const ts = timestamp ? new Date(timestamp + 'Z').toLocaleTimeString() : '';
  return `<div class="cc-chat-msg cc-chat-msg--${role}">
  <div class="cc-chat-msg-meta">
    <span class="cc-chat-msg-role">${role === 'user' ? 'YOU' : 'AGENT'}</span>
    ${ts ? `<span class="cc-chat-msg-ts">${_esc(ts)}</span>` : ''}
  </div>
  <div class="cc-chat-msg-content">${_esc(content)}</div>
</div>`;
}

function _contextDivider(trimmed) {
  return `<div class="cc-ctx-divider">
  <span class="cc-ctx-divider-line"></span>
  <span class="cc-ctx-divider-label">// context window — ${trimmed} earlier message${trimmed !== 1 ? 's' : ''} not sent to LLM</span>
  <span class="cc-ctx-divider-line"></span>
</div>`;
}

async function _loadThread(agentId, messagesEl) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/thread`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { messages = [], context_window = 20 } = await res.json();
    if (!messages.length) {
      messagesEl.innerHTML = '<div class="cc-empty">No messages yet — start the conversation.</div>';
      return;
    }
    const trimmed = Math.max(0, messages.length - context_window);
    const bubbles = messages.map(m => _msgBubble(m.role, m.content, m.timestamp));
    if (trimmed > 0) {
      bubbles.splice(trimmed, 0, _contextDivider(trimmed));
    }
    messagesEl.innerHTML = bubbles.join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (e) {
    messagesEl.innerHTML = `<div class="cc-empty">Could not load thread — ${_esc(e.message)}</div>`;
  }
}

async function _streamSSE(body, contentEl) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
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
      if (raw === '[DONE]') return;
      if (eventType === 'error') {
        try {
          const obj = JSON.parse(raw);
          contentEl.textContent = `Error: ${obj.error || raw}`;
        } catch (_) { contentEl.textContent = `Error: ${raw}`; }
        contentEl.classList.remove('cc-chat-streaming');
        contentEl.classList.add('cc-chat-error');
        eventType = 'message'; continue;
      }
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'usage') continue;
        contentEl.textContent += obj.delta || obj.text || obj.content || '';
      } catch (_) { contentEl.textContent += raw; }
      eventType = 'message';
    }
  }
}

async function _sendMessage(agentId, input, messagesEl, sendBtn) {
  const text = input?.value?.trim();
  if (!text) return;

  // Optimistically append user bubble
  messagesEl.insertAdjacentHTML('beforeend', _msgBubble('user', text, null));
  input.value = '';
  sendBtn.disabled = true;
  sendBtn.textContent = '…';
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Append streaming assistant bubble
  const asstWrap = document.createElement('div');
  asstWrap.innerHTML = _msgBubble('assistant', '', null);
  const asstBubble = asstWrap.firstChild;
  const contentEl  = asstBubble.querySelector('.cc-chat-msg-content');
  contentEl.classList.add('cc-chat-streaming');
  messagesEl.appendChild(asstBubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/thread/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await _streamSSE(res.body, contentEl);
    contentEl.classList.remove('cc-chat-streaming');
  } catch (e) {
    contentEl.textContent = `Error: ${e.message}`;
    contentEl.classList.remove('cc-chat-streaming');
    contentEl.classList.add('cc-chat-error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ---- Public API ----

export async function openAgentChat(container, agentId, agentName, agentAvatar, accentColor, ttsVoice = '') {
  container.innerHTML = _buildChatPanel(agentName, agentAvatar, accentColor || 'rgba(197,201,208,0.5)', ttsVoice);

  const messagesEl = container.querySelector('#cc-chat-messages');
  const input      = container.querySelector('#cc-chat-input');
  const sendBtn    = container.querySelector('#cc-chat-send-btn');
  const backBtn    = container.querySelector('.cc-chat-back-btn');
  const clearBtn   = container.querySelector('.cc-chat-clear-btn');
  const chatCallBtn = container.querySelector('.cc-chat-call-btn');

  chatCallBtn?.addEventListener('click', async () => {
    const { openVoiceCall } = await import('./voice.js');
    openVoiceCall(container, agentId, agentName, agentAvatar, accentColor || 'rgba(197,201,208,0.5)', ttsVoice);
  });

  // Back — re-mount the roster
  backBtn?.addEventListener('click', async () => {
    const { buildAgentsTab, loadAgents } = await import('./agents.js');
    container.innerHTML = buildAgentsTab();
    await loadAgents(container);
  });

  // Clear thread
  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear this conversation? All messages will be deleted.')) return;
    try {
      await fetch(`/api/agents/${encodeURIComponent(agentId)}/thread`, { method: 'DELETE' });
      messagesEl.innerHTML = '<div class="cc-empty">Thread cleared.</div>';
    } catch (e) {
      alert(`Failed to clear thread: ${e.message}`);
    }
  });

  // Send
  sendBtn?.addEventListener('click', () => _sendMessage(agentId, input, messagesEl, sendBtn));
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _sendMessage(agentId, input, messagesEl, sendBtn);
    }
  });

  await _loadThread(agentId, messagesEl);
  input?.focus();
}
