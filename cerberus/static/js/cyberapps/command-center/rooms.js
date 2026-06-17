/**
 * rooms.js — Conference Rooms tab (Phase 3).
 *
 * Rooms let an owner send a single message to a set of agents; the
 * ORCHESTRATOR (if present) routes to the best participant, otherwise
 * the first participant responds.  History persists across sessions.
 *
 * Exports: buildRoomsTab, loadRooms
 */

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// Agent list cache — populated once per tab mount
let _agentCache = [];

async function _ensureAgents() {
  if (_agentCache.length) return;
  try {
    const res = await fetch('/api/agents');
    if (res.ok) {
      const { agents = [] } = await res.json();
      _agentCache = agents;
    }
  } catch (_) {}
}

function _agentById(id) {
  return _agentCache.find(a => a.id === id) || null;
}

// ---- Room card in list view ----

function _roomCard(room) {
  const count = room.participant_ids?.length || 0;
  const lastAt = room.last_message_at
    ? new Date(room.last_message_at + 'Z').toLocaleString() : '—';
  return `
<div class="cc-room-card" data-room-id="${_esc(room.id)}" data-room-name="${_esc(room.name)}">
  <div class="cc-room-card-header">
    <span class="cc-room-name">${_esc(room.name)}</span>
    <span class="cc-room-count">${count} agent${count !== 1 ? 's' : ''}</span>
  </div>
  <div class="cc-room-last">${_esc(lastAt)}</div>
  <div class="cc-room-card-actions">
    <button class="cc-room-open-btn" data-room-id="${_esc(room.id)}">Open</button>
    <button class="cc-room-delete-btn" data-room-id="${_esc(room.id)}">Delete</button>
  </div>
</div>`.trim();
}

// ---- New room form ----

function _newRoomForm(agents) {
  const agentToggles = agents.map(a => `
    <label class="cc-room-agent-toggle">
      <input type="checkbox" class="cc-room-agent-cb" value="${_esc(a.id)}"
        data-name="${_esc(a.name)}">
      <span class="cc-room-agent-toggle-name">${_esc(a.name)}</span>
    </label>`).join('');

  return `
<div class="cc-room-new-form" id="cc-room-new-form" style="display:none">
  <div class="cc-room-form-title">New Conference Room</div>
  <label>Room name <span class="cc-req">*</span></label>
  <input id="cc-room-name-input" placeholder="e.g. DESIGN SPRINT" autocomplete="off">
  <label>Participants <span class="cc-req">*</span></label>
  <div class="cc-room-agent-list">${agentToggles || '<span class="cc-empty">No agents found.</span>'}</div>
  <div class="cc-ag-invoke-actions" style="margin-top:8px">
    <button id="cc-room-create-btn">Create</button>
    <button id="cc-room-cancel-btn">Cancel</button>
  </div>
  <div id="cc-room-create-msg" class="cc-ag-edit-msg"></div>
</div>`.trim();
}

// ---- Room message bubble ----

function _roomMsgBubble(msg) {
  const isUser = msg.role === 'user';
  const ts = msg.timestamp ? new Date(msg.timestamp + 'Z').toLocaleTimeString() : '';
  const agentColor = isUser ? '' : _agentAccent(msg.sender_name);
  const senderLabel = isUser ? 'YOU' : _esc(msg.sender_name || 'AGENT');
  return `<div class="cc-chat-msg cc-chat-msg--${isUser ? 'user' : 'assistant'}">
  <div class="cc-chat-msg-meta">
    <span class="cc-chat-msg-role" style="${agentColor ? `color:${agentColor}` : ''}">${senderLabel}</span>
    ${ts ? `<span class="cc-chat-msg-ts">${_esc(ts)}</span>` : ''}
  </div>
  <div class="cc-chat-msg-content">${_esc(msg.content)}</div>
</div>`;
}

function _agentAccent(name) {
  const MAP = {
    ARCHITECT:'#3498db', CODER:'#3498db', TESTER:'#3498db', RESEARCHER:'#3498db', REVIEWER:'#3498db',
    SECURITY:'#e74c3c',
    ORCHESTRATOR:'#e67e22', DEVOPS:'#e67e22', DEBUGGER:'#e67e22', PLANNER:'#e67e22',
    'DATA-ANALYST':'#2ecc71', LIBRARIAN:'#2ecc71', OPTIMIZER:'#2ecc71',
    SCRIBE:'#9b59b6', DESIGNER:'#9b59b6', PROMPTSMITH:'#9b59b6',
  };
  return MAP[(name || '').toUpperCase()] || 'rgba(197,201,208,0.6)';
}

