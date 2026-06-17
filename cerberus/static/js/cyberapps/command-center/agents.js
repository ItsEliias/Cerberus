/**
 * agents.js — AGENTS/SWARM sub-tab for Command Center.
 *
 * Phase 1 — Jarvis-v2 cards, deterministic sigils, expand/details panel,
 *            grouped by category (CORE / SECURITY / OPS / DATA / COMMS / CUSTOM).
 * Phase 2 — "Chat" button on each card opens a persistent 1:1 thread (chat.js).
 */

import { openAgentChat } from './chat.js';

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

const STATUS_META = {
  active:  { cls: 'cc-ag-status--active',  label: 'ACTIVE'   },
  idle:    { cls: 'cc-ag-status--idle',    label: 'IDLE'     },
  alert:   { cls: 'cc-ag-status--alert',   label: 'ALERT'    },
  standby: { cls: 'cc-ag-status--standby', label: 'STANDBY'  },
  ready:   { cls: 'cc-ag-status--ready',   label: 'READY'    },
};

function _statusMeta(status) {
  return STATUS_META[status] || { cls: 'cc-ag-status--idle', label: (status || 'UNKNOWN').toUpperCase() };
}

// ---------------------------------------------------------------------------
// Category map
// ---------------------------------------------------------------------------

const CATEGORY_MAP = {
  ARCHITECT: 'CORE', CODER: 'CORE', TESTER: 'CORE', RESEARCHER: 'CORE', REVIEWER: 'CORE',
  SECURITY: 'SECURITY',
  ORCHESTRATOR: 'OPS', DEVOPS: 'OPS', DEBUGGER: 'OPS', PLANNER: 'OPS',
  'DATA-ANALYST': 'DATA', LIBRARIAN: 'DATA', OPTIMIZER: 'DATA',
  SCRIBE: 'COMMS', DESIGNER: 'COMMS', PROMPTSMITH: 'COMMS',
};

const CAT_ACCENT = {
  CORE:     '#3498db',
  SECURITY: '#e74c3c',
  OPS:      '#e67e22',
  DATA:     '#2ecc71',
  COMMS:    '#9b59b6',
  CUSTOM:   'rgba(197,201,208,0.45)',
};

const CAT_ORDER = ['CORE', 'SECURITY', 'OPS', 'DATA', 'COMMS', 'CUSTOM'];

function _getCategory(name) {
  return CATEGORY_MAP[(name || '').toUpperCase()] || 'CUSTOM';
}

// Deterministic color from name, styled initial sigil
function _sigil(agent) {
  let h = 0;
  const n = agent.name || '?';
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  const PALETTE = ['#2980b9','#e67e22','#27ae60','#8e44ad','#16a085','#c0392b','#d35400','#2c3e50'];
  const bg = PALETTE[h % PALETTE.length];
  const glyph = agent.avatar || n[0];
  return `<span class="cc-ag-sigil" style="background:${bg}">${_esc(glyph)}</span>`;
}

