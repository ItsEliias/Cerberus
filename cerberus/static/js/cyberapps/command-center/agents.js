/**
 * agents.js — AGENTS tab for Command Center.
 * Variant A — Dense Roster Table: compact columnar rows grouped by category,
 * expand-on-click detail panel with inline invoke + edit + memory.
 */

import { openAgentChat } from './chat.js';

// ---------------------------------------------------------------------------
// Voice picker — lazily fetched from /api/tts/voices, cached for session
// ---------------------------------------------------------------------------

let _voicesCache = null;   // null = not yet fetched; [] = fetched (may be empty)
let _voicesFetch = null;   // in-flight promise dedup

async function _getVoices() {
  if (_voicesCache !== null) return _voicesCache;
  if (_voicesFetch) return _voicesFetch;
  _voicesFetch = fetch('/api/tts/voices', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : { voices: [] })
    .then(d => { _voicesCache = d.voices || []; _voicesFetch = null; return _voicesCache; })
    .catch(() => { _voicesCache = []; _voicesFetch = null; return _voicesCache; });
  return _voicesFetch;
}

async function _populateVoiceSelect(selectEl, currentVoice) {
  const voices = await _getVoices();
  const prev = selectEl.value;
  selectEl.innerHTML = '<option value="">— none —</option>' +
    voices.map(v => {
      const label = `${v.name} (${v.lang}, ${v.gender})`;
      const sel   = v.id === (currentVoice || prev) ? ' selected' : '';
      return `<option value="${_esc(v.id)}"${sel}>${_esc(label)}</option>`;
    }).join('');
  if (!voices.length) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'Kokoro not installed — enter voice ID manually';
    selectEl.appendChild(opt);
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

const STATUS_META = {
  active:  { label: 'ACTIVE'   },
  idle:    { label: 'IDLE'     },
  alert:   { label: 'ALERT'    },
  standby: { label: 'STANDBY'  },
  ready:   { label: 'READY'    },
};
function _statusLabel(status) {
  return (STATUS_META[status] || { label: (status || 'UNKNOWN').toUpperCase() }).label;
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_MAP = {
  ORCHESTRATOR: 'COORDINATOR',
  ARCHITECT: 'CORE', CODER: 'CORE', TESTER: 'CORE', RESEARCHER: 'CORE', REVIEWER: 'CORE',
  SECURITY: 'SECURITY',
  DEVOPS: 'OPS', DEBUGGER: 'OPS', PLANNER: 'OPS',
  'DATA-ANALYST': 'DATA', LIBRARIAN: 'DATA', OPTIMIZER: 'DATA',
  SCRIBE: 'COMMS', DESIGNER: 'COMMS', PROMPTSMITH: 'COMMS',
};

const CAT_ACCENT = {
  COORDINATOR: '#c0392b',
  CORE:        '#3498db',
  SECURITY:    '#e74c3c',
  OPS:         '#e67e22',
  DATA:        '#2ecc71',
  COMMS:       '#9b59b6',
  CUSTOM:      'rgba(197,201,208,0.45)',
};

const CAT_ORDER = ['COORDINATOR', 'CORE', 'SECURITY', 'OPS', 'DATA', 'COMMS', 'CUSTOM'];

function _getCategory(name) {
  return CATEGORY_MAP[(name || '').toUpperCase()] || 'CUSTOM';
}

const GLYPH_MAP = {
  ARCHITECT:     '🏗',
  CODER:         '⚡',
  TESTER:        '🧪',
  RESEARCHER:    '🔍',
  REVIEWER:      '✅',
  SECURITY:      '🛡',
  ORCHESTRATOR:  '🎯',
  DEVOPS:        '⚙',
  DEBUGGER:      '🐛',
  PLANNER:       '📋',
  'DATA-ANALYST':'📊',
  LIBRARIAN:     '📚',
  OPTIMIZER:     '⚡',
  SCRIBE:        '✍',
  DESIGNER:      '🎨',
  PROMPTSMITH:   '🔧',
};


function _groupAgents(agents) {
  const groups = {};
  for (const a of agents) {
    const cat = _getCategory(a.name);
    (groups[cat] = groups[cat] || []).push(a);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Row HTML
// ---------------------------------------------------------------------------

function _agentRow(agent) {
  const id     = _esc(agent.id);
  const status = agent.status || 'idle';
  const glyph  = _esc(agent.avatar || GLYPH_MAP[(agent.name || '').toUpperCase()] || (agent.name || '?')[0]);
  const score  = agent.score > 0 ? _esc(agent.score) : '—';
  const accent = CAT_ACCENT[_getCategory(agent.name)] || CAT_ACCENT.CUSTOM;
  return `
<div class="cc-agent-row" data-id="${id}" data-status="${_esc(status)}" data-agent-name="${_esc(agent.name || '')}" data-agent-avatar="${_esc(agent.avatar || '')}" data-cat-accent="${_esc(accent)}" data-tts-voice="${_esc(agent.tts_voice || '')}">
  <span class="cc-status-pip ${_esc(status)}"></span>
  <span class="cc-row-sigil">${glyph}</span>
  <span class="cc-row-name">${_esc(agent.name || agent.id)}</span>
  <span class="cc-row-role">${_esc(agent.role || agent.agent_type || '—')}</span>
  <span class="cc-row-model">${_esc(agent.model_alias || '—')}</span>
  <span class="cc-row-score">${score}</span>
  <span class="cc-row-actions">
    <button class="cc-row-btn cc-row-btn-chat">Chat</button>
    <button class="cc-row-btn cc-row-btn-invoke">Run</button>
    <div class="cc-overflow-wrap">
      <button class="cc-row-btn cc-row-btn-overflow">···</button>
      <div class="cc-overflow-menu" id="cc-ov-${id}">
        <button class="cc-overflow-item cc-ov-call">📞 Call</button>
        <button class="cc-overflow-item cc-ov-memory">◎ Memory</button>
        <button class="cc-overflow-item cc-ov-edit">✎ Edit</button>
        <button class="cc-overflow-item cc-ov-delete danger">✕ Delete</button>
      </div>
    </div>
  </span>
</div>`.trim();
}

function _agentDetail(agent) {
  const id     = _esc(agent.id);
  const status = agent.status || 'idle';
  const label  = _statusLabel(status);
  const inTok  = agent.total_input_tokens  || 0;
  const outTok = agent.total_output_tokens || 0;
  const lastAt = agent.last_active_at
    ? new Date(agent.last_active_at + 'Z').toLocaleString() : null;
  const snip   = (agent.system_prompt || '').slice(0, 180);
  const more   = (agent.system_prompt || '').length > 180;
  return `
<div class="cc-agent-detail" id="cc-detail-${id}">
  <div class="cc-detail-grid">
    <div class="cc-detail-section">
      <div class="cc-detail-header-row">
        <span class="cc-detail-status ${_esc(status)}">● ${label}</span>
        <span class="cc-detail-tokens">↑ ${inTok.toLocaleString()} ↓ ${outTok.toLocaleString()}</span>
        ${lastAt ? `<span class="cc-detail-last-active">${_esc(lastAt)}</span>` : ''}
      </div>
      <div class="cc-detail-label">System Prompt</div>
      <div class="cc-detail-prompt">${_esc(snip)}${more ? '…' : ''}</div>
    </div>
    <div class="cc-detail-section">
      <div class="cc-detail-label">Quick Actions</div>
      <div class="cc-detail-actions">
        <button class="cc-detail-btn cc-detail-btn-primary cc-detail-chat-btn">Chat ›</button>
        <button class="cc-detail-btn cc-detail-btn-primary cc-detail-invoke-btn">Invoke ›</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-call-btn">📞 Call</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-memory-btn">◎ Memory</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-edit-btn">✎ Edit</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-btn-danger cc-detail-delete-btn">✕ Del</button>
      </div>
      <div class="cc-ag-invoke-form" id="cc-ag-invoke-${id}" style="display:none">
        <textarea class="cc-ag-invoke-input" placeholder="Enter prompt…" rows="3"></textarea>
        <div class="cc-ag-invoke-actions">
          <button class="cc-ag-submit-btn" data-agent-id="${id}">Send</button>
          <button class="cc-ag-cancel-btn" data-agent-id="${id}">Cancel</button>
        </div>
        <div class="cc-ag-result" id="cc-ag-result-${id}"></div>
      </div>
    </div>
  </div>
  <div class="cc-ag-memory-panel" id="cc-ag-memory-${id}" style="display:none">
    <div class="cc-ag-memory-header">
      <span class="cc-ag-memory-title">AGENT MEMORY</span>
      <button class="cc-ag-memory-close-btn" data-agent-id="${id}">✕</button>
    </div>
    <div class="cc-ag-memory-list" id="cc-ag-memory-list-${id}"></div>
  </div>
  <div class="cc-ag-edit-form" id="cc-ag-edit-${id}" style="display:none">
    <label>Avatar (emoji)</label>
    <input class="cc-ag-edit-avatar"     value="${_esc(agent.avatar || '')}" placeholder="🤖" maxlength="4">
    <label>Name</label>
    <input class="cc-ag-edit-name"       value="${_esc(agent.name || '')}" placeholder="Agent name">
    <label>Role</label>
    <input class="cc-ag-edit-role"       value="${_esc(agent.role || '')}" placeholder="e.g. coder">
    <label>Type</label>
    <input class="cc-ag-edit-agent-type" value="${_esc(agent.agent_type || '')}" placeholder="e.g. backend-dev">
    <label>Model alias</label>
    <input class="cc-ag-edit-model"      value="${_esc(agent.model_alias || 'default')}" placeholder="default">
    <label>TTS voice (optional)</label>
    <select class="cc-ag-edit-tts-voice" data-current="${_esc(agent.tts_voice || '')}">
      <option value="">— loading voices… —</option>
    </select>
    <label>System prompt</label>
    <textarea class="cc-ag-edit-prompt" rows="5">${_esc(agent.system_prompt || '')}</textarea>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-save-btn"    data-agent-id="${id}">Save</button>
      <button class="cc-ag-discard-btn" data-agent-id="${id}">Cancel</button>
    </div>
    <div class="cc-ag-edit-msg" id="cc-ag-edit-msg-${id}"></div>
  </div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function _createForm() {
  return `
<div class="cc-ag-create-form" id="cc-ag-create-form" style="display:none">
  <div class="cc-ag-create-title">New Agent</div>
  <label>Avatar (emoji)</label>
  <input id="cc-create-avatar"  placeholder="🤖" maxlength="4">
  <label>Name <span class="cc-req">*</span></label>
  <input id="cc-create-name"    placeholder="AGENT-NAME">
  <label>Role <span class="cc-req">*</span></label>
  <input id="cc-create-role"    placeholder="e.g. coder">
  <label>Agent type <span class="cc-req">*</span></label>
  <input id="cc-create-type"    placeholder="e.g. backend-dev">
  <label>Model alias</label>
  <input id="cc-create-model"   placeholder="default" value="default">
  <label>System prompt <span class="cc-req">*</span></label>
  <textarea id="cc-create-prompt" rows="5" placeholder="You are …"></textarea>
  <div class="cc-ag-invoke-actions">
    <button id="cc-create-submit">Create</button>
    <button id="cc-create-cancel">Cancel</button>
  </div>
  <div id="cc-create-msg" class="cc-ag-edit-msg"></div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _toggleDetail(row, detail) {
  const open = detail.classList.toggle('open');
  row.classList.toggle('expanded', open);
  row.classList.toggle('is-active', open);
}

function _openChat(container, row, agentId) {
  const name   = row.dataset.agentName   || agentId;
  const avatar = row.dataset.agentAvatar || '';
  const accent = row.dataset.catAccent   || 'rgba(197,201,208,0.5)';
  const voice  = row.dataset.ttsVoice    || '';
  openAgentChat(container, agentId, name, avatar, accent, voice);
}

async function _openCall(container, row, agentId) {
  const name   = row.dataset.agentName   || agentId;
  const avatar = row.dataset.agentAvatar || '';
  const accent = row.dataset.catAccent   || 'rgba(197,201,208,0.5)';
  const voice  = row.dataset.ttsVoice    || '';
  const { openVoiceCall } = await import('./voice.js');
  openVoiceCall(container, agentId, name, avatar, accent, voice);
}

// ---------------------------------------------------------------------------
// Voice picker init — called once when the edit form is first shown
// ---------------------------------------------------------------------------

function _initEditVoicePicker(editForm) {
  const sel = editForm.querySelector('.cc-ag-edit-tts-voice');
  if (!sel || sel.dataset.voiceLoaded) return;
  sel.dataset.voiceLoaded = '1';
  const current = sel.dataset.current || '';
  _populateVoiceSelect(sel, current);
}

// ---------------------------------------------------------------------------
// Wire a single row + detail pair
// ---------------------------------------------------------------------------

function _wireRow(container, agentId) {
  const row    = container.querySelector(`.cc-agent-row[data-id="${agentId}"]`);
  const detail = container.querySelector(`#cc-detail-${agentId}`);
  if (!row || !detail) return;

  // Row body click → expand/collapse detail
  row.addEventListener('click', e => {
    if (e.target.closest('.cc-row-actions')) return;
    _toggleDetail(row, detail);
  });

  // Row: Chat
  row.querySelector('.cc-row-btn-chat')?.addEventListener('click', () => {
    _openChat(container, row, agentId);
  });

  // Row: Run → open detail + toggle invoke form
  row.querySelector('.cc-row-btn-invoke')?.addEventListener('click', () => {
    if (!detail.classList.contains('open')) _toggleDetail(row, detail);
    const invForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (invForm) invForm.style.display = invForm.style.display === 'none' ? 'block' : 'none';
  });

  // Row: Overflow menu
  const overflowBtn  = row.querySelector('.cc-row-btn-overflow');
  const overflowMenu = row.querySelector(`#cc-ov-${agentId}`);
  if (overflowBtn && overflowMenu) {
    overflowBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = overflowMenu.classList.toggle('open');
      if (isOpen) {
        const close = () => { overflowMenu.classList.remove('open'); document.removeEventListener('click', close); };
        document.addEventListener('click', close);
      }
    });
    overflowMenu.querySelector('.cc-ov-call')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      _openCall(container, row, agentId);
    });
    overflowMenu.querySelector('.cc-ov-memory')?.addEventListener('click', async () => {
      overflowMenu.classList.remove('open');
      if (!detail.classList.contains('open')) _toggleDetail(row, detail);
      const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
      const memList  = detail.querySelector(`#cc-ag-memory-list-${agentId}`);
      if (!memPanel) return;
      const wasOpen = memPanel.style.display !== 'none';
      memPanel.style.display = wasOpen ? 'none' : 'block';
      if (!wasOpen && memList) await _loadAgentMemories(agentId, memList);
    });
    overflowMenu.querySelector('.cc-ov-edit')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      if (!detail.classList.contains('open')) _toggleDetail(row, detail);
      const editForm = detail.querySelector(`#cc-ag-edit-${agentId}`);
      if (editForm) {
        const opening = editForm.style.display === 'none';
        editForm.style.display = opening ? 'block' : 'none';
        if (opening) _initEditVoicePicker(editForm);
      }
    });
    overflowMenu.querySelector('.cc-ov-delete')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      _deleteAgent(agentId, row);
    });
  }

  // Detail: Chat
  detail.querySelector('.cc-detail-chat-btn')?.addEventListener('click', () => {
    _openChat(container, row, agentId);
  });

  // Detail: Invoke toggle
  detail.querySelector('.cc-detail-invoke-btn')?.addEventListener('click', () => {
    const invForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (invForm) invForm.style.display = invForm.style.display === 'none' ? 'block' : 'none';
  });

  // Detail: Call
  detail.querySelector('.cc-detail-call-btn')?.addEventListener('click', () => {
    _openCall(container, row, agentId);
  });

  // Detail: Memory toggle
  detail.querySelector('.cc-detail-memory-btn')?.addEventListener('click', async () => {
    const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
    const memList  = detail.querySelector(`#cc-ag-memory-list-${agentId}`);
    if (!memPanel) return;
    const wasOpen = memPanel.style.display !== 'none';
    memPanel.style.display = wasOpen ? 'none' : 'block';
    if (!wasOpen && memList) await _loadAgentMemories(agentId, memList);
  });

  // Detail: Edit toggle
  detail.querySelector('.cc-detail-edit-btn')?.addEventListener('click', () => {
    const editForm = detail.querySelector(`#cc-ag-edit-${agentId}`);
    const invForm  = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (editForm) {
      const opening = editForm.style.display === 'none';
      editForm.style.display = opening ? 'block' : 'none';
      if (opening) _initEditVoicePicker(editForm);
    }
    if (invForm) invForm.style.display = 'none';
  });

  // Detail: Delete
  detail.querySelector('.cc-detail-delete-btn')?.addEventListener('click', () => {
    _deleteAgent(agentId, row);
  });

  // Invoke form
  const invokeForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
  const textarea   = invokeForm?.querySelector('.cc-ag-invoke-input');
  const result     = detail.querySelector(`#cc-ag-result-${agentId}`);
  const submitBtn  = invokeForm?.querySelector('.cc-ag-submit-btn');
  const cancelBtn  = invokeForm?.querySelector('.cc-ag-cancel-btn');
  submitBtn?.addEventListener('click', () => _invokeAgent(agentId, textarea, result, submitBtn));
  cancelBtn?.addEventListener('click', () => {
    if (invokeForm) invokeForm.style.display = 'none';
    if (result)     result.textContent = '';
  });

  // Edit form
  const editForm   = detail.querySelector(`#cc-ag-edit-${agentId}`);
  const saveBtn    = editForm?.querySelector('.cc-ag-save-btn');
  const discardBtn = editForm?.querySelector('.cc-ag-discard-btn');
  saveBtn?.addEventListener('click', () => _saveAgent(agentId, row, detail, editForm));
  discardBtn?.addEventListener('click', () => { if (editForm) editForm.style.display = 'none'; });

  // Memory panel close
  detail.querySelector('.cc-ag-memory-close-btn')?.addEventListener('click', () => {
    const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
    if (memPanel) memPanel.style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Save / Delete / Invoke
// ---------------------------------------------------------------------------

async function _saveAgent(agentId, row, detail, editForm) {
  const msgEl = editForm.querySelector(`#cc-ag-edit-msg-${agentId}`);
  const body = {
    name:          editForm.querySelector('.cc-ag-edit-name')?.value?.trim(),
    role:          editForm.querySelector('.cc-ag-edit-role')?.value?.trim(),
    agent_type:    editForm.querySelector('.cc-ag-edit-agent-type')?.value?.trim(),
    model_alias:   editForm.querySelector('.cc-ag-edit-model')?.value?.trim() || 'default',
    system_prompt: editForm.querySelector('.cc-ag-edit-prompt')?.value ?? '',
    avatar:        editForm.querySelector('.cc-ag-edit-avatar')?.value?.trim() || '',
    tts_voice:     editForm.querySelector('.cc-ag-edit-tts-voice')?.value?.trim() || '',
  };
  if (!body.name) { if (msgEl) msgEl.textContent = 'Name is required'; return; }
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    const nameEl  = row.querySelector('.cc-row-name');
    const roleEl  = row.querySelector('.cc-row-role');
    const modelEl = row.querySelector('.cc-row-model');
    const sigilEl = row.querySelector('.cc-row-sigil');
    if (nameEl)  nameEl.textContent  = data.name  || '';
    if (roleEl)  roleEl.textContent  = data.role  || data.agent_type || '—';
    if (modelEl) modelEl.textContent = data.model_alias || 'default';
    if (sigilEl) sigilEl.textContent = data.avatar || (data.name || '?')[0];
    const promptEl = detail.querySelector('.cc-detail-prompt');
    if (promptEl && data.system_prompt != null) {
      const snip = (data.system_prompt || '').slice(0, 180);
      promptEl.textContent = snip + ((data.system_prompt || '').length > 180 ? '…' : '');
    }
    if (data.name)           row.dataset.agentName   = data.name;
    if (data.avatar)         row.dataset.agentAvatar = data.avatar;
    if (data.tts_voice != null) row.dataset.ttsVoice = data.tts_voice;
    editForm.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  } catch (e) {
    if (msgEl) msgEl.textContent = `Error: ${e.message}`;
  }
}

async function _deleteAgent(agentId, row) {
  const name = row.querySelector('.cc-row-name')?.textContent || 'this agent';
  if (!confirm(`Delete ${name}? Seeded defaults won't come back on refresh.`)) return;
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    const detail     = document.querySelector(`#cc-detail-${agentId}`);
    const rosterBody = row.closest('#cc-ag-grid');
    row.remove();
    detail?.remove();
    if (rosterBody) {
      rosterBody.querySelectorAll('.cc-cat-section').forEach(sec => {
        if (!sec.querySelector('.cc-agent-row')) sec.remove();
      });
      const countEl = document.getElementById('cc-ag-count');
      if (countEl) countEl.textContent = rosterBody.querySelectorAll('.cc-agent-row').length;
    }
  } catch (e) {
    alert(`Could not delete agent: ${e.message}`);
  }
}