// ---- Room chat view ----

function _buildRoomChatView(room) {
  const participants = (room.participant_ids || []).map(id => {
    const a = _agentById(id);
    return a ? `<span class="cc-room-participant-chip" style="border-color:${_agentAccent(a.name)};color:${_agentAccent(a.name)}">${_esc(a.name)}</span>` : '';
  }).join('');

  return `
<div class="cc-agents-tab cc-room-chat" id="cc-room-chat">
  <div class="cc-agent-chat-header">
    <button class="cc-chat-back-btn">← Rooms</button>
    <span class="cc-agent-chat-name">${_esc(room.name)}</span>
    <div class="cc-room-participants">${participants}</div>
    <button class="cc-room-chat-clear-btn" title="Clear messages">Clear</button>
  </div>
  <div class="cc-chat-messages" id="cc-room-messages">
    <div class="cc-empty">Loading…</div>
  </div>
  <div class="cc-chat-input-row">
    <textarea class="cc-chat-input" id="cc-room-input"
      placeholder="Message the room… (Ctrl+Enter to send)" rows="2"></textarea>
    <button class="cc-chat-send-btn" id="cc-room-send-btn">Send</button>
  </div>
</div>`.trim();
}

// ---- SSE streaming with route event ----

async function _streamRoom(body, messagesEl) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
  let currentBubble = null;
  let currentContent = null;

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
      if (raw === '[DONE]') { if (currentContent) currentContent.classList.remove('cc-chat-streaming'); return; }

      if (eventType === 'route') {
        // Create agent bubble
        try {
          const { agent } = JSON.parse(raw);
          const color = _agentAccent(agent);
          const wrap = document.createElement('div');
          wrap.innerHTML = `<div class="cc-chat-msg cc-chat-msg--assistant">
  <div class="cc-chat-msg-meta"><span class="cc-chat-msg-role" style="color:${color}">${_esc(agent)}</span></div>
  <div class="cc-chat-msg-content cc-chat-streaming"></div>
</div>`;
          currentBubble = wrap.firstChild;
          currentContent = currentBubble.querySelector('.cc-chat-msg-content');
          messagesEl.appendChild(currentBubble);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch (_) {}
        eventType = 'message'; continue;
      }

      if (eventType === 'error') {
        if (currentContent) {
          currentContent.textContent = `[Error] ${raw}`;
          currentContent.classList.remove('cc-chat-streaming');
          currentContent.classList.add('cc-chat-error');
        }
        eventType = 'message'; continue;
      }

      if (currentContent) {
        try {
          const obj = JSON.parse(raw);
          if (obj.type === 'usage') continue;
          currentContent.textContent += obj.delta || obj.text || obj.content || '';
        } catch (_) { currentContent.textContent += raw; }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      eventType = 'message';
    }
  }
  if (currentContent) currentContent.classList.remove('cc-chat-streaming');
}

// ---- Open a room (chat view) ----

