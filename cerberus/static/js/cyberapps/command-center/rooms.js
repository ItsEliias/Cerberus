/**
 * rooms.js — Conference Rooms tab (Phase 3).
 *
 * Exports: buildRoomsTab, loadRooms
 */

import { notifyCCComplete, requestNotifyPermission } from './cc-notify.js';

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// Agent list cache — populated once per tab mount
let _agentCache = [];

// ---- Pin storage (localStorage) ----
//
// Pinned room IDs persist in localStorage under `cerberus.rooms.pinned` as a
// JSON array. All access is wrapped in try/catch so a quota error in private
// browsing never crashes the room list. Pinned rooms sort to the top of the
// list; the pin toggle re-sorts the cards in place without re-fetching.
const PINNED_KEY = 'cerberus.rooms.pinned';

function _readPinned() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch (_) { return new Set(); }
}

function _writePinned(set) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...set])); } catch (_) {}
}

function _isPinned(roomId) { return _readPinned().has(roomId); }

function _togglePinned(roomId) {
  const set = _readPinned();
  if (set.has(roomId)) set.delete(roomId); else set.add(roomId);
  _writePinned(set);
  return set.has(roomId);
}

// Pinned IDs sort to index 0; remaining rooms keep newest-first (last_message_at
// desc). Pure — no DOM, no localStorage access — so the test runner can
// exercise it directly.
function _sortRoomsForDisplay(rooms, pinned) {
  return [...rooms].sort((a, b) => {
    const ap = pinned.has(a.id) ? 0 : 1;
    const bp = pinned.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return String(b.last_message_at || '').localeCompare(String(a.last_message_at || ''));
  });
}

// Resolve participant_ids → display names via _agentCache. Falls back to the
// raw ID when an agent row hasn't loaded (or was deleted) so the card never
// renders an empty list.
function _participantNames(room) {
  const ids = Array.isArray(room?.participant_ids) ? room.participant_ids : [];
  return ids.map(id => _agentById(id)?.name || id);
}

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

function _roomCard(room, pinned = _readPinned()) {
  const count = room.participant_ids?.length || 0;
  const lastAt = room.last_message_at
    ? new Date(room.last_message_at + 'Z').toLocaleString() : '—';
  const modeBadge = room.mode === 'open'
    ? '<span class="cc-room-mode-badge cc-room-mode-open">OPEN</span>'
    : '<span class="cc-room-mode-badge cc-room-mode-routed">ROUTED</span>';
  const isPinned = pinned.has(room.id);
  const pinTitle = isPinned ? 'Unpin room' : 'Pin room';
  const participantNames = _participantNames(room);
  const participantsLine = participantNames.length
    ? `<div class="cc-room-participants">${_esc(participantNames.join(' · '))}</div>`
    : '';
  return `
<div class="cc-room-card${isPinned ? ' cc-room-card--pinned' : ''}" data-room-id="${_esc(room.id)}" data-room-name="${_esc(room.name)}">
  <div class="cc-room-card-header">
    <span class="cc-room-name">${_esc(room.name)}</span>
    <span class="cc-room-count">${count} agent${count !== 1 ? 's' : ''}</span>
    ${modeBadge}
    <button class="cc-room-pin-btn${isPinned ? ' cc-room-pin-btn--active' : ''}" data-room-id="${_esc(room.id)}" title="${pinTitle}" aria-pressed="${isPinned}">📌</button>
  </div>
  <div class="cc-room-last">${_esc(lastAt)}</div>
  ${participantsLine}
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

// ---- Token meter helper ----

function _tokenMeter(room) {
  const total = (room.total_input_tokens || 0) + (room.total_output_tokens || 0);
  if (!total) return '';
  return `<span class="cc-room-token-meter" title="${room.total_input_tokens || 0} in / ${room.total_output_tokens || 0} out">${_fmtTokens(total)}</span>`;
}

function _fmtTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M tk`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}k tk`;
  return `${n} tk`;
}

// ---- Room chat view ----

function _buildRoomChatView(room) {
  const participants = (room.participant_ids || []).map(id => {
    const a = _agentById(id);
    return a ? `<span class="cc-room-participant-chip" style="border-color:${_agentAccent(a.name)};color:${_agentAccent(a.name)}">${_esc(a.name)}</span>` : '';
  }).join('');

  const isOpen = room.mode === 'open';
  const modeClass = isOpen ? 'cc-room-mode-open' : 'cc-room-mode-routed';
  const modeLabel = isOpen ? `OPEN (cap ${room.round_cap || 5})` : 'ROUTED';

  return `