async function _invokeAgent(agentId, textarea, resultEl, submitBtn) {
  const prompt = textarea?.value?.trim();
  if (!prompt) return;
  resultEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Running…';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      await _streamSSE(res.body, resultEl);
    } else {
      const data = await res.json();
      resultEl.textContent = data.response || data.result || JSON.stringify(data);
    }
  } catch (e) {
    resultEl.textContent = `Error: ${e.message}`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';
  }
}

async function _streamSSE(body, resultEl) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
  resultEl.textContent = '';
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
      if (raw === '[DONE]') { eventType = 'message'; return; }
      if (eventType === 'error') {
        try {
          const obj = JSON.parse(raw);
          resultEl.innerHTML += `<span style="color:var(--cc-crit,#f66)">[Error] ${_esc(obj.error || raw)}</span>`;
        } catch (_) {
          resultEl.innerHTML += `<span style="color:var(--cc-crit,#f66)">[Error] ${_esc(raw)}</span>`;
        }
        eventType = 'message';
        continue;
      }
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'usage') continue;
        resultEl.textContent += obj.delta || obj.text || obj.content || '';
      } catch (_) {
        resultEl.textContent += raw;
      }
      eventType = 'message';
    }
  }
}

// ---------------------------------------------------------------------------
// Agent memory panel
// ---------------------------------------------------------------------------