function _groupAgents(agents) {
  const groups = {};
  for (const a of agents) {
    const cat = _getCategory(a.name);
    (groups[cat] = groups[cat] || []).push(a);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Card HTML
// ---------------------------------------------------------------------------

function _agentCard(agent) {
  const { cls, label } = _statusMeta(agent.status);
  const score   = (agent.score > 0) ? `<span class="cc-ag-score">${_esc(agent.score)}</span>` : '';
  const accent  = CAT_ACCENT[_getCategory(agent.name)] || CAT_ACCENT.CUSTOM;
  const inTok   = agent.total_input_tokens  || 0;
  const outTok  = agent.total_output_tokens || 0;
  const lastAt  = agent.last_active_at
    ? new Date(agent.last_active_at + 'Z').toLocaleString() : null;
  const snip    = (agent.system_prompt || '').slice(0, 180);
  const hasMore = (agent.system_prompt || '').length > 180;
  const id      = _esc(agent.id);
  return `
<div class="cc-ag-card cc-ag-card--v2" data-agent-id="${id}" data-agent-name="${_esc(agent.name || '')}" data-agent-avatar="${_esc(agent.avatar || '')}" data-cat-accent="${accent}" style="--cat-accent:${accent}">
  <div class="jx2-bracket-tl"></div>
  <div class="jx2-bracket-br"></div>
  <div class="cc-ag-card-header">
    ${_sigil(agent)}
    <span class="cc-ag-name">${_esc(agent.name || agent.id)}</span>
    <span class="cc-ag-status ${cls}">${label}</span>
    <button class="cc-ag-expand-btn" data-target="cc-ag-details-${id}" title="Details">›</button>
  </div>
  <div class="cc-ag-card-meta">
    <span class="cc-ag-role">${_esc(agent.role || agent.agent_type || '—')}</span>
    <span class="cc-ag-type-badge">${_esc(agent.agent_type || '—')}</span>
    ${score}
  </div>
  ${agent.model_alias ? `<div class="cc-ag-model-chip">${_esc(agent.model_alias)}</div>` : ''}
  <div class="cc-ag-details" id="cc-ag-details-${id}" style="display:none">
    <div class="cc-ag-details-prompt">${_esc(snip)}${hasMore ? '…' : ''}</div>
    <div class="cc-ag-details-stats">
      <span title="input tokens">↑ ${inTok.toLocaleString()}</span>
      <span title="output tokens">↓ ${outTok.toLocaleString()}</span>
      ${lastAt ? `<span class="cc-ag-last-active">${_esc(lastAt)}</span>` : ''}
    </div>
  </div>
  <div class="cc-ag-card-actions">
    <button class="cc-ag-chat-btn"   data-agent-id="${id}">Chat</button>
    <button class="cc-ag-invoke-btn" data-agent-id="${id}">Invoke</button>
    <button class="cc-ag-edit-btn"   data-agent-id="${id}">Edit</button>
    <button class="cc-ag-delete-btn" data-agent-id="${id}">Del</button>
  </div>
  <div class="cc-ag-invoke-form" id="cc-ag-invoke-${id}" style="display:none">
    <textarea class="cc-ag-invoke-input" placeholder="Enter prompt…" rows="3"></textarea>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-submit-btn" data-agent-id="${id}">Send</button>
      <button class="cc-ag-cancel-btn" data-agent-id="${id}">Cancel</button>
    </div>
    <div class="cc-ag-result" id="cc-ag-result-${id}"></div>
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
// Wire a single card's interaction buttons
// ---------------------------------------------------------------------------

function _wireCard(container, agentId) {
  const card = container.querySelector(`.cc-ag-card[data-agent-id="${agentId}"]`);
  if (!card) return;

  const invokeBtn  = card.querySelector('.cc-ag-invoke-btn');
  const invokeForm = card.querySelector(`#cc-ag-invoke-${agentId}`);
  const submitBtn  = card.querySelector('.cc-ag-submit-btn');
  const cancelBtn  = card.querySelector('.cc-ag-cancel-btn');
  const textarea   = card.querySelector('.cc-ag-invoke-input');
  const result     = card.querySelector(`#cc-ag-result-${agentId}`);
  const editBtn    = card.querySelector('.cc-ag-edit-btn');
  const editForm   = card.querySelector(`#cc-ag-edit-${agentId}`);
  const saveBtn    = card.querySelector('.cc-ag-save-btn');
  const discardBtn = card.querySelector('.cc-ag-discard-btn');
  const deleteBtn  = card.querySelector('.cc-ag-delete-btn');
  const chatBtn    = card.querySelector('.cc-ag-chat-btn');
  const expandBtn  = card.querySelector('.cc-ag-expand-btn');
  const details    = expandBtn ? card.querySelector(`#${expandBtn.dataset.target}`) : null;

  expandBtn?.addEventListener('click', () => {
    if (!details) return;
    const open = details.style.display !== 'none';
    details.style.display = open ? 'none' : 'block';
    expandBtn.textContent = open ? '›' : '⌄';
    expandBtn.classList.toggle('cc-ag-expand-btn--open', !open);
  });

  chatBtn?.addEventListener('click', () => {
    const name   = card.dataset.agentName   || agentId;
    const avatar = card.dataset.agentAvatar || '';
    const accent = card.dataset.catAccent   || 'rgba(197,201,208,0.5)';
    openAgentChat(container, agentId, name, avatar, accent);
  });

  invokeBtn?.addEventListener('click', () => {
    invokeForm.style.display = invokeForm.style.display === 'none' ? 'block' : 'none';
    editForm.style.display = 'none';
  });
  cancelBtn?.addEventListener('click', () => { invokeForm.style.display = 'none'; result.textContent = ''; });
  submitBtn?.addEventListener('click', () => _invokeAgent(agentId, textarea, result, submitBtn));

  editBtn?.addEventListener('click', () => {
    editForm.style.display = editForm.style.display === 'none' ? 'block' : 'none';
    invokeForm.style.display = 'none';
  });
  discardBtn?.addEventListener('click', () => { editForm.style.display = 'none'; });
  saveBtn?.addEventListener('click', () => _saveAgent(agentId, card, editForm));
  deleteBtn?.addEventListener('click', () => _deleteAgent(agentId, card));
}

async function _saveAgent(agentId, card, editForm) {
  const msgEl = editForm.querySelector(`#cc-ag-edit-msg-${agentId}`);
  const body = {
    name:         editForm.querySelector('.cc-ag-edit-name')?.value?.trim(),
    role:         editForm.querySelector('.cc-ag-edit-role')?.value?.trim(),
    agent_type:   editForm.querySelector('.cc-ag-edit-agent-type')?.value?.trim(),
    model_alias:  editForm.querySelector('.cc-ag-edit-model')?.value?.trim() || 'default',
    system_prompt: editForm.querySelector('.cc-ag-edit-prompt')?.value ?? '',
    avatar:       editForm.querySelector('.cc-ag-edit-avatar')?.value?.trim() || '',
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
    const nameEl  = card.querySelector('.cc-ag-name');
    const roleEl  = card.querySelector('.cc-ag-role');
    const typeEl  = card.querySelector('.cc-ag-type-badge');
    const modelEl = card.querySelector('.cc-ag-model-chip');
    const sigilEl = card.querySelector('.cc-ag-sigil');
    if (nameEl)  nameEl.textContent  = data.name  || '';
    if (roleEl)  roleEl.textContent  = data.role  || data.agent_type || '—';
    if (typeEl)  typeEl.textContent  = data.agent_type || '—';
    if (modelEl) modelEl.textContent = data.model_alias || 'default';
    if (sigilEl) sigilEl.textContent = data.avatar || (data.name || '?')[0];
    editForm.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  } catch (e) {
    if (msgEl) msgEl.textContent = `Error: ${e.message}`;
  }
}

async function _deleteAgent(agentId, card) {
  const name = card.querySelector('.cc-ag-name')?.textContent || 'this agent';
  if (!confirm(`Delete ${name}? Seeded defaults won't come back on refresh.`)) return;
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    card.remove();
    const grid = document.getElementById('cc-ag-grid');
    if (grid) {
      grid.querySelectorAll('.cc-ag-category-section').forEach(sec => {
        if (!sec.querySelector('.cc-ag-card')) sec.remove();
      });
      const count = document.getElementById('cc-ag-count');
      if (count) count.textContent = grid.querySelectorAll('.cc-ag-card').length;
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
          resultEl.innerHTML += `<span style="color:var(--cc-danger,#f66)">[Error] ${_esc(obj.error || raw)}</span>`;
        } catch (_) {
          resultEl.innerHTML += `<span style="color:var(--cc-danger,#f66)">[Error] ${_esc(raw)}</span>`;
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
// Create form wiring (onCreated callback = full grid refresh)
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
// Grid refresh (renders category sections)
// ---------------------------------------------------------------------------

async function _refreshGrid(container) {
  const grid    = container.querySelector('#cc-ag-grid');
  const countEl = container.querySelector('#cc-ag-count');
  if (!grid) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { agents = [] } = await res.json();
    if (!agents.length) {
      grid.innerHTML = '<div class="cc-empty">No agents registered.</div>';
      return;
    }
    if (countEl) countEl.textContent = agents.length;
    const grouped = _groupAgents(agents);
    grid.innerHTML = CAT_ORDER
      .filter(cat => grouped[cat]?.length)
      .map(cat => {
        const accent = CAT_ACCENT[cat] || CAT_ACCENT.CUSTOM;
        return `<div class="cc-ag-category-section">
  <div class="cc-ag-category-header" style="--cat-accent:${accent}">
    <span class="cc-ag-cat-label">${cat}</span>
    <span class="cc-ag-cat-count">${grouped[cat].length}</span>
  </div>
  <div class="cc-ag-category-grid">${grouped[cat].map(_agentCard).join('')}</div>
</div>`;
      }).join('');
    agents.forEach(a => _wireCard(container, a.id));
  } catch (e) {
    grid.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
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
    <button class="cc-ag-new-btn" id="cc-ag-new-btn">+ New Agent</button>
  </div>
  ${_createForm()}
  <div class="cc-ag-grid" id="cc-ag-grid">
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
  _wireCreateForm(container, () => _refreshGrid(container));
  await _refreshGrid(container);
}