<div class="cc-agents-tab cc-room-chat" id="cc-room-chat">
  <div class="cc-agent-chat-header">
    <button class="cc-chat-back-btn">← Rooms</button>
    <span class="cc-agent-chat-name">${_esc(room.name)}</span>
    <div class="cc-room-participants">${participants}</div>
    <button class="cc-room-mode-toggle cc-room-mode-badge ${modeClass}" data-room-id="${_esc(room.id)}" data-current-mode="${_esc(room.mode || 'routed')}" title="Click to toggle mode">${_esc(modeLabel)}</button>
    ${_tokenMeter(room)}
    <button class="cc-room-call-btn" title="Start group voice call">📞 Call</button>
    <button class="cc-room-save-preset-btn" title="Save this room composition as a preset">// SAVE CURRENT</button>
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

// ---- Continue-checkpoint prompt ----

function _insertContinuePrompt(messagesEl, roomId, rounds, cap, onContinue) {
  const el = document.createElement('div');
  el.className = 'cc-room-cap-prompt';
  el.innerHTML = `
<span class="cc-room-cap-msg">${rounds} round${rounds !== 1 ? 's' : ''} completed (cap ${cap}).</span>
<button class="cc-room-cap-yes">Continue ${cap} more</button>
<button class="cc-room-cap-no">Done</button>`.trim();
  el.querySelector('.cc-room-cap-yes').addEventListener('click', () => {
    el.remove();
    onContinue();
  });
  el.querySelector('.cc-room-cap-no').addEventListener('click', () => el.remove());
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- SSE streaming with route + cap_reached events ----

async function _streamRoom(body, messagesEl, roomId, onCapReached) {
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
      if (raw === '[DONE]') {
        if (currentContent) currentContent.classList.remove('cc-chat-streaming');
        return;
      }

      if (eventType === 'route') {
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

      if (eventType === 'cap_reached') {
        if (currentContent) currentContent.classList.remove('cc-chat-streaming');
        currentContent = null;
        try {
          const meta = JSON.parse(raw);
          if (onCapReached) onCapReached(meta);
        } catch (_) {}
        eventType = 'message'; continue;
      }

      if (eventType === 'error') {
        if (currentContent) {
          try {
            const obj = JSON.parse(raw);
            currentContent.textContent = `Error: ${obj.error || raw}`;
          } catch (_) { currentContent.textContent = `Error: ${raw}`; }
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

// ---- Mode toggle ----

async function _toggleMode(btn, container) {
  const roomId = btn.dataset.roomId;
  const current = btn.dataset.currentMode || 'routed';
  const next = current === 'routed' ? 'open' : 'routed';
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const room = await res.json();
    btn.dataset.currentMode = room.mode;
    btn.className = `cc-room-mode-toggle cc-room-mode-badge ${room.mode === 'open' ? 'cc-room-mode-open' : 'cc-room-mode-routed'}`;
    btn.textContent = room.mode === 'open' ? `OPEN (cap ${room.round_cap || 5})` : 'ROUTED';
  } catch (e) {
    console.warn('[rooms] toggle mode failed:', e.message);
  }
}

// ---- Open a room (chat view) ----

async function _openRoom(container, room) {
  // Lazy permission prompt — first user-initiated room open is the natural
  // moment to ask, mirroring the chat.js entry hook (spec step 4).
  requestNotifyPermission();

  container.innerHTML = _buildRoomChatView(room);
  const messagesEl = container.querySelector('#cc-room-messages');
  const input      = container.querySelector('#cc-room-input');
  const sendBtn    = container.querySelector('#cc-room-send-btn');
  const backBtn    = container.querySelector('.cc-chat-back-btn');
  const clearBtn   = container.querySelector('.cc-room-chat-clear-btn');
  const modeBtn    = container.querySelector('.cc-room-mode-toggle');
  const callBtn    = container.querySelector('.cc-room-call-btn');
  const saveBtn    = container.querySelector('.cc-room-save-preset-btn');

  // SAVE CURRENT — turn this room's participants into a named preset.
  // Uses prompt() so we don't have to render a modal; the preset save is
  // a low-frequency action so the UX cost is acceptable.
  saveBtn?.addEventListener('click', () => _saveRoomAsPreset(room));

  modeBtn?.addEventListener('click', () => _toggleMode(modeBtn, container));

  callBtn?.addEventListener('click', async () => {
    const { openRoomVoiceCall } = await import('./room_voice.js');
    openRoomVoiceCall(container, room);
  });

  backBtn?.addEventListener('click', async () => {
    container.innerHTML = buildRoomsTab();
    await loadRooms(container);
  });

  clearBtn?.addEventListener('click', async () => {
    if (!confirm('Clear all messages in this room?')) return;
    try {
      await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
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

  async function _doSend(endpoint, method = 'POST', payload = null) {
    sendBtn.disabled = true;
    sendBtn.textContent = '…';
    try {
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      };
      if (payload) opts.body = JSON.stringify(payload);
      const res = await fetch(endpoint, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await _streamRoom(res.body, messagesEl, room.id, (meta) => {
        _insertContinuePrompt(messagesEl, room.id, meta.rounds, meta.cap, () => {
          _doSend(`/api/rooms/${encodeURIComponent(room.id)}/continue`);
        });
      });
      notifyCCComplete({
        title: '[C]ERBERUS // COUNCIL',
        body:  `${room.name || 'Room'} round complete`,
        tag:   `cc-room-${room.id}`,
      });
    } catch (e) {
      messagesEl.insertAdjacentHTML('beforeend',
        `<div class="cc-chat-error" style="font-size:9px;padding:4px 0">Error: ${_esc(e.message)}</div>`);
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  async function _sendMsg() {
    const text = input?.value?.trim();
    if (!text) return;
    messagesEl.insertAdjacentHTML('beforeend', _roomMsgBubble({
      role: 'user', sender_name: 'USER', content: text, timestamp: null,
    }));
    input.value = '';
    messagesEl.scrollTop = messagesEl.scrollHeight;
    await _doSend(
      `/api/rooms/${encodeURIComponent(room.id)}/send`,
      'POST',
      { message: text },
    );
  }

  sendBtn?.addEventListener('click', _sendMsg);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _sendMsg(); }
  });
  input?.focus();
}

// ---- Room list view ----

// Cached room list for in-place re-sort (pin toggle) and filter without a
// network round-trip. Reset on every `_loadRoomList` call.
let _lastLoadedRooms = [];

function _renderRoomGrid(grid, container, rooms) {
  const pinned = _readPinned();
  const sorted = _sortRoomsForDisplay(rooms, pinned);
  grid.innerHTML = sorted.map(r => _roomCard(r, pinned)).join('');
  sorted.forEach(room => {
    const openBtn   = grid.querySelector(`.cc-room-open-btn[data-room-id="${room.id}"]`);
    const deleteBtn = grid.querySelector(`.cc-room-delete-btn[data-room-id="${room.id}"]`);
    const pinBtn    = grid.querySelector(`.cc-room-pin-btn[data-room-id="${room.id}"]`);
    openBtn?.addEventListener('click', () => _openRoom(container, room));
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm(`Delete room "${room.name}"?`)) return;
      await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
      await _loadRoomList(container);
    });
    pinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      _togglePinned(room.id);
      _renderRoomGrid(grid, container, _lastLoadedRooms);
      _applyRoomFilter(container);
    });
  });
}

async function _loadRoomList(container) {
  const grid    = container.querySelector('#cc-rooms-grid');
  const countEl = container.querySelector('#cc-rooms-count');
  if (!grid) return;

  try {
    const res = await fetch('/api/rooms');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { rooms = [] } = await res.json();
    if (countEl) countEl.textContent = rooms.length;
    _lastLoadedRooms = rooms;
    if (!rooms.length) {
      grid.innerHTML = '<div class="cc-empty">No rooms yet — create one above.</div>';
      return;
    }
    _renderRoomGrid(grid, container, rooms);
    _applyRoomFilter(container);
  } catch (e) {
    grid.innerHTML = `<div class="cc-empty">Could not load rooms — ${_esc(e.message)}</div>`;
  }
}

// ---- Room search filter ----
//
// Pure client-side filter on the rendered card list — case-insensitive
// substring match on room name. Empty input restores all cards. Operates by
// flipping inline `display` on `.cc-room-card` nodes so no re-render is needed.
function _applyRoomFilter(container) {
  const input = container.querySelector('#cc-rooms-filter');
  const q = (input?.value || '').trim().toLowerCase();
  const cards = container.querySelectorAll('#cc-rooms-grid .cc-room-card');
  cards.forEach(card => {
    if (!q) {
      card.style.display = '';
      return;
    }
    const name = (card.dataset.roomName || '').toLowerCase();
    card.style.display = name.includes(q) ? '' : 'none';
  });
}

function _wireRoomFilter(container) {
  const input = container.querySelector('#cc-rooms-filter');
  if (!input) return;
  input.addEventListener('input', () => _applyRoomFilter(container));
}

// ---- Preset templates ----

async function _renderTemplates(container) {
  const mount = container.querySelector('#cc-room-templates-mount');
  if (!mount) return;
  try {
    const res = await fetch('/api/rooms/templates');
    const data = await res.json();
    const templates = data.templates || [];
    mount.innerHTML = `
<div class="cc-room-templates">
  <div class="cc-section-label">// TEMPLATES</div>
  <div class="cc-room-template-grid">
    ${templates.map(t => `
      <button class="cc-room-template-card" data-id="${_esc(t.id)}"
              title="${_esc(t.description)}">
        <span class="cc-room-tmpl-icon">${_esc(t.icon)}</span>
        <span class="cc-room-tmpl-name">${_esc(t.name)}</span>
        <span class="cc-room-tmpl-agents">${_esc(t.agents.join(' · '))}</span>
      </button>`).join('')}
  </div>
</div>`.trim();
    mount.querySelectorAll('.cc-room-template-card').forEach(btn => {
      btn.dataset.originalText = btn.querySelector('.cc-room-tmpl-name')?.textContent || '';
      btn.addEventListener('click', () => _launchTemplate(container, btn.dataset.id));
    });
  } catch (_) {
    // Templates are a convenience — fail silent.
    mount.innerHTML = '';
  }
}

async function _launchTemplate(container, templateId) {
  const btn = container.querySelector(`.cc-room-template-card[data-id="${templateId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    const res = await fetch(`/api/rooms/templates/${encodeURIComponent(templateId)}/create`,
      { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    await _loadRoomList(container);
    const room = data.room;
    if (room) await _openRoom(container, room);
  } catch (_) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.originalText || ''; }
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
    const name    = container.querySelector('#cc-room-name-input')?.value?.trim();
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
  <div id="cc-room-templates-mount"></div>
  <div id="cc-room-presets-mount"></div>
  <div id="cc-room-new-form-mount"></div>
  <div class="cc-rooms-filter-row">
    <input id="cc-rooms-filter" class="cc-rooms-filter-input"
      type="text" autocomplete="off" placeholder="// filter rooms" />
  </div>
  <div class="cc-ag-grid" id="cc-rooms-grid">
    <div class="cc-empty">Loading rooms…</div>
  </div>
</div>`.trim();
}

export async function loadRooms(container) {
  _agentCache = [];
  await _ensureAgents();

  const mount = container.querySelector('#cc-room-new-form-mount');
  if (mount) {
    mount.innerHTML = _newRoomForm(_agentCache);
    _wireNewRoomForm(container);
  }

  _wireRoomFilter(container);
  await _renderTemplates(container);
  await _renderPresets(container);
  await _loadRoomList(container);
}

// ---- MY PRESETS — owner-saved compositions (CouncilPreset) -------------
//
// Sits below the hardcoded TEMPLATES strip. List comes from
// /api/council/presets; each card can LAUNCH (POST .../create-room) or
// DELETE (DELETE /api/council/presets/{id}). The SAVE CURRENT button on
// the room chat header (added in _buildRoomChatView) prompts for a name
// and POSTs the current room's participant names.

async function _renderPresets(container) {
  const mount = container.querySelector('#cc-room-presets-mount');
  if (!mount) return;
  try {
    const res = await fetch('/api/council/presets', { credentials: 'same-origin' });
    if (!res.ok) {
      // Hide the section entirely on 401/etc so a half-rendered shell
      // doesn't sit there.
      mount.innerHTML = '';
      return;
    }
    const data = await res.json();
    const presets = Array.isArray(data.presets) ? data.presets : [];
    mount.innerHTML = `
<div class="cc-room-presets">
  <div class="cc-section-label">// MY PRESETS</div>
  ${presets.length
    ? `<div class="cc-room-preset-list">
        ${presets.map(p => _presetCard(p)).join('')}
      </div>`
    : `<div class="cc-room-preset-empty">// NO SAVED PRESETS — launch a room and save it.</div>`}
</div>`.trim();
    mount.querySelectorAll('.cc-room-preset-launch').forEach(btn => {
      btn.addEventListener('click', () => _launchPreset(container, btn.dataset.id));
    });
    mount.querySelectorAll('.cc-room-preset-delete').forEach(btn => {
      btn.addEventListener('click', () => _deletePreset(container, btn.dataset.id, btn.dataset.name));
    });
  } catch (_) {
    mount.innerHTML = '';
  }
}

function _presetCard(p) {
  const name  = String(p.name || '(unnamed)');
  const count = Number(p.agent_count || 0);
  const desc  = String(p.description || '');
  const id    = String(p.id || '');
  return `
    <div class="cc-room-preset-card" data-id="${_esc(id)}">
      <div class="cc-room-preset-info">
        <span class="cc-room-preset-name" title="${_esc(desc || name)}">${_esc(name)}</span>
        <span class="cc-room-preset-count">${count} agent${count === 1 ? '' : 's'}</span>
      </div>
      <div class="cc-room-preset-actions">
        <button type="button" class="cc-room-preset-launch" data-id="${_esc(id)}">LAUNCH</button>
        <button type="button" class="cc-room-preset-delete" data-id="${_esc(id)}" data-name="${_esc(name)}">DELETE</button>
      </div>
    </div>
  `.trim();
}

async function _launchPreset(container, presetId) {
  if (!presetId) return;
  try {
    const res = await fetch(`/api/council/presets/${encodeURIComponent(presetId)}/create-room`, {
      method: 'POST', credentials: 'same-origin',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    await _loadRoomList(container);
    if (data.room) await _openRoom(container, data.room);
  } catch (e) {
    alert(`Failed to launch preset: ${e.message}`);
  }
}

async function _deletePreset(container, presetId, name) {
  if (!presetId) return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  try {
    const res = await fetch(`/api/council/presets/${encodeURIComponent(presetId)}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await _renderPresets(container);
  } catch (e) {
    alert(`Failed to delete preset: ${e.message}`);
  }
}

async function _saveRoomAsPreset(room) {
  if (!room) return;
  // Resolve participant ids → agent names via the cache loaded by loadRooms.
  // Agents present in the cache get their .name; unknown ids fall back to
  // the id string so the preset still saves (server skips at create-room
  // time if the name doesn't resolve for the current owner).
  const names = (room.participant_ids || []).map(id => {
    const a = _agentById(id);
    return (a && a.name) ? a.name : String(id);
  }).filter(Boolean);
  if (!names.length) {
    alert('Cannot save preset: room has no participants.');
    return;
  }
  const suggested = (room.name || '').split(' — ')[0] || room.name || 'My Preset';
  const presetName = prompt('Name for this preset:', suggested);
  if (!presetName || !presetName.trim()) return;

  try {
    const res = await fetch('/api/council/presets', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: presetName.trim(),
        description: `Saved from room: ${room.name}`,
        agent_names: names,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    // Best-effort UI hint — there's no toast surface in the room chat view.
    alert(`// PRESET SAVED — ${presetName.trim()}`);
  } catch (e) {
    alert(`Failed to save preset: ${e.message}`);
  }
}


// Helpers exported only for tests. Keep this at the bottom so import-time
// side effects on the rest of the module stay minimal.
export const __testables = {
  PINNED_KEY,
  _readPinned,
  _writePinned,
  _isPinned,
  _togglePinned,
  _sortRoomsForDisplay,
  _participantNames,
  _roomCard,
  _applyRoomFilter,
  _renderRoomGrid,
  _setAgentCache: (agents) => { _agentCache = agents || []; },
};