async function _loadAgentMemories(agentId, listEl) {
  listEl.innerHTML = '<div class="cc-empty cc-ag-mem-loading">Loading…</div>';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memories`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { memories = [] } = await res.json();
    if (!memories.length) {
      listEl.innerHTML = '<div class="cc-empty">No memories yet. Start chatting to build agent memory.</div>';
      return;
    }
    listEl.innerHTML = '';
    for (const m of memories) {
      const row = document.createElement('div');
      row.className = 'cc-ag-mem-row';
      row.dataset.memId = m.id;
      const cat = m.category ? `<span class="cc-ag-mem-cat">${_esc(m.category)}</span>` : '';
      row.innerHTML = `
        <div class="cc-ag-mem-text">${_esc(m.text)}${cat}</div>
        <button class="cc-ag-mem-del-btn" title="Delete memory">✕</button>
      `.trim();
      row.querySelector('.cc-ag-mem-del-btn')?.addEventListener('click', async () => {
        try {
          const dr = await fetch(
            `/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(m.id)}`,
            { method: 'DELETE' },
          );
          if (!dr.ok) throw new Error(`HTTP ${dr.status}`);
          row.remove();
          if (!listEl.querySelector('.cc-ag-mem-row')) {
            listEl.innerHTML = '<div class="cc-empty">No memories yet. Start chatting to build agent memory.</div>';
          }
        } catch (_) {
          row.querySelector('.cc-ag-mem-del-btn').textContent = '!';
        }
      });
      listEl.appendChild(row);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="cc-empty">Could not load memories — ${_esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Create form wiring
// ---------------------------------------------------------------------------

function _wireCreateForm(container, onCreated) {
  const form     = container.querySelector('#cc-ag-create-form');
  const submitEl = container.querySelector('#cc-create-submit');
  const cancelEl = container.querySelector('#cc-create-cancel');
  const msgEl    = container.querySelector('#cc-create-msg');

  cancelEl?.addEventListener('click', () => {
    form.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  });

  submitEl?.addEventListener('click', async () => {
    const body = {
      name:          (container.querySelector('#cc-create-name')?.value  || '').trim(),
      role:          (container.querySelector('#cc-create-role')?.value  || '').trim(),
      agent_type:    (container.querySelector('#cc-create-type')?.value  || '').trim(),
      model_alias:   (container.querySelector('#cc-create-model')?.value || 'default').trim(),
      system_prompt: (container.querySelector('#cc-create-prompt')?.value || ''),
      avatar:        (container.querySelector('#cc-create-avatar')?.value || '').trim(),
    };
    if (!body.name || !body.role || !body.agent_type || !body.system_prompt.trim()) {
      if (msgEl) msgEl.textContent = 'Name, role, type and system prompt are required';
      return;
    }
    submitEl.disabled = true;
    try {
      const res = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      form.style.display = 'none';
      if (msgEl) msgEl.textContent = '';
      ['#cc-create-name','#cc-create-role','#cc-create-type','#cc-create-prompt','#cc-create-avatar']
        .forEach(sel => { const el = container.querySelector(sel); if (el) el.value = ''; });
      const modelEl = container.querySelector('#cc-create-model');
      if (modelEl) modelEl.value = 'default';
      if (onCreated) onCreated();
    } catch (e) {
      if (msgEl) msgEl.textContent = `Error: ${e.message}`;
    } finally {
      submitEl.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

function _applyFilter(container, filter) {
  container.querySelectorAll('.cc-agent-row').forEach(row => {
    const visible = filter === 'all' || (row.dataset.status || 'idle') === filter;
    row.classList.toggle('cc-row-hidden', !visible);
    const id     = row.dataset.id;
    const detail = id ? container.querySelector(`#cc-detail-${id}`) : null;
    if (detail) detail.classList.toggle('cc-row-hidden', !visible);
  });
  container.querySelectorAll('.cc-cat-section').forEach(sec => {
    const hasVisible = [...sec.querySelectorAll('.cc-agent-row')]
      .some(r => !r.classList.contains('cc-row-hidden'));
    sec.classList.toggle('cc-row-hidden', !hasVisible);
  });
}