async function _openRoom(container, room) {
  container.innerHTML = _buildRoomChatView(room);
  const messagesEl = container.querySelector('#cc-room-messages');
  const input      = container.querySelector('#cc-room-input');
  const sendBtn    = container.querySelector('#cc-room-send-btn');
  const backBtn    = container.querySelector('.cc-chat-back-btn');
  const clearBtn   = container.querySelector('.cc-room-chat-clear-btn');

  backBtn?.addEventListener('click', async () => {
    container.innerHTML = buildRoomsTab();
    await loadRooms(container);
  });

  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear all messages in this room?')) return;
    try {
      await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
      // Recreate fresh room — server deletes, so just reload list
      container.innerHTML = buildRoomsTab();
      await loadRooms(container);
    } catch (e) { alert(`Failed: ${e.message}`); }
  });

  // Load history
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`);
    if (res.ok) {
      const data = await res.json();
      const msgs = data.messages || [];
      if (!msgs.length) {
        messagesEl.innerHTML = '<div class="cc-empty">No messages yet — send the first one.</div>';
      } else {
        messagesEl.innerHTML = msgs.map(_roomMsgBubble).join('');
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }
  } catch (_) {
    messagesEl.innerHTML = '<div class="cc-empty">Could not load messages.</div>';
  }

  async function _sendMsg() {
    const text = input?.value?.trim();
    if (!text) return;
    messagesEl.insertAdjacentHTML('beforeend', _roomMsgBubble({
      role: 'user', sender_name: 'USER', content: text, timestamp: null,
    }));
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '…';
    messagesEl.scrollTop = messagesEl.scrollHeight;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await _streamRoom(res.body, messagesEl);
    } catch (e) {
      messagesEl.insertAdjacentHTML('beforeend', `<div class="cc-chat-error" style="font-size:9px;padding:4px 0">Error: ${_esc(e.message)}</div>`);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  sendBtn?.addEventListener('click', _sendMsg);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _sendMsg(); }
  });
  input?.focus();
}

// ---- Room list view ----

async function _loadRoomList(container) {
  const grid   = container.querySelector('#cc-rooms-grid');
  const countEl = container.querySelector('#cc-rooms-count');
  if (!grid) return;

  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { rooms = [] } = await res.json();
    if (countEl) countEl.textContent = rooms.length;
    if (!rooms.length) {
      grid.innerHTML = '<div class="cc-empty">No rooms yet — create one above.</div>';
      return;
    }
    grid.innerHTML = rooms.map(_roomCard).join('');
    rooms.forEach(room => {
      const openBtn   = grid.querySelector(`.cc-room-open-btn[data-room-id="${room.id}"]`);
      const deleteBtn = grid.querySelector(`.cc-room-delete-btn[data-room-id="${room.id}"]`);
      openBtn?.addEventListener('click', () => _openRoom(container, room));
      deleteBtn?.addEventListener('click', async () => {
        if (!confirm(`Delete room "${room.name}"?`)) return;
        await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
        await _loadRoomList(container);
      });
    });
  } catch (e) {
    grid.innerHTML = `<div class="cc-empty">Could not load rooms — ${_esc(e.message)}</div>`;
  }
}

function _wireNewRoomForm(container) {
  const form      = container.querySelector('#cc-room-new-form');
  const createBtn = container.querySelector('#cc-room-create-btn');
  const cancelBtn = container.querySelector('#cc-room-cancel-btn');
  const msgEl     = container.querySelector('#cc-room-create-msg');
  const newBtn    = container.querySelector('#cc-rooms-new-btn');

  newBtn?.addEventListener('click', () => {
    if (!form) return;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  cancelBtn?.addEventListener('click', () => { if (form) form.style.display = 'none'; });

  createBtn?.addEventListener('click', async () => {
    const name = container.querySelector('#cc-room-name-input')?.value?.trim();
    const checked = [...container.querySelectorAll('.cc-room-agent-cb:checked')].map(cb => cb.value);
    if (!name)           { if (msgEl) msgEl.textContent = 'Room name is required'; return; }
    if (!checked.length) { if (msgEl) msgEl.textContent = 'Select at least one agent'; return; }
    createBtn.disabled = true;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, participant_ids: checked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (form) form.style.display = 'none';
      if (msgEl) msgEl.textContent = '';
      await _loadRoomList(container);
    } catch (e) {
      if (msgEl) msgEl.textContent = `Error: ${e.message}`;
    } finally {
      createBtn.disabled = false;
    }
  });
}

// ---- Public API ----

export function buildRoomsTab() {
  return `
<div class="cc-agents-tab cc-rooms-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">CONFERENCE ROOMS</span>
    <span class="cc-agents-tab-count" id="cc-rooms-count">—</span>
    <button class="cc-ag-new-btn" id="cc-rooms-new-btn">+ New Room</button>
  </div>
  <div id="cc-room-new-form-mount"></div>
  <div class="cc-ag-grid" id="cc-rooms-grid">
    <div class="cc-empty">Loading rooms…</div>
  </div>
</div>`.trim();
}

export async function loadRooms(container) {
  _agentCache = [];  // Reset cache on each mount
  await _ensureAgents();

  // Build and inject new room form
  const mount = container.querySelector('#cc-room-new-form-mount');
  if (mount) {
    mount.innerHTML = _newRoomForm(_agentCache);
    _wireNewRoomForm(container);
  }

  await _loadRoomList(container);
}