// ---------------------------------------------------------------------------
// Grid refresh
// ---------------------------------------------------------------------------

async function _refreshGrid(container) {
  const rosterBody = container.querySelector('#cc-ag-grid');
  const countEl    = container.querySelector('#cc-ag-count');
  if (!rosterBody) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { agents = [] } = await res.json();
    if (!agents.length) {
      rosterBody.innerHTML = '<div class="cc-empty">No agents registered.</div>';
      return;
    }
    if (countEl) countEl.textContent = agents.length;
    const grouped = _groupAgents(agents);
    rosterBody.innerHTML = CAT_ORDER
      .filter(cat => grouped[cat]?.length)
      .map(cat => {
        const rows = grouped[cat].map(a => _agentRow(a) + '\n' + _agentDetail(a)).join('\n');
        return `<div class="cc-cat-section" data-cat="${cat.toLowerCase()}">
<div class="cc-cat-head">
  <span class="cc-cat-head-prefix">//</span>
  <span class="cc-cat-head-label">${cat}</span>
  <span class="cc-cat-head-count">${grouped[cat].length}</span>
  <span class="cc-cat-head-chevron">›</span>
</div>
<div class="cc-cat-rows">${rows}</div>
</div>`;
      }).join('');
    container.querySelectorAll('.cc-cat-head').forEach(head => {
      head.addEventListener('click', () => head.closest('.cc-cat-section')?.classList.toggle('collapsed'));
    });
    agents.forEach(a => _wireRow(container, a.id));
  } catch (e) {
    rosterBody.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAgentsTab() {
  return `
<div class="cc-agents-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">AGENT ROSTER</span>
    <span class="cc-agents-tab-count" id="cc-ag-count">—</span>
    <div class="cc-filter-pills">
      <button class="cc-filter-pill active" data-filter="all">ALL</button>
      <button class="cc-filter-pill" data-filter="active">ACTIVE</button>
      <button class="cc-filter-pill" data-filter="idle">IDLE</button>
      <button class="cc-filter-pill" data-filter="standby">STANDBY</button>
      <button class="cc-filter-pill" data-filter="ready">READY</button>
    </div>
    <button class="cc-ag-new-btn" id="cc-ag-new-btn">+ New Agent</button>
  </div>
  ${_createForm()}
  <div class="cc-roster-col-header">
    <span></span><span></span>
    <span>Agent</span><span>Role</span><span>Model</span><span>Score</span>
    <span style="text-align:right">Actions</span>
  </div>
  <div class="cc-roster-body" id="cc-ag-grid">
    <div class="cc-empty">Loading agents…</div>
  </div>
</div>`.trim();
}

export async function loadAgents(container) {
  const newBtn     = container.querySelector('#cc-ag-new-btn');
  const createForm = container.querySelector('#cc-ag-create-form');
  newBtn?.addEventListener('click', () => {
    if (!createForm) return;
    createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelectorAll('.cc-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.cc-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      _applyFilter(container, pill.dataset.filter || 'all');
    });
  });
  _wireCreateForm(container, () => _refreshGrid(container));
  await _refreshGrid(container);
}
